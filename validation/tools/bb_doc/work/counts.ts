import path from "node:path"
import { BrainDatabase } from "../../../../src/brain/database"
import { getProjectId } from "../../../../src/util/project-id"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const pid = getProjectId(REPO)
const db: any = await BrainDatabase.getRawInstance(pid as any)
const q = (sql: string) => (db.prepare(sql).get(pid) as any)?.c
console.log(JSON.stringify({
  projectId: pid,
  filesForProject: q("SELECT count(*) c FROM brain_file WHERE project_id=?"),
  symbolsForProject: q("SELECT count(*) c FROM brain_symbol WHERE project_id=?"),
  relationshipsForProject: q("SELECT count(*) c FROM brain_relationship WHERE project_id=?"),
  importsForProject: q("SELECT count(*) c FROM brain_import WHERE project_id=?"),
  filesAll: (db.prepare("SELECT count(*) c FROM brain_file").get() as any)?.c,
  distinctProjectIds: (db.prepare("SELECT count(DISTINCT project_id) c FROM brain_file").get() as any)?.c,
  schemaVersion: (db.prepare("SELECT version FROM brain_schema_version ORDER BY version DESC LIMIT 1").get() as any)?.version,
  indexStatus: db.prepare("SELECT indexing_version, total_files, indexed_files FROM brain_index_status WHERE project_id=? LIMIT 1").get(pid),
}, null, 1))
