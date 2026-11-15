import { getProjectId } from "../../../../src/cli/index"
import { reindexFilesParallel, collectDirChanges } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { symlinkSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const proj = mkdtempSync(path.join(tmpdir(), "symlink-dbg-"))
mkdirSync(path.join(proj, "src"))
writeFileSync(path.join(proj, "src/lib.ts"), "export function libCallee(x: number): number { return x }\n")
const pid = getProjectId(proj)
const link = path.join(proj, "src/link-keep.ts")
symlinkSync(path.join(proj, "src/lib.ts"), link)
const seed = await reindexFilesParallel(pid as any, proj, [{ path: link, type: "modified" }])
const raw = await BrainDatabase.getRawInstance(pid as any)
const rows = () => (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND path=?").get(pid, link) as any).c
console.log(JSON.stringify({ seed: { indexed: seed.indexed, unchanged: seed.unchanged }, linkRows: rows() }))
const all = raw.prepare("SELECT path FROM brain_file WHERE project_id=?").all(pid).map((r:any)=>r.path.replace(proj+"/",""))
const changes = await collectDirChanges(pid as any, proj, proj)
console.log(JSON.stringify({ storedRows: all, changes: changes.map(c=>({p:c.path.replace(proj+"/",""), t:c.type})) }))
rmSync(proj, { recursive: true, force: true })
