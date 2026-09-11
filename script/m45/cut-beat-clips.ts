// script/m45/cut-beat-clips.ts — M45.D1, editor-handoff support.
//
// The owner's generative video tools (Kling) cap input at 15 seconds, and the
// raw takes are 35.8s / 28.0s. This script splits each take into per-beat
// clips cut on the MEASURED observed beat boundaries (from D1-session-*.json
// observedTimeline), every clip <= 15s, so a 15s-capped tool can receive each
// beat as an independent input.
//
// Self-verifying per clip: duration (±0.15s), resolution, fps, no audio
// stream, and frame provenance (PSNR vs the source take at the cut point).
// Writes a manifest (clips-manifest.json) pinned to the source take SHA-256.

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "../..")
const SESSION_DIR = path.join(ROOT, "validation/m45/results/demo-session")

const SCENARIOS: Record<
  string,
  { take: string; evidence: string; outPrefix: string; outDir: string }
> = {
  hero: {
    take: "raw-take.mp4",
    evidence: "D1-session-raw.json",
    outPrefix: "hero",
    outDir: path.join(ROOT, "validation/m45/results/demo-session/clips-hero"),
  },
  money: {
    take: "raw-take-money.mp4",
    evidence: "D1-session-money.json",
    outPrefix: "money",
    outDir: path.join(ROOT, "validation/m45/results/demo-session/clips-money"),
  },
}

type Beat = { name: string; observed: string; what: string }

function fail(msg: string): never {
  console.error(`CUT-CLIPS FAIL: ${msg}`)
  process.exit(1)
}

function sh(cmd: string, args: string[], opts?: { capture?: boolean }) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...(opts?.capture ? {} : { stdio: ["ignore", "pipe", "pipe"] }),
  })
  if (r.error) fail(`${cmd} failed to start: ${r.error.message}`)
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 }
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function probe(file: string): { seconds: number; w: number; h: number; fps: number; audio: boolean } {
  const r = sh("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format", "-show_streams",
    file,
  ])
  if (r.status !== 0) fail(`ffprobe failed for ${file}: ${r.stderr.slice(0, 400)}`)
  const j = JSON.parse(r.stdout)
  const v = j.streams?.find((s: { codec_type?: string }) => s.codec_type === "video")
  if (!v) fail(`no video stream in ${file}`)
  const ar = v.avg_frame_rate ?? "30/1"
  const [an, ad] = ar.split("/").map(Number)
  const fps = ad ? an / ad : an
  return {
    seconds: parseFloat(j.format?.duration ?? "0"),
    w: v.width,
    h: v.height,
    fps,
    audio: j.streams?.some((s: { codec_type?: string }) => s.codec_type === "audio") ?? false,
  }
}

