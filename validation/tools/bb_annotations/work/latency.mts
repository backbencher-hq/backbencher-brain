// validation/tools/bb_annotations/work/latency.mts
//
// Campaign §6 latency: three tiers, always warm, five runs, p50/p95, with the
// exact command, environment, index population and db mtime recorded.
//
//   T0  test/fixtures/polyglot            -> validation/tools/bb_annotations/bbdata
//   T1  .perf-fixtures/bb-scale/n100      -> validation/tools/bb_annotations/bbdata
//   T2  the reference large index         -> validation/tools/bb_annotations/t2-copy
//       (a read-only backup copy: the live read door opens read-write, so the
//        shared store must not be the subject of a measurement)
//
// The handler is imported from SOURCE. T2 is handler level; the real MCP stdio
// door is measured separately (raw/door-*.json).
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/latency.mts --tier T0
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { cpus } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const require = createRequire(import.meta.url)
const tierArg = process.argv.includes("--tier") ? process.argv[process.argv.indexOf("--tier") + 1] : "T0"
const manifest = JSON.parse(readFileSync(join(HERE, "..", "raw", "index-manifest.json"), "utf8"))
const t2Copy = JSON.parse(readFileSync(join(HERE, "..", "raw", "t2-copy.json"), "utf8"))

const CONFIG: Record<string, { dataDir: string; workspace: string; projectId: string; subject: string }> = {
  T0: { dataDir: join(HERE, "..", "bbdata"), workspace: manifest.tiers.T0.workspace, projectId: manifest.tiers.T0.projectId, subject: "test/fixtures/polyglot" },
  T1: { dataDir: join(HERE, "..", "bbdata"), workspace: manifest.tiers.T1.workspace, projectId: manifest.tiers.T1.projectId, subject: ".perf-fixtures/bb-scale/n100" },
  T2: { dataDir: join(HERE, "..", "t2-copy"), workspace: join(ROOT), projectId: "1d3d57103be91b8f9716d70199fe28a3f39245d9", subject: "reference large index (byte copy of .bb-data project)" },
}
const cfg = CONFIG[tierArg]
if (!cfg) throw new Error(`unknown tier ${tierArg}`)
process.env.BB_DATA_DIR = cfg.dataDir
process.env.BB_NO_AUTO_REFRESH = "1"

const now = () => Number(process.hrtime.bigint()) / 1e6
const round = (n: number) => Math.round(n * 1000) / 1000
const stats = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
  return { p50Ms: round(at(50)), p95Ms: round(at(95)), minMs: round(sorted[0]!), maxMs: round(sorted[sorted.length - 1]!) }
}

const { createToolHandlers } = await import(join(ROOT, "src", "mcp", "tool-handlers.ts"))
const handlers = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<any>>
const ctx = { projectId: cfg.projectId, projectPath: cfg.workspace }
const call = async (tool: string, args: Record<string, unknown>) => {
  const started = now()
  const result = await handlers[tool](args, ctx)
  const elapsed = now() - started
  const text = result?.content?.[0]?.text ?? ""
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {}
  return { elapsed, bytes: Buffer.byteLength(text), isError: result?.isError === true, parsed }
}

