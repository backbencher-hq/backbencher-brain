// script/m45/session-driver.ts — M45.D1, the raw-take recorder.
//
// Records a REAL scripted session: real VS Code under Xvfb, the real bb-lsp
// VSIX, real cursor movement via xdotool, real hover portals, real
// go-to-definition and references UI — captured as h264 video with ffmpeg
// x11grab. This is Layer 1 for the session-based film pivot (owner decision
// 2026-09-07): the footage IS the product working, nothing composited.
//
// Pacing contract (owner feedback: captions/zooms moved too fast in the
// stills film): every on-screen product beat holds >= 3s; the take runs
// ~36s with five beats and generous dwell.
//
// Run: npx tsx script/m45/session-driver.ts [--out /abs/dir]
// Output: <out>/raw-take.mp4, <out>/probes/*.png, capture-manifest.json,
//         D1-session-raw.json

import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  indexCorpus,
  readDbStats,
  writeCaptureManifest,
  sha256File,
  gitHead,
  toolVersions,
} from "./capture-harness.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const VSIX_PATH = path.join(ROOT, "ide/vscode/bb-lsp-vscode-0.1.0.vsix")
const STUDIO_REL = "test/fixtures/m45-studio"
const STUDIO_ABS = path.join(ROOT, STUDIO_REL)

// Same film-grade surface as capture-driver --film: 2x scale on a
// 2560x1600 grab = retina-class pixels with push-in headroom.
const SCREEN = "2560x1600"
const GRAB_W = 2560
const GRAB_H = 1600
const SCALE = "2"
const DISPLAY = process.env.M45_DISPLAY ?? "98"

function sh(cmd: string, timeoutMs = 60_000): string {
  return execFileSync("bash", ["-c", cmd], { cwd: ROOT, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] })
}
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

type Step =
  | { do: "sleep"; ms: number }
  | { do: "key"; keys: string; ms: number }
  | { do: "type"; text: string; ms: number }
  | { do: "rights"; count: number; each: number }

interface Scenario {
  id: string
  take: string
  evidenceFile: string
  probesDir: string
  openRel: string
  recordSeconds: number
  beats: readonly { t: number; name: string; what: string }[]
  steps: readonly Step[]
  probes: readonly (readonly [string, number])[]
  proofs: readonly { name: string; file: string; line: number; character: number }[]
}

// HERO — the approved first film: place() portal, go-to-definition,
// cancel() portal, references. Step list replicates the original inline
// choreography byte-for-byte (same keys, same waits).
const HERO_STEPS: readonly Step[] = [
  { do: "sleep", ms: 3500 },
  { do: "key", keys: "ctrl+b", ms: 1000 },
  { do: "key", keys: "ctrl+g", ms: 900 },
  { do: "type", text: "21", ms: 700 },
  { do: "key", keys: "Return", ms: 800 },
  { do: "key", keys: "Home", ms: 300 },
  { do: "rights", count: 27, each: 35 },
  { do: "sleep", ms: 1000 },
  { do: "key", keys: "ctrl+k ctrl+i", ms: 5000 },
  { do: "key", keys: "Escape", ms: 700 },
  { do: "key", keys: "F12", ms: 2800 },
  { do: "key", keys: "ctrl+g", ms: 900 },
  { do: "type", text: "51", ms: 700 },
  { do: "key", keys: "Return", ms: 800 },
  { do: "key", keys: "Home", ms: 300 },
  { do: "rights", count: 3, each: 35 },
  { do: "sleep", ms: 1000 },
  { do: "key", keys: "ctrl+k ctrl+i", ms: 5000 },
  { do: "key", keys: "Escape", ms: 600 },
  { do: "key", keys: "shift+F12", ms: 4500 },
  { do: "key", keys: "Escape", ms: 500 },
  { do: "key", keys: "ctrl+Home", ms: 3500 },
]

