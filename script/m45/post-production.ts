// script/m45/post-production.ts — M45.D1 light post pass (Layer 2).
//
// Owner decision 2026-09-07: the film pivot is REAL session footage (the
// raw take from session-driver.ts); post-production stays light and
// anchored:
//   1. TRIM — cut the dead holds, keep the real transitions (hard cuts).
//   2. GRADE — subtle contrast/brightness lift (owner: text read dilute).
//   3. PUSH — gentle 1.0→1.15 zoom toward the hover portal, anchored to
//      portal centers MEASURED from the take itself (frame-diff), never
//      guessed — the failure mode of the abandoned stills film.
//   4. CAPTIONS — Fraunces italic headline + JetBrains Mono kicker, every
//      hold >= 3.4s (owner pacing contract: nothing reads too fast).
// The script self-verifies its output (duration, resolution, caption
// presence, camera-move delta) and writes D1-post.json evidence.
//
// Run: npx tsx script/m45/post-production.ts
// Output: validation/m45/results/demo-session/hero-cut.mp4 + D1-post.json

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { gitHead } from "./capture-harness.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const SESSION_DIR = path.join(ROOT, "validation/m45/results/demo-session")
const WORK = path.join(tmpdir(), "m45-post")
const FONTS = path.join(ROOT, "script/m45/film/fonts")
const FRAUNCES = path.join(FONTS, existsSync(path.join(FONTS, "Fraunces-600Italic.ttf")) ? "Fraunces-600Italic.ttf" : "Fraunces-Italic.ttf")
const MONO = path.join(FONTS, "JetBrainsMono-Regular.ttf")
const W = 2560, H = 1600, FPS = 30

interface PostSegment { name: string; in: number; out: number; zoom: { midT: number; preT: number } | null }
interface PostCaption { seg: string; ta: number; tb: number; text: string; kicker?: string }
interface PostScenario {
  id: string
  take: string
  out: string
  evidenceFile: string
  segments: readonly PostSegment[]
  captions: readonly PostCaption[]
}

const HERO: PostScenario = {
  id: "hero",
  take: "raw-take.mp4",
  out: "hero-cut.mp4",
  evidenceFile: "D1-post.json",
  // In/out points follow the observed timeline in D1-session-raw.json; ~29s total.
  segments: [
    { name: "A-establish", in: 3.5, out: 9.5, zoom: null },
    { name: "B-portal-place", in: 9.5, out: 14.2, zoom: { midT: 12.0, preT: 9.6 } },
    { name: "C-goto-def", in: 15.0, out: 20.0, zoom: null },
    { name: "D-portal-cancel", in: 20.5, out: 29.0, zoom: { midT: 25.0, preT: 21.0 } },
    { name: "E-references", in: 31.0, out: 35.7, zoom: null },
  ],
  // Captions in OUTPUT-global time (segment offsets accumulated).
  captions: [
    { seg: "A-establish", ta: 0.6, tb: 5.6, text: "Your codebase, already understood.", kicker: "backbencher · local code intelligence" },
    { seg: "B-portal-place", ta: 7.0, tb: 10.4, text: "Hover any symbol — its full story, in place." },
    { seg: "C-goto-def", ta: 11.5, tb: 15.4, text: "Jump to the definition without breaking flow." },
    { seg: "D-portal-cancel", ta: 17.8, tb: 23.8, text: "Who builds it, who calls it — across every file." },
    { seg: "E-references", ta: 25.0, tb: 28.5, text: "Every usage, one keystroke away.", kicker: "bb · code intelligence that stays local" },
  ],
}

