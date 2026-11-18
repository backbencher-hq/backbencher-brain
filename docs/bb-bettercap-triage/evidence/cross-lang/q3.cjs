const Database = require('better-sqlite3')
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true })
const J = (x) => JSON.stringify(x, null, 2)
const mode = process.argv[3]
if (mode === 'corpus') {
  const agg = db.prepare(`
    SELECT sf.language AS src_lang, tf.language AS tgt_lang, r.relationship_type AS rt, COUNT(*) AS n
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
    JOIN brain_file sf ON sf.id = ss.file_id
    JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
    JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.is_cross_language = 1 AND (sf.relative_path LIKE '.corpus/%' OR tf.relative_path LIKE '.corpus/%')
    GROUP BY sf.language, tf.language, r.relationship_type ORDER BY n DESC LIMIT 40
  `).all()
  const samples = db.prepare(`
    SELECT sf.relative_path AS s_file, ss.name AS s_name, ss.line_start AS s_line,
           r.relationship_type AS rt, r.confidence AS conf, r.target_external AS tgt_ext,
           tf.relative_path AS t_file, ts.name AS t_name, ts.line_start AS t_line, tf.language AS t_lang,
           r.id AS row_id
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id = r.source_symbol_id AND ss.project_id = r.project_id
    JOIN brain_file sf ON sf.id = ss.file_id
    JOIN brain_symbol ts ON ts.id = r.target_symbol_id AND ts.project_id = r.project_id
    JOIN brain_file tf ON tf.id = ts.file_id
    WHERE r.is_cross_language = 1 AND (sf.relative_path LIKE '.corpus/%' OR tf.relative_path LIKE '.corpus/%')
    ORDER BY sf.relative_path, sf.language, r.relationship_type LIMIT 60
  `).all()
  console.log(J({ agg, samples }))
}
