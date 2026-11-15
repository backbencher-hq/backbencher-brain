import { openDatabase } from "../../../../src/storage/db.node.ts"
const dbPath = process.argv[2]!
const raw: any = openDatabase(dbPath, { readonly: true })
for (const row of raw.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all() as any[]) {
  console.log(`--- ${row.name}\n${String(row.sql)}`)
}
