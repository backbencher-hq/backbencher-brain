// Fresh-process READ-WRITE open of a project index: the default open path the
// bb_security read handler currently takes. Runs two SELECTs and closes, so any
// byte change in brain.db is attributable to the open path (migrations/healers)
// rather than to the tool's own queries.
import { BrainDatabase } from "../../../../src/brain/database"
import { getProjectId } from "../../../../src/util/project-id"

const dir = process.argv[2]!
const dataDir = process.argv[3]!
process.env.BB_DATA_DIR = dataDir
const projectId = getProjectId(dir)
const raw = await BrainDatabase.getRawInstance(projectId)
const counts = {
  files: (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c,
  taintFlows: (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(projectId) as any).c,
}
console.log(JSON.stringify({ projectId, dataDir, readonly: false, counts }))
