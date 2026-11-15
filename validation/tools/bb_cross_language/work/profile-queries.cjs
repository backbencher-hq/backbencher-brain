// validation/tools/bb_cross_language/work/profile-queries.cjs
//
// Phase A: which of the seven statements bb_cross_language runs dominates its
// latency on the reference large index. Read-only connection; no write to the
// shared store. The SQL below is transcribed verbatim from
// src/lsp/cross_language_hover.ts (the statements are module-private, so this
// probe cannot import them and a divergence is possible in principle — the
// per-statement ordering of magnitude is what is being measured).
const Database = require("better-sqlite3")
const PID = "1d3d57103be91b8f9716d70199fe28a3f39245d9"
const db = new Database(".bb-data/projects/" + PID + "/brain.db", { readonly: true, fileMustExist: true })

const AGENT_FACTS_SQL = `SELECT r.id AS row_id, r.relationship_type AS relationship_type, r.confidence AS confidence,
 r.bridge_mechanism AS bridge_mechanism, r.metadata AS metadata, 'caller' AS direction,
 ts.id AS self_id, ts.name AS self_name, tf.relative_path AS self_file, tf.language AS self_language, ts.line_start AS self_line,
 ss.id AS other_id, ss.name AS other_name, sf.relative_path AS other_file, sf.language AS other_language, ss.line_start AS other_line
 FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id JOIN brain_file tf ON tf.id = ts.file_id
 JOIN brain_symbol ss ON ss.id = r.source_symbol_id JOIN brain_file sf ON sf.id = ss.file_id
 WHERE r.project_id = ? AND r.is_cross_language = 1 AND ts.name = ?
 UNION ALL
 SELECT r.id AS row_id, r.relationship_type AS relationship_type, r.confidence AS confidence,
 r.bridge_mechanism AS bridge_mechanism, r.metadata AS metadata, 'callee' AS direction,
 ss.id AS self_id, ss.name AS self_name, sf.relative_path AS self_file, sf.language AS self_language, ss.line_start AS self_line,
 ts.id AS other_id, ts.name AS other_name, tf.relative_path AS other_file, tf.language AS other_language, ts.line_start AS other_line
 FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id JOIN brain_file sf ON sf.id = ss.file_id
 JOIN brain_symbol ts ON ts.id = r.target_symbol_id JOIN brain_file tf ON tf.id = ts.file_id
 WHERE r.project_id = ? AND r.is_cross_language = 1 AND ss.name = ?
 ORDER BY self_file, self_line, direction, other_file, other_line, row_id`

const MEMBER_FACTS_SQL = `SELECT r.id AS row_id, r.relationship_type, r.confidence, r.bridge_mechanism, r.metadata, 'caller' AS direction,
 owner.id AS self_id, owner.name AS self_name, ofile.relative_path AS self_file, ofile.language AS self_language, owner.line_start AS self_line,
 ss.id AS other_id, ss.name AS other_name, sf.relative_path AS other_file, sf.language AS other_language, ss.line_start AS other_line,
 m.id AS member_id, m.name AS member_name, mfile.relative_path AS member_file, mfile.language AS member_language, m.line_start AS member_line
 FROM brain_relationship r JOIN brain_symbol m ON m.id = r.target_symbol_id JOIN brain_symbol owner ON owner.id = m.owner_symbol_id
 JOIN brain_file ofile ON ofile.id = owner.file_id JOIN brain_file mfile ON mfile.id = m.file_id
 JOIN brain_symbol ss ON ss.id = r.source_symbol_id JOIN brain_file sf ON sf.id = ss.file_id
 WHERE r.project_id = ? AND r.is_cross_language = 1 AND owner.name = ? AND m.name <> owner.name
 UNION ALL
 SELECT r.id, r.relationship_type, r.confidence, r.bridge_mechanism, r.metadata, 'callee' AS direction,
 owner.id, owner.name, ofile.relative_path, ofile.language, owner.line_start,
 ts.id, ts.name, tf.relative_path, tf.language, ts.line_start,
 m.id, m.name, mfile.relative_path, mfile.language, m.line_start
 FROM brain_relationship r JOIN brain_symbol m ON m.id = r.source_symbol_id JOIN brain_symbol owner ON owner.id = m.owner_symbol_id
 JOIN brain_file ofile ON ofile.id = owner.file_id JOIN brain_file mfile ON mfile.id = m.file_id
 JOIN brain_symbol ts ON ts.id = r.target_symbol_id JOIN brain_file tf ON tf.id = ts.file_id
 WHERE r.project_id = ? AND r.is_cross_language = 1 AND owner.name = ? AND m.name <> owner.name
 ORDER BY self_file, self_line, member_file, member_line, direction, other_file, other_line, row_id`

const ALL_COPIES_SQL = `SELECT s.id AS id, s.name AS name, f.relative_path AS file, f.language AS language, s.line_start AS line
 FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = ? ORDER BY f.relative_path, s.line_start, s.id LIMIT ?`
const COPY_COUNT_SQL = `SELECT COUNT(*) AS total FROM brain_symbol WHERE project_id = ? AND name = ?`
const COPY_LANGUAGES_SQL = `SELECT DISTINCT f.language AS language FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
 WHERE s.project_id = ? AND s.name = ? AND f.language IS NOT NULL AND TRIM(f.language) <> '' ORDER BY f.language`
const DEEPER_DESCENDANT_ROWS_SQL = `WITH RECURSIVE down(id, depth) AS (
 SELECT m.id, 1 FROM brain_symbol m JOIN brain_symbol o ON o.id = m.owner_symbol_id WHERE o.project_id = ? AND o.name = ?
 UNION ALL SELECT m.id, down.depth + 1 FROM brain_symbol m JOIN down ON m.owner_symbol_id = down.id)
 SELECT COUNT(DISTINCT r.id) AS n FROM brain_relationship r JOIN down ON down.id = r.target_symbol_id
 WHERE r.project_id = ? AND r.is_cross_language = 1 AND down.depth >= 2`

const time = (label, fn) => {
  const t = process.hrtime.bigint()
  const v = fn()
  const ms = Number(process.hrtime.bigint() - t) / 1e6
  console.log(label.padEnd(14), ms.toFixed(1) + "ms", "rows=" + v)
  return ms
}

const totals = {}
for (const name of ["Command", "type", "file"]) {
  console.log("--- " + name)
  time("agentFacts", () => db.prepare(AGENT_FACTS_SQL).all(PID, name, PID, name).length)
  time("memberFacts", () => db.prepare(MEMBER_FACTS_SQL).all(PID, name, PID, name).length)
  time("allCopies", () => db.prepare(ALL_COPIES_SQL).all(PID, name, 200).length)
  time("copyCount", () => db.prepare(COPY_COUNT_SQL).get(PID, name).total)
  time("copyLanguages", () => db.prepare(COPY_LANGUAGES_SQL).all(PID, name).length)
  totals[name] = time("deeperDesc", () => db.prepare(DEEPER_DESCENDANT_ROWS_SQL).get(PID, name, PID).n)
}
console.log("deeper-only totals:", JSON.stringify(totals))
db.close()
