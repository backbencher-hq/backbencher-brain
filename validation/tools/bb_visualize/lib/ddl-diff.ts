import { BrainDatabase } from "../../../../src/brain/database"
const pid = process.argv[2]!
const snap = (raw: any) => raw.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all().map((r: any) => `${r.type}|${r.name}|${String(r.sql).slice(0, 160)}`)
const ro = await BrainDatabase.getRawInstance(pid as any, { readonly: true })
const before = snap(ro)
const verBefore = (ro.prepare("PRAGMA schema_version").get() as any).schema_version
const rw = await BrainDatabase.getRawInstance(pid as any)
const after = snap(rw)
const verAfter = (rw.prepare("PRAGMA schema_version").get() as any).schema_version
console.log("schema_version", verBefore, "->", verAfter)
const b = new Set(before), a = new Set(after)
console.log("added/changed:"); for (const x of a) if (!b.has(x)) console.log("  +", x)
console.log("removed:"); for (const x of b) if (!a.has(x)) console.log("  -", x)
