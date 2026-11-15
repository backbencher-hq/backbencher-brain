import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const dir = path.join(ROOT, "validation/tools/bb_migrate/work/stale-fixture")
const projectId = getProjectId(dir)
await indexProjectParallel(projectId, dir, {})
console.log(JSON.stringify({ projectId, dir }))
