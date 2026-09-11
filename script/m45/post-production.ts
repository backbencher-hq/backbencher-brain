// script/m45/post-production.ts — M45.D1 light post pass v2 (Layer 2).
//
// History: v1 was rejected by the owner (classical, flat, dilute text).
// Generative tools were tried (Kling) and rejected hard — they regenerate the
// UI (negative colors, redrawn text). Owner decision 2026-09-09: post stays
// in-house, this script, every pixel traceable.
//
// v2 look (in-house ffmpeg only):
//   1. TRIM   — dead holds cut on the measured beat boundaries (hard cuts).
//   2. GRADE  — filmic S-curve + warm amber cast + gentle contrast, then a
//               luma unsharp so code text pops (the "dilute text" fix).
//   3. CAMERA — eased 1.0->1.13 push-ins ONLY on portal beats, anchored to
//               portal centers MEASURED from the take (never guessed).
//   4. TEXTURE — subtle vignette + fine film grain (applied after zoom).
//   5. CAPTIONS — Fraunces italic headline + JetBrains Mono kicker, soft
//               alpha fades, every hold >= 3.4s, never over portal content.
//   6. FADES  — 0.7s in from black, 0.8s out to black (loop-safe seam).
//
// Self-verifying: duration, resolution/fps, caption visibility (band diff),
// camera actually moves (strong-px diff), grade applied but content preserved
// (PSNR window vs the take), fade-in present, silent output. Writes evidence
// (D1-post[-money].json) bound to the take + output sha256.
//
// Run: npx tsx script/m45/post-production.ts [--scenario money]

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { gitHead } from "./capture-harness.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const SESSION = path.join(ROOT, "validation/m45/results/demo-session")
const WORK = "/tmp/m45-post-v2"
const W = 2560, H = 1600, FPS = 30

type Zoom = { cx: number; cy: number; strength: number }
type Segment = { name: string; in: number; out: number; zoom: Zoom | null }
type Caption = { text: string; kicker?: string; ta: number; tb: number }
type Scenario = {
  id: string
  take: string
  evidenceOut: string
  output: string
  poster: { file: string; at: number }
  segments: Segment[]
  captions: Caption[]
}

const HERO: Scenario = {
  id: "hero",
  take: "raw-take.mp4",
  evidenceOut: "D1-post.json",
  output: "hero-cut.mp4",
  poster: { file: "hero-poster.jpg", at: 8.4 },
  segments: [
    { name: "A-establish", in: 3.5, out: 9.5, zoom: null },
    { name: "B-portal-place", in: 9.5, out: 14.2, zoom: { cx: 622, cy: 430, strength: 0.13 } },
    { name: "C-goto-def", in: 15.0, out: 20.0, zoom: null },
    { name: "D-portal-cancel", in: 20.5, out: 29.0, zoom: { cx: 899, cy: 605, strength: 0.13 } },
    { name: "E-references", in: 31.0, out: 35.7, zoom: null },
  ],
  captions: [
    { ta: 0.7, tb: 5.4, text: "Your codebase, already understood.", kicker: "backbencher — local code intelligence" },
    { ta: 6.4, tb: 10.4, text: "Hover any symbol — its full story, in place.", kicker: "hover · OrderService.place — 19 usages" },
    { ta: 11.3, tb: 15.2, text: "Follow the definition without breaking flow.", kicker: "go-to-definition · order-service.ts" },
    { ta: 16.4, tb: 22.9, text: "Who builds it, who calls it — across every file.", kicker: "cancel() · 9 usages · called by handleCancelOrder" },
    { ta: 24.6, tb: 28.0, text: "Every usage, one keystroke away.", kicker: "references · one list, nothing hidden" },
  ],
}

