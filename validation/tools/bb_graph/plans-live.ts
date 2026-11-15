// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS — the plans and timings the TOOL actually runs, on the same
// database handle the handler opens (BrainDatabase.getRawInstance runs the
// additive migrations and, when absent, builds planner statistics, so a plan
// read from a bare read-only handle is not the plan a caller pays for).
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/plans-live.json.
// CONTRACTS IT MUST NOT BREAK — read-only in the tool sense: only SELECT and
// EXPLAIN are issued here; no indexer and no write tool is run.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../src/brain/database"
import { getProjectId } from "../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const pid = getProjectId(ROOT)
const t0 = performance.now()
const db = (await BrainDatabase.getRawInstance(pid as any)) as any
const openMs = Math.round((performance.now() - t0) * 100) / 100
const relTypes = ["calls","extends","implements","uses","instantiates","overrides","contains","references","imports","exports","decorates","renders","mixes_in","part_of"]
const ph = relTypes.map(() => "?").join(",")
const id = (db.prepare("SELECT id FROM brain_symbol WHERE project_id=? AND name='likeContains' ORDER BY gravity_score DESC LIMIT 1").get(pid) as any).id
const prefix = id.slice(0, id.lastIndexOf(":") + 1)
const upper = prefix + ";"
const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"
const stmts: Record<string, { sql: string; params: any[] }> = {
  unattributedCallers: { sql: `SELECT COUNT(*) AS c FROM brain_relationship r JOIN (${cascade}) casc ON casc.id = r.target_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NULL`, params: [id, prefix, upper, pid, pid, ...relTypes] },
  callerArm: { sql: `SELECT r.id FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id JOIN brain_file f ON f.id = s.file_id JOIN (${cascade}) casc ON casc.id = r.target_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (${ph}) ORDER BY r.relationship_type, f.relative_path, r.line_number, r.id LIMIT ?`, params: [id, prefix, upper, pid, pid, ...relTypes, 201] },
  cascadeOnly: { sql: cascade, params: [id, prefix, upper, pid] },
  rootExact: { sql: `SELECT s.id FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = s.project_id WHERE s.project_id = ? AND s.name = ? ORDER BY s.gravity_score DESC, s.id ASC LIMIT 1`, params: [pid, "likeContains"] },
}
const out: any = { openMs, dbPath: BrainDatabase.getDbPath(pid) }
out.stat1 = db.prepare("SELECT tbl, idx, stat FROM sqlite_stat1 WHERE tbl IN ('brain_symbol','brain_relationship') LIMIT 20").all()
out.queryOnly = db.prepare("PRAGMA query_only").all()
out.timings = {}
for (const [label, { sql, params }] of Object.entries(stmts)) {
  const plan = db.prepare("EXPLAIN QUERY PLAN " + sql).all(...params).map((p: any) => p.detail)
  const t = performance.now()
  const rows = db.prepare(sql).all(...params).length
  out.timings[label] = { ms: Math.round((performance.now() - t) * 100) / 100, rows, plan }
}
writeFileSync(path.join(ROOT, "validation/tools/bb_graph/results/plans-live.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
process.exit(0)
