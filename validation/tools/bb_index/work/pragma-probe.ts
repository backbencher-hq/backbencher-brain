import { BrainDatabase } from "../../../../src/brain/database"
const raw: any = await BrainDatabase.getRawInstance("069354f5b81f8d1bc3ca023fb4083087b59e40bf" as any)
console.log(JSON.stringify({ driver: raw.constructor?.name, pragma: typeof raw.pragma, prepare: typeof raw.prepare }))
try {
  const r = raw.pragma("wal_checkpoint(TRUNCATE)")
  console.log("pragma result:", JSON.stringify(r))
} catch (e: any) {
  console.log("pragma threw:", e?.message)
}
