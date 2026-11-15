// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS — the AFTER measurement of the D-06 fix: the plans and
// timings of the statements one traversal runs, on a READ-ONLY open (no
// migrations, no WAL movement, no open-time healer scan), so the number is the
// cost of the question rather than the cost of opening the index.
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/plans-after.json.
// CONTRACTS IT MUST NOT BREAK — read-only open; only SELECT/EXPLAIN issued.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../src/brain/database"
import { getProjectId } from "../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const pid = getProjectId(ROOT)
const t0 = performance.now()
const db = (await BrainDatabase.getRawInstance(pid as any, { readonly: true })) as any
const openMs = Math.round((performance.now() - t0) * 100) / 100
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='brain_symbol' AND name LIKE '%owner%'").all().map((r: any) => r.name)
const relTypes = ["calls","extends","implements","uses","instantiates","overrides","contains","references","imports","exports","decorates","renders","mixes_in","part_of"]
const ph = relTypes.map(() => "?").join(",")
const id = (db.prepare("SELECT id FROM brain_symbol WHERE project_id=? AND name='likeContains' ORDER BY gravity_score DESC LIMIT 1").get(pid) as any).id
const prefix = id.slice(0, id.lastIndexOf(":") + 1)
const upper = prefix + ";"
const ownerIdx = indexes.includes("brain_symbol_project_owner_idx") ? "brain_symbol_project_owner_idx" : indexes.includes("brain_symbol_owner_idx") ? "brain_symbol_owner_idx" : null
const out: any = { openMs, ownerIndexesPresent: indexes, ownerIndexUsed: ownerIdx }
out.readonlyQueryOnly = db.prepare("PRAGMA query_only").get()
out.timings = {}
const timed = (label: string, sql: string, params: any[]) => {
  const plan = db.prepare("EXPLAIN QUERY PLAN " + sql).all(...params).map((p: any) => p.detail)
  const t = performance.now()
  const rows = db.prepare(sql).all(...params)
  return { label, ms: Math.round((performance.now() - t) * 100) / 100, rowCount: rows.length, plan }
}
// The cascade id fetch (new path): one indexed owner-range query per symbol.
const cascadeSql = `SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m${ownerIdx ? " INDEXED BY " + ownerIdx : ""} WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ? LIMIT 401`
const cascadeRows = timed("cascadeIds", cascadeSql, [id, prefix, upper, pid])
const ids = cascadeRows.rowCount > 0 ? (db.prepare(cascadeSql).all(id, prefix, upper, pid) as any[]).map((r) => r.id) : [id]
out.cascadeIds = ids.length
const inlineJoin = ids.length ? `JOIN (${ids.map(() => "SELECT ? AS id").join(" UNION ALL ")}) casc ON casc.id = r.target_symbol_id` : ""
out.timings.cascadeIds = { ms: cascadeRows.ms, rowCount: cascadeRows.rowCount, plan: cascadeRows.plan }
if (inlineJoin) {
  out.timings.callerArm = timed("callerArm",
    `SELECT r.id FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id JOIN brain_file f ON f.id = s.file_id ${inlineJoin} WHERE r.project_id = ? AND r.relationship_type IN (${ph}) ORDER BY r.relationship_type, f.relative_path, r.line_number, r.id LIMIT ?`,
    [...ids, pid, ...relTypes, 201])
  out.timings.unattributedCallers = timed("unattributedCallers",
    `SELECT COUNT(*) AS c FROM brain_relationship r ${inlineJoin} WHERE r.project_id = ? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NULL`,
    [...ids, pid, ...relTypes])
}
out.timings.rootExactNameIndexed = timed("rootExactNameIndexed",
  `SELECT s.id FROM brain_symbol s INDEXED BY brain_sym_proj_name_idx JOIN brain_file f ON f.id = s.file_id AND f.project_id = s.project_id WHERE s.project_id = ? AND s.name = ? ORDER BY s.gravity_score DESC, s.id ASC LIMIT 1`,
  [pid, "likeContains"])
writeFileSync(path.join(ROOT, "validation/tools/bb_graph/results/plans-after.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
process.exit(0)
