import { BrainDatabase } from "../../../../src/brain/database"
const pid = process.argv[2]!
try {
  const raw = await BrainDatabase.getRawInstance(pid as any, { readonly: true })
  for (const [label, sql] of [["files","SELECT COUNT(*) c FROM brain_file WHERE project_id=?"],["symbols","SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?"],["relationships","SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?"]] as const) {
    console.log(label, Number((raw.prepare(sql).get(pid) as any)?.c ?? 0))
  }
} catch (e: any) { console.log("error:", e?.message ?? String(e)) }
