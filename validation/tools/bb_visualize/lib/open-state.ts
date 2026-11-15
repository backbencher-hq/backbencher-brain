import { BrainDatabase } from "../../../../src/brain/database"
const pid = process.argv[2]!
const ro = await BrainDatabase.getRawInstance(pid as any, { readonly: true })
const version = () => Number((ro.prepare("PRAGMA schema_version").get() as any).schema_version)
const triggers = () => (ro.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger'").get() as any).c
console.log("before", version(), "triggers", triggers())
const rw = await BrainDatabase.getRawInstance(pid as any)
console.log("after rw open", version(), "triggers", triggers())
console.log("after second rw open (cached handle)", version(), "triggers", triggers())