// MONEY — the breadth film: one hover on the corpus's most-connected type
// ("class, 41 usages" across 6 files, verified via the live LSP probe).
const MONEY_STEPS: readonly Step[] = [
  { do: "sleep", ms: 4000 },
  { do: "key", keys: "ctrl+b", ms: 1000 },
  { do: "key", keys: "ctrl+g", ms: 900 },
  { do: "type", text: "5", ms: 700 },
  { do: "key", keys: "Return", ms: 800 },
  { do: "key", keys: "Home", ms: 300 },
  { do: "rights", count: 15, each: 35 },
  { do: "sleep", ms: 1000 },
  { do: "key", keys: "ctrl+k ctrl+i", ms: 5500 },
  { do: "key", keys: "Escape", ms: 700 },
  { do: "key", keys: "shift+F12", ms: 5000 },
  { do: "key", keys: "Down", ms: 500 },
  { do: "key", keys: "Down", ms: 500 },
  { do: "key", keys: "Down", ms: 500 },
  { do: "key", keys: "Escape", ms: 600 },
  { do: "key", keys: "ctrl+Home", ms: 3000 },
]

const SCENARIOS: Record<string, Scenario> = {
  hero: {
    id: "hero",
    take: "raw-take.mp4",
    evidenceFile: "D1-session-raw.json",
    probesDir: "probes",
    openRel: "src/routing/orders-router.ts",
    recordSeconds: 36,
    beats: [
      { t: 0.5, name: "establish", what: "orders-router.ts open, explorer visible, cursor parked" },
      { t: 4.5, name: "focus", what: "ctrl+b — explorer slides away (real VS Code animation)" },
      { t: 5.5, name: "navigate", what: "ctrl+g line 21, Home, 27x Right — text cursor inside `place`" },
      { t: 9.0, name: "hover-place", what: "ctrl+k ctrl+i — rich portal over the place() call site" },
      { t: 14.0, name: "goto-def", what: "escape (dismiss portal), F12 — real go-to-definition into order-service.ts" },
      { t: 17.0, name: "navigate-2", what: "ctrl+g line 51, Home, 3x Right — text cursor on `cancel`" },
      { t: 20.0, name: "hover-cancel", what: "ctrl+k ctrl+i — rich portal over cancel()" },
      { t: 25.0, name: "references", what: "escape, shift+f12 — references peek with cross-file usages" },
      { t: 30.5, name: "settle", what: "escape, ctrl+home — settle on the service file" },
    ],
    steps: HERO_STEPS,
    probes: [
      ["01-establish.png", 5.0], ["02-hover-place.png", 12.0], ["03-goto-def.png", 19.5],
      ["04-hover-cancel.png", 25.0], ["05-references.png", 33.0],
    ],
    proofs: [
      { name: "place", file: "routing/orders-router.ts", line: 20, character: 25 },
      { name: "cancel", file: "services/order-service.ts", line: 50, character: 2 },
    ],
  },
  money: {
    id: "money",
    take: "raw-take-money.mp4",
    evidenceFile: "D1-session-money.json",
    probesDir: "probes-money",
    openRel: "src/money.ts",
    recordSeconds: 28,
    beats: [
      { t: 0.5, name: "establish", what: "money.ts open, explorer visible" },
      { t: 4.7, name: "focus", what: "ctrl+b — explorer slides away" },
      { t: 5.7, name: "navigate", what: "ctrl+g line 5, Home, 15x Right — text cursor on `Money`" },
      { t: 8.8, name: "hover-money", what: "ctrl+k ctrl+i — portal over Money (class, 41 usages, 6 files)" },
      { t: 14.5, name: "references", what: "escape, shift+f12 — every usage in one view" },
      { t: 20.0, name: "browse", what: "Down through the usage list" },
      { t: 22.0, name: "settle", what: "escape, ctrl+home" },
    ],
    steps: MONEY_STEPS,
    probes: [
      ["01-establish.png", 3.0], ["02-hover-money.png", 11.5], ["03-references.png", 18.5], ["04-settle.png", 25.0],
    ],
    proofs: [
      { name: "money", file: "money.ts", line: 4, character: 14 },
    ],
  },
}

