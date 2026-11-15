import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const pid = getProjectId(path.join(repoRoot, "validation/tools/bb_search/work/project")) as any
const raw = await BrainDatabase.getRawInstance(pid)
const q = (sql: string, ...p: any[]) => raw.prepare(sql).get(...p)
console.log("a", JSON.stringify(q("SELECT id FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE ? LIMIT 1 OFFSET ?", pid, "/%/%", 25000)))
console.log("b", JSON.stringify(q("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE ?", pid, "/%/%")))
console.log("c", JSON.stringify(q("SELECT id FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE ? LIMIT 1 OFFSET 25000", pid, "/%/%")))
console.log("d", JSON.stringify(q("SELECT id FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE ? LIMIT 1 OFFSET ?", pid, "/%/%", 5)))
