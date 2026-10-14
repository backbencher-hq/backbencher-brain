// script/m19/verify-fallback-scale.ts — M19.Q2.
//
// Fallback ladder at scale: when API/vector embeddings cannot cover 100k+
// symbols, every degradation state must be LABELED — never silent — and the
// fallback must return RELEVANT results, not garbage.
//
// Checks (CAN FAIL):
//   1. Coverage measured + reported per model for the giant index; the health
//      line is machine-checkable (its counts match the DB rows exactly).
//   2. semanticVectorSearch on the unembedded giant always falls back with an
//      explicit method + fallbackReason and surfaces the unknown in provenance.
//   3. bb_ask prepends the explicit "semantic embeddings are unavailable or
//      insufficient" note when coverage is low; stat queries stay confident.
//   4. Fallback returns RELEVANT named symbols on a verified subset
//      (intellij-community real names), case-insensitively; a true miss labels
//      itself instead of inventing results.
//   5. tfidf/local rows are labeled and excluded from the dense cosine path
//      (deterministic temp index + patched engine — no API dependence).
//
// No auto-pass: every check can fail.

import { writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir, cpus, totalmem } from "node:os"
import path from "node:path"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { checkEmbeddingCoverage } from "../../src/brain/brain-index-health"
import { semanticVectorSearch } from "../../src/intelligence/search/semantic-search"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"
import { SemanticEngine } from "../../src/brain/semantic/engine"

let checks = 0, passed = 0, failed = 0
function ck(label: string, cond: boolean, detail?: string) {
  checks++
  if (cond) passed++
  else { failed++; console.log("  FAIL: " + label + (detail ? " - " + detail : "")) }
}

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m19/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

const INTELIJ = "$HOME/intellij-community"
const MACHINE = { platform: process.platform, arch: process.arch, cpu: (cpus() || []).slice(0, 2).map((c) => c.model.trim()).join(" | "), ramGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10 }

