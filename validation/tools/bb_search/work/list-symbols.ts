import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const dir = process.argv[2]!
const pid = getProjectId(dir) as any
const raw = await BrainDatabase.getRawInstance(pid)
const files = raw.prepare("SELECT relative_path, language FROM brain_file ORDER BY relative_path").all() as any[]
const syms = raw.prepare("SELECT name, symbol_type FROM brain_symbol ORDER BY name LIMIT 40").all() as any[]
console.log(JSON.stringify({ files, syms }, null, 1))
