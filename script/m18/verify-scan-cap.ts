// script/m18/verify-scan-cap.ts — M18.Q5 case 11 (provenance.truncated).
//
// Runs as a CHILD PROCESS because BB_VECTOR_SCAN_CAP is read at import time
// of semantic-search.ts. This script sets the env var, then performs the
// WHOLE pipeline in-process (index corpus -> inject fake embedding rows ->
// semanticVectorSearch) so there is no parent/child DB handoff.
//
// Arg: <corpusSource> (path to a real indexed corpus, e.g. rake).
// Exit 0 with JSON evidence on pass, 1 on fail.

process.env.BB_VECTOR_SCAN_CAP = "2"

const FAKE_MODEL = "m18-q5-synthetic"
const FAKE_DIM = 64
const fakeVec = () => Array.from({ length: FAKE_DIM }, (_, i) => 0.01 + (i % 7) * 0.001)

async function main() {
  const corpus = process.argv[2]
  if (!corpus) {
    console.error("usage: verify-scan-cap.ts <corpusSourcePath>")
    process.exit(2)
  }

  const { mkdtempSync, cpSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const path = await import("node:path")
  const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
  const { BrainDatabase } = await import("../../src/brain/database")
  const { getProjectId } = await import("../../src/cli/index")
  const { semanticVectorSearch } = await import("../../src/intelligence/search/semantic-search")
  const { SemanticEngine } = await import("../../src/brain/semantic/engine")

  // Patch the engine so the query uses the same synthetic model as the rows.
  ;(SemanticEngine as any).embed = async (_t: string) => fakeVec()
  ;(SemanticEngine as any).getLastEmbeddingModel = () => FAKE_MODEL

  const tmp = mkdtempSync(path.join(tmpdir(), "m18cap-"))
  try {
    cpSync(corpus, tmp, { recursive: true })
    const pid = getProjectId(tmp)
    process.env.BB_EMBEDDING_BATCH_LIMIT = "1" // skip background embeddings; we inject fakes
    await indexProjectParallel(pid, tmp, {})
    delete process.env.BB_EMBEDDING_BATCH_LIMIT

    const raw = await BrainDatabase.getRawInstance(pid)
    const syms = raw.prepare("SELECT id, symbol_type t FROM brain_symbol WHERE project_id = ? LIMIT 4").all(pid) as Array<{ id: string; t: string }>
    if (syms.length < 4) {
      console.error("need >= 4 symbols in indexed corpus, got " + syms.length)
      process.exit(2)
    }
    const cols = ["id", "project_id", "entity_id", "entity_type", "embedding_model", "embedding_vector", "vector_dimension", "content_hash", "semantic_context", "similarity_threshold", "last_updated", "time_created", "time_updated"]
    const ins = raw.prepare("INSERT OR REPLACE INTO brain_semantic_embedding (" + cols.join(",") + ") VALUES (" + cols.map(() => "?").join(",") + ")")
    // 4 rows, cap=2 -> the search must truncate at exactly 2 scanned rows.
    // entity_id MUST be a real symbol id so resolveEntities() keeps the row;
    // only the row PK differs per index.
    for (let i = 0; i < 4; i++) {
      const sym = syms[i]
      ins.run(sym.id + ":cap" + i, pid, sym.id, sym.t, FAKE_MODEL, JSON.stringify(fakeVec()), FAKE_DIM, "h" + i, "{}", 0.35, Date.now(), Date.now(), Date.now())
    }
    const inserted = raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_model=?").get(pid, FAKE_MODEL) as any
    const r = await semanticVectorSearch(pid, "query", { maxResults: 5 })
    const out = {
      issue: "M18.Q5-case11", label: "scan-cap truncation",
      inserted: inserted.c,
      pass: inserted.c === 4 && r.metadata.scannedRows === 2 && r.provenance.truncated === true,
      scanned: r.metadata.scannedRows,
      truncated: r.provenance.truncated === true,
      method: r.metadata.method,
      generatedAt: new Date().toISOString(),
    }
    console.log(JSON.stringify(out))
    process.exit(out.pass ? 0 : 1)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

await main()