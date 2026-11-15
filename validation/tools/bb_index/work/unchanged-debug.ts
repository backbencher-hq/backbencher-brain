import { getProjectId } from "../../../../src/cli/index"
import { reindexFilesParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { statSync } from "node:fs"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
const proj = path.resolve(process.argv[2])
const file = path.resolve(proj, process.argv[3])
const pid = getProjectId(proj)
const raw = await BrainDatabase.getRawInstance(pid as any)
const row = raw.prepare("SELECT path,last_modified,size_bytes,file_hash FROM brain_file WHERE project_id=? AND path=?").get(pid, file) as any
const st = statSync(file)
const hash = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16)
console.log(JSON.stringify({row: row ? {...row, contentHashNow: hash, diskFloor: Math.floor(st.mtimeMs), diskSize: st.size, floorEq: Math.floor(row.last_modified)===Math.floor(st.mtimeMs), sizeEq: row.size_bytes===st.size, hashEq: row.file_hash===hash} : null}))
const t0=performance.now()
const r = await reindexFilesParallel(pid as any, proj, [{path:file, type:"modified"}])
console.log(JSON.stringify({ms:Math.round(performance.now()-t0), indexed:r.indexed, unchanged:r.unchanged, declined:r.declined, skipped:r.skipped, walCheckpointed:r.walCheckpointed}))
