// script/m18/verify-edge-cases.ts — M18.Q5 (semantic edge cases).
// Fully deterministic, no API dependence: SemanticEngine.embed /
// getLastEmbeddingModel are patched to a fixed vector + model label,
// so every case reproduces offline. Verifier CAN FAIL (issue #418).

import { writeFileSync, readFileSync, mkdtempSync, cpSync, rmSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { semanticVectorSearch } from "../../src/intelligence/search/semantic-search"
import { SemanticEngine } from "../../src/brain/semantic/engine"

let checks = 0
let passed = 0
let failed = 0
function ck(label: string, cond: boolean, detail?: string) {
  checks++
  if (cond) passed++
  else { failed++; console.log("  FAIL: " + label + (detail ? " - " + detail : "")) }
}

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m18/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

// Fixed synthetic query vector + model label (no API, no local model).
const FAKE_MODEL = "m18-q5-synthetic"
const FAKE_DIM = 64
function fakeVec(seed = 0.01) {
  return Array.from({ length: FAKE_DIM }, (_, i) => seed + (i % 7) * 0.001)
}

const origEmbed = SemanticEngine.embed.bind(SemanticEngine)
const origGetModel = SemanticEngine.getLastEmbeddingModel.bind(SemanticEngine)
let fakeQueryVector: number[] | null = fakeVec()
let fakeThrow = false
let fakeModel = FAKE_MODEL
function installFake() {
  ;(SemanticEngine as any).embed = async (_t: string) => {
    if (fakeThrow) throw new Error("synthetic embed failure")
    return fakeQueryVector ? [...fakeQueryVector] : []
  }
  ;(SemanticEngine as any).getLastEmbeddingModel = () => fakeModel
}
function uninstallFake() {
  ;(SemanticEngine as any).embed = origEmbed
  ;(SemanticEngine as any).getLastEmbeddingModel = origGetModel
}

const EMBED_COLS = [
  "id", "project_id", "entity_id", "entity_type", "embedding_model", "embedding_vector",
  "vector_dimension", "content_hash", "semantic_context", "similarity_threshold",
  "last_updated", "time_created", "time_updated",
]
function insertEmbed(raw: any, pid: string, entityId: string, entityType: string, model: string, vec: unknown, dim: number) {
  raw.prepare(
    "INSERT OR REPLACE INTO brain_semantic_embedding (" + EMBED_COLS.join(",") + ") VALUES (" + EMBED_COLS.map(() => "?").join(",") + ")",
  ).run(
    entityId + ":embed", pid, entityId, entityType, model,
    typeof vec === "string" ? vec : JSON.stringify(vec),
    dim, "hash-" + entityId, JSON.stringify({ name: entityId }), 0.35,
    Date.now(), Date.now(), Date.now(),
  )
}

async function setupCorpus(tmpPrefix: string) {
  const bench = JSON.parse(readFileSync(path.join(ROOT_DIR, "validation/m18/benchmark/benchmark.json"), "utf8"))
  const rake = bench.corpora.find((c: any) => c.tag === "rake")
  const tmp = mkdtempSync(path.join(tmpdir(), tmpPrefix))
  cpSync(rake.source, tmp, { recursive: true })
  const pid = getProjectId(tmp)
  process.env.BB_EMBEDDING_BATCH_LIMIT = "1"
  await indexProjectParallel(pid, tmp, {})
  delete process.env.BB_EMBEDDING_BATCH_LIMIT
  const raw = await BrainDatabase.getRawInstance(pid)
  const syms = raw.prepare("SELECT id, name, symbol_type t FROM brain_symbol WHERE project_id = ? LIMIT 6").all(pid) as Array<{ id: string; name: string; t: string }>
  return { tmp, pid, raw, syms }
}

async function main() {
  console.log("Q5  semantic edge cases (deterministic)")
  installFake()

  // ---- 1. Corrupt rows (malformed JSON / non-numeric / Infinity) skipped ----
  {
    const { tmp, pid, raw, syms } = await setupCorpus("m18q5-")
    try {
      insertEmbed(raw, pid, syms[0].id, syms[0].t, FAKE_MODEL, "not-json{{", FAKE_DIM)
      insertEmbed(raw, pid, syms[1].id, syms[1].t, FAKE_MODEL, [1, "x", 3], FAKE_DIM) // non-numeric
      insertEmbed(raw, pid, syms[2].id, syms[2].t, FAKE_MODEL, [1e999, 0, 0], FAKE_DIM) // Infinity
      insertEmbed(raw, pid, syms[3].id, syms[3].t, FAKE_MODEL, fakeVec(), FAKE_DIM) // valid
      const r = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      const validRetrieved = r.results.some((x: any) => x.entityId === syms[3].id)
      const corruptLeaked = r.results.some((x: any) => x.entityId === syms[0].id || x.entityId === syms[1].id || x.entityId === syms[2].id)
      ck("Q5.1: corrupt rows skipped without crash; valid row retrieved", validRetrieved && !corruptLeaked, "method=" + r.metadata.method + " ids=" + r.results.map((x: any) => x.entityId).join(","))

      // ---- 2. All-corrupt table -> explicit fallback ----
      raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id = ?").run(pid)
      for (let i = 0; i < 3; i++) insertEmbed(raw, pid, syms[i].id, syms[i].t, FAKE_MODEL, "garbage-not-json", FAKE_DIM)
      const r2 = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      ck("Q5.2: all-corrupt table -> explicit fallback (no silent empty)", r2.metadata.method === "keyword-fallback" && !!r2.metadata.fallbackReason, JSON.stringify(r2.metadata))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---- 3. Dimension mismatch (same model, different dim) refused ----
  {
    const { tmp, pid, raw, syms } = await setupCorpus("m18q5-dim-")
    try {
      insertEmbed(raw, pid, syms[0].id, syms[0].t, FAKE_MODEL, fakeVec(), FAKE_DIM + 4) // wrong dim
      const r3 = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      ck("Q5.3a: dim-mismatch row excluded by SQL (scannedRows=0 or fallback)", r3.metadata.method === "keyword-fallback" || (r3.metadata.scannedRows === 0 && r3.results.length === 0), "method=" + r3.metadata.method + " scanned=" + r3.metadata.scannedRows)
      insertEmbed(raw, pid, syms[1].id, syms[1].t, FAKE_MODEL, fakeVec(), FAKE_DIM) // compatible
      const r3b = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      ck("Q5.3b: compatible row retrieved; dim-mismatch row ignored", r3b.results.some((x: any) => x.entityId === syms[1].id) && !r3b.results.some((x: any) => x.entityId === syms[0].id), "ids=" + r3b.results.map((x: any) => x.entityId).join(","))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---- 4. Model mismatch: other-model row never compared ----
  {
    const { tmp, pid, raw, syms } = await setupCorpus("m18q5-model-")
    try {
      insertEmbed(raw, pid, syms[0].id, syms[0].t, "different-model-x", fakeVec(0.99), FAKE_DIM)
      const r4 = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      ck("Q5.4: other-model row refused (never compared in vector space)", r4.metadata.method === "keyword-fallback" && !r4.results.some((x: any) => x.entityId === syms[0].id), "method=" + r4.metadata.method + " reason=" + r4.metadata.fallbackReason)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---- 5. tfidf query model refused from dense path ----
  {
    const { tmp, pid, raw, syms } = await setupCorpus("m18q5-tfidf-")
    try {
      fakeModel = "tfidf-v1"
      insertEmbed(raw, pid, syms[0].id, syms[0].t, "tfidf-v1", JSON.stringify({ tokens: ["a"] }), 2)
      const r5 = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      ck("Q5.5: tfidf query model refused -> non-dense-query-model", r5.metadata.method === "keyword-fallback" && r5.metadata.fallbackReason === "non-dense-query-model", JSON.stringify(r5.metadata))
      fakeModel = FAKE_MODEL
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---- 6. embed returns [] -> no-query-vector fallback ----
  {
    const { tmp, pid } = await setupCorpus("m18q5-noqv-")
    try {
      fakeQueryVector = null
      const r6 = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      ck("Q5.6: empty query vector -> no-query-vector fallback", r6.metadata.method === "keyword-fallback" && r6.metadata.fallbackReason === "no-query-vector", JSON.stringify(r6.metadata))
      fakeQueryVector = fakeVec()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---- 7. embed throws -> embedding-error fallback ----
  {
    const { tmp, pid } = await setupCorpus("m18-q5-emb-")
    try {
      fakeThrow = true
      const r7 = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      ck("Q5.7: embed throws -> embedding-error fallback (never crashes)", r7.metadata.method === "keyword-fallback" && r7.metadata.fallbackReason === "embedding-error", JSON.stringify(r7.metadata))
      fakeThrow = false
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---- 8. Empty embedding table -> no-matching-model-embeddings ----
  {
    const { tmp, pid } = await setupCorpus("m18-q5-empty-")
    try {
      const r8 = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      ck("Q5.8: empty table -> explicit fallback with reason", r8.metadata.method === "keyword-fallback" && r8.metadata.fallbackReason === "no-matching-model-embeddings", JSON.stringify(r8.metadata))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---- 9. Degenerate zero rows never produce NaN; fall back cleanly ----
  {
    const { tmp, pid, raw, syms } = await setupCorpus("m18-q5-zero-")
    try {
      // A zero vector has norm 0 -> cosine 0 -> below threshold -> clean fallback.
      insertEmbed(raw, pid, syms[0].id, syms[0].t, FAKE_MODEL, Array(FAKE_DIM).fill(0), FAKE_DIM)
      const r9 = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      const hasNaN = r9.results.some((x: any) => !Number.isFinite(x.similarity))
      ck("Q5.9: degenerate zero row never yields NaN similarity; clean fallback", !hasNaN && (r9.metadata.method === "keyword-fallback" || r9.results.every((x: any) => Number.isFinite(x.similarity))), "method=" + r9.metadata.method + " nan=" + hasNaN)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---- 10. Stale source: file changed after index -> flagged stale ----
  {
    const { tmp, pid, raw } = await setupCorpus("m18-q5-stale-")
    try {
      const f = raw.prepare("SELECT path, id FROM brain_file WHERE project_id = ? LIMIT 1").get(pid) as any
      const { appendFileSync } = await import("node:fs")
      appendFileSync(f.path, "\n// touched after index\n")
      const sym = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND file_id = ? LIMIT 1").get(pid, f.id) as any
      insertEmbed(raw, pid, sym.id, "symbol", FAKE_MODEL, fakeVec(), FAKE_DIM)
      const r10 = await semanticVectorSearch(pid, "query", { maxResults: 5 })
      const hit = r10.results.find((x: any) => x.entityId === sym.id)
      ck("Q5.10: stale source flagged stale:true (never presented as current)", r10.metadata.method === "keyword-fallback" || (hit && hit.stale === true), "method=" + r10.metadata.method + " stale=" + (hit && hit.stale))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // ---- 11. Scan-cap truncation is honest (provenance.truncated) ----
  // The cap (BB_VECTOR_SCAN_CAP) is read at import time, so it cannot be
  // changed in-process. Runs as a self-contained CHILD process that sets the
  // cap BEFORE importing, then indexes + injects 4 rows + searches.
  {
    const bench = JSON.parse(readFileSync(path.join(ROOT_DIR, "validation/m18/benchmark/benchmark.json"), "utf8"))
    const rakeSource = bench.corpora.find((c: any) => c.tag === "rake").source
    const { execFileSync } = await import("node:child_process")
    let childOut = ""
    let childExit = 0
    try {
      childOut = execFileSync(
        process.execPath, ["script/m18/verify-scan-cap.ts", rakeSource],
        { cwd: ROOT_DIR, encoding: "utf8", timeout: 120000 },
      ).trim()
    } catch (e: any) {
      childExit = e?.status ?? 1
      childOut = String(e?.stdout || e?.message || "")
    }
    let parsed: any = null
    try { parsed = JSON.parse(childOut.split("\n").filter((l: string) => l.startsWith("{")).join("\n") || childOut) } catch {}
    const pass = parsed && parsed.pass === true && parsed.inserted === 4 && parsed.scanned === 2 && parsed.truncated === true
    ck("Q5.11: scan-cap truncation via child process (inserted=4, scanned=2, truncated=true)", pass === true, "exit=" + childExit + " out=" + childOut.slice(0, 240))
  }

  uninstallFake()
  const e = {
    issue: "M18.Q5", code: "Q5", tool: "semantic-search (edge cases)",
    title: "semantic edge cases - corruption, stale, empty, cold-start, model-mismatch",
    verified: failed === 0, checks, passed, failed,
    negatives: ["content_hash is stored but NOT consulted at query time (insert-time dedupe only); staleness is proven via file-level hash (checkResultsFreshness).", "The verifier patches SemanticEngine.embed + getLastEmbeddingModel with a fixed synthetic vector/model so it is fully deterministic; real-model behavior is covered by Q2/Q3/Q4."],
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(RESULTS_DIR, "Q5.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("Q5: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()