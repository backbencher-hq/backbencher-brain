const Database = require('better-sqlite3')
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true })
const J = (x) => JSON.stringify(x, null, 2)
const mode = process.argv[3]
if (mode === 'corpus-status') {
  const corpusFiles = db.prepare(`SELECT COUNT(*) n FROM brain_file WHERE relative_path LIKE '.corpus/%'`).get()
  const corpusSyms = db.prepare(`SELECT COUNT(*) n FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE f.relative_path LIKE '.corpus/%'`).get()
  const corpusRels = db.prepare(`
    SELECT COUNT(*) n, SUM(r.is_cross_language) xl, SUM(CASE WHEN r.target_symbol_id IS NULL THEN 1 ELSE 0 END) unbound
    FROM brain_relationship r
    JOIN brain_symbol ss ON ss.id=r.source_symbol_id AND ss.project_id=r.project_id
    JOIN brain_file sf ON sf.id=ss.file_id
    WHERE sf.relative_path LIKE '.corpus/%'`).get()
  const corpusTargetRels = db.prepare(`
    SELECT COUNT(*) n, SUM(r.is_cross_language) xl
    FROM brain_relationship r
    JOIN brain_symbol ts ON ts.id=r.target_symbol_id AND ts.project_id=r.project_id
    JOIN brain_file tf ON tf.id=ts.file_id
    WHERE tf.relative_path LIKE '.corpus/%'`).get()
  const langs = db.prepare(`SELECT language, COUNT(*) n FROM brain_file WHERE relative_path LIKE '.corpus/%' GROUP BY language ORDER BY n DESC LIMIT 15`).all()
  const consul = db.prepare(`SELECT relative_path, language FROM brain_file WHERE relative_path LIKE '.corpus/consul/%main.go%' OR relative_path LIKE '.corpus/vault/%main.go%' LIMIT 10`).all()
  console.log(J({ corpusFiles, corpusSyms, corpusRels, corpusTargetRels, langs, goMains: consul }))
}