const MONEY: Scenario = {
  id: "money",
  take: "raw-take-money.mp4",
  evidenceOut: "D1-post-money.json",
  output: "hero-cut-money.mp4",
  poster: { file: "hero-poster-money.jpg", at: 9.6 },
  segments: [
    { name: "A-establish", in: 1.0, out: 5.4, zoom: null },
    { name: "B-portal-money", in: 5.4, out: 14.6, zoom: { cx: 614, cy: 674, strength: 0.13 } },
    { name: "C-references", in: 14.6, out: 21.9, zoom: { cx: 538, cy: 596, strength: 0.11 } },
    { name: "D-settle", in: 21.9, out: 27.5, zoom: null },
  ],
  captions: [
    { ta: 0.6, tb: 4.1, text: "One type. Every place it is used.", kicker: "backbencher — local code intelligence" },
    { ta: 5.0, tb: 12.9, text: "Money — 41 usages, every file, one hover.", kicker: "hover · Money — class · 41 usages · 6 files" },
    { ta: 14.2, tb: 20.2, text: "Six files, one list — nothing hidden.", kicker: "references · shift+F12" },
    { ta: 21.5, tb: 25.7, text: "Every usage, one keystroke away.", kicker: "bb — code intelligence that stays local" },
  ],
}

function sh(cmd: string, args: string[], capture = false) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...(capture ? {} : { stdio: ["ignore", "pipe", "pipe"] }) })
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`)
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 }
}
function sha256(p: string) { return createHash("sha256").update(readFileSync(p)).digest("hex") }
function gray(src: string, t: number, tag: string): Buffer {
  const f = path.join(WORK, `${tag}.gray`)
  sh("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", src, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${W}x${H}`, f])
  const b = readFileSync(f)
  if (b.length !== W * H) throw new Error(`gray frame wrong size ${b.length}`)
  return b
}
function strongDiff(a: Buffer, b: Buffer, y0 = 0, y1 = H): number {
  let n = 0
  for (let y = y0; y < y1; y += 2) for (let x = 0; x < W; x += 5) { const i = y * W + x; if (Math.abs(a[i]! - b[i]!) > 25) n++ }
  return n
}
function meanLuma(buf: Buffer): number { let s = 0; for (let i = 0; i < buf.length; i += 7) s += buf[i]!; return s / (buf.length / 7) }
function psnr(fa: string, fb: string): number {
  const r = sh("ffmpeg", ["-v", "info", "-i", fa, "-i", fb, "-filter_complex", "psnr", "-f", "null", "-"], true)
  const m = /average:(inf|[0-9.]+)/.exec(r.stderr)
  const v = m?.[1] ?? "0"
  return v === "inf" ? 999 : parseFloat(v)
}

// Grade chain: filmic S-curve -> warm amber cast -> contrast -> text-crisping
// unsharp. Applied per segment (before camera + texture).
const GRADE = [
  "curves=all='0/0.02 0.5/0.55 1/1'",
  "colorbalance=rs=0.04:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03:rh=0.02:bh=-0.02",
  "eq=contrast=1.07:brightness=0.012:saturation=1.05:gamma=1.03",
  "unsharp=lx=7:ly=7:la=0.35",
].join(",")
const TEXTURE = "vignette=PI/4.8,noise=alls=5:allf=t+u"
const FONTS = {
  headline: path.join(ROOT, "script/m45/film/fonts/Fraunces-600Italic.ttf"),
  kicker: path.join(ROOT, "script/m45/film/fonts/JetBrainsMono-Regular.ttf"),
}

function zoomFilter(z: Zoom, dur: number): string {
  const frames = Math.max(2, Math.round(dur * FPS))
  const p = `min(in/${frames - 1}\\,1)`
  const e = `(${p}*${p}*(3-2*${p}))`
  const zExpr = `1+${z.strength}*${e}`
  const x = `clip(${z.cx}-iw/(2*zoom)\\,0\\,iw-iw/zoom)`
  const y = `clip(${z.cy}-ih/(2*zoom)\\,0\\,ih-ih/zoom)`
  return `zoompan=z='${zExpr}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${FPS}`
}

function drawtext(file: string, font: string, size: number, y: number, color: string, ta: number, tb: number): string {
  const alpha = `'if(lt(t,${ta}),0,if(lt(t,${ta + 0.5}),(t-${ta})/0.5,if(lt(t,${tb - 0.5}),1,if(lt(t,${tb}),(${tb}-t)/0.5,0))))'`
  return `drawtext=fontfile=${font}:textfile=${file}:fontcolor=${color}:fontsize=${size}:x=150:y=${y}:shadowcolor=black@0.8:shadowx=2:shadowy=3:alpha=${alpha}`
}

