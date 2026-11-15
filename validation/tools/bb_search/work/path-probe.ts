import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const pid = getProjectId(path.join(repoRoot, "validation/tools/bb_search/work/project")) as any
const raw = await BrainDatabase.getRawInstance(pid)
const count = raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid)
const probe = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE ? LIMIT 1 OFFSET ?").get(pid, "/%/%", 25000)
console.log(JSON.stringify({ count, giantProbe: probe ?? null }))
