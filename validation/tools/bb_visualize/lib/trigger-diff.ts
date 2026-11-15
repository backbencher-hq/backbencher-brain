import { openDatabase } from "../../../../src/storage/db.node.ts"
import { ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL } from "../../../../src/brain/schema-ddl"
const dbPath = process.argv[2]!
const raw: any = openDatabase(dbPath, { readonly: true })
const installed = String((raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='brain_annotation_author_class_guard'").get() as any)?.sql ?? "")
const wants = ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL
const norm = (text: string) => text.slice(text.indexOf("BEFORE")).replace(/\s+/g, " ").trim()
const a = norm(installed), b = norm(wants)
console.log("equal:", a === b)
console.log("installed norm:", JSON.stringify(a))
console.log("wanted    norm:", JSON.stringify(b))
