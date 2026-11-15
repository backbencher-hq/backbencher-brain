// One measured bb_patterns call (or a warmup) on one tier, appended to a JSONL file.
// Designed for short foreground batches so a measurement survives session restarts:
// every call writes its own line immediately.
//
// Usage: BB_DATA_DIR=<data dir> BB_NO_AUTO_REFRESH=1 npx tsx latency-one.mts <tier> <projectDir> <shape> <runIndex> <out.jsonl> [--warmup]

import { appendFileSync, statSync, existsSync } from "node:fs"
import { loadavg } from "node:os"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { handler as bbPatternsHandler } from "../../../../src/mcp/tools/bb_patterns/handler"

const [tier, projectDir, shape, runArg, outPath] = process.argv.slice(2)
if (!tier || !projectDir || !shape || !runArg || !outPath) {
  console.error("usage: latency-one.mts <tier> <projectDir> <shape> <runIndex> <out.jsonl> [--warmup]")
  process.exit(2)
}
if (!process.env.BB_DATA_DIR) { console.error("BB_DATA_DIR required"); process.exit(2) }
const warmup = process.argv.includes("--warmup")
const runIndex = Number(runArg)
const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
const walFingerprint = (p: string) => { const s = statOf(p); return s === null || s.bytes === 0 ? "absent-or-empty" : JSON.stringify(s) }
const shapes: Record<string, Record<string, unknown>> = {
  "default-all": {},
  orphaned: { scope: "orphaned" },
  "all-limit-100": { limit: 100 },
}
const args = shapes[shape]
if (!args) { console.error(`unknown shape ${shape}; expected ${Object.keys(shapes).join(", ")}`); process.exit(2) }
const before = { db: statOf(dbPath), wal: walFingerprint(`${dbPath}-wal`) }
const cpu0 = process.cpuUsage()
const t0 = performance.now()
const result: any = await bbPatternsHandler(args as any, { projectId, projectPath: projectDir } as any)
const ms = Math.round((performance.now() - t0) * 100) / 100
const cpu = process.cpuUsage(cpu0)
const cpuMs = Math.round((cpu.user + cpu.system) / 1000)
const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")
const after = { db: statOf(dbPath), wal: walFingerprint(`${dbPath}-wal`) }
const rows = text.split("\n").filter((line) => {
  const body = line.trim()
  return line.startsWith("  ") && body !== "" && body !== "none" && (/^\[(?:info|warning|error)\] /.test(body) || /^orphaned_/.test(body))
}).length
const line = {
  tier, shape, run: warmup ? "warmup" : runIndex, ms, cpuMs, warmup,
  isError: result?.isError === true,
  census: (text.match(/^(?:patterns|orphaned code) \((\d+)/) ?? [])[1] ?? null,
  rows, chars: text.length,
  dbUnchanged: JSON.stringify(before.db) === JSON.stringify(after.db) && before.wal === after.wal,
  before, after,
  loadavg: loadavg(), at: new Date().toISOString(),
}
appendFileSync(outPath, JSON.stringify(line) + "\n")
console.log(JSON.stringify(line))
BrainDatabase.closeAll()
