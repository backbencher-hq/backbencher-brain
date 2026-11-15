import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const pid = getProjectId(path.join(repoRoot, process.argv[2]!)) as any
const raw = await BrainDatabase.getRawInstance(pid)
const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE '%fts%'").all() as any[]).map((r) => r.name)
console.log(JSON.stringify(tables))
