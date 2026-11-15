import { openDatabase } from "../../../../src/storage/db.node.ts"
import { ensureAnnotationTable, ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL } from "../../../../src/brain/schema-ddl"
const dbPath = process.argv[2]!
const raw: any = openDatabase(dbPath, { readonly: false })
const v = () => Number((raw.prepare("PRAGMA schema_version").get() as any).schema_version)
console.log("start", v())
const installed = String((raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='brain_annotation_author_class_guard'").get() as any)?.sql ?? "")
const wants = ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL
const norm = (text: string) => text.slice(text.indexOf("BEFORE")).replace(/\s+/g, " ").trim()
console.log("installedBody === wantedBody:", norm(installed) === norm(wants))
console.log("installed head:", installed.slice(0, 200))
console.log("wanted head:", wants.slice(0, 200))
ensureAnnotationTable(raw); console.log("after ensureAnnotationTable #1", v())
ensureAnnotationTable(raw); console.log("after ensureAnnotationTable #2", v())
