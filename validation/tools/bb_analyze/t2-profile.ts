// Where does a T2 `callers` walk spend its 22 s? Times the engine's own statements.
import { BrainDatabase } from "../../../src/brain/database"
import { graphTraversal } from "../../../src/intelligence/graph/graph-engine"
const pid = "1d3d57103be91b8f9716d70199fe28a3f39245d9"
const raw = await BrainDatabase.getRawInstance(pid as any)
const time = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
  const t = Date.now(); const v = await fn(); console.log(`${label}: ${Date.now() - t}ms`); return v
}
const ROOT = "1d3d57103be91b8f9716d70199fe28a3f39245d9:script/verify-mcp-e2e.ts:getProjectId:67"
const prefix = ROOT.slice(0, ROOT.lastIndexOf(":") + 1)
const upper = prefix + ";"
const relTypes = ["calls","extends","implements","uses","instantiates","overrides","contains","references","imports","exports","decorates","renders","mixes_in","part_of"]
const ph = relTypes.map(() => "?").join(",")
const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"
const KIND_RANK = "CASE r.relationship_type " + relTypes.map((k, i) => `WHEN '${k}' THEN ${i}`).join(" ") + " ELSE 99 END AS kindRank "

await time("root-resolve exact structural", () => raw.prepare("SELECT s.id FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = s.project_id WHERE s.project_id = ? AND s.symbol_type IN ('function','method','class','interface','struct','enum','trait','module','namespace') AND s.name = ? ORDER BY s.gravity_score DESC, s.id ASC LIMIT 1").all(pid, "getProjectId"))
await time("root-resolve exact any-kind", () => raw.prepare("SELECT s.id FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = s.project_id WHERE s.project_id = ? AND s.name = ? ORDER BY s.gravity_score DESC, s.id ASC LIMIT 1").all(pid, "getProjectId"))

const callerSql = "SELECT r.id AS rowId, r.line_number AS lineNumber " + "FROM brain_relationship r " +
  "JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
  "JOIN brain_file f ON f.id = s.file_id " +
  "JOIN (" + cascade + ") casc ON casc.id = r.target_symbol_id " +
  "WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ")"
const params = [ROOT, prefix, upper, pid, pid, ...relTypes]
await time("caller query no-order LIMIT 201", () => raw.prepare(callerSql + " LIMIT ?").all(...params, 201))
await time("caller query ORDER BY LIMIT 201", () => raw.prepare(callerSql + " ORDER BY kindRank, f.relative_path, r.line_number, r.id LIMIT ?").all(...params, 201))
await time("cascade member ids", () => raw.prepare("SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?").all(prefix, upper, pid))
await time("unattributed callers count", () => raw.prepare("SELECT COUNT(*) c FROM brain_relationship r JOIN (" + cascade + ") casc ON casc.id = r.target_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") AND r.source_symbol_id IS NULL").all(ROOT, prefix, upper, pid, pid, ...relTypes))
await time("unattributed callees count", () => raw.prepare("SELECT COUNT(*) c FROM brain_relationship r JOIN (" + cascade + ") casc ON casc.id = r.source_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") AND r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NULL AND r.target_external IS NULL").all(ROOT, prefix, upper, pid, pid, ...relTypes))
const plan = raw.prepare("EXPLAIN QUERY PLAN " + callerSql + " ORDER BY kindRank, f.relative_path, r.line_number, r.id LIMIT ?").all(...params, 201)
console.log("PLAN caller:", JSON.stringify(plan))
await time("graphTraversal callers 22s?", () => graphTraversal(pid as any, "getProjectId", { direction: "callers", maxDepth: 3, timeBudgetMs: 2000 }))
