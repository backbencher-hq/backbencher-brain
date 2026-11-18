// Read-only inspection of the bettercap index DB for ISSUE-02 (cross-language rows).
// NEVER writes. Usage: node inspect-db.cjs <dbPath> <mode>
const Database = require('better-sqlite3')
const dbPath = process.argv[2]
const mode = process.argv[3] || 'main-rows'
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
const J = (x) => JSON.stringify(x, null, 2)

if (mode === 'main-rows') {
  const rows = db.prepare(`
    SELECT r.id AS row_id, r.relationship_type, r.confidence, r.line_number,
           r.is_cross_file, r.is_cross_language, r.bridge_mechanism,
           r.target_external, r.source_external, r.context, r.metadata,
           ss.name AS source_name, ss.id AS source_id, ss.symbol_type AS source_type,
           ss.line_start AS source_line, sf.relative_path AS source_file, sf.language AS source_lang,
           ts.name AS target_name, ts.id AS target_id, ts.symbol_type AS target_type,
           ts.line_start AS target_line, tf.relative_path AS target_file, tf.language AS target_lang
    FROM brain_relationship r
    LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
    LEFT JOIN brain_file sf ON sf.id = ss.file_id
    LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
    LEFT JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.is_cross_language = 1
      AND (ss.name = 'main' OR ts.name = 'main')
    ORDER BY r.id
  `).all()
  console.log(J(rows))
} else if (mode === 'main-copies') {
  const rows = db.prepare(`
    SELECT s.id, s.name, s.symbol_type, s.line_start, s.line_end, s.is_declaration,
           f.relative_path, f.language
    FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.name = 'main' ORDER BY f.relative_path, s.line_start, s.id
  `).all()
  console.log(J(rows))
} else if (mode === 'import-rows') {
  // every row whose source is a symbol named main in main.go, any target
  const rows = db.prepare(`
    SELECT r.id AS row_id, r.relationship_type, r.confidence, r.line_number,
           r.is_cross_file, r.is_cross_language, r.bridge_mechanism, r.target_external,
           r.metadata,
           ss.name AS source_name, ss.symbol_type AS source_type, ss.line_start AS source_line,
           sf.relative_path AS source_file,
           ts.name AS target_name, ts.symbol_type AS target_type, ts.line_start AS target_line,
           tf.relative_path AS target_file, tf.language AS target_lang
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id = r.source_symbol_id
    JOIN brain_file sf ON sf.id = ss.file_id
    LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
    LEFT JOIN brain_file tf ON tf.id = ts.file_id
    WHERE sf.relative_path = 'main.go' AND ss.name = 'main'
    ORDER BY r.relationship_type, r.line_number, r.id
  `).all()
  console.log(J(rows))
} else if (mode === 'pairs') {
  const langFilter = process.argv[4] || null
  const rows = db.prepare(`
    SELECT sf.language AS src_lang, tf.language AS tgt_lang, r.relationship_type,
           r.bridge_mechanism, COUNT(*) AS n,
           SUM(CASE WHEN r.bridge_mechanism = 'name-resolution' THEN 1 ELSE 0 END) AS name_res_rows
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
    JOIN brain_file sf ON sf.id = ss.file_id
    JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
    JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.is_cross_language = 1
      ${langFilter ? "AND (sf.language = ? OR tf.language = ?)" : ''}
    GROUP BY sf.language, tf.language, r.relationship_type, r.bridge_mechanism
    ORDER BY n DESC
  `)
  console.log(J(langFilter ? rows.all(langFilter, langFilter) : rows.all()))
} else if (mode === 'totals') {
  const total = db.prepare(`SELECT COUNT(*) n FROM brain_relationship`).get()
  const cross = db.prepare(`SELECT COUNT(*) n FROM brain_relationship WHERE is_cross_language = 1`).get()
  const crossNonName = db.prepare(`SELECT COUNT(*) n FROM brain_relationship WHERE is_cross_language = 1 AND (bridge_mechanism IS NULL OR bridge_mechanism <> 'name-resolution')`).get()
  const extTargets = db.prepare(`SELECT COUNT(*) n FROM brain_relationship WHERE target_symbol_id IS NULL`).get()
  console.log(J({ totalRows: total.n, crossRows: cross.n, crossRowsNotNameResolution: crossNonName.n, rowsWithNullTargetSymbol: extTargets.n }))
} else if (mode === 'narrow') {
  // the 7 rows, summarized without metadata blobs
  const rows = db.prepare(`
    SELECT r.id, r.relationship_type AS rt, r.confidence AS conf, r.line_number AS src_line,
           r.is_cross_file AS xfile, r.is_cross_language AS xlang, r.bridge_mechanism AS bridge,
           r.target_external AS tgt_ext,
           ss.name AS s_name, ss.id AS s_id, sf.relative_path AS s_file,
           ts.name AS t_name, ts.id AS t_id, tf.relative_path AS t_file, tf.language AS t_lang
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id = r.source_symbol_id
    JOIN brain_file sf ON sf.id = ss.file_id
    LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
    LEFT JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.is_cross_language = 1 AND (ss.name = 'main' OR ts.name = 'main')
    ORDER BY r.id
  `).all()
  console.log(J(rows))
} else {
  console.error('unknown mode')
  process.exit(1)
}
