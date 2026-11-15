import Database from "better-sqlite3"
const [a,b] = process.argv.slice(2)
const q = (p: string) => { const db = new Database(p, {readonly:true}); const rows = db.prepare("SELECT type,name,tbl_name,rootpage,sql FROM sqlite_master ORDER BY type,name").all(); const sv = (db.prepare("PRAGMA schema_version").get() as any).schema_version; db.close(); return {rows, sv} }
const A=q(a!), B=q(b!)
console.log("schema_version", A.sv, "->", B.sv)
const ka = new Map((A.rows as any[]).map((r:any)=>[r.type+":"+r.name, r]))
const kb = new Map((B.rows as any[]).map((r:any)=>[r.type+":"+r.name, r]))
for (const k of new Set([...ka.keys(), ...kb.keys()])) {
  const x:any=ka.get(k), y:any=kb.get(k)
  if (!x || !y) { console.log(x? "REMOVED":"ADDED", k, JSON.stringify((x||y)).slice(0,150)); continue }
  if (x.rootpage !== y.rootpage || x.sql !== y.sql || x.tbl_name !== y.tbl_name) console.log("CHANGED", k, {rootBefore:x.rootpage, rootAfter:y.rootpage, sqlSame:x.sql===y.sql})
}
