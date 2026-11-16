// script/m14/tmp/os-log-read-race.ts — why could the sharpness instrument read a log whose repo
// line was not there, when the same file parses fine afterwards?
//
// The instrument does: spawnSync("bun", [harness, --lang, lang, --sample, SAMPLE],
// { stdio: ["ignore", fd, fd] }) — stdout AND stderr merged into ONE file — then immediately
// readFileSync(logPath) and parse. Two competing explanations for a missing repo line:
//   (A) ORDER: stdout is block-buffered into a file while stderr is unbuffered, so merged writes
//       land in an order that differs from program order;
//   (B) LATE WRITER: something keeps writing to the inherited fd after spawnSync returns (a forked
//       worker — src/ast/parallel-indexer.ts forks), so the read sees a prefix of the file.
// This probe reproduces the instrument's exact spawn and then watches the file: size and the
// positions of the repo and strict lines at read time, plus any growth afterwards.
//
// Usage: bun script/m14/tmp/os-log-read-race.ts [lang] [sample]
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = process.env.BB_PROBE_ROOT ?? "<corpus-root>/mcp/backbencher-brain"
const LANG = process.argv[2] ?? "svelte"
const SAMPLE = process.argv[3] ?? "200"
const LOG = path.join(os.tmpdir(), `os-race-${LANG}.log`)
const WORK = path.join(os.tmpdir(), `os-race-work-${LANG}`)

const repoLine = (log: string): { idx: number; line: string } => {
  const lines = log.split("\n")
  for (let i = 0; i < lines.length; i++) {
    // The shape the instrument's REPO_RE demands, without regex: "[repo] lang: files=N tree-truth=N …"
    const l = lines[i]
    const m = l.match(/^\[([^\]]+)\] ([a-z0-9_]+): files=\d+ tree-truth=\d+ covered=\d+ \(/)
    if (m) return { idx: i, line: l.slice(0, 90) }
  }
  return { idx: -1, line: "" }
}
const strictLine = (log: string): { idx: number; line: string } => {
  const lines = log.split("\n")
  for (let i = 0; i < lines.length; i++) if (lines[i].includes("[strict] " + LANG + ":")) return { idx: i, line: lines[i].trim().slice(0, 90) }
  return { idx: -1, line: "" }
}

fs.rmSync(LOG, { force: true })
fs.mkdirSync(WORK, { recursive: true })
const fd = fs.openSync(LOG, "w")
const t0 = Date.now()
const proc = spawnSync("bun", ["script/m14/differential.ts", "--lang", LANG, "--sample", SAMPLE], {
  cwd: ROOT, stdio: ["ignore", fd, fd],
  env: { ...process.env, BB_F5_STRICT: "1", BB_F5_SHOW_SAMPLES: "1", BB_M14_WORK: WORK },
})
fs.closeSync(fd)
const spawnMs = Date.now() - t0

const snap = (label: string) => {
  const log = fs.readFileSync(LOG, "utf8")
  const r = repoLine(log), s = strictLine(log)
  console.log(`${label}: ${log.length} bytes, repoLine@${r.idx}${r.idx >= 0 ? " " + r.line : " ABSENT"}, strictLine@${s.idx}${s.idx >= 0 ? " " + s.line : " ABSENT"}, order=${r.idx >= 0 && s.idx >= 0 ? (r.idx < s.idx ? "repo<strict OK" : "STRICT BEFORE REPO (violated)") : "n/a"}`)
  return log.length
}
console.log(`spawnSync returned after ${spawnMs}ms (status=${proc.status}, signal=${proc.signal ?? "none"})`)
let last = snap("at read time (the instrument's moment)")
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 300))
  const now = snap(`+${((i + 1) * 300) / 1000}s`)
  if (now !== last) console.log(`   ↑ the file GREW after spawnSync returned (${last} -> ${now} bytes): a late writer holds the fd`)
  last = now
}
