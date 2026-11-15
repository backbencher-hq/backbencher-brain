import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const pid = getProjectId(repoRoot) as any
const raw = await BrainDatabase.getRawInstance(pid)
const c = (t: string) => (raw.prepare(`SELECT COUNT(*) c FROM ${t} WHERE project_id=?`).get(pid) as any).c
console.log(JSON.stringify({ projectId: pid, files: c("brain_file"), symbols: c("brain_symbol"), relationships: c("brain_relationship"), dbPath: BrainDatabase.getDbPath(pid) }))
