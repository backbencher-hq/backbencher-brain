// Which files in the project DB dir change after a plain (default) call now that
// the read path opens the index read-only?
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { getUnifiedHealth } from "../../../../src/intelligence/health/health-provider"
const root = mkdtempSync(path.join(tmpdir(), "bb-health-mutation2-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"), "export function a(): number { return 1 }\n")
await indexProjectParallel(projectId as any, root, {})
const dbDir = path.dirname(BrainDatabase.getDbPath(projectId))
const snap = () => Object.fromEntries(readdirSync(dbDir).sort().map((f) => { const st = statSync(path.join(dbDir, f)); return [f, { size: st.size, mtime: st.mtimeMs }] }))
const before = snap()
await getUnifiedHealth(projectId, root, {})
const after = snap()
const diff: any = {}
for (const f of new Set([...Object.keys(before), ...Object.keys(after)])) {
  const b = before[f], a = after[f]
  if (JSON.stringify(b) !== JSON.stringify(a)) diff[f] = { before: b, after: a }
}
console.log(JSON.stringify({ filesBefore: Object.keys(before), diff }, null, 2))