const scenarioFlag = process.argv.includes("--scenario") ? process.argv[process.argv.indexOf("--scenario") + 1] : undefined
const SCENARIO = SCENARIOS[scenarioFlag ?? "hero"]
if (!SCENARIO) throw new Error(`unknown scenario: ${scenarioFlag}`)

async function main(): Promise<void> {
  const outArg = process.argv.indexOf("--out")
  const OUT_DIR = outArg >= 0 && process.argv[outArg + 1]
    ? path.resolve(process.argv[outArg + 1]!)
    : path.join(ROOT, "validation/m45/results/demo-session")
  const PROBES = path.join(OUT_DIR, SCENARIO.probesDir)
  const takePath = path.join(OUT_DIR, SCENARIO.take)
  const evidencePath = path.join(OUT_DIR, SCENARIO.evidenceFile)
  // Scenario-specific cleanup only — other scenarios' committed artifacts
  // in this dir must survive a rerun.
  rmSync(PROBES, { recursive: true, force: true })
  rmSync(takePath, { force: true })
  rmSync(evidencePath, { force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const commit = gitHead(ROOT)
  const bbVersion = sh("node bin/bb --version").trim()
  const vsixSha256 = sha256File(VSIX_PATH)
  const tools = toolVersions()
  console.log(`D1 raw take — real session recording (scenario: ${SCENARIO.id})\n`)
  console.log(`  corpus: ${STUDIO_REL} @ ${commit.slice(0, 8)}`)

  // 1. Preconditions.
  if (!existsSync(VSIX_PATH)) throw new Error(`VSIX missing: ${VSIX_PATH}`)
  if (!existsSync(path.join(STUDIO_ABS, "src", "services", "order-service.ts"))) throw new Error("studio corpus missing")
  if (!tools.Xvfb || tools.Xvfb.startsWith("unavailable")) throw new Error("Xvfb unavailable")
  if (!tools.ffmpeg || tools.ffmpeg.startsWith("unavailable")) throw new Error("ffmpeg unavailable")

  // 2. Fresh index of the studio workspace root (what the editor opens).
  const dataDir = path.join(tmpdir(), "m45-studio-session-index")
  rmSync(dataDir, { recursive: true, force: true })
  const idx = indexCorpus({ root: ROOT, dataDir, corpusAbs: STUDIO_ABS })
  const dbStats = readDbStats(idx.dbPath)
  console.log(`  index: ${idx.indexHash.slice(0, 12)}… (${dbStats.symbols} symbols, ${dbStats.relationships} relationships, ${dbStats.files} files)`)

  // 3. Xvfb at film-grade resolution.
  const display = `:${DISPLAY}`
  sh(`pkill -f "[X]vfb ${display}" 2>/dev/null; true`)
  await sleep(500)
  sh(`setsid nohup Xvfb ${display} -screen 0 ${SCREEN}x24 >/tmp/m45-session-xvfb.log 2>&1 </dev/null &`)
  await sleep(2500)
  if (sh(`ls /tmp/.X11-unix/ 2>/dev/null | grep -c X${DISPLAY} || true`).trim() !== "1") throw new Error(`Xvfb ${display} did not start`)
  console.log(`  Xvfb ${display} up at ${SCREEN}`)

  // 4. VSIX into a temp extension dir (never inside the repo).
  const extDir = path.join(tmpdir(), "m45-session-ext")
  rmSync(extDir, { recursive: true, force: true })
  mkdirSync(extDir, { recursive: true })
  sh(`DISPLAY=${display} /usr/bin/code --user-data-dir ${path.join(tmpdir(), "m45-session-user")} --no-sandbox --disable-gpu --extensions-dir ${extDir} --install-extension ${VSIX_PATH} >/tmp/m45-session-ext-install.log 2>&1; true`)

  // 5. Fresh user-data dir, film-grade settings, launch on the studio workspace.
  const userDir = path.join(tmpdir(), "m45-session-user")
  rmSync(userDir, { recursive: true, force: true })
  mkdirSync(userDir, { recursive: true })
  const settingsDir = path.join(userDir, "Data", "User")
  mkdirSync(settingsDir, { recursive: true })
  writeFileSync(path.join(settingsDir, "settings.json"), JSON.stringify({
    "editor.minimap.enabled": false,
    "editor.fontSize": 20,
    "editor.lineHeight": 30,
    "editor.cursorBlinking": "solid",
    "workbench.statusBar.visible": false,
    "workbench.colorTheme": "Default Dark Modern",
    "explorer.openEditors.visible": 0,
    "window.commandCenter": false,
  }, null, 2) + "\n")

  const env = { ...process.env, DISPLAY: display, BB_DATA_DIR: dataDir }
  const code = spawn("/usr/bin/code", [
    "--user-data-dir", userDir, "--no-sandbox", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes",
    "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--extensions-dir", extDir,
    "--force-device-scale-factor", SCALE, "--window-size", "2560,1600",
    STUDIO_ABS,
  ], { env, stdio: ["ignore", "ignore", "ignore"], detached: true })
  code.unref()
  console.log("  VS Code launched on studio workspace (2x scale)")

  // 6. Wait for window + bb_lsp serving the studio.
  let windowId = ""
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    try {
      windowId = sh(`DISPLAY=${display} xdotool search --name "Visual Studio Code" 2>/dev/null | head -1`).trim()
      const lsp = sh(`ps aux | grep "[l]sp/server.js" | grep "m45-studio" | head -1`).trim()
      if (windowId && lsp) break
    } catch { /* keep waiting */ }
  }
  if (!windowId) throw new Error("VS Code window never appeared")
  sh(`DISPLAY=${display} xdotool windowmove ${windowId} 0 0 windowsize ${windowId} ${GRAB_W} ${GRAB_H} 2>/dev/null; true`)
  await sleep(1500)
  console.log(`  window up: ${windowId}, bb_lsp serving studio`)

  // 7. Open the router file; settle so indexing settles too.
  await sleep(4000)
  sh(`DISPLAY=${display} xdotool windowactivate --sync ${windowId} 2>/dev/null; true`)
  await sleep(800)
  sh(`DISPLAY=${display} /usr/bin/code --user-data-dir ${userDir} --no-sandbox --reuse-window ${path.join(STUDIO_ABS, SCENARIO.openRel)} >/dev/null 2>&1; true`)
  await sleep(8000)

  const key = (keys: string) => sh(`DISPLAY=${display} xdotool key --window ${windowId} ${keys}`, 30_000)
  const type = (text: string) => sh(`DISPLAY=${display} xdotool type --window ${windowId} --delay 60 "${text}"`, 30_000)

  // 8. START RECORDING.
  const ffmpeg = spawn("ffmpeg", [
    "-y", "-f", "x11grab", "-video_size", `${GRAB_W}x${GRAB_H}`, "-framerate", "30", "-i", display,
    "-t", String(SCENARIO.recordSeconds), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    takePath,
  ], { stdio: ["ignore", "ignore", "pipe"], detached: false })
  let ffmpegErr = ""
  ffmpeg.stderr.on("data", (d) => { ffmpegErr += d.toString() })
  await sleep(1200)
  if (ffmpeg.exitCode !== null) throw new Error(`ffmpeg died at start: ${ffmpegErr.slice(-300)}`)
  console.log(`  recording ${SCENARIO.recordSeconds}s → ${path.relative(ROOT, takePath)}`)

  // 9. Choreography — scenario steps (recording clock starts here, ~0.5s in).
  for (const s of SCENARIO.steps) {
    if (s.do === "sleep") await sleep(s.ms)
    else if (s.do === "key") { key(s.keys); await sleep(s.ms) }
    else if (s.do === "type") { type(s.text); await sleep(s.ms) }
    else { for (let i = 0; i < s.count; i++) { key("Right"); await sleep(s.each) } }
  }

  // 10. Stop recording (SIGINT finalizes the mp4 cleanly).
  const stopped = new Promise<void>((resolve) => ffmpeg.on("close", () => resolve()))
  ffmpeg.kill("SIGINT")
  await stopped
  if (!existsSync(takePath)) throw new Error(`take not written: ${takePath}`)
  const takeSize = readFileSync(takePath).length
  if (takeSize < 500_000) throw new Error(`take suspiciously small (${takeSize}b)`)
  const dur = sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${takePath}"`).trim()
  console.log(`  take written: ${(takeSize / 1e6).toFixed(1)} MB, ${dur}s`)

  // 11. Probe frames at beat midpoints — machine-checkable footage claims.
  mkdirSync(PROBES, { recursive: true })
  const probeAt = SCENARIO.probes
  for (const [name, at] of probeAt) {
    sh(`ffmpeg -y -v error -ss ${at} -i "${takePath}" -frames:v 1 "${path.join(PROBES, name)}"`)
    const p = path.join(PROBES, name)
    if (!existsSync(p)) throw new Error(`probe frame missing: ${name}`)
    if (readFileSync(p).length < 20_000) throw new Error(`probe frame suspiciously small: ${name}`)
  }
  console.log(`  ${SCENARIO.probes.length} probe frames extracted at beat midpoints`)

  // 12. Hover content proof — the SAME rich hover the portals render.
  const proofs: Record<string, { ok: boolean; err?: string; summary?: string }> = {}
  for (const p of SCENARIO.proofs) proofs[p.name] = lspHoverProof(dataDir, p.file, p.line, p.character)
  console.log(`  hover proofs: ${SCENARIO.proofs.map((p) => `${p.name}=${proofs[p.name]!.ok ? "rich" : "MISSING"}`).join(" ")}`)

  // 13. Manifest + evidence.
  const manifestPath = writeCaptureManifest(OUT_DIR, {
    bbVersion, editor: "vscode",
    editorVersion: sh("/usr/bin/code --version | head -1").trim(),
    vsixSha256, corpusCommit: commit, corpusPath: STUDIO_REL,
    indexHash: idx.indexHash, captureDate: new Date().toISOString(), tools,
  }, SCENARIO.id === "hero" ? "capture-manifest.json" : `capture-manifest-${SCENARIO.id}.json`)
  const evidence = {
    issue: "M45.D1", code: "D1", milestone: "M45",
    status: "draft-awaiting-owner-look", currentCommit: commit,
    scenario: SCENARIO.id,
    verifierCommand: `npx tsx script/m45/session-driver.ts${SCENARIO.id === "hero" ? "" : " --scenario " + SCENARIO.id}`,
    evidenceFile: SCENARIO.evidenceFile,
    take: { path: SCENARIO.take, seconds: Number(dur), bytes: takeSize, fps: 30, grab: `${GRAB_W}x${GRAB_H}`, scale: SCALE },
    beats: SCENARIO.beats,
    dbStats,
    hoverProofs: proofs,
    probes: probeAt.map(([name]) => `probes/${name}`),
    manifest: path.relative(OUT_DIR, manifestPath),
    pacingContract: "every on-screen hold >= 3s; five beats; no caption layer in the raw take",
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n")

  // 14. Cleanup our processes only.
  sh(`pkill -f "[c]ode --user-data-dir ${userDir}" 2>/dev/null; pkill -f "[X]vfb ${display}" 2>/dev/null; true`)

  if (!SCENARIO.proofs.every((p) => proofs[p.name]!.ok)) {
    console.log("\nD1 raw take: KNOWN-GAP — take recorded but hover proof incomplete")
    process.exit(1)
  }
  console.log(`\nD1 raw take (${SCENARIO.id}): RECORDED — real session, hover proofs rich`)
}

function lspHoverProof(dataDir: string, relFile: string, line: number, character: number): { ok: boolean; err?: string; summary?: string } {
  // Probe as a generated .mjs file run with plain node. The previous tsx -e
  // nested-template variant broke on escaping and reported false negatives
  // against a server that answers correctly (verified manually at LEN=3193).
  const probePath = path.join(tmpdir(), "m45-hover-proof.mjs")
  const probe = [
    `import { spawn } from "node:child_process"`,
    `const WS = ${JSON.stringify(STUDIO_ABS)}`,
    `const SERVER = ${JSON.stringify(path.join(ROOT, "dist/lsp/server.js"))}`,
    `const DATA = ${JSON.stringify(dataDir)}`,
    `const FILE = ${JSON.stringify(relFile)}`,
    `const POS = { line: ${line}, character: ${character} }`,
    `const child = spawn("node", [SERVER, "--dir", WS], { env: { ...process.env, BB_DATA_DIR: DATA }, stdio: ["pipe", "pipe", "pipe"] })`,
    `let buf = Buffer.alloc(0); let nextId = 1; const pending = new Map()`,
    `child.stdout.on("data", (d) => { buf = Buffer.concat([buf, d])`,
    `  while (true) { const i = buf.indexOf("\\r\\n\\r\\n"); if (i < 0) break`,
    `    const h = buf.subarray(0, i).toString(); const m = /Content-Length:\\s*(\\d+)/i.exec(h); if (!m) { buf = buf.subarray(i + 4); continue }`,
    `    const len = +m[1]; const bs = i + 4; if (buf.length < bs + len) break`,
    `    const body = buf.subarray(bs, bs + len).toString(); buf = buf.subarray(bs + len)`,
    `    try { const msg = JSON.parse(body); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) } } catch {} } })`,
    `function send(o) { const b = JSON.stringify(o); child.stdin.write(\`Content-Length: \${Buffer.byteLength(b)}\\r\\n\\r\\n\${b}\`) }`,
    `function req(method, params) { return new Promise((res) => { const id = nextId++; pending.set(id, res); send({ jsonrpc: "2.0", id, method, params }); setTimeout(() => res({ error: "timeout" }), 8000) }) }`,
    `setTimeout(async () => {`,
    `  await req("initialize", { processId: null, rootUri: "file://" + WS, capabilities: {}, workspaceFolders: [{ uri: "file://" + WS, name: "studio" }] })`,
    `  send({ jsonrpc: "2.0", method: "initialized", params: {} })`,
    `  await new Promise((r) => setTimeout(r, 700))`,
    `  const hover = await req("textDocument/hover", { textDocument: { uri: "file://" + WS + "/src/" + FILE }, position: POS })`,
    `  let c = hover.result?.contents`,
    `  while (c && typeof c !== "string") { c = Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : (x && x.value) || "")).join("\\n") : c.value }`,
    `  const text = typeof c === "string" ? c : JSON.stringify(hover.result?.contents ?? {})`,
    // Rich = usage data present. Class hovers show a usage list with a
    // "show all usages" link; method hovers show a "connected" section —
    // accept either structure.
    `  console.log("HAS_USAGES=" + (text.includes("usages") && (text.includes("connected") || text.includes("show all usages"))))`,
    `  console.log("LEN=" + text.length)`,
    `  child.kill(); process.exit(0)`,
    `}, 800)`,
  ].join("\n") + "\n"
  try {
    writeFileSync(probePath, probe)
    const out = execFileSync("node", [probePath], { cwd: ROOT, encoding: "utf8", timeout: 40_000, env: { ...process.env, BB_DATA_DIR: dataDir }, stdio: ["ignore", "pipe", "pipe"] })
    const rich = out.includes("HAS_USAGES=true")
    const len = parseInt(out.match(/LEN=(\d+)/)?.[1] ?? "0", 10)
    return rich && len > 100 ? { ok: true, summary: `rich hover, ${len} chars, usages+connected present` } : { ok: false, err: `hover not rich (rich=${rich}, len=${len})` }
  } catch (e) {
    return { ok: false, err: String(e).slice(0, 300) }
  } finally {
    rmSync(probePath, { force: true })
  }
}

main().catch((e) => { console.error(`D1 session recording FAILED: ${e.message}`); process.exit(1) })
