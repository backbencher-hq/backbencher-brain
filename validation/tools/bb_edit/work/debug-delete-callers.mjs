import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id.ts"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer.ts"
import { executeEdit } from "../../../../src/intelligence/edit/edit-engine.ts"
import { BrainDatabase } from "../../../../src/brain/database.ts"

const root = path.resolve("validation/tools/bb_edit/work/run/delete-warn-probe2")
rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true })
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src/a.ts"), "export function lone(): number {\n  return 1\n}\n")
writeFileSync(path.join(root, "src/n.ts"), 'import * as a from "./a"\n\nexport const v = a.lone()\n')
const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})
const raw = await BrainDatabase.getRawInstance(projectId)
const sym = raw.prepare("SELECT id FROM brain_symbol WHERE name='lone'").get()
console.log("SYMBOL=", JSON.stringify(sym))
if (sym) {
  const callers = raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE target_symbol_id=? AND relationship_type IN ('calls','instantiates','references','uses')").get(sym.id)
  console.log("CALLERS=", JSON.stringify(callers))
}
let err = ""
try { const r = await executeEdit(root, projectId, { mode: "delete", symbolName: "lone", filePath: "src/a.ts", format: false }); console.log("NO_FORCE_OK warnings=", JSON.stringify(r.warnings)) }
catch (e) { err = e.message; console.log("NO_FORCE_REFUSED:", err.slice(0, 300)) }
