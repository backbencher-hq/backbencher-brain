// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — indexes one fixture into a per-tier BB_DATA_DIR and waits for the
//   embedding drain, so later latency runs are warm and reproducible.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/LATENCY.json.
// EDIT TOGETHER WHEN THIS CHANGES — work/latency.mts.
//
// Usage: BB_DATA_DIR=<dir> npx tsx index-fixture.mts <fixtureDir> <out.json>

import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const fixtureDir = process.argv[2]
const outPath = process.argv[3]
if (!fixtureDir || !outPath) {
  console.error("usage: index-fixture.mts <fixtureDir> <out.json>")
  process.exit(2)
}
const projectId = getProjectId(fixtureDir)
const t0 = performance.now()
await indexProjectParallel(projectId, fixtureDir, {})
await flushBackgroundEmbeddings()
const ms = Math.round(performance.now() - t0)
const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const one = (sql: string) => (raw.prepare(sql).get(projectId) as any)?.c ?? -1
const models = raw
  .prepare("SELECT embedding_model AS model, vector_dimension AS dimension, COUNT(*) AS rows FROM brain_semantic_embedding WHERE project_id = ? GROUP BY embedding_model, vector_dimension")
  .all(projectId)
const report = {
  fixtureDir,
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  embeddingDisabled: process.env.BB_EMBEDDING_DISABLED === "1",
  indexMs: ms,
  counts: {
    files: one("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?"),
    symbols: one("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?"),
    embeddingRows: one("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ?"),
  },
  embeddingModels: models,
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))
