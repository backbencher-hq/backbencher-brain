import { openDatabase } from "../../../../src/storage/db.node.ts"
import { ANNOTATION_DDL } from "../../../../src/brain/schema-ddl"
const dbPath = process.argv[2]!
const raw: any = openDatabase(dbPath, { readonly: false })
const v = () => Number((raw.prepare("PRAGMA schema_version").get() as any).schema_version)
console.log("start", v())
raw.exec(ANNOTATION_DDL); console.log("after ANNOTATION_DDL #1", v())
raw.exec(ANNOTATION_DDL); console.log("after ANNOTATION_DDL #2", v())
for (const stmt of ["CREATE TABLE IF NOT EXISTS brain_annotation (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, symbol_name TEXT NOT NULL, symbol_path TEXT, author_class TEXT NOT NULL, tool_identity TEXT NOT NULL, body TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)"]) {
  raw.exec(stmt); console.log("after CREATE TABLE IF NOT EXISTS one", v())
}
raw.exec("CREATE INDEX IF NOT EXISTS brain_annotation_project_idx ON brain_annotation(project_id)"); console.log("after CREATE INDEX IF NOT EXISTS", v())