function main(): void {
  const scenario = process.argv.includes("--scenario") ? process.argv[process.argv.indexOf("--scenario") + 1]! : "hero"
  const S = scenario === "money" ? MONEY : HERO
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })

  const takePath = path.join(SESSION, S.take)
  const takeSha = sha256(takePath)
  const planSeconds = S.segments.reduce((a, s) => a + (s.out - s.in), 0)
  const checks: { name: string; pass: boolean; detail: string }[] = []
  const add = (name: string, pass: boolean, detail = "") => { checks.push({ name, pass, detail }); console.log(`  ${pass ? "PASS" : "FAIL"} ${name} — ${detail}`) }

  // ---- caption text files (textfile= avoids all filtergraph escaping) ----
  const capFiles: { cap: Caption; head: string; kick: string | null }[] = S.captions.map((cap, i) => {
    const head = path.join(WORK, `cap-${i}.txt`)
    writeFileSync(head, cap.text)
    let kick: string | null = null
    if (cap.kicker) { kick = path.join(WORK, `kick-${i}.txt`); writeFileSync(kick, cap.kicker) }
    return { cap, head, kick }
  })

  // ---- 1. per-segment: trim + grade + camera ----
  const segFiles: string[] = []
  let globalStart = 0
  const segGlobal: Record<string, { start: number; end: number }> = {}
  for (const seg of S.segments) {
    const out = path.join(WORK, `${seg.name}.mp4`)
    const dur = seg.out - seg.in
    const vf = [GRADE, ...(seg.zoom ? [zoomFilter(seg.zoom, dur)] : []), TEXTURE].join(",")
    const r = sh("ffmpeg", ["-y", "-v", "error", "-ss", seg.in.toFixed(2), "-i", takePath, "-t", dur.toFixed(2), "-an", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", out])
    if (r.status !== 0) throw new Error(`segment ${seg.name} encode failed: ${r.stderr.slice(0, 300)}`)
    segGlobal[seg.name] = { start: globalStart, end: globalStart + dur }
    globalStart += dur
    segFiles.push(out)
  }

  // ---- 2. concat ----
  const list = path.join(WORK, "concat.txt")
  writeFileSync(list, segFiles.map((f) => `file '${f}'`).join("\n"))
  const concatFile = path.join(WORK, "graded.mp4")
  sh("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", concatFile])

  // ---- 3. final: fades + captions ----
  const finalPath = path.join(SESSION, S.output)
  const total = planSeconds
  const vf: string[] = [`fade=t=in:st=0:d=0.7`, `fade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8`]
  for (const { cap, head, kick } of capFiles) {
    if (kick) vf.push(drawtext(kick, FONTS.kicker, 25, 1294, "#C9A36B", cap.ta, cap.tb))
    vf.push(drawtext(head, FONTS.headline, 56, 1348, "#F1E9DD", cap.ta, cap.tb))
  }
  const r = sh("ffmpeg", ["-y", "-v", "error", "-i", concatFile, "-vf", vf.join(","), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", finalPath])
  if (r.status !== 0) throw new Error(`final encode failed: ${r.stderr.slice(0, 300)}`)

  // ---- 4. poster ----
  sh("ffmpeg", ["-y", "-v", "error", "-ss", String(S.poster.at), "-i", finalPath, "-frames:v", "1", "-q:v", "2", path.join(SESSION, S.poster.file)])

  // ---- 5. self-checks ----
  const probe = (f: string) => JSON.parse(sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", f], true).stdout)
  const pj = probe(finalPath)
  const v = pj.streams.find((s: { codec_type?: string }) => s.codec_type === "video")
  const dur = parseFloat(pj.format.duration)
  add("duration matches plan ±0.5s", Math.abs(dur - planSeconds) <= 0.5, `${dur.toFixed(2)}s vs ${planSeconds.toFixed(2)}s`)
  add("resolution + fps", v?.width === W && v?.height === H, `${v?.width}x${v?.height} @ ${v?.avg_frame_rate}`)
  add("silent output", !pj.streams.some((s: { codec_type?: string }) => s.codec_type === "audio"))

  // fade-in: near-black at 0.08s, visible at 1.6s
  const l0 = meanLuma(gray(finalPath, 0.08, "f0"))
  const l1 = meanLuma(gray(finalPath, 1.6, "f1"))
  add("fade-in from black", l0 < 20 && l1 > 15, `luma(0.08)=${l0.toFixed(1)}, luma(1.6)=${l1.toFixed(1)}`)

  // captions visible: band diff between caption-mid frame and post-caption frame
  const BAND_Y0 = 1260, BAND_Y1 = H - 60
  for (const cap of S.captions) {
    const mid = (cap.ta + cap.tb) / 2
    const outside = cap.tb + 0.7 < dur ? cap.tb + 0.7 : Math.max(0.1, cap.ta - 0.7)
    const d = strongDiff(gray(finalPath, mid, "cm"), gray(finalPath, outside, "co"), BAND_Y0, BAND_Y1)
    add(`caption visible: "${cap.text.slice(0, 34)}…"`, d > 3000, `${d} band-diff px`)
  }

  // camera actually moves on zoom segments (editor region, excludes caption band)
  const Y1 = 1250
  for (const seg of S.segments) {
    if (!seg.zoom) continue
    const g = segGlobal[seg.name]!
    const d = strongDiff(gray(finalPath, g.start + 0.4, "zs"), gray(finalPath, g.end - 0.4, "ze"), 120, Y1)
    add(`push-in moves: ${seg.name}`, d > 4000, `${d} strong-px in editor region`)
  }

  // grade applied but content preserved (PSNR window vs the take, establish seg)
  const a = S.segments[0]!
  const srcT = a.in + 2.0
  const outT = 2.0
  sh("ffmpeg", ["-y", "-v", "error", "-ss", String(outT), "-i", finalPath, "-frames:v", "1", path.join(WORK, "pg.png")])
  sh("ffmpeg", ["-y", "-v", "error", "-ss", String(srcT), "-i", takePath, "-frames:v", "1", path.join(WORK, "ps.png")])
  const pv = psnr(path.join(WORK, "pg.png"), path.join(WORK, "ps.png"))
  add("graded, same content (PSNR window 15-42 dB)", pv >= 15 && pv <= 42, `PSNR ${pv.toFixed(1)} dB`)

  // pacing contract
  const short = S.captions.filter((c) => c.tb - c.ta < 3.0)
  add("pacing: every caption holds >= 3s", short.length === 0, short.map((c) => c.text).join(";") || `min hold ${Math.min(...S.captions.map((c) => c.tb - c.ta)).toFixed(1)}s`)

  const failed = checks.filter((c) => !c.pass)
  const evidence = {
    issue: "M45.D1", code: "D1", milestone: "M45",
    status: failed.length === 0 ? "verified" : "known-gap",
    currentCommit: gitHead(ROOT),
    verifierCommand: "npx tsx script/m45/post-production.ts" + (scenario === "money" ? " --scenario money" : ""),
    evidenceFile: S.evidenceOut,
    scenario: S.id,
    postVersion: 2,
    input: { take: S.take, sha256: takeSha },
    output: { file: S.output, sha256: sha256(finalPath), seconds: Number(dur.toFixed(2)), resolution: `${W}x${H}`, fps: FPS, poster: S.poster.file },
    segments: S.segments.map((s) => ({ name: s.name, in: s.in, out: s.out, zoom: !!s.zoom })),
    anchors: Object.fromEntries(S.segments.filter((s) => s.zoom).map((s) => [s.name, { center: [s.zoom!.cx, s.zoom!.cy], bboxPx: 200 }])),
    captions: S.captions,
    grade: GRADE + " | " + TEXTURE,
    fonts: { headline: "Fraunces-600Italic.ttf", kicker: "JetBrainsMono-Regular.ttf", license: "OFL (fonts/OFL.txt)" },
    checks,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(SESSION, S.evidenceOut), JSON.stringify(evidence, null, 2) + "\n")

  console.log(`\n${S.id} post v2: ${failed.length === 0 ? "VERIFIED" : "FAILED"} (${checks.filter((c) => c.pass).length}/${checks.length})`)
  if (failed.length > 0) process.exit(1)
}

main()
