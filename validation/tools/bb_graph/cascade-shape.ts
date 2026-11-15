// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS — the shape of the owner cascade in stored ids: how
// `owner_symbol_id` relates to a member's own id, and whether the engine's
// lexical id-prefix range can be replaced by a range predicate on a
// relationship's target column (which is what decides a traversal's plan).
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/cascade-shape.json.
// CONTRACTS IT MUST NOT BREAK — read-only: the database is opened `readonly`.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../src/brain/database"
import { getProjectId } from "../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const pid = getProjectId(ROOT)
const db = BrainDatabase.openByPath(BrainDatabase.getDbPath(pid), { readonly: true }) as any
const out: any = {}
out.ownerRows = db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=? AND owner_symbol_id IS NOT NULL").get(pid).c
out.samples = db.prepare("SELECT id, owner_symbol_id, name, symbol_type FROM brain_symbol WHERE project_id=? AND owner_symbol_id IS NOT NULL LIMIT 8").all(pid)
out.ownerIsPrefixOfId = db.prepare("SELECT SUM(CASE WHEN id LIKE owner_symbol_id || '%' THEN 1 ELSE 0 END) prefixed, COUNT(*) total FROM brain_symbol WHERE project_id=? AND owner_symbol_id IS NOT NULL").get(pid)
out.noColonOwner = db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=? AND owner_symbol_id IS NOT NULL AND owner_symbol_id NOT LIKE '%:%'").get(pid)
// The range the engine builds: prefix = tracedId up to its LAST ':' (inclusive), upper = prefix || ';'
const cls = db.prepare("SELECT id, name FROM brain_symbol WHERE project_id=? AND symbol_type IN ('class','interface','struct','trait','enum') ORDER BY gravity_score DESC LIMIT 3").all(pid)
out.classRanges = cls.map((c: any) => {
  const prefix = c.id.slice(0, c.id.lastIndexOf(":") + 1)
  const upper = prefix + ";"
  const byOwner = db.prepare("SELECT COUNT(*) c FROM brain_symbol m WHERE m.project_id=? AND m.owner_symbol_id >= ? AND m.owner_symbol_id < ?").get(pid, prefix, upper).c
  const byIdRange = db.prepare("SELECT COUNT(*) c FROM brain_symbol m WHERE m.project_id=? AND m.id >= ? AND m.id < ? AND m.id <> ?").get(pid, prefix, upper, c.id).c
  const ownerPrefix = db.prepare("SELECT COUNT(*) c FROM brain_symbol m WHERE m.project_id=? AND m.owner_symbol_id = ?").get(pid, c.id).c
  return { id: c.id, name: c.name, prefix, upper, membersByOwnerRange: byOwner, idsInSameLexicalRange: byIdRange, membersByExactOwner: ownerPrefix }
})
// Cost comparison: cascade-as-join (engine) vs a range predicate on the target column.
const cls0 = cls[0]
if (cls0) {
  const prefix = cls0.id.slice(0, cls0.id.lastIndexOf(":") + 1)
  const upper = prefix + ";"
  const relTypes = ["calls","extends","implements","uses","instantiates","overrides","contains","references","imports","exports","decorates","renders","mixes_in","part_of"]
  const ph = relTypes.map(() => "?").join(",")
  const timed = (label: string, sql: string, params: any[]) => {
    const plan = db.prepare("EXPLAIN QUERY PLAN " + sql).all(...params).map((p: any) => p.detail)
    const t = performance.now()
    const n = db.prepare(sql).all(...params).length
    return { label, ms: Math.round((performance.now() - t) * 100) / 100, rows: n, plan }
  }
  const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"
  out.compare = [
    timed("engine-join", `SELECT r.id FROM brain_relationship r JOIN (${cascade}) casc ON casc.id = r.source_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) LIMIT 201`, [cls0.id, prefix, upper, pid, pid, ...relTypes]),
    timed("target-range-predicate", `SELECT r.id FROM brain_relationship r WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND (r.source_symbol_id = ? OR (r.source_symbol_id >= ? AND r.source_symbol_id < ?)) LIMIT 201`, [pid, ...relTypes, cls0.id, prefix, upper]),
  ]
}
writeFileSync(path.join(ROOT, "validation/tools/bb_graph/results/cascade-shape.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
db.close()
