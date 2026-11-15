import { getProjectId } from "../../../../src/cli/index"
import { indexProjectParallel, reindexFilesParallel, collectDirChanges } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { symlinkSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const proj = mkdtempSync(path.join(tmpdir(), "symlink-dbg-bun-"))
mkdirSync(path.join(proj, "src"))
writeFileSync(path.join(proj, "src/lib.ts"), "export function libCallee(x: number): number { return x }\n")
writeFileSync(path.join(proj, "src/caller.ts"), "import { libCallee } from \"./lib\"\nexport function caller(x: number): number { return libCallee(x) }\n")
const pid = getProjectId(proj)
await indexProjectParallel(pid as any, proj, {})
const link = path.join(proj, "src/link-keep.ts")
symlinkSync(path.join(proj, "src/lib.ts"), link)
const seed = await reindexFilesParallel(pid as any, proj, [{ path: link, type: "modified" }])
const raw = await BrainDatabase.getRawInstance(pid as any)
const rows = () => (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND path=?").get(pid, link) as any).c
const stored = () => raw.prepare("SELECT path,id FROM brain_file WHERE project_id=?").all(pid).map((r:any)=>({p:r.path.replace(proj+"/",""), id:String(r.id).split(":").slice(1).join(":")}))
console.log(JSON.stringify({ seed: { indexed: seed.indexed, unchanged: seed.unchanged }, linkRows: rows(), stored: stored() }))
writeFileSync(path.join(proj, "src/lib.ts"), "export function libCallee(x: number): number { return x + 7 }\n")
const changes = await collectDirChanges(pid as any, proj, proj)
console.log(JSON.stringify({ changes: changes.map(c=>({p:c.path.replace(proj+"/",""), t:c.type})) }))
const after = await reindexFilesParallel(pid as any, proj, changes)
console.log(JSON.stringify({ after: { indexed: after.indexed, deleted: after.deleted, unchanged: after.unchanged }, linkRows: rows(), stored: stored() }))
rmSync(proj, { recursive: true, force: true })
