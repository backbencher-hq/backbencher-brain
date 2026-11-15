// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS — per-statement timing for one bb_graph traversal's work
// units (root resolution, the two edge arms, the unattributed counting scans),
// so the cost of a default call can be attributed to a statement rather than
// guessed from the total.
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/timing.json.
// CONTRACTS IT MUST NOT BREAK — read-only: the database is opened `readonly`.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../src/brain/database"
import { getProjectId } from "../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const pid = getProjectId(ROOT)
const db = BrainDatabase.openByPath(BrainDatabase.getDbPath(pid), { readonly: true }) as any
const timed = <T>(label: string, fn: () => T): { label: string; ms: number; value: T } => {
  const t = performance.now()
  const value = fn()
  return { label, ms: Math.round((performance.now() - t) * 100) / 100, value }
}
const out: any = {}
for (const name of ["likeContains", "traverseGraph", "graphTraversal"]) {
  const rows = db.prepare(`SELECT s.id, s.name, s.symbol_type, s.line_start, f.relative_path,
      (SELECT COUNT(*) FROM brain_relationship x WHERE x.target_symbol_id = s.id) inc,
      (SELECT COUNT(*) FROM brain_relationship x WHERE x.source_symbol_id = s.id) out
    FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
    WHERE s.project_id=? AND s.name=? ORDER BY s.gravity_score DESC`).all(pid, name)
  out[name] = rows
}
const target = out.likeContains[0]
const id = target.id
const prefix = id.slice(0, id.lastIndexOf(":") + 1)
const upper = prefix + ";"
const relTypes = ["calls","extends","implements","uses","instantiates","overrides","contains","references","imports","exports","decorates","renders","mixes_in","part_of"]
const ph = relTypes.map(() => "?").join(",")
const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"

out.timings = {}
// unattributed caller count (engine, depth 0 only)
out.timings.unattributedCallers = timed("unattributed-callers", () => db.prepare(
  `SELECT COUNT(*) AS c FROM brain_relationship r JOIN (${cascade}) casc ON casc.id = r.target_symbol_id
    WHERE r.project_id = ? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NULL`
).all(id, prefix, upper, pid, pid, ...relTypes)[0])
out.timings.unattributedCallees = timed("unattributed-callees", () => db.prepare(
  `SELECT COUNT(*) AS c FROM brain_relationship r JOIN (${cascade}) casc ON casc.id = r.source_symbol_id
    WHERE r.project_id = ? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NULL AND r.target_external IS NULL`
).all(id, prefix, upper, pid, pid, ...relTypes)[0])
const callerSql = `SELECT r.id FROM brain_relationship r
  JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id
  JOIN brain_file f ON f.id = s.file_id
  JOIN (${cascade}) casc ON casc.id = r.target_symbol_id
  WHERE r.project_id = ? AND r.relationship_type IN (${ph})
  ORDER BY r.relationship_type, f.relative_path, r.line_number, r.id LIMIT ?`
out.timings.callerArm = timed("caller-arm", () => db.prepare(callerSql).all(id, prefix, upper, pid, pid, ...relTypes, 201).length)
out.timings.callerArmRepeat = timed("caller-arm-repeat", () => db.prepare(callerSql).all(id, prefix, upper, pid, pid, ...relTypes, 201).length)
writeFileSync(path.join(ROOT, "validation/tools/bb_graph/results/timing.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({ resolved: { name: target.name, file: target.relative_path, inc: target.inc, out: target.out, candidates: out.likeContains.length }, timings: out.timings }, null, 2))
db.close()
