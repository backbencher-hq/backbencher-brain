// Index the T0/T1 fixtures ONCE under validation/tools/bb_doc/bbdata.
// Usage: BB_DATA_DIR=validation/tools/bb_doc/bbdata bun validation/tools/bb_doc/work/index-fixtures.ts
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { getProjectId } from "../../../../src/util/project-id"
import path from "node:path"

const REPO = path.resolve(import.meta.dirname, "../../../..")
const fixtures = [
  path.join(REPO, "test/fixtures/polyglot"),
  path.join(REPO, ".perf-fixtures/bb-scale/n100"),
]
for (const root of fixtures) {
  console.log("indexing", root)
  const pid = getProjectId(root)
  const t0 = performance.now()
  await indexProjectParallel(pid, root, {})
  console.log("  projectId", pid, "ms", Math.round(performance.now() - t0))
}
