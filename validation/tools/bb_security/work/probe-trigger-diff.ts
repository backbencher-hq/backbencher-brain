// Pinpoint why ensureAnnotationTable always considers the installed trigger stale.
import Database from "better-sqlite3"
import { ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL } from "../../../../src/brain/schema-ddl"
import { DATA } from "./lib"
import path from "node:path"
const dbPath = process.argv[2]!
const db = new Database(dbPath, { readonly: true })
const installed = String((db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='brain_annotation_author_class_guard'").get() as any)?.sql ?? "")
db.close()
const norm = (s: string) => s.slice(s.indexOf("BEFORE")).replace(/\s+/g, " ").trim()
const a = norm(installed), b = norm(ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL)
let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
console.log(JSON.stringify({ installedLength: installed.length, installedBodyLength: a.length, wantsBodyLength: b.length, firstDiffAt: i, installedAround: a.slice(Math.max(0, i - 40), i + 60), wantsAround: b.slice(Math.max(0, i - 40), i + 60), installedTail: a.slice(-80), wantsTail: b.slice(-80) }, null, 1))
