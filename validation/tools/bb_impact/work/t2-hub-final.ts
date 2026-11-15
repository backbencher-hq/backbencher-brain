// Final T2 hub measurement after the indexed count walk + declared wall deadlines.
// Lead's protocol: in-process handler calls, BB_NO_AUTO_REFRESH=1, one warm-up,
// 8+ measured runs; index bytes/mtime and row counts recorded before/after.
import { createHash } from "node:crypto"
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/latency-t2-hub-final.json")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

const pid = getProjectId(ROOT)
const dbDir = path.join(ROOT, ".bb-data/projects", pid)
const dbFiles = ["brain.db", "brain.db-wal", "brain.db-shm"].map((name) => path.join(dbDir, name))
async function hashOf(file: string): Promise<string | null> {
  if (!existsSync(file)) return null
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256")
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")))
  })
}
const snap = async () => {
  const out: Record<string, { bytes: number; mtimeMs: number; sha256: string | null } | null> = {}
  for (const file of dbFiles) out[path.basename(file)] = existsSync(file) ? { bytes: statSync(file).size, mtimeMs: statSync(file).mtimeMs, sha256: await hashOf(file) } : null
  return out
}
const before = await snap()
const load = (await import("node:os")).loadavg()

const raw: any = await (BrainDatabase as any).getRawInstance(pid, { readonly: true })
const counts = {
  files: (raw.prepare("SELECT COUNT(*) AS n FROM brain_file WHERE project_id = ?").get(pid) as any).n,
  symbols: (raw.prepare("SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ?").get(pid) as any).n,
  relationships: (raw.prepare("SELECT COUNT(*) AS n FROM brain_relationship WHERE project_id = ?").get(pid) as any).n,
}
const handlers: any = createToolHandlers()
const ctx = { projectPath: ROOT, projectId: pid }
const SYMBOL = "getRawInstance"

const runs: any[] = []
const callOnce = async () => {
  const t0 = performance.now()
  const r = await handlers.bb_impact({ symbol: SYMBOL }, ctx)
  const ms = Number((performance.now() - t0).toFixed(1))
  const text = String(r.content[0].text)
  if (r.isError) throw new Error(text.slice(0, 300))
  const p = JSON.parse(text)
  return {
    ms,
    outputBytes: Buffer.byteLength(text, "utf8"),
    shownCount: p.shownCount,
    totalCountIfKnown: p.totalCountIfKnown,
    directCount: p.directCount,
    truncated: p.truncated,
    truncationReason: p.truncationReason,
    reproducible: p.reproducible,
    countVerification: p.countVerification,
    engineTruncated: p.traversal?.engineTruncated,
    engineTruncationReason: p.traversal?.engineTruncationReason,
    walkTimeExhausted: p.traversal?.walkTimeExhausted,
    walkTimeBudgetMs: p.traversal?.walkTimeBudgetMs,
    returnedCallers: p.traversal?.returnedCallers,
    callersIfUncapped: p.traversal?.callersIfUncapped,
    budget: p.budget,
    depthReached: p.traversal?.depthReached,
  }
}
await callOnce() // warm-up
const MEASURED = 8
for (let i = 0; i < MEASURED; i++) { const r = await callOnce(); runs.push(r); console.log(`${i + 1}: ${r.ms} ms shown=${r.shownCount} total=${r.totalCountIfKnown} truncated=${r.truncated} walkExhausted=${r.walkTimeExhausted} count=${JSON.stringify(r.countVerification)}`) }
const sortedMs = runs.map((r) => r.ms).sort((a, b) => a - b)
const percentile = (p: number) => sortedMs[Math.max(0, Math.ceil((p / 100) * sortedMs.length) - 1)]!
const after = await snap()
const changed = Object.keys(before).filter((name) => before[name]?.sha256 !== after[name]?.sha256)

writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  tool: "bb_impact",
  tier: "T2-hub",
  symbol: SYMBOL,
  what: "the Lead's T2 hub case: default bb_impact call for a real hub symbol on the shared 3.6 GB reference index, after the indexed counting walk and the declared wall deadlines",
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/t2-hub-final.ts",
  protocol: { warmupRuns: 1, measuredRuns: MEASURED, inProcess: true, env: "BB_DATA_DIR=<repo>/.bb-data, BB_NO_AUTO_REFRESH=1", openMode: "byte-read-only (handler opens the same way)" },
  generatedAt: new Date().toISOString(),
  loadAverage: load,
  indexCounts: counts,
  before,
  after,
  dbUnchanged: changed.length === 0,
  changedFiles: changed,
  runs,
  p50Ms: percentile(50),
  p95Ms: percentile(95),
  budgetMs: 5_000,
  withinBudget: percentile(95) <= 5_000,
}, null, 2) + "\n")
console.log(`p50=${percentile(50)} p95=${percentile(95)} budget=5000 within=${percentile(95) <= 5000}`)
console.log(`DB_UNCHANGED:${changed.length === 0} counts=${JSON.stringify(counts)}`)
console.log("HUB_FINAL_DONE")
