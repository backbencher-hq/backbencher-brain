// Which open-path healer issues DDL? Measured one function at a time on the same
// database, printing schema_version after each, so the write-on-read defect is
// attributed rather than inferred.
import { openDatabase } from "../../../../src/storage/db.node.ts"
import * as ddl from "../../../../src/brain/schema-ddl"
import path from "node:path"
const dbPath = process.argv[2]!
const raw: any = openDatabase(dbPath, { readonly: false })
const version = () => Number((raw.prepare("PRAGMA schema_version").get() as any).schema_version)
let last = version()
const step = (name: string, fn: () => any) => {
  try { const value = fn(); const now = version(); console.log(`${name}: ${last} -> ${now}${now > last ? "  ← DDL" : ""}`); last = now; return value }
  catch (e: any) { console.log(`${name}: threw ${e?.message ?? e}`) }
}
const names = Object.keys(ddl).filter((key) => key.startsWith("ensure") || key.startsWith("migrate") || key.startsWith("cleanup"))
for (const name of names.sort()) step(name, () => (ddl as any)[name](raw))
