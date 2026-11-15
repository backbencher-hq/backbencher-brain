import { openDatabase } from "../../../../src/storage/db.node.ts"
import { ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL } from "../../../../src/brain/schema-ddl"
const dbPath = process.argv[2]!
const raw: any = openDatabase(dbPath, { readonly: false })
const v = () => Number((raw.prepare("PRAGMA schema_version").get() as any).schema_version)
const installedBefore = raw.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()
console.log("start", v())
raw.exec(ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL)
console.log("after trigger DDL", v())
raw.exec(ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL)
console.log("after trigger DDL twice", v())
console.log("DDL statements in constant:", (ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL.match(/CREATE TRIGGER/g) ?? []).length)
console.log("installed before:", installedBefore.length, "after:", (raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger'").get() as any).c)
