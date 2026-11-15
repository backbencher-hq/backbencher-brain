import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const pid = getProjectId(repoRoot) as any
const raw = await BrainDatabase.getRawInstance(pid)
const rows = raw.prepare("SELECT name, type FROM sqlite_master WHERE name LIKE '%fts%' ORDER BY name").all() as any[]
console.log(JSON.stringify({ projectId: pid, ftsObjects: rows }))
