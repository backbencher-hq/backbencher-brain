import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../src/brain/database"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const dir = path.join(ROOT, "validation/tools/bb_analyze/work/behaviour")
const projectId = getProjectId(dir)
await indexProjectParallel(projectId, dir, {})
const raw = await BrainDatabase.getRawInstance(projectId)
const q = (sql: string) => (raw.prepare(sql).get(projectId) as any)
console.log(JSON.stringify({
  projectId, dir,
  files: q("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").c,
  symbols: q("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").c,
  rels: q("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").c,
  imports: q("SELECT COUNT(*) c FROM brain_import WHERE project_id=?").c ?? null,
  testFiles: q("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1").c,
  testFileRels: (raw.prepare("SELECT relative_path, COALESCE(is_test_file,0) t FROM brain_file WHERE project_id=? ORDER BY relative_path").all(projectId) as any[]).map(r => `${r.relative_path}:test=${r.t}`),
}, null, 2))
