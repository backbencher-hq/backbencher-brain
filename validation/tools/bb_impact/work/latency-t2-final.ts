// T2 final: warm 5-run measurement through the byte-read-only handler on the
// current reference index, plus the query plan that governs the walk and a
// before/after hash of the index's own files (dbUnchanged).
import { createHash } from "node:crypto"
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/latency-t2-final.json")
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
const before: Record<string, string | null> = {}
for (const file of dbFiles) before[path.basename(file)] = await hashOf(file)

const raw: any = await (BrainDatabase as any).getRawInstance(pid, { readonly: true })
const handlers: any = createToolHandlers()
const ctx = { projectPath: ROOT, projectId: pid }
const DEP_KINDS = ["calls", "instantiates", "extends", "implements"]

// The plan that governs the walk's per-symbol caller query (same shape the engine
// builds, with a literal target list).
const plan = raw
  .prepare(
    "EXPLAIN QUERY PLAN SELECT r.id FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
      "JOIN brain_file f ON f.id = s.file_id JOIN (SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?) casc ON casc.id = r.target_symbol_id " +
      "WHERE r.project_id = ? AND r.relationship_type IN (" +
      DEP_KINDS.map(() => "?").join(",") +
      ") ORDER BY 1 LIMIT 201",
  )
  .all("x:y:z:1", "x:y:z:", "x:y:z;", pid, pid, ...DEP_KINDS)
  .map((row: any) => row.detail)
const indexes = raw
  .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('brain_symbol','brain_relationship')")
  .all()
  .map((row: any) => row.name)

const candidates = raw
  .prepare(
    "SELECT s.name AS name, COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id " +
      "WHERE r.project_id = ? AND r.relationship_type IN (" +
      DEP_KINDS.map(() => "?").join(",") +
      ") GROUP BY s.name ORDER BY n DESC LIMIT 5001",
  )
  .all(pid, ...DEP_KINDS) as Array<{ name: string; n: number }>
const picked: Array<{ name: string; n: number; rank: number }> = []
for (const rank of [0, 99, 499]) {
  const row = candidates[rank]
  if (row) picked.push({ name: row.name, n: row.n, rank: rank + 1 })
}
picked.push({ name: "computeImpact", n: -1, rank: -1 })

function percentile(sorted: number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]!
}

const results: any[] = []
for (const candidate of picked) {
  const callOnce = async () => {
    const t0 = performance.now()
    const r = await handlers.bb_impact({ symbol: candidate.name }, ctx)
    const ms = performance.now() - t0
    if (r.isError) throw new Error(String(r.content[0].text).slice(0, 200))
    return { ms, payload: JSON.parse(String(r.content[0].text)) }
  }
  try {
    await callOnce()
    await callOnce()
    const runs: number[] = []
    let last: any = null
    for (let i = 0; i < 5; i++) { const r = await callOnce(); runs.push(Number(r.ms.toFixed(1))); last = r.payload }
    const sorted = [...runs].sort((a, b) => a - b)
    results.push({
      ...candidate,
      calls: 5,
      warm: true,
      runsMs: runs,
      p50Ms: Number(percentile(sorted, 50).toFixed(1)),
      p95Ms: Number(percentile(sorted, 95).toFixed(1)),
      outcome: {
        shownCount: last.shownCount,
        totalCountIfKnown: last.totalCountIfKnown,
        directCount: last.directCount,
        truncated: last.truncated,
        truncationReason: last.truncationReason,
        depthReached: last.traversal?.depthReached,
        engineTruncationReason: last.traversal?.engineTruncationReason,
        countVerification: last.countVerification,
        reproducible: last.reproducible,
        freshness: last.freshness && { fresh: last.freshness.fresh, stale: last.freshness.stale, missing: last.freshness.missing },
        autoRefresh: last.autoRefresh ?? null,
      },
    })
    console.log(`${candidate.name}: p50=${results[results.length - 1].p50Ms} p95=${results[results.length - 1].p95Ms}`)
  } catch (e) {
    results.push({ ...candidate, error: String((e as Error).message).slice(0, 300) })
    console.log(`${candidate.name}: ERROR ${String((e as Error).message).slice(0, 120)}`)
  }
}

const after: Record<string, string | null> = {}
for (const file of dbFiles) after[path.basename(file)] = await hashOf(file)
const changed = Object.keys(before).filter((name) => before[name] !== after[name])
const load = (await import("node:os")).loadavg()

writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  tool: "bb_impact",
  tier: "T2",
  subject: "workspace reference large index (.bb-data, 11,440 files, ~3.4 GB)",
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-t2-final.ts",
  openMode: "byte-read-only (BrainDatabase.getRawInstance(projectId,{readonly:true})); the handler opens the same way",
  generatedAt: new Date().toISOString(),
  loadAverage: load,
  indexes,
  walkQueryPlan: plan,
  dbFiles,
  before,
  after,
  dbUnchanged: changed.length === 0,
  changedFiles: changed,
  results,
}, null, 2) + "\n")
console.log(`DB_UNCHANGED:${changed.length === 0} changed=${changed.join(",") || "none"}`)
console.log("T2_FINAL_DONE")
