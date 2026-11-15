// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — decomposes the cost of one default bb_ask call on a large index WITHOUT
//   using the product's read-write handle: every database step is re-executed through a
//   byte-read-only handle, and the embedding step is measured on its own, so network time can
//   be separated from index time and the db/wal can be proven unchanged afterwards.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/t2-components.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/search/semantic-search.ts (the steps
//   replicated here), work/index-facts.mts.
//
// Usage: BB_DATA_DIR=<dir> BB_NO_AUTO_REFRESH=1 npx tsx t2-components.mts <projectDir> <out.json>

import { statSync, writeFileSync, existsSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { SemanticEngine } from "../../../../src/brain/semantic/engine"
import { cosineFloat32, readRowVector } from "../../../../src/brain/semantic/vector-binary"

const projectDir = process.argv[2]
const outPath = process.argv[3]
if (!projectDir || !outPath) {
  console.error("usage: t2-components.mts <projectDir> <out.json>")
  process.exit(2)
}

const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (p: string) => (existsSync(p) ? { size: statSync(p).size, mtimeMs: statSync(p).mtimeMs } : null)
const before = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) }

const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const ms = (t0: number) => Math.round((performance.now() - t0) * 100) / 100
const QUERIES = [
  "how does request handling work in this codebase",
  "where is the index lock acquired",
  "how are tool descriptors registered",
  "what parses the configuration file",
  "how does the search engine rank results",
]

// ── 1. Embedding step: the only step that can leave the machine ─────────────
const embedding: Array<{ query: string; ms: number; model: string; dimension: number; failed: boolean }> = []
for (const query of QUERIES) {
  const t0 = performance.now()
  let vec: number[] = []
  let failed = false
  try {
    vec = await SemanticEngine.embed(query, projectId as any)
  } catch {
    failed = true
  }
  embedding.push({
    query,
    ms: ms(t0),
    model: SemanticEngine.getLastEmbeddingModel(),
    dimension: vec.length,
    failed: failed || vec.length === 0,
  })
}

// ── 2. Index-state count (quick-answer.ts indexState) ─────────────────────
const tState = performance.now()
const fileCount = ((raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(projectId) as any)?.c ?? 0)
const stateMs = ms(tState)

// ── 3. Coverage aggregate (semantic-search.ts measureCoverage) ────────────
const tCoverage = performance.now()
const coverageRow = raw
  .prepare(
    "SELECT (SELECT COUNT(*) FROM brain_symbol WHERE project_id = ?) AS symbols, " +
      "(SELECT COUNT(DISTINCT entity_id) FROM brain_semantic_embedding WHERE project_id = ?) AS embedded",
  )
  .get(projectId, projectId) as { symbols: number; embedded: number }
const coverageMs = ms(tCoverage)

// ── 4. Candidate scan + cosine, exactly as the engine does it ─────────────
// The query model/dimension are the ones the embedding step reported; only rows
// in that vector space are candidates (model-consistency contract).
const last = embedding[embedding.length - 1]
const scan: Array<{ query: string; model: string; dimension: number; rows: number; bytes: number; loadMs: number; scoreMs: number; kept: number; top: number | null }> = []
for (let q = 0; q < Math.min(embedding.length, 3); q++) {
  const info = embedding[q]
  if (info.failed || info.dimension === 0) continue
  const tLoad = performance.now()
  const hasBlob = (raw.prepare("PRAGMA table_info(brain_semantic_embedding)").all() as Array<{ name: string }>).some((c) => c.name === "embedding_blob")
  const columns = "SELECT rowid AS rowid, entity_id AS entityId, embedding_vector AS vector, " +
    (hasBlob ? "embedding_blob AS blob, " : "") + "embedding_model AS model " +
    "FROM brain_semantic_embedding WHERE project_id = ? AND embedding_model = ? AND vector_dimension = ? ORDER BY entity_id LIMIT ?"
  const rows = raw.prepare(columns).all(projectId, info.model, info.dimension, 20000) as Array<{ rowid: number; entityId: string; vector: string; blob?: Uint8Array | null; model: string }>
  const loadMs = ms(tLoad)
  let bytes = 0
  for (const r of rows) bytes += r.blob ? r.blob.byteLength : (r.vector?.length ?? 0)
  const tScore = performance.now()
  const scratch = new Float32Array(info.dimension)
  const kept: number[] = []
  let top: number | null = null
  // Re-embed the same query is a cache hit; reuse the vector this round measured.
  const tEmbed = performance.now()
  const queryVec = await SemanticEngine.embed(QUERIES[q], projectId as any)
  void ms(tEmbed)
  const q32 = new Float32Array(info.dimension)
  for (let i = 0; i < info.dimension; i++) q32[i] = queryVec[i] ?? 0
  for (const row of rows) {
    const vec = readRowVector((row as any).blob ?? null, row.vector, info.dimension, scratch)
    if (!vec) continue
    const sim = cosineFloat32(q32, vec, info.dimension)
    if (!Number.isFinite(sim)) continue
    if (sim >= 0.35) kept.push(sim)
    if (top === null || sim > top) top = sim
  }
  const scoreMs = ms(tScore)
  scan.push({ query: info.query, model: info.model, dimension: info.dimension, rows: rows.length, bytes, loadMs, scoreMs, kept: kept.length, top })
}

// ── 5. Exact-name lookup (quick-answer.ts exactSymbolMatch) ───────────────
const tExact = performance.now()
raw.prepare(
  "SELECT s.name, s.symbol_type AS symbolType, COALESCE(s.line_start, 0) AS line, f.relative_path AS file " +
    "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
    "WHERE s.project_id = ? AND s.name = ? COLLATE NOCASE AND COALESCE(s.line_start, 0) > 0 ORDER BY s.id ASC LIMIT 1",
).get(projectId, "handleRequest")
const exactMs = ms(tExact)

const after = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) }
const report = {
  projectDir,
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  fileCount,
  embedding,
  indexStateMs: stateMs,
  coverageMs,
  coverage: coverageRow,
  coverageRatio: coverageRow.symbols > 0 ? coverageRow.embedded / coverageRow.symbols : 0,
  scan,
  exactNameMs: exactMs,
  /** db+wal unchanged: a read that respects byte-read-only never moves the WAL. The -shm
   *  reader index is expected to be touched by any WAL read and is not counted as a write. */
  files: { before, after, dbUnchanged: JSON.stringify({ db: before.db, wal: before.wal }) === JSON.stringify({ db: after.db, wal: after.wal }) },
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 2))
