const Database = require('better-sqlite3')
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true })
const J = (x) => JSON.stringify(x, null, 2)
const rows = db.prepare(`
  SELECT r.id AS row_id, r.relationship_type AS rt, r.confidence AS conf,
         r.bridge_mechanism AS bridge, json_extract(r.metadata,'$.evidenceClass') AS evidence_class,
         ss.name AS s_name, sf.relative_path AS s_file, sf.language AS s_lang, ss.line_start AS s_line,
         ts.name AS t_name, tf.relative_path AS t_file, tf.language AS t_lang, ts.line_start AS t_line
  FROM brain_relationship r
  JOIN brain_symbol ss ON ss.id=r.source_symbol_id AND ss.project_id=r.project_id
  JOIN brain_file sf ON sf.id=ss.file_id
  JOIN brain_symbol ts ON ts.id=r.target_symbol_id AND ts.project_id=r.project_id
  JOIN brain_file tf ON tf.id=ts.file_id
  WHERE r.is_cross_language = 1
    AND tf.language IN ('json','markdown','yaml')
    AND sf.language IN ('typescript','javascript','go')
  ORDER BY r.confidence DESC, r.id
  LIMIT 25
`).all()
const totals = db.prepare(`SELECT COUNT(*) n FROM brain_relationship WHERE is_cross_language=1`).get()
console.log(J({ workspaceCrossRows: totals.n, sample: rows }))
