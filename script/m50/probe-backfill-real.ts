// script/m50/probe-backfill-real.ts — M50.A2 (#764) real-index backfill cost.
// Runs the production backfill against the REAL project index and records:
//   * dense rows before, JSON text bytes, DB file size before
//   * promoted rows, elapsed, DB file size after (the disk cost of the accelerator)
//   * blob bytes written vs JSON bytes saved on each future read
// Writes validation/m50/results/A2-blob-backfill-real.json.
//
// Usage: bun run script/m50/probe-backfill-real.ts [budgetMsPerPass]

import { statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve("script/m50", "../..")
const REPO = "$HOME/mcp/backbencher-brain"
const BUDGET = Number(process.argv[2] || 60_000)

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { backfillEmbeddingBlobs } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))

  const pid = getProjectId(REPO)
  const dbPath = BrainDatabase.getDbPath(pid as any)
  const raw = await BrainDatabase.getRawInstance(pid as any)

  const dense = "SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_blob IS NULL AND embedding_model != 'tfidf-v1'"
  const q = (sql: string) => (raw.prepare(sql).get(pid) as any)?.c ?? 0

  const before = {
    denseMissingBlobs: q(dense),
    blobsPresent: q("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_blob IS NOT NULL"),
    jsonTextBytes: q("SELECT COALESCE(SUM(LENGTH(embedding_vector)),0) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_model != 'tfidf-v1'"),
    dbFileBytes: statSync(dbPath).size,
  }

  const t0 = Date.now()
  let promoted = 0
  let passes = 0
  let remaining = before.denseMissingBlobs
  while (remaining > 0 && Date.now() - t0 < 10 * 60_000) {
    const r = await backfillEmbeddingBlobs(pid as any, { budgetMs: BUDGET })
    passes++
    promoted += r.promoted
    remaining = r.remaining
    if (r.scanned === 0 && r.promoted === 0) break // nothing promotable
  }
  const elapsedMs = Date.now() - t0

  const after = {
    denseMissingBlobs: q(dense),
    blobsPresent: q("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_blob IS NOT NULL"),
    blobBytes: q("SELECT COALESCE(SUM(LENGTH(embedding_blob)),0) c FROM brain_semantic_embedding WHERE project_id=?"),
    dbFileBytes: statSync(dbPath).size,
  }

  const out = {
    probe: "M50.A2-blob-backfill-real",
    at: new Date().toISOString(),
    projectId: pid,
    dbPath,
    budgetMsPerPass: BUDGET,
    passes,
    promoted,
    elapsedMs,
    before,
    after,
    diskDeltaBytes: after.dbFileBytes - before.dbFileBytes,
    jsonTextMB: Number((before.jsonTextBytes / 1024 / 1024).toFixed(1)),
    blobMB: Number((after.blobBytes / 1024 / 1024).toFixed(1)),
    readSavingRatio: before.jsonTextBytes > 0 ? Number((before.jsonTextBytes / Math.max(1, after.blobBytes)).toFixed(2)) : null,
  }
  mkdirSync(path.join(ROOT, "validation/m50/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m50/results/A2-blob-backfill-real.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
  BrainDatabase.closeAll()
}

main().catch((e) => {
  console.error(e?.stack || e)
  process.exit(1)
})
