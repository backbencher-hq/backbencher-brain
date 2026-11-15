// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS — EXPLAIN QUERY PLAN for the statements a default bb_graph
// call runs, so a slow call is attributed to the plan SQLite chose rather than
// to the row count it touched. Reads only.
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/plans.json.
// CONTRACTS IT MUST NOT BREAK — read-only: the database is opened `readonly`.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../src/brain/database"
import { getProjectId } from "../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const pid = getProjectId(ROOT)
const db = BrainDatabase.openByPath(BrainDatabase.getDbPath(pid), { readonly: true }) as any
const relTypes = ["calls","extends","implements","uses","instantiates","overrides","contains","references","imports","exports","decorates","renders","mixes_in","part_of"]
const ph = relTypes.map(() => "?").join(",")
const id = (db.prepare("SELECT id FROM brain_symbol WHERE project_id=? AND name='likeContains' ORDER BY gravity_score DESC LIMIT 1").get(pid) as any).id
const prefix = id.slice(0, id.lastIndexOf(":") + 1)
const upper = prefix + ";"
const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"
const kindRank = "CASE r.relationship_type " + Object.entries({calls:0,instantiates:2,extends:4,implements:6,mixes_in:7,renders:8,overrides:10,decorates:11,uses:12,references:14,imports:16,exports:18,contains:20,part_of:22}).map(([k,v])=>`WHEN '${k}' THEN ${v}`).join(" ") + " ELSE 100 END AS kindRank"
const stmts: Record<string, { sql: string; params: any[] }> = {}
stmts.unattributedCallers = { sql: `SELECT COUNT(*) AS c FROM brain_relationship r JOIN (${cascade}) casc ON casc.id = r.target_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NULL`, params: [id, prefix, upper, pid, pid, ...relTypes] }
stmts.unattributedCallees = { sql: `SELECT COUNT(*) AS c FROM brain_relationship r JOIN (${cascade}) casc ON casc.id = r.source_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NULL AND r.target_external IS NULL`, params: [id, prefix, upper, pid, pid, ...relTypes] }
stmts.callerArm = { sql: `SELECT r.id, ${kindRank} FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id JOIN brain_file f ON f.id = s.file_id JOIN (${cascade}) casc ON casc.id = r.target_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (${ph}) ORDER BY kindRank, f.relative_path, r.line_number, r.id LIMIT ?`, params: [id, prefix, upper, pid, pid, ...relTypes, 201] }
stmts.rootExact = { sql: `SELECT s.id FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = s.project_id WHERE s.project_id = ? AND s.symbol_type IN ('function','method','class','interface','trait','struct','enum','macro') AND s.name = ? ORDER BY s.gravity_score DESC, s.id ASC LIMIT 1`, params: [pid, "likeContains"] }
stmts.attachMatched = { sql: "SELECT s.id AS id, s.name AS name, f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.id IN (?)", params: [id] }
const out: any = {}
for (const [label, { sql, params }] of Object.entries(stmts)) {
  const plan = db.prepare("EXPLAIN QUERY PLAN " + sql).all(...params)
  const t = performance.now()
  let rows = 0
  try { rows = db.prepare(sql).all(...params).length } catch (e) { rows = -1 }
  out[label] = { ms: Math.round((performance.now() - t) * 100) / 100, rows, plan: plan.map((p: any) => `${p.id}|${p.parent}|${p.detail}`) }
}
out.indexes = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND (tbl_name IN ('brain_relationship','brain_symbol','brain_file')) ORDER BY tbl_name, name").all().map((r: any) => ({ name: r.name, table: r.tbl_name, sql: String(r.sql ?? "").slice(0, 200) }))
out.columns = db.prepare("PRAGMA table_info(brain_relationship)").all().map((c: any) => c.name)
writeFileSync(path.join(ROOT, "validation/tools/bb_graph/results/plans.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({ plans: Object.fromEntries(Object.entries(out).filter(([k]) => k !== "indexes" && k !== "columns").map(([k, v]: any) => [k, { ms: v.ms, rows: v.rows, plan: v.plan }])) }, null, 2))
db.close()