const MONEY: PostScenario = {
  id: "money",
  take: "raw-take-money.mp4",
  out: "hero-cut-money.mp4",
  evidenceFile: "D1-post-money.json",
  // Observed timeline (1s frame-diff scan): the portal opens between t=5-6
  // (102,944 px transition) and holds to ~14.4; references peek 15.5-20.5;
  // browse ~20.5-21.5; settle 22+. The choreography clock ran ~3s ahead of
  // the recording clock — segments follow the SCAN, not the nominal table.
  segments: [
    { name: "A-establish", in: 1.0, out: 5.4, zoom: null },
    { name: "B-portal-money", in: 5.4, out: 14.6, zoom: { midT: 12.0, preT: 5.0 } },
    { name: "C-references", in: 14.6, out: 21.9, zoom: { midT: 18.0, preT: 14.5 } },
    { name: "D-settle", in: 21.9, out: 27.5, zoom: null },
  ],
  captions: [
    { seg: "A-establish", ta: 0.5, tb: 4.2, text: "One type. Every place it is used.", kicker: "backbencher · local code intelligence" },
    { seg: "B-portal-money", ta: 6.0, tb: 13.0, text: "Money — 41 usages, every file, one hover." },
    { seg: "C-references", ta: 14.8, tb: 20.6, text: "Six files, one list — nothing hidden." },
    { seg: "D-settle", ta: 21.8, tb: 25.8, text: "Every usage, one keystroke away.", kicker: "bb · code intelligence that stays local" },
  ],
}

const scenarioFlag = process.argv.includes("--scenario") ? process.argv[process.argv.indexOf("--scenario") + 1] : undefined
const SCENARIO = scenarioFlag === "money" ? MONEY : HERO

function sh(cmd: string): string {
  return execFileSync("bash", ["-c", cmd], { cwd: ROOT, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] })
}
function run(file: string, args: string[]): void {
  execFileSync(file, args, { cwd: ROOT, timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] })
}
function sha256(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}

