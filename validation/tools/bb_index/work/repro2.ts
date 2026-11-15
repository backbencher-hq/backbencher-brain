import { getProjectId } from "../../../../src/cli/index"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { statSync } from "node:fs"
import path from "node:path"
const proj = path.resolve(process.argv[2])
const file = path.resolve(proj, process.argv[3])
const pid = getProjectId(proj)
const raw = await BrainDatabase.getRawInstance(pid as any)
const row = raw.prepare("SELECT path, last_modified, size_bytes FROM brain_file WHERE project_id=? AND path=?").get(pid, file) as any
const st = statSync(file)
console.log(JSON.stringify({file, row, stored_floor: row?Math.floor(row.last_modified):null, disk_floor: Math.floor(st.mtimeMs), size_eq: row?.size_bytes === st.size}))
const t0 = performance.now()
const r = await indexProjectParallel(pid as any, proj, { files: [file], isIncremental: true, skipDiscovery: true })
console.log(JSON.stringify({ms: Math.round(performance.now()-t0), successFiles: r.successFiles, skippedFiles: r.skippedFiles, totalFiles: r.totalFiles, processedFiles: r.processedFiles}))
