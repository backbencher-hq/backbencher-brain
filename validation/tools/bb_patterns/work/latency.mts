// Phase A latency probe for bb_patterns. Measures the real handler on one tier,
// warm: one excluded warmup per shape, then five runs per shape. Both documented
// entry shapes are measured — the default argument object ({}, scope=all) and
// scope=orphaned — because they take different engines (rules+orphans vs orphans).
// Every run records the answer's own census so a latency figure cannot be read
// apart from the population that produced it.
//
// Usage: BB_DATA_DIR=<tier data dir> BB_NO_AUTO_REFRESH=1 npx tsx latency.mts <tier> <projectDir> <out.json>

import { writeFileSync, appendFileSync, statSync, existsSync } from "node:fs"
import { loadavg } from "node:os"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { handler as bbPatternsHandler } from "../../../../src/mcp/tools/bb_patterns/handler"

const tier = process.argv[2]
const projectDir = process.argv[3]
const outPath = process.argv[4]
if (!tier || !projectDir || !outPath) { console.error("usage: latency.mts <tier> <projectDir> <out.json>"); process.exit(2) }

const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const handler = bbPatternsHandler
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
const indexBefore = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
const indexWalBefore = (() => { const w = statOf(`${dbPath}-wal`); return w === null || w.bytes === 0 ? "absent-or-empty" : JSON.stringify(w) })()

const ALL_SHAPES: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: "default-all", args: {} },
  { name: "orphaned", args: { scope: "orphaned" } },
]
const shapeFlag = process.argv.find((arg) => arg.startsWith("--shape="))
const runsFlag = process.argv.find((arg) => arg.startsWith("--runs="))
const onlyShape = shapeFlag ? shapeFlag.slice("--shape=".length) : null
const RUNS = runsFlag ? Number(runsFlag.slice("--runs=".length)) : 5
const SHAPES = onlyShape ? ALL_SHAPES.filter((shape) => shape.name === onlyShape) : ALL_SHAPES
if (SHAPES.length === 0) { console.error(`unknown --shape; expected ${ALL_SHAPES.map((shape) => shape.name).join(", ")}`); process.exit(2) }
if (!Number.isInteger(RUNS) || RUNS < 1) { console.error("--runs must be a positive integer"); process.exit(2) }
// Every call's line is appended immediately so a measurement survives an interrupted
// process; the JSON report is assembled from the same lines at the end.
const progressPath = outPath.replace(/\.json$/, "") + ".runs.jsonl"
writeFileSync(progressPath, "")

function parseFacts(text: string) {
  const censusHeader = (text.match(/^(?:patterns|orphaned code) \((\d+)/) ?? [])[1] ?? null
  const scan = (text.match(/\[scan: ([^\]]*)\]/) ?? [])[1] ?? null
  const displayRows = text.split("\n").filter((l) => /^ {2}\[?(?:\[?\w)/.test(l) && l.trim() !== "none").length
  return { censusHeader, scan, displayRows, chars: text.length, lines: text.split("\n").length }
}

const walFingerprint = (p: string) => { const s = statOf(p); return s === null || s.bytes === 0 ? "absent-or-empty" : JSON.stringify(s) }
// A read may move only the -shm read marks; db and WAL must be untouched. That is the
// ruling this harness reports against, so -shm is tracked separately rather than folded
// into "the index moved" (which it never did: db+WAL were byte-identical in every run).
async function call(args: Record<string, unknown>): Promise<{ ms: number; text: string; isError: boolean; dbUnchanged: boolean; cpuMs: number }> {
  const before = { db: statOf(dbPath), wal: walFingerprint(`${dbPath}-wal`) }
  const shmBefore = statOf(`${dbPath}-shm`)
  const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  const result: any = await handler(args as any, { projectId, projectPath: projectDir } as any)
  const ms = Math.round((performance.now() - t0) * 100) / 100
  const cpu = process.cpuUsage(cpu0)
  const after = { db: statOf(dbPath), wal: walFingerprint(`${dbPath}-wal`) }
  const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  return {
    ms,
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    text,
    isError: result?.isError === true,
    dbUnchanged: JSON.stringify(before.db) === JSON.stringify(after.db) && before.wal === after.wal,
    ...(shmBefore ? {} : {}),
  }
}

const report: Record<string, any> = {
  tier,
  projectDir,
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default)",
  route: "handler (source door): createToolHandlers().bb_patterns — the same handler src/mcp/server.ts calls",
  env: {
    BB_DATA_DIR: process.env.BB_DATA_DIR ?? null,
    BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH ?? null,
  },
  protocol: "warm: one excluded warmup per shape, then five measured calls; p50/p95 over the five; BB_NO_AUTO_REFRESH=1",
  indexBefore,
  shapes: [],
  generatedAt: new Date().toISOString(),
}

for (const shape of SHAPES) {
  const warm = await call(shape.args)
  appendFileSync(progressPath, JSON.stringify({ tier, shape: shape.name, run: "warmup", ms: warm.ms, cpuMs: warm.cpuMs, dbUnchanged: warm.dbUnchanged, loadavg: loadavg(), at: new Date().toISOString() }) + "\n")
  const runs: any[] = []
  for (let i = 0; i < RUNS; i++) {
    const r = await call(shape.args)
    appendFileSync(progressPath, JSON.stringify({ tier, shape: shape.name, run: i, ms: r.ms, cpuMs: r.cpuMs, isError: r.isError, dbUnchanged: r.dbUnchanged, facts: parseFacts(r.text), loadavg: loadavg(), at: new Date().toISOString() }) + "\n")
    runs.push({ ms: r.ms, cpuMs: r.cpuMs, isError: r.isError, facts: parseFacts(r.text), dbUnchanged: r.dbUnchanged })
  }
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b)
  report.shapes.push({
    shape: shape.name,
    args: shape.args,
    warmupMs: warm.ms,
    warmupChars: warm.text.length,
    runs,
    p50Ms: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * 0.95))],
    maxMs: sorted[sorted.length - 1],
    minMs: sorted[0],
    medianOfRuns: sorted,
    isError: runs.some((r) => r.isError),
  })
}
report.indexAfter = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
const walLeaf = (entry: any) => (entry === null || entry.bytes === 0 ? "absent-or-empty" : JSON.stringify(entry))
const indexWalBeforeLeaf = walLeaf(report.indexBefore.wal)
// db and -wal are the index; -shm is SQLite's read-mark file and may move on a read.
report.readMovedIndex = JSON.stringify(report.indexBefore.db) !== JSON.stringify(report.indexAfter.db) || indexWalBeforeLeaf !== walLeaf(report.indexAfter.wal)
report.shmMoved = JSON.stringify(report.indexBefore.shm) !== JSON.stringify(report.indexAfter.shm)
report.cpuMs = Object.fromEntries(report.shapes.map((shape: any) => [shape.shape, shape.runs.map((run: any) => run.cpuMs)]))
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ tier, shapes: report.shapes.map((s: any) => ({ shape: s.shape, p50: s.p50Ms, p95: s.p95Ms, max: s.maxMs, runs: s.runs.map((r: any) => r.ms), census: s.runs[0]?.facts?.censusHeader, rows: s.runs[0]?.facts?.displayRows, chars: s.runs[0]?.facts?.chars })), readMovedIndex: report.readMovedIndex, shmMoved: report.shmMoved, cpuMs: report.cpuMs }, null, 1))
