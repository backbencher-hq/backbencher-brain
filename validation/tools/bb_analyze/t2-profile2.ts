import { BrainDatabase } from "../../../src/brain/database"
import { graphTraversal } from "../../../src/intelligence/graph/graph-engine"
const pid = "1d3d57103be91b8f9716d70199fe28a3f39245d9"
const raw = await BrainDatabase.getRawInstance(pid as any)
const time = async <T>(label: string, fn: () => T): Promise<T> => { const t = Date.now(); const v = await fn(); console.log(`${label}: ${Date.now() - t}ms`); return v }
const ROOT = "1d3d57103be91b8f9716d70199fe28a3f39245d9:script/verify-mcp-e2e.ts:getProjectId:67"
const prefix = ROOT.slice(0, ROOT.lastIndexOf(":") + 1), upper = prefix + ";"
const relTypes = ["calls","extends","implements","uses","instantiates","overrides","contains","references","imports","exports","decorates","renders","mixes_in","part_of"]
const ph = relTypes.map(() => "?").join(",")
const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"
const KIND_RANK = "CASE r.relationship_type " + relTypes.map((k, i) => `WHEN '${k}' THEN ${i}`).join(" ") + " ELSE 99 END AS kindRank "
const callerSql = "SELECT r.id AS rowId, r.line_number AS lineNumber, " + KIND_RANK + ", f.relative_path AS fileRel " +
  "FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
  "JOIN brain_file f ON f.id = s.file_id JOIN (" + cascade + ") casc ON casc.id = r.target_symbol_id " +
  "WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ")"
const params = [ROOT, prefix, upper, pid, pid, ...relTypes]
await time("caller FULL projection no-order LIMIT 201", () => raw.prepare(callerSql + " LIMIT ?").all(...params, 201))
console.log("PLAN:", JSON.stringify(raw.prepare("EXPLAIN QUERY PLAN " + callerSql + " LIMIT ?").all(...params, 201)))
await time("count exact targeted single id", () => raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=? AND target_symbol_id=? AND relationship_type IN ("+ph+")").get(pid, ROOT, ...relTypes))
await time("count targeted by cascade range prefix", () => raw.prepare("SELECT COUNT(*) c FROM brain_symbol m WHERE m.project_id=? AND m.owner_symbol_id >= ? AND m.owner_symbol_id < ?").get(pid, prefix, upper))
console.log("relationship indexes:", JSON.stringify(raw.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='brain_relationship'").all()))
console.log("symbol indexes:", JSON.stringify(raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='brain_symbol'").all()))
for (const target of ["makeProvenance", "graphTraversal", "zz_no_such_name"]) {
  const t = Date.now()
  try { await graphTraversal(pid as any, target, { direction: "callers", maxDepth: 3, timeBudgetMs: 2000 }) } catch (e: any) { console.log(target, "threw:", String(e.message).slice(0,80)) }
  console.log(`graphTraversal callers(${target}): ${Date.now()-t}ms`)
}