// One grayscale frame as a raw buffer — no image library needed.
function grayFrame(src: string, t: number): Buffer {
  const out = path.join(WORK, `g-${Math.random().toString(36).slice(2)}.gray`)
  run("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", src, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${W}x${H}`, out])
  const buf = readFileSync(out)
  rmSync(out, { force: true })
  if (buf.length !== W * H) throw new Error(`gray frame wrong size: ${buf.length}`)
  return buf
}

// Bounding box of strongly-different pixels inside the editor search
// region — where hover portals render (upper-left code area).
const SEARCH = { x0: 100, y0: 150, x1: 1700, y1: 1200 }
function diffBbox(a: Buffer, b: Buffer, threshold = 40): { cx: number; cy: number; w: number; h: number; px: number } | null {
  let minX = W, minY = H, maxX = 0, maxY = 0, px = 0
  for (let y = SEARCH.y0; y < SEARCH.y1; y += 2) {
    for (let x = SEARCH.x0; x < SEARCH.x1; x += 2) {
      const i = y * W + x
      if (Math.abs(a[i] - b[i]) > threshold) {
        px++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (px < 200) return null
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY, px }
}

function zoomFilter(cx: number, cy: number, dur: number): string {
  const frames = Math.round(dur * FPS)
  // Progress driven by `in` (input frame index). `on` with d=1 on video
  // input is always 0 within its frame group — the zoom silently became
  // 1.0 constant in the first run (caught by the camera-move check).
  const p = `min(in\\,${frames})/${frames}`
  const IW = W * 2, IH = H * 2, Z = 1.15
  const wx = IW / Z, wy = IH / Z
  const tx = Math.max(0, Math.min(2 * cx - wx / 2, IW - wx))
  const ty = Math.max(0, Math.min(2 * cy - wy / 2, IH - wy))
  return [
    "eq=contrast=1.05:brightness=0.012:saturation=1.04",
    `scale=${IW}:${IH}:flags=lanczos`,
    `zoompan=z='1+0.15*${p}':x='${tx.toFixed(1)}*${p}':y='${ty.toFixed(1)}*${p}':d=1:s=${W}x${H}:fps=${FPS}`,
  ].join(",")
}
function plainFilter(): string {
  return "eq=contrast=1.05:brightness=0.012:saturation=1.04,fps=30"
}

function drawtextCaption(c: PostCaption, ta: number, tb: number): string {
  const A = ta.toFixed(2), B = tb.toFixed(2)
  const alpha = `if(lt(t\\,${A})\\,0\\,if(lt(t\\,${A}+0.5)\\,(t-${A})/0.5\\,if(lt(t\\,${B}-0.5)\\,1\\,if(lt(t\\,${B})\\,(${B}-t)/0.5\\,0))))`
  const parts = [
    `drawtext=fontfile=${FRAUNCES}:text='${c.text}':fontsize=88:fontcolor=white:alpha='${alpha}':x=(w-text_w)/2:y=h-340:shadowcolor=black@0.45:shadowx=0:shadowy=4:enable='between(t\\,${A}\\,${B})'`,
  ]
  if (c.kicker) {
    parts.push(`drawtext=fontfile=${MONO}:text='${c.kicker}':fontsize=34:fontcolor=0xC9A36B@0.95:alpha='${alpha}':x=(w-text_w)/2:y=h-215:enable='between(t\\,${A}\\,${B})'`)
  }
  return parts.join(",")
}

async function main(): Promise<void> {
  const commit = gitHead(ROOT)
  const TAKE = path.join(SESSION_DIR, SCENARIO.take)
  const OUT = path.join(SESSION_DIR, SCENARIO.out)
  const SEGMENTS = SCENARIO.segments
  const CAPTIONS = SCENARIO.captions
  if (!existsSync(TAKE)) throw new Error(`raw take missing: ${TAKE}`)
  rmSync(WORK, { recursive: true, force: true })
  execFileSync("mkdir", ["-p", WORK])
  rmSync(OUT, { force: true })
  const checks: { name: string; pass: boolean; detail: string }[] = []
  const anchorNotes: Record<string, unknown> = {}

  // 1. Measure portal anchors from the take itself.
  for (const seg of SEGMENTS) {
    if (!seg.zoom) continue
    const mid = grayFrame(TAKE, seg.zoom.midT)
    const pre = grayFrame(TAKE, seg.zoom.preT)
    const bbox = diffBbox(mid, pre)
    if (!bbox) throw new Error(`portal not measurable for ${seg.name} (no strong diff)`)
    anchorNotes[seg.name] = { center: [Math.round(bbox.cx), Math.round(bbox.cy)], bboxPx: bbox.px, w: Math.round(bbox.w), h: Math.round(bbox.h) }
    seg.anchor = { cx: bbox.cx, cy: bbox.cy }
    console.log(`  anchor ${seg.name}: portal center (${Math.round(bbox.cx)}, ${Math.round(bbox.cy)}), ${bbox.px} diff px`)
  }

  // 2. Extract segments (trim + grade [+ anchored push]).
  const segFiles: string[] = []
  for (const seg of SEGMENTS) {
    const dur = seg.out - seg.in
    const segPath = path.join(WORK, `${seg.name}.mp4`)
    const vf = seg.zoom && seg.anchor ? zoomFilter(seg.anchor.cx, seg.anchor.cy, dur) : plainFilter()
    run("ffmpeg", ["-y", "-v", "error", "-ss", String(seg.in), "-i", TAKE, "-t", String(dur), "-vf", vf, "-an", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", segPath])
    segFiles.push(segPath)
    console.log(`  segment ${seg.name}: ${dur.toFixed(1)}s`)
  }

  // 3. Concat (same codec params -> stream copy).
  const listPath = path.join(WORK, "list.txt")
  writeFileSync(listPath, segFiles.map((f) => `file '${f}'`).join("\n") + "\n")
  const nocap = path.join(WORK, "nocap.mp4")
  run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", nocap])

  // 4. Captions + edge fades (single re-encode).
  const total = SEGMENTS.reduce((s, seg) => s + (seg.out - seg.in), 0)
  const captionChain = CAPTIONS.flatMap((c) => {
    // ta/tb are already OUTPUT-global (segment offsets accumulated into
    // them by design) — adding the offset here again pushed captions past
    // EOF in the first run.
    return [drawtextCaption(c, c.ta, c.tb)]
  })
  const vfOut = [
    `fade=t=in:st=0:d=0.6`,
    `fade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8`,
    ...captionChain,
  ].join(",")
  run("ffmpeg", ["-y", "-v", "error", "-i", nocap, "-vf", vfOut, "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", OUT])
  console.log(`  hero cut rendered (${SCENARIO.id}): ${total.toFixed(1)}s -> ${path.relative(ROOT, OUT)}`)

  // 5. Self-verification — the post pass proves itself or fails loudly.
  const duration = parseFloat(sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${OUT}"`).trim())
  const dims = sh(`ffprobe -v error -show_entries stream=width,height -of csv=p=0 "${OUT}"`).trim().split(",")
  const fps = sh(`ffprobe -v error -show_entries stream=r_frame_rate -of csv=p=0 "${OUT}"`).trim()
  checks.push({ name: "duration within 0.5s of plan", pass: Math.abs(duration - total) < 0.5, detail: `${duration.toFixed(2)}s vs ${total.toFixed(2)}s plan` })
  checks.push({ name: "resolution + fps", pass: dims[0] === String(W) && dims[1] === String(H) && fps === "30/1", detail: `${dims.join("x")} @ ${fps}` })

  // Captions: bottom-band diff between just-before-caption and caption-on.
  for (const c of CAPTIONS) {
    const before = grayFrame(OUT, c.ta - 0.2)
    const on = grayFrame(OUT, c.ta + 1.2)
    let band = 0
    for (let y = H - 460; y < H - 120; y += 2) for (let x = 300; x < W - 300; x += 2) {
      const i = y * W + x
      if (Math.abs(before[i] - on[i]) > 30) band++
    }
    checks.push({ name: `caption visible: "${c.text.slice(0, 28)}…"`, pass: band > 1500, detail: `${band} changed px in caption band` })
  }

  // Camera move: count strong-diff pixels in the editor region between B
  // start (zoom ~1.0) and B end (zoom 1.15). A mean-based threshold is
  // blind here — the IDE frame is mostly flat background, so displacement
  // only shows at text edges (calibrated: ~21k px when zooming, ~0 when
  // the zoom silently failed in the first run).
  {
    const b = SEGMENTS.find((s) => s.zoom)!
    const bIdx = SEGMENTS.indexOf(b)
    const bOffset = SEGMENTS.slice(0, bIdx).reduce((s, x) => s + (x.out - x.in), 0)
    const a = grayFrame(OUT, bOffset + 0.4)
    const z = grayFrame(OUT, bOffset + (b.out - b.in) - 0.3)
    let strong = 0
    for (let y = SEARCH.y0; y < SEARCH.y1; y += 2) {
      for (let x = SEARCH.x0; x < SEARCH.x1; x += 2) {
        const i = y * W + x
        if (Math.abs(a[i] - z[i]) > 25) strong++
      }
    }
    checks.push({ name: "anchored push-in actually moves the camera", pass: strong > 8000, detail: `${strong} strong-diff px in editor region between B start and B end` })
  }

  // 6. Evidence.
  const ok = checks.every((c) => c.pass)
  const evidence = {
    issue: "M45.D1", code: "D1", milestone: "M45",
    status: ok ? "verified" : "known-gap", currentCommit: commit,
    verifierCommand: `npx tsx script/m45/post-production.ts${SCENARIO.id === "hero" ? "" : " --scenario " + SCENARIO.id}`,
    evidenceFile: SCENARIO.evidenceFile,
    input: { take: SCENARIO.take, sha256: sha256(TAKE) },
    output: { file: SCENARIO.out, sha256: sha256(OUT), seconds: duration, resolution: `${W}x${H}`, fps: 30 },
    scenario: SCENARIO.id,
    segments: SEGMENTS.map((s) => ({ name: s.name, in: s.in, out: s.out, zoom: Boolean(s.zoom) })),
    anchors: anchorNotes,
    captions: CAPTIONS,
    grade: "eq=contrast=1.05:brightness=0.012:saturation=1.04",
    fonts: { headline: path.basename(FRAUNCES), kicker: "JetBrainsMono-Regular.ttf", license: "OFL (fonts/OFL.txt)" },
    checks,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(SESSION_DIR, SCENARIO.evidenceFile), JSON.stringify(evidence, null, 2) + "\n")

  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}: ${c.name} (${c.detail})`)
  if (!ok) {
    console.log("\nD1 post pass: KNOWN-GAP — self-checks failed, hero cut not trustworthy")
    process.exit(1)
  }
  console.log("\nD1 post pass: VERIFIED — hero cut rendered + self-checked")
}

main().catch((e) => { console.error(`D1 post pass FAILED: ${e.message}`); process.exit(1) })
