import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const rel = process.argv[2]!
console.log(BrainDatabase.getDbPath(getProjectId(path.join(repoRoot, rel)) as any))
