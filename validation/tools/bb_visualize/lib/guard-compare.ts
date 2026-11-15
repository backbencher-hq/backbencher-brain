import { openDatabase } from "../../../../src/storage/db.node.ts"
import { ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL } from "../../../../src/brain/schema-ddl"
const dbPath = process.argv[2]!
const raw: any = openDatabase(dbPath, { readonly: false })
const wantsGuard = ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL
const updateMarker = "CREATE TRIGGER IF NOT EXISTS brain_annotation_author_class_guard_update"
const updateIndex = wantsGuard.indexOf(updateMarker)
const wantedStatements = [
  { name: "brain_annotation_author_class_guard", sql: wantsGuard.slice(0, updateIndex) },
  { name: "brain_annotation_author_class_guard_update", sql: wantsGuard.slice(updateIndex) },
]
const normalise = (sql: string): string => { const before = sql.indexOf("BEFORE"); return before < 0 ? "" : sql.slice(before).replace(/\s+/g, " ").trim() }
for (const wanted of wantedStatements) {
  const row = raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(wanted.name) as { sql?: string } | undefined
  const installed = String(row?.sql ?? "")
  console.log(wanted.name, "installed?", installed.length > 0, "equal?", normalise(installed) === normalise(wanted.sql))
  if (normalise(installed) !== normalise(wanted.sql)) {
    console.log("  installed:", JSON.stringify(normalise(installed)))
    console.log("  wanted   :", JSON.stringify(normalise(wanted.sql)))
  }
}
const v = () => Number((raw.prepare("PRAGMA schema_version").get() as any).schema_version)
console.log("version start", v())
