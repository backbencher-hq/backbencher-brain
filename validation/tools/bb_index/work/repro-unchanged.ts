import { getProjectId } from "../../../../src/cli/index"
import { reindexFilesParallel } from "../../../../src/ast/parallel-indexer"
const proj = process.argv[2]
const rel = process.argv[3]
const pid = getProjectId(proj)
const file = proj + "/" + rel
const t0 = performance.now()
const r = await reindexFilesParallel(pid as any, proj, [{ path: file, type: "modified" }])
console.log(JSON.stringify({ ms: Math.round(performance.now() - t0), r }))
