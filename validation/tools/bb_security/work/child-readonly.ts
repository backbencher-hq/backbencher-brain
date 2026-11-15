// Fresh-process READ-ONLY open of a project index: the control for the
// read-path write probe. Opens through BrainDatabase.getRawInstance(readonly)
// and reads one count, so whatever happens to the db/-wal files afterwards is
// attributable to the open alone.
import { BrainDatabase } from "../../../../src/brain/database"
import { getProjectId } from "../../../../src/util/project-id"

const dir = process.argv[2]!
const dataDir = process.argv[3]!
process.env.BB_DATA_DIR = dataDir
const projectId = getProjectId(dir)
const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const counts = {
  files: (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c,
  taintFlows: (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(projectId) as any).c,
}
console.log(JSON.stringify({ projectId, dataDir, readonly: true, counts }))