async function main() {
  console.log("-- Q2  fallback at scale (honest degradation) --")
  const pid = getProjectId(INTELIJ)
  const raw = await BrainDatabase.getRawInstance(pid)
  const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid) as any).c
  const embedRows = raw.prepare("SELECT embedding_model m, COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model").all(pid) as Array<{ m: string; c: number }>
  const embedTotal = embedRows.reduce((a, r) => a + r.c, 0)
  ck("Q2: giant index present", symbols >= 1000000, "symbols=" + symbols)

  // 1. Coverage measured + machine-checkable health line
  // Q2 owns the embedding-coverage contract. The full 12-check integrity
  // report is intentionally not invoked here: it samples and hashes files and
  // can take minutes on a 1M-symbol corpus, which would make this fallback
  // verifier depend on unrelated filesystem latency.
  const covCheck = await checkEmbeddingCoverage(raw, pid)
  ck("Q2: health has an embedding-coverage check line", !!covCheck, "found=" + !!covCheck)
  if (covCheck) {
    const desc: string = covCheck.description || ""
    const m = desc.match(/(\d[\d,]*) of ([\d,]+) symbols have semantic embeddings/)
    ck("Q2: coverage line machine-checkable (counts match DB)", !!m && m[1].replace(/,/g, "") === String(embedTotal) && m[2].replace(/,/g, "") === String(symbols), "desc=" + desc.slice(0, 140))
    ck("Q2: low coverage is surfaced as a warning (never silent)", covCheck.status === "warn" || covCheck.status === "error", "status=" + covCheck.status)
  }

  // 2. semanticVectorSearch always labeled at scale
  const t0 = Date.now()
  const vres = await semanticVectorSearch(pid, "VirtualFile", { maxResults: 5 })
  const vecMs = Date.now() - t0
  const labeled = vres.metadata.method === "keyword-fallback" && !!vres.metadata.fallbackReason
  const surfaced = (vres.provenance?.unknowns || []).some((u: string) => typeof u === "string" && u.length > 0)
  ck("Q2: vector search on unembedded giant is labeled, never silent", labeled && surfaced, "method=" + vres.metadata.method + " reason=" + vres.metadata.fallbackReason + " unknowns=" + (vres.provenance?.unknowns || []).length)
  ck("Q2: labeled fallback is bounded (< 20s)", vecMs < 20000, "vecMs=" + vecMs)

  // 3. bb_ask honesty at low coverage
  const ask = await quickAnswer(pid, "VirtualFile")
  const askHasNote = ask.answer.includes("semantic embeddings are unavailable or insufficient")
  ck("Q2: bb_ask prepends the low-coverage honesty note", askHasNote, "note=" + askHasNote)
  const askStat = await quickAnswer(pid, "how many symbols are in this project")
  ck("Q2: bb_ask stat path stays confident at scale", askStat.answer.includes("symbols") && askStat.confidence >= 0.8, "answer=" + askStat.answer.slice(0, 80) + " conf=" + askStat.confidence)

  // 4. Fallback relevance on a verified subset (case-insensitive lexical match)
  const relevant = (vres.results || []).filter((r: any) => String(r.symbolName || "").toLowerCase().includes("virtualfile"))
  ck("Q2: fallback returns RELEVANT named symbols on a verified name", relevant.length >= 1, "matched=" + relevant.length + " of " + vres.results.length)
  const miss = await semanticVectorSearch(pid, "zzznope_definitely_nothing", { maxResults: 5 })
  ck("Q2: fallback for a true miss returns nothing but labels itself", miss.results.length === 0 && miss.metadata.method === "keyword-fallback", "n=" + miss.results.length + " method=" + miss.metadata.method)

  // 5. tfidf/local labels excluded from dense cosine (deterministic temp index)
  const tmp = mkdtempSync(path.join(tmpdir(), "m19q2-"))
  try {
    // This is deliberately a tiny real production-pipeline fixture. The
    // mechanism proof needs one resolvable symbol, not a copied repository;
    // copying Clojure made Q2 depend on unrelated corpus size and could stall
    // for minutes before reaching the deterministic semantic assertions.
    writeFileSync(path.join(tmp, "fixture.ts"), [
      "export class VirtualFile {",
      "  constructor(public readonly path: string) {}",
      "  open(): string { return this.path }",
      "}",
      "export function makeVirtualFile(path: string): VirtualFile {",
      "  return new VirtualFile(path)",
      "}",
      "",
    ].join("\\n"))
    const tPid = getProjectId(tmp)
    process.env.BB_EMBEDDING_BATCH_LIMIT = "1"
    try {
      await indexProjectParallel(tPid, tmp, {})
    } finally {
      delete process.env.BB_EMBEDDING_BATCH_LIMIT
    }
    const tRaw = await BrainDatabase.getRawInstance(tPid)
    const fakeSym = (tRaw.prepare("SELECT id FROM brain_symbol WHERE project_id=? AND name=? LIMIT 1").get(tPid, "VirtualFile") as any)?.id
    ck("Q2: temp production fixture seeded for mechanism proof", !!fakeSym, "sym=" + fakeSym)

    // Patch the engine deterministically so the dense path is fully offline.
    const realEmbed = SemanticEngine.embed.bind(SemanticEngine)
    const realLastModel = SemanticEngine.getLastEmbeddingModel.bind(SemanticEngine)
    SemanticEngine.embed = async () => new Array(4).fill(0.5)
    SemanticEngine.getLastEmbeddingModel = () => "local-vectors-v1"

    // (a) tfidf-labeled row at the same dimension as the query vector: the
    // dense path must refuse it (NON_DENSE_MODELS) and fall back explicitly
    // with no-matching-model-embeddings instead of cosine-ing it.
    tRaw.exec("DELETE FROM brain_semantic_embedding WHERE project_id = ?", [tPid])
    tRaw.prepare(
      "INSERT INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?, ?, ?, 'symbol', 'tfidf-v1', ?, 4, 'h', '{}', 0.15, 1, 1, 1)",
    ).run("tfidf:" + fakeSym, tPid, fakeSym, JSON.stringify(["tok"]))
    const tfidfRes = await semanticVectorSearch(tPid, "mkdir", { maxResults: 3 })
    ck("Q2: tfidf-labeled rows excluded from dense cosine", tfidfRes.metadata.method === "keyword-fallback" && tfidfRes.metadata.fallbackReason === "no-matching-model-embeddings", "method=" + tfidfRes.metadata.method + " reason=" + tfidfRes.metadata.fallbackReason)

    // (b) same-model vector row present: the vector path runs and is labeled.
    tRaw.exec("DELETE FROM brain_semantic_embedding WHERE project_id = ?", [tPid])
    tRaw.prepare(
      "INSERT INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?, ?, ?, 'symbol', 'local-vectors-v1', ?, 4, 'h', '{}', 0.15, 1, 1, 1)",
    ).run("vec:" + fakeSym, tPid, fakeSym, JSON.stringify(new Array(4).fill(0.9)))
    const vecPath = await semanticVectorSearch(tPid, "mkdir", { maxResults: 3 })
    ck("Q2: matching-model vector rows use the vector path", vecPath.metadata.method === "vector" && vecPath.metadata.queryModel === "local-vectors-v1", "method=" + vecPath.metadata.method)

    SemanticEngine.embed = realEmbed
    SemanticEngine.getLastEmbeddingModel = realLastModel
  } catch (e: any) {
    console.log("  FAIL: temp-index mechanism section - " + (e?.message || e))
    checks++
    failed++
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  const measured = {
    repo: "intellij-community", symbols, machine: MACHINE,
    coverage: { perModel: embedRows, totalEmbeds: embedTotal, pct: symbols > 0 ? Math.round((embedTotal / symbols) * 1000) / 10 : 0 },
    healthCoverageLine: covCheck ? (covCheck.description || "").slice(0, 160) : null,
    semanticVector: { ms: vecMs, method: vres.metadata.method, reason: vres.metadata.fallbackReason, resultCount: vres.results.length, relevantSubsetHits: relevant.length },
    ask: { hasLowCoverageNote: askHasNote, statConfidence: askStat.confidence },
  }

  const e = {
    issue: "M19.Q2", code: "Q2", tool: "semantic fallback ladder at scale",
    title: "fallback at scale - API-embedding exhaustion degrades honestly, never silently",
    verified: failed === 0, checks, passed, failed,
    measured,
    negatives: [
      "Fallback relevance is measured on a verified subset (VirtualFile family); it is lexical candidate discovery, not behavioral proof.",
      "The giant index has 0 vector embeddings (S3 bounded them off by design); 0% coverage is reported, never hidden.",
      "tfidf/vector-path exclusion is verified on a deterministic temp index (fixed engine vectors) — the mechanism, not a 1M-row cosine.",
    ],
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(RESULTS_DIR, "Q2.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("Q2: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(failed === 0 ? 0 : 1)
}

main()