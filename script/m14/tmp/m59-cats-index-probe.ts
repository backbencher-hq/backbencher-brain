// Why does the TOOL's answer lack the liftF call at TimeT.scala:148 while the
// analyzer emits `calls anonymous_Fiber -> liftF @148`? Walk file → symbols →
// relationships in the real built index.
import * as fs from "fs"
import { Database } from "bun:sqlite"

for (const d of fs.readdirSync("/tmp/m59-cats-data/projects")) {
  const dbPath = `/tmp/m59-cats-data/projects/${d}/brain.db`
  const db: any = new Database(dbPath, { readonly: true })
  const files = db
    .query("SELECT id,path,relative_path,line_count,has_syntax_errors FROM brain_file WHERE path LIKE '%TimeT.scala%'")
    .all()
  if (files.length === 0) {
    console.log(`\n===== project ${d}: no TimeT.scala`)
    db.close?.()
    continue
  }
  console.log(`\n===== project ${d}: ${files.length} TimeT.scala file(s)`)
  for (const f of files) {
    console.log(`   file id=${f.id} path=${f.path} lines=${f.line_count} syntaxErrors=${f.has_syntax_errors}`)
    const syms = db
      .query("SELECT id,name,qualified_name,symbol_type,line_start,line_end FROM brain_symbol WHERE file_id=? ORDER BY line_start")
      .all(f.id)
    console.log(`   symbols: ${syms.length}`)
    for (const s of syms)
      console.log(`      sym ${String(s.id).padStart(5)} ${String(s.symbol_type).padEnd(12)} ${String(s.name).padEnd(20)} L${s.line_start}-${s.line_end}`)
    const ids = syms.map((s: any) => s.id)
    if (ids.length === 0) continue
    const ph = ids.map(() => "?").join(",")
    const rels = db
      .query(
        `SELECT r.id,r.relationship_type t,r.line_number ln,r.source_symbol_id ss,r.target_symbol_id ts,r.source_external se,r.target_external te
         FROM brain_relationship r
         WHERE (r.source_symbol_id IN (${ph}) OR r.target_symbol_id IN (${ph}))
           AND r.line_number BETWEEN 138 AND 158
         ORDER BY r.line_number`,
      )
      .all(...ids, ...ids)
    console.log(`   relationships with line in [138,158]: ${rels.length}`)
    for (const r of rels)
      console.log(
        `      L${String(r.ln).padStart(4)} ${String(r.t).padEnd(12)} ${String(r.ss)} -> ${String(r.ts)}  ext(${r.se}/${r.te})`,
      )
    const at148 = db
      .query(
        `SELECT r.id,r.relationship_type t,r.line_number ln,r.source_symbol_id ss,r.target_symbol_id ts
         FROM brain_relationship r WHERE r.line_number=148 AND (r.source_symbol_id IN (${ph}) OR r.target_symbol_id IN (${ph}))`,
      )
      .all(...ids, ...ids)
    console.log(`   relationships at line 148 exactly: ${JSON.stringify(at148)}`)
  }
  db.close?.()
}
