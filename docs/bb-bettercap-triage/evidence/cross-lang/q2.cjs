const Database = require('better-sqlite3')
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true })
const J = (x) => JSON.stringify(x, null, 2)
const mode = process.argv[3]
if (mode === 'external-bound') {
  const rows = db.prepare(`
    SELECT sf.language AS src_lang, tf.language AS tgt_lang, r.relationship_type AS rt,
           COUNT(*) AS n,
           SUM(CASE WHEN r.target_external IS NOT NULL AND TRIM(r.target_external) <> '' THEN 1 ELSE 0 END) AS external_declared
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
    JOIN brain_file sf ON sf.id = ss.file_id
    JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
    JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.is_cross_language = 1
    GROUP BY sf.language, tf.language, r.relationship_type
    ORDER BY external_declared DESC, n DESC
  `).all()
  const tot = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN target_external IS NOT NULL AND TRIM(target_external) <> '' THEN 1 ELSE 0 END) ext FROM brain_relationship WHERE is_cross_language = 1`).get()
  console.log(J({ totals: tot, byPairType: rows }))
} else if (mode === 'assets') {
  const rows = db.prepare(`
    SELECT
      SUM(CASE WHEN sf.relative_path LIKE '%/assets/%' OR tf.relative_path LIKE '%/assets/%' THEN 1 ELSE 0 END) AS with_asset_endpoint,
      SUM(CASE WHEN sf.relative_path LIKE '%/assets/%' THEN 1 ELSE 0 END) AS source_asset,
      SUM(CASE WHEN tf.relative_path LIKE '%/assets/%' THEN 1 ELSE 0 END) AS target_asset,
      COUNT(*) AS total
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
    JOIN brain_file sf ON sf.id = ss.file_id
    JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
    JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.is_cross_language = 1
  `).get()
  console.log(J(rows))
} else if (mode === 'hubs') {
  const rows = db.prepare(`
    SELECT ts.name AS name, COUNT(*) AS n
    FROM brain_relationship r
    JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
    WHERE r.is_cross_language = 1
    GROUP BY ts.name ORDER BY n DESC LIMIT 25
  `).all()
  console.log(J(rows))
} else if (mode === 'impossible') {
  // pairs where the relationship type cannot genuinely cross that language boundary
  const rows = db.prepare(`
    SELECT sf.language AS src_lang, tf.language AS tgt_lang, r.relationship_type AS rt, COUNT(*) AS n
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
    JOIN brain_file sf ON sf.id = ss.file_id
    JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
    JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.is_cross_language = 1
      AND (
        (r.relationship_type = 'imports' AND NOT ((sf.language='go' AND tf.language='go') OR (sf.language='javascript' AND tf.language IN ('javascript','typescript')) OR (sf.language='typescript' AND tf.language IN ('javascript','typescript','json')) OR (sf.language='python' AND tf.language='python')))
        OR (r.relationship_type IN ('calls','uses') AND tf.language IN ('yaml','make','xml','markdown','json','toml','ini','html','css'))
      )
    GROUP BY sf.language, tf.language, r.relationship_type ORDER BY n DESC
  `).all()
  const sum = rows.reduce((a, b) => a + b.n, 0)
  console.log(J({ structurallyImpossible: sum, detail: rows }))
}
