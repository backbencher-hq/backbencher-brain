// script/m50/probe-ask-phases.ts — M50.A2 bb_ask phase attribution.
// bb_ask was convicted at p50 3.4–4.8s. This probe splits the cost by PHASE on
// the real index so the fix targets the real cost, not a guess:
//   1. dbOpen        — BrainDatabase.getRawInstance(projectId)
//   2. queryEmbed    — SemanticEngine.embed(query)  (provider round-trip)
//   3. vectorLoad    — SELECT embeddings for (model, dim) LIMIT VECTOR_SCAN_CAP
//   4. parseCosine   — JSON.parse each vector + cosine vs the query vector
//   5. resolve+Snippet — resolveEntities (top-N symbol rows + snippet reads)
//   6. full           — semanticVectorSearch end to end (what bb_ask pays)
// Writes validation/m50/results/A2-ask-phases.json. Records the RESOLVED db path.
//
// Usage: bun run script/m50/probe-ask-phases.ts ["query"]

import { BrainDatabase } from "../../src/brain/database"
import { SemanticEngine } from "../../src/brain/semantic/engine"
import { getProjectId } from "../../src/cli/index"
import { semanticVectorSearch } from "../../src/intelligence/search/semantic-search"
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve("script/m50", "../..")
const REPO = "$HOME/mcp/backbencher-brain"
const QUERY = process.argv[2] || "where are foreign keys enforced?"
const VECTOR_SCAN_CAP = Number(process.env.BB_VECTOR_SCAN_CAP || 20000)

async function time<T>(label: string, fn: () => Promise<T> | T): Promise<{ label: string; ms: number; value?: T }> {
  const t0 = Date.now()
  const value = await fn()
  return { label, ms: Date.now() - t0, value }
}

async function main() {
  const projectId = getProjectId(REPO)
  const dbPath = BrainDatabase.getDbPath(projectId as any)
  const phases: Array<{ label: string; ms: number }> = []

  // 0. db open (cold in this process)
  const open = await time("dbOpen", async () => BrainDatabase.getRawInstance(projectId as any))
  phases.push({ label: open.label, ms: open.ms })
  const raw = open.value as any

  // 1. query embedding (provider round-trip)
  const embed = await time("queryEmbed", () => SemanticEngine.embed(QUERY))
  phases.push({ label: embed.label, ms: embed.ms })
  const queryVector = embed.value as number[]
  const queryModel = SemanticEngine.getLastEmbeddingModel()

  if (!queryVector || queryVector.length === 0) {
    console.log(JSON.stringify({ note: "no query vector — embed() returned empty", queryModel }, null, 2))
  }

  // 2. vector load (what the search actually reads)
  let rows: any[] = []
  if (queryVector?.length) {
    const load = await time("vectorLoad", () =>
      raw
        .prepare(
          "SELECT entity_id AS entityId, embedding_vector AS vector, embedding_model AS model " +
            "FROM brain_semantic_embedding WHERE project_id = ? AND embedding_model = ? AND vector_dimension = ? " +
            "ORDER BY entity_id LIMIT ?",
        )
        .all(projectId, queryModel, queryVector.length, VECTOR_SCAN_CAP),
    )
    phases.push({ label: load.label, ms: load.ms })
    rows = load.value as any[]

    // 3. parse + cosine over the loaded rows
    const pc = await time("parseCosine", () => {
      let n = 0
      for (const r of rows) {
        const p = JSON.parse(r.vector)
        if (Array.isArray(p) && p.length === queryVector.length) {
          SemanticEngine.cosineSimilarity(queryVector, p)
          n++
        }
      }
      return n
    })
    phases.push({ label: pc.label, ms: pc.ms })
  }

  // 4. full semantic search (what bb_ask pays end to end)
  const full = await time("full semanticVectorSearch", () => semanticVectorSearch(projectId as any, QUERY, { maxResults: 5 }))
  phases.push({ label: full.label, ms: full.ms })
  const sr = full.value as any

  // second call in the same process: isolates cache/warm effects
  const full2 = await time("full (2nd call, same process)", () => semanticVectorSearch(projectId as any, QUERY, { maxResults: 5 }))
  phases.push({ label: full2.label, ms: full2.ms })
  const embed2 = await time("queryEmbed (2nd call)", () => SemanticEngine.embed(QUERY))
  phases.push({ label: embed2.label, ms: embed2.ms })

  const out = {
    probe: "M50.A2-ask-phases",
    at: new Date().toISOString(),
    query: QUERY,
    resolvedDbPath: dbPath,
    projectId,
    queryModel,
    queryDim: queryVector?.length ?? 0,
    vectorScanCap: VECTOR_SCAN_CAP,
    embeddingRowsLoaded: rows.length,
    resultMethod: sr?.metadata?.method,
    fallbackReason: sr?.metadata?.fallbackReason,
    resultsReturned: sr?.results?.length ?? 0,
    scannedRows: sr?.metadata?.scannedRows,
    phases,
  }
  mkdirSync(path.join(ROOT, "validation/m50/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m50/results/A2-ask-phases.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e?.stack || e)
  process.exit(1)
})
