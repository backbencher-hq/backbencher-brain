/**
 * REFRESH ONE LANE IN THE BOARD'S INCOMING LOG — incrementally, atomically, and crash-safely.
 *
 * WHY THIS EXISTS. `incoming-gate.ts --board-log` writes the whole file at the END of a
 * 23-lane run. Measured 2026-10-09: a full-fleet regeneration ran 27 minutes without
 * landing anything, so a reaped turn, a timeout or a killed process loses every lane's
 * work and leaves the artefact exactly as stale as before. All-or-nothing is the wrong
 * shape for a file 23 lanes each contribute one row to.
 *
 * WHAT IT DOES. Runs `incoming-gate.ts --board-log <tmp> --only <lane> <budget>`, then
 * splices that lane's three lines into the canonical log and writes the result through a
 * temp file + rename, so a reader never sees a half-written log and an interrupted run
 * leaves the previous file intact.
 *
 * Usage:  node script/m14/refresh-incoming-lane.cjs <lane> [budget] [logPath]
 *         node script/m14/refresh-incoming-lane.cjs --all [budget]     (sequential, one per lane)
 */
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..", "..")
const CANON = path.join(ROOT, "validation/m14/results/incoming-laptop-b.current.log")

const args = process.argv.slice(2)
const all = args.includes("--all")
const pos = args.filter((a) => !a.startsWith("--"))
const budget = all ? pos[0] ?? "30" : pos[1] ?? "30"
const logPath = all ? CANON : pos[2] ?? CANON

function lanes() {
  const src = fs.readFileSync(path.join(ROOT, "script/m14/incoming-gate.ts"), "utf8").replace(/\r/g, "")
  const out = []
  let inBlock = false
  for (const raw of src.split("\n")) {
    const line = raw.split("//")[0]
    if (!inBlock) { if (line.includes("export const LANES_B")) inBlock = true; continue }
    if (line.trim() === "}") break
    for (const part of line.split(",")) {
      const c = part.indexOf(":")
      if (c < 0) continue
      const k = part.slice(0, c).trim()
      if (k && /^[a-z][a-z0-9-]*$/.test(k)) out.push(k)
    }
  }
  return out
}

function readLog(p) {
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, "utf8").split("\n")
}

/** The log is a flat list of `### <lane>` / verdict / self-test triples. Replace or append one. */
function splice(lines, lane, block) {
  const header = `### ${lane}`
  const i = lines.findIndex((l) => l.trim() === header)
  if (i < 0) {
    const kept = lines.filter((l) => l.trim() !== "")
    return [...kept, ...block, ""]
  }
  // consume the existing triple (header + next two non-empty lines)
  let j = i + 1, consumed = 0
  while (j < lines.length && consumed < 2) {
    if (lines[j].trim() !== "") consumed++
    j++
  }
  return [...lines.slice(0, i), ...block, ...lines.slice(j)]
}

function refresh(lane) {
  const tmp = path.join(ROOT, `.tmp-index/one-${lane}.log`)
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  const t0 = Date.now()
  try {
    execFileSync("npx", ["tsx", "script/m14/incoming-gate.ts", "--board-log", tmp, "--only", lane, budget], {
      cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], timeout: 45 * 60 * 1000,
    })
  } catch (e) {
    return { lane, ok: false, why: `exit ${e.status ?? "?"}${e.signal ? ` signal ${e.signal}` : ""}` }
  }
  if (!fs.existsSync(tmp)) return { lane, ok: false, why: "no output file" }
  const block = fs.readFileSync(tmp, "utf8").split("\n").filter((l) => l.trim() !== "")
  if (block.length < 3) return { lane, ok: false, why: `only ${block.length} line(s)` }
  const lines = splice(readLog(logPath), lane, block.slice(0, 3))
  const out = path.join(path.dirname(logPath), `.${path.basename(logPath)}.tmp`)
  fs.writeFileSync(out, lines.join("\n"))
  fs.renameSync(out, logPath) // atomic: a reader never sees a partial log
  return { lane, ok: true, secs: ((Date.now() - t0) / 1000).toFixed(0), verdict: block[1].slice(0, 60) }
}

const targets = all ? lanes() : [pos[0] ?? ""]
if (!targets[0]) { console.error("usage: refresh-incoming-lane.cjs <lane>|--all [budget] [logPath]"); process.exit(2) }
for (const lane of targets) {
  const r = refresh(lane)
  console.log(r.ok ? `OK   ${r.lane.padEnd(12)} ${r.secs}s  ${r.verdict}` : `FAIL ${r.lane.padEnd(12)} ${r.why}`)
  if (!r.ok && !all) process.exit(1)
}
console.log(`\nlog: ${logPath}`)