// Read-only population facts for this tier's database.
const Database = require("better-sqlite3")
const dbFile = join(cfg.dataDir, "projects", cfg.projectId, "brain.db")
const dbStat = { bytes: statSync(dbFile).size, mtimeMs: statSync(dbFile).mtimeMs }
const ro = new Database(dbFile, { readonly: true, fileMustExist: true })
const population = {
  files: (ro.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id = ?").get(cfg.projectId) as any).n,
  symbols: (ro.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ?").get(cfg.projectId) as any).n,
  relationships: (ro.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ?").get(cfg.projectId) as any).n,
  annotations: (ro.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ?").get(cfg.projectId) as any).n,
}
// A subject symbol with the most indexed copies (the harder name lookup) and a
// real file path, so no measurement runs against a name that does not exist.
const subjectSymbol = (ro.prepare(
  "SELECT name, COUNT(*) n FROM brain_symbol WHERE project_id = ? AND name IS NOT NULL GROUP BY name ORDER BY n DESC, name LIMIT 1",
).get(cfg.projectId) as any)?.name as string
const subjectPath = (ro.prepare(
  "SELECT relative_path FROM brain_file WHERE project_id = ? ORDER BY relative_path LIMIT 1",
).get(cfg.projectId) as any)?.relative_path as string
ro.close()

const RUNS = 5
const out: Record<string, unknown> = {
  schemaVersion: 1,
  tool: "bb_annotations",
  tier: tierArg,
  subject: cfg.subject,
  measuredAt: new Date().toISOString(),
  currentCommit: (() => { try { return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  command: `BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/latency.mts --tier ${tierArg}`,
  environment: { node: process.version, cpus: cpus().length, loadavg: readFileSync("/proc/loadavg", "utf8").trim() },
  database: { path: dbFile, ...dbStat, population },
  rules: ["BB_NO_AUTO_REFRESH=1", "one discarded warmup call per subject", `${RUNS} measured runs`, "p50/p95 from the measured runs", "handler imported from source"],
  subjects: {} as Record<string, unknown>,
}

// The declared-absence answer on a store that holds no notes (the T2 store is
// genuinely empty; T0/T1 are seeded below so the page path is measured too).
const absence = await call("bb_annotations", {})
out.absencePath = {
  args: {},
  coldCallMs: round(absence.elapsed),
  isError: absence.isError,
  count: absence.parsed?.count,
  totalCountIfKnown: absence.parsed?.totalCountIfKnown,
  declaredAbsent: absence.parsed?.declaredAbsent,
  bytes: absence.bytes,
}

// Seed notes through the WRITE door so the bounded-page path is measured on a
// real store (only this lane's isolated indexes / T2 copy are written).
const seeded: string[] = []
for (const body of ["warmup note one", "warmup note two"]) {
  const res = await call("bb_annotate", { symbol: subjectSymbol, body: `${body} (${subjectSymbol})` })
  if (res.parsed?.stored === true) seeded.push(res.parsed.annotation?.id)
}
if (subjectPath) {
  const res = await call("bb_annotate", { symbol: subjectSymbol, path: subjectPath, body: `file-scoped note in ${subjectPath}` })
  if (res.parsed?.stored === true) seeded.push(res.parsed.annotation?.id)
}
const afterSeed = await call("bb_annotations", {})
const subjects: Array<{ id: string; args: Record<string, unknown>; warm: any }> = [
  { id: "default-project-wide", args: {}, warm: null },
  { id: "another-name-absent", args: { symbol: "bb-annotations-audit-name-that-does-not-exist" }, warm: null },
  { id: "limit-1", args: { limit: 1 }, warm: null },
]
if (subjectSymbol) subjects.push({ id: "subject-symbol", args: { symbol: subjectSymbol }, warm: null })
if (subjectPath) subjects.push({ id: "subject-path", args: { path: subjectPath }, warm: null })

for (const subject of subjects) {
  await call("bb_annotations", subject.args) // warmup, discarded
  const runs: number[] = []
  let last: any = null
  for (let i = 0; i < RUNS; i++) { const r = await call("bb_annotations", subject.args); runs.push(r.elapsed); last = r }
  out.subjects[subject.id] = {
    args: subject.args,
    runs: runs.map(round),
    ...stats(runs),
    bytes: last?.bytes,
    answerShape: { count: last?.parsed?.count, totalCountIfKnown: last?.parsed?.totalCountIfKnown, truncated: last?.parsed?.truncated, declaredAbsent: last?.parsed?.declaredAbsent, isError: last?.isError },
  }
}

const budget = tierArg === "T0" ? { p95Ms: 250 } : tierArg === "T1" ? { p95Ms: 1000 } : { p95Ms: 5000 }
const defaultCall = out.subjects["default-project-wide"] as any
out.seed = { subjectSymbol, subjectPath, seededIds: seeded.length, rowsAfterSeed: afterSeed.parsed?.totalCountIfKnown }
out.budget = { ...budget, verdict: defaultCall.p95Ms <= budget.p95Ms ? "within budget" : "BREACH", rule: "campaign §6 (T0<250ms, T1<1s, read tools <5s at T2)" }

const file = join(HERE, "..", "raw", `latency-${tierArg}.json`)
writeFileSync(file, JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({ file, tier: tierArg, population, absencePath: out.absencePath, subjects: out.subjects, budget: out.budget, load: (out.environment as any).loadavg }, null, 2))
