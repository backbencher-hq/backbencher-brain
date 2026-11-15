// Index ONE project into an explicit data dir. Kept as its own child process so
// a read probe's measurement cannot be contaminated by an indexer that is still
// holding a read-write handle in the same process.
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { getProjectId } from "../../../../src/util/project-id"

const dir = process.argv[2]!
const dataDir = process.argv[3]!
process.env.BB_DATA_DIR = dataDir
const projectId = getProjectId(dir)
await indexProjectParallel(projectId, dir, {})
console.log(JSON.stringify({ dir, dataDir, projectId }))
