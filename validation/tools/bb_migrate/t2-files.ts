import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { BrainDatabase } from "../../../src/brain/database"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const raw = await BrainDatabase.getRawInstance(getProjectId(ROOT), { readonly: true })
const projectId = getProjectId(ROOT)
console.log(JSON.stringify({
  samples: raw.prepare("SELECT relative_path FROM brain_file WHERE project_id=? ORDER BY relative_path LIMIT 5").all(projectId),
  srcMcp: raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND relative_path LIKE 'src/mcp/%'").get(projectId),
  exact: raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND relative_path = 'src/mcp/tools/bb_migrate/handler.ts'").get(projectId),
  migrations: raw.prepare("SELECT relative_path FROM brain_file WHERE project_id=? AND relative_path LIKE '%migration%' LIMIT 5").all(projectId),
  projectIds: raw.prepare("SELECT project_id, COUNT(*) c FROM brain_file GROUP BY project_id ORDER BY c DESC LIMIT 3").all(),
}, (_, v) => typeof v === "bigint" ? Number(v) : v))