// PSNR between a clip's first frame and the source take at the cut point —
// proves the clip actually derives from the committed take (frame provenance).
function psnrAt(clip: string, source: string, sourceT: number): number {
  const tmp = path.join("/tmp", `m45clip-psnr-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmp, { recursive: true })
  const fa = path.join(tmp, "a.png")
  const fb = path.join(tmp, "b.png")
  sh("ffmpeg", ["-y", "-v", "error", "-ss", String(sourceT + 0.05), "-i", source, "-frames:v", "1", fb])
  sh("ffmpeg", ["-y", "-v", "error", "-ss", "0.05", "-i", clip, "-frames:v", "1", fa])
  const r = sh("ffmpeg", ["-v", "info", "-i", fa, "-i", fb, "-filter_complex", "psnr", "-f", "null", "-"], { capture: true })
  const m = /average:(inf|[0-9.]+)/.exec(r.stderr)
  const v = m?.[1] ?? "0"
  return v === "inf" ? 999 : parseFloat(v)
}

function parseObserved(observed: string): [number, number] {
  // formats seen: "0.0-9.5" or "18.0" (single instant)
  const parts = observed.split("-").map((s) => parseFloat(s))
  if (parts.length === 2) return [parts[0], parts[1] + 0.4] // +0.4s guard so the clip includes the settle into the next beat boundary
  // single-instant beats (e.g. "18.0" for the F12 jump): +-1.25s window
  return [parts[0] - 1.25, parts[0] + 1.25]
}

// ---- main ------------------------------------------------------------------

const manifest: Record<string, unknown> = {
  issue: "M45.D1",
  milestone: "M45",
  purpose: "per-beat source clips for generative editing tools with a 3-15s input window (e.g. Kling)",
  generatedAt: new Date().toISOString(),
  clips: [] as Array<Record<string, unknown>>,
}

const MAX_SECONDS = 15
const MIN_SECONDS = 3 // Kling rejects inputs below 3s as well as above 15s
let failures = 0

for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const takePath = path.join(SESSION_DIR, cfg.take)
  if (!existsSync(takePath)) fail(`take missing: ${takePath}`)
  const ev = JSON.parse(readFileSync(path.join(SESSION_DIR, cfg.evidence), "utf8"))
  const beats: Beat[] = ev.observedTimeline.beats
  const src = probe(takePath)
  const takeSha = sha256(takePath)
  mkdirSync(cfg.outDir, { recursive: true })
  // stale clips from earlier runs must not linger — a 1.4s clip that no longer
  // passes the 3s floor would otherwise survive in the folder
  for (const f of readdirSync(cfg.outDir)) {
    if (f.endsWith(".mp4")) unlinkSync(path.join(cfg.outDir, f))
  }

  // Kling accepts only 3-15s: split long beats, then merge any beat shorter
  // than 3s into a neighbor (next preferred, else previous) so every emitted
  // clip fits the tool's window.
  type Plan = { name: string; in: number; out: number }
  const raw: Plan[] = []
  for (const b of beats) {
    const [a, z] = parseObserved(b.observed)
    const dur = z - a
    if (dur <= MAX_SECONDS) {
      raw.push({ name: b.name, in: a, out: Math.min(z, src.seconds) })
      continue
    }
    // split long beats into chunks <= 15s
    let t = a
    let part = 1
    while (t < z - 0.01) {
      const chunk = Math.min(MAX_SECONDS, z - t)
      raw.push({ name: `${b.name}-p${part}`, in: t, out: t + chunk })
      t += chunk
      part++
    }
  }
  const plans: Plan[] = []
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]
    if (p.out - p.in >= MIN_SECONDS) {
      plans.push(p)
      continue
    }
    const next = raw[i + 1]
    if (next && next.out - p.in <= MAX_SECONDS) {
      next.in = p.in
      next.name = `${p.name}+${next.name}`
      continue
    }
    const prev = plans[plans.length - 1]
    if (prev && p.out - prev.in <= MAX_SECONDS) {
      prev.out = p.out
      prev.name = `${prev.name}+${p.name}`
      continue
    }
    plans.push(p) // unmergeable short clip: keep it; the 3s check will flag it
  }
  // drop plans outside the source
  const good = plans.filter((p) => p.in >= 0 && p.out <= src.seconds + 0.5)
  if (good.length === 0) fail(`${scenario}: no valid beat plans derived`)

  console.log(`\n=== ${scenario}: ${good.length} clips from ${cfg.take} (${src.seconds.toFixed(1)}s) ===`)

  for (const p of good) {
    const dur = p.out - p.in
    if (dur > MAX_SECONDS + 0.01) fail(`plan ${p.name} exceeds 15s cap: ${dur}`)
    const out = path.join(cfg.outDir, `${cfg.outPrefix}-${p.name}.mp4`)
    const enc = spawnSync("ffmpeg", [
      "-y", "-v", "error",
      "-ss", p.in.toFixed(2), "-i", takePath,
      "-t", dur.toFixed(2),
      "-an",
      "-c:v", "libx264", "-preset", "slow", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      out,
    ], { encoding: "utf8" })
    if (enc.error || enc.status !== 0) {
      fail(`ffmpeg encode failed for ${p.name}: ${enc.stderr?.slice(0, 300)}`)
    }

    const c = probe(out)
    const checks: Array<{ name: string; pass: boolean; detail: string }> = []
    const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail })
    add("duration ±0.15s", Math.abs(c.seconds - dur) <= 0.15, `${c.seconds.toFixed(2)}s vs ${dur.toFixed(2)}s`)
    add("within 3-15s tool window", c.seconds >= MIN_SECONDS - 0.01 && c.seconds <= MAX_SECONDS + 0.01, `${c.seconds.toFixed(2)}s`)
    add("resolution", c.w === src.w && c.h === src.h, `${c.w}x${c.h}`)
    add("fps", Math.abs(c.fps - src.fps) < 0.01, `${c.fps.toFixed(2)}`)
    add("no audio", c.audio === false, c.audio ? "audio stream present!" : "silent")
    const psnr = psnrAt(out, takePath, p.in)
    const pass = checks.every((k) => k.pass) && psnr >= 30
    add("frame provenance (PSNR vs take)", psnr >= 30, `PSNR ${psnr.toFixed(1)} dB at t=${p.in.toFixed(2)}`)
    if (!pass) failures++

    const size = existsSync(out) ? Math.round(statSync(out).size / 1024) : 0
    console.log(`  ${pass ? "PASS" : "FAIL"} ${path.basename(out)} — ${dur.toFixed(1)}s, ${size} KB, PSNR ${psnr.toFixed(1)} dB`)

    manifest.clips.push({
      scenario,
      name: p.name,
      source: cfg.take,
      sourceSha256: takeSha,
      sourceIn: Number(p.in.toFixed(2)),
      sourceOut: Number(p.out.toFixed(2)),
      seconds: Number(c.seconds.toFixed(2)),
      file: path.relative(ROOT, out),
      bytes: existsSync(out) ? statSync(out).size : 0,
      checks,
    })
  }
}

if (failures > 0) fail(`${failures} clip check(s) failed`)

const manifestPath = path.join(SESSION_DIR, "clips-manifest.json")
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
console.log(`\nALL CLIPS PASS — manifest: ${path.relative(ROOT, manifestPath)}`)
