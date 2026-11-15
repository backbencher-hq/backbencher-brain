// Phase A fixture indexer: indexes one tier fixture into the lane's own
// BB_DATA_DIR. The shared workspace index is never touched.
//
// Usage: BB_DATA_DIR=<tier data dir> npx tsx index-fixture.mts <fixtureDir> <out.json>

import { writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const fixtureDir = process.argv[2]
const outPath = process.argv[3]
if (!fixtureDir || !outPath) { console.error("usage: index-fixture.mts <fixtureDir> <out.json>"); process.exit(2) }
const root = path.resolve(fixtureDir)
const projectId = getProjectId(root)
const t0 = performance.now()
await indexProjectParallel(projectId, root, {})
const ms = Math.round(performance.now() - t0)
const report = {
  fixtureDir: root,
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default)",
  dbPath: BrainDatabase.getDbPath(projectId),
  indexMs: ms,
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))
BrainDatabase.closeAll()
