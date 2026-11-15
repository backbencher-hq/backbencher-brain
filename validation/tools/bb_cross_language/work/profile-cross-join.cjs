// validation/tools/bb_cross_language/work/profile-cross-join.cjs
//
// Phase A prototype for defect D4: measure the shipped by-name statements against a
// join-order rewrite that preserves every predicate and forces the planner to drive
// from the symbol-name index instead of scanning the project's relationship table.
// Read-only on the shared reference index; writes nothing but the JSON named below.
//
// Run: node validation/tools/bb_cross_language/work/profile-cross-join.cjs
const Database = require("better-sqlite3")
const fs = require("node:fs")
const PID = "1d3d57103be91b8f9716d70199fe28a3f39245d9"
const db = new Database(".bb-data/projects/" + PID + "/brain.db", { readonly: true, fileMustExist: true })

const OLD_OWN = `SELECT r.id AS row_id, ts.name AS self_name, ss.name AS other_name
 FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id JOIN brain_symbol ss ON ss.id = r.source_symbol_id
 WHERE r.project_id = ? AND r.is_cross_language = 1 AND ts.name = ?
 UNION ALL
 SELECT r.id, ss.name, ts.name
 FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id JOIN brain_symbol ts ON ts.id = r.target_symbol_id
 WHERE r.project_id = ? AND r.is_cross_language = 1 AND ss.name = ?`

const NEW_OWN = `SELECT r.id AS row_id, ts.name AS self_name, ss.name AS other_name
 FROM brain_symbol ts CROSS JOIN brain_relationship r ON r.target_symbol_id = ts.id AND r.is_cross_language = 1
 CROSS JOIN brain_symbol ss ON ss.id = r.source_symbol_id
 WHERE ts.name = ? AND r.project_id = ?
 UNION ALL
 SELECT r.id, ss.name, ts.name
 FROM brain_symbol ss CROSS JOIN brain_relationship r ON r.source_symbol_id = ss.id AND r.is_cross_language = 1
 CROSS JOIN brain_symbol ts ON ts.id = r.target_symbol_id
 WHERE ss.name = ? AND r.project_id = ?`

const OLD_MEMBER = `SELECT r.id,'caller' AS d, m.id AS member_id FROM brain_relationship r JOIN brain_symbol m ON m.id = r.target_symbol_id
 JOIN brain_symbol owner ON owner.id = m.owner_symbol_id WHERE r.project_id = ? AND r.is_cross_language = 1 AND owner.name = ? AND m.name <> owner.name
 UNION ALL
 SELECT r.id,'callee', m.id FROM brain_relationship r JOIN brain_symbol m ON m.id = r.source_symbol_id
 JOIN brain_symbol owner ON owner.id = m.owner_symbol_id WHERE r.project_id = ? AND r.is_cross_language = 1 AND owner.name = ? AND m.name <> owner.name`

const NEW_MEMBER = `SELECT r.id,'caller' AS d, m.id AS member_id
 FROM brain_symbol owner CROSS JOIN brain_symbol m ON m.owner_symbol_id = owner.id
 CROSS JOIN brain_relationship r ON r.target_symbol_id = m.id AND r.is_cross_language = 1
 WHERE owner.name = ? AND r.project_id = ? AND m.name <> owner.name
 UNION ALL
 SELECT r.id,'callee', m.id
 FROM brain_symbol owner CROSS JOIN brain_symbol m ON m.owner_symbol_id = owner.id
 CROSS JOIN brain_relationship r ON r.source_symbol_id = m.id AND r.is_cross_language = 1
 WHERE owner.name = ? AND r.project_id = ? AND m.name <> owner.name`

const time = (sql, args) => {
  const started = process.hrtime.bigint()
  const rows = db.prepare(sql).all(...args)
  return { ms: Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 1000) / 1000, rows: rows.length, rowIds: rows.map((r) => r.row_id ?? r.member_id).sort() }
}
const results = {
  note: "prototype of the join-order fix for D4. old = shipped SQL; new = CROSS JOIN driving from the symbol-name index. Same row set: INNER joins are commutative and every predicate (including r.project_id) is preserved.",
  projectId: PID,
  generatedAt: new Date().toISOString(),
  subjects: {},
}
for (const name of ["Command", "type", "file"]) {
  const a = time(OLD_OWN, [PID, name, PID, name])
  const b = time(NEW_OWN, [name, PID, name, PID])
  const c = time(OLD_MEMBER, [PID, name, PID, name])
  const d = time(NEW_MEMBER, [name, PID, name, PID])
  results.subjects[name] = {
    ownFacts: { oldMs: a.ms, newMs: b.ms, rowsEqual: JSON.stringify(a.rowIds) === JSON.stringify(b.rowIds), rows: a.rows },
    memberFacts: { oldMs: c.ms, newMs: d.ms, rowsEqual: JSON.stringify(c.rowIds) === JSON.stringify(d.rowIds), rows: c.rows },
  }
}
db.close()
fs.writeFileSync("validation/tools/bb_cross_language/results/AUDIT-t2-query-fix-prototype.json", JSON.stringify(results, null, 2) + "\n")
console.log(JSON.stringify(results.subjects, null, 1))
