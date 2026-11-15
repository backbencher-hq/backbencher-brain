// Honest re-measurement of the query-form cost on a BYTE-READ-ONLY handle:
// is the cascade-JOIN form still ~10 s against the flat target-indexed form, or
// was the earlier figure a contended read-write-open artifact? Same index, same
// process, interleaved arms, both repeated.
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/latency-t2-query-cost-readonly.json")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

const pid = getProjectId(ROOT)
const raw: any = await (BrainDatabase as any).getRawInstance(pid, { readonly: true })
const rows: any[] = []
const timeIt = async (label: string, fn: () => unknown | Promise<unknown>) => {
  const t0 = performance.now()
  let v: any
  try { v = await fn() } catch (e) { v = { error: String((e as Error).message).slice(0, 160) } }
  const ms = Number((performance.now() - t0).toFixed(1))
  rows.push({ label, ms, value: v })
  console.log(`${label}: ${ms} ms`)
}
const load = (await import("node:os")).loadavg()
console.log(`# load average: ${load.map((n) => n.toFixed(2)).join(", ")}`)

const root = "1d3d57103be91b8f9716d70199fe28a3f39245d9:src/lsp/impact.ts:computeImpact:764"
const prefix = root.slice(0, root.lastIndexOf(":") + 1)
const upper = prefix + ";"
const kinds = ["calls", "instantiates", "extends", "implements"]
const ph = kinds.map(() => "?").join(",")
const kindRank = "CASE r.relationship_type WHEN 'calls' THEN 0 WHEN 'instantiates' THEN 1 WHEN 'extends' THEN 2 WHEN 'implements' THEN 3 ELSE 9 END"
const cols = "SELECT r.id AS rowId, r.line_number AS lineNumber, r.relationship_type AS relType, r.confidence AS confidence, s.id AS symId, s.name AS symName, s.line_start AS line, f.relative_path AS fileRel, " + kindRank + " AS kindRank "
const sqlA = cols + "FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id JOIN brain_file f ON f.id = s.file_id " +
  "WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") AND r.target_symbol_id IN (SELECT id FROM brain_symbol WHERE id = ?) ORDER BY kindRank, fileRel, lineNumber, rowId LIMIT ?"
const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"
const sqlB = cols + "FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id JOIN brain_file f ON f.id = s.file_id " +
  "JOIN (" + cascade + ") casc ON casc.id = r.target_symbol_id " +
  "WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") ORDER BY kindRank, fileRel, lineNumber, rowId LIMIT ?"

// Warm the prepared statements, then measure interleaved: A,B,A,B twice.
const stmtA = raw.prepare(sqlA)
const stmtB = raw.prepare(sqlB)
const runA = () => stmtA.all(pid, ...kinds, root, 201).length
const runB = () => stmtB.all(root, prefix, upper, pid, pid, ...kinds, 201).length
runA(); runB()
await timeIt("flat-A-1", runA)
await timeIt("cascade-B-1", runB)
await timeIt("flat-A-2", runA)
await timeIt("cascade-B-2", runB)
await timeIt("engine-depth-1-readonly", () => graphTraversal(pid, "computeImpact", { direction: "callers", maxDepth: 1, relationshipTypes: kinds }).then((r: any) => ({ callers: r.callers.length })))
await timeIt("engine-depth-5-readonly", () => graphTraversal(pid, "computeImpact", { direction: "callers", maxDepth: 5, relationshipTypes: kinds }).then((r: any) => ({ callers: r.callers.length })))
await timeIt("control-count-symbols", () => raw.prepare("SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ?").get(pid))

writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-t2-query-cost-readonly.ts",
  openMode: "byte-read-only (BrainDatabase.getRawInstance(projectId,{readonly:true}))",
  loadAverage: load,
  rows,
}, null, 2) + "\n")
console.log("QUERYCOST_READONLY_DONE")
