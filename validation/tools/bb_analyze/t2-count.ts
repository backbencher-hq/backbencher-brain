import { BrainDatabase } from "../../../src/brain/database"
const pid = "1d3d57103be91b8f9716d70199fe28a3f39245d9"
const raw = await BrainDatabase.getRawInstance(pid as any)
for (const t of ["brain_file", "brain_symbol", "brain_relationship", "brain_import"]) {
  try { console.log(t, (raw.prepare("SELECT COUNT(*) c FROM " + t + " WHERE project_id=?").get(pid) as any).c) } catch (e: any) { console.log(t, "ERR", e.message) }
}
console.log("getProjectId symbols:", JSON.stringify(raw.prepare("SELECT id, symbol_type FROM brain_symbol WHERE project_id=? AND name='getProjectId' LIMIT 5").all(pid)))
console.log("name-count:", JSON.stringify(raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=? AND name='getProjectId'").get(pid)))
