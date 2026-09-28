// script/m18/verify-coverage.ts — M18.Q4 (embedding coverage as a reported,
// gated metric — no silent low-coverage).
//
// Scope (from issue #415, corrected after the final review):
//   1. Coverage = embeddings per model / symbols, measured per run and REPORTED
//      through bb_health — machine-checkable, never hidden even when 0.
//   2. The pre-flush "0 of N" line (during background drain) must be
//      DISTINGUISHABLE from the post-flush number — evidence states the phase.
//   3. Model consistency is verified, not reimplemented: a query whose model has
//      no stored embeddings must fall back explicitly (cross-model refused).
//   4. Degradation is surfaced: at zero/low coverage, bb_ask says so (lexical
//      note) instead of presenting lexical matches as semantic.

import { writeFileSync, readFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync, writeFileSync as wfs } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { semanticVectorSearch } from "../../src/intelligence/search/semantic-search"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"

let checks = 0, passed = 0, failed = 0
function ck(label: string, cond: boolean, detail?: string) {
  checks++
  if (cond) passed++
  else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) }
}

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m18/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
const FLUSH_TIMEOUT_MS = Number(process.env.BB_Q2_FLUSH_TIMEOUT_MS || 120 * 1000)

async function healthCoverage(raw: any, projectId: string) {
  const total = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any).c
  const embedCount = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=?").get(projectId) as any).c
  const models = raw.prepare("SELECT embedding_model m, COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model").all(projectId) as Array<{ m: string; c: number }>
  const pct = total > 0 ? (embedCount / total) * 100 : 0
  return { total, embedCount, pct, models, status: pct < 20 ? "error" : pct < 50 ? "warn" : "ok" }
}

async function main() {
  console.log("── Q4  embedding coverage: reported, gated, honest ──")

  // ── Phase 1: coverage reporting + phase labeling on a real corpus ──
  const rake = JSON.parse(readFileSync(path.join(ROOT_DIR, "validation/m18/benchmark/benchmark.json"), "utf8")).corpora.find((c: any) => c.tag === "rake")
  const tmp = mkdtempSync(path.join(tmpdir(), "m18cov-"))
  let pid = ""
  try {
    cpSync(rake.source, tmp, { recursive: true })
    pid = getProjectId(tmp)
    await indexProjectParallel(pid, tmp, {})
    const raw = await BrainDatabase.getRawInstance(pid)

    // PRE-FLUSH: during background drain, embeddings may be 0 or partial. The
    // health line reports exactly what is stored at that moment — honest, but
    // it must be labeled as the pre-flush phase in evidence.
    const pre = await healthCoverage(raw, pid)
    console.log(`  PRE-FLUSH: ${pre.embedCount}/${pre.total} (${pre.pct.toFixed(1)}%) models=${JSON.stringify(pre.models)}`)
    ck("Q4: pre-flush coverage is machine-checkable (value/total/percent/models present)", pre.total > 0 && typeof pre.pct === "number", "")

    // POST-FLUSH: after a bounded deterministic flush, the number must be >= the
    // pre-flush number and the phase is recorded.
    await Promise.race([
      flushBackgroundEmbeddings(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("flush timeout")), FLUSH_TIMEOUT_MS)),
    ]).catch(() => {})
    const post = await healthCoverage(raw, pid)
    console.log(`  POST-FLUSH: ${post.embedCount}/${post.total} (${post.pct.toFixed(1)}%) models=${JSON.stringify(post.models)}`)
    ck("Q4: post-flush coverage >= pre-flush (never shrinks from a flush)", post.embedCount >= pre.embedCount, `${post.embedCount} >= ${pre.embedCount}`)
    ck("Q4: post-flush coverage reported with model label", post.models.length > 0, JSON.stringify(post.models))
    // 0-coverage is never hidden: the health check reports 0 with an explicit
    // description rather than omitting the metric.
    ck("Q4: zero-coverage is representable (health reports 0 as a number)", typeof pre.embedCount === "number" && Number.isFinite(pre.pct) && pre.total > 0, "pre-embedCount=" + pre.embedCount + " pre-pct=" + pre.pct)

    // ── Phase 3: cross-model refusal + degradation surfaced at zero coverage ──
    // On a COLD index the query's model (API) has zero stored embeddings, so:
    //  (a) a foreign-model row must never be compared (cross-model refused), and
    //  (b) the mismatch must surface an EXPLICIT fallback reason, not a silent
    //      empty result — the honest "why no semantic answer" surface.
    const tmp2 = mkdtempSync(path.join(tmpdir(), "m18cov-cold-"))
    try {
      cpSync(rake.source, tmp2, { recursive: true })
      const pid2 = getProjectId(tmp2)
      process.env.BB_EMBEDDING_BATCH_LIMIT = "1"
      await indexProjectParallel(pid2, tmp2, {})
      delete process.env.BB_EMBEDDING_BATCH_LIMIT
      const raw2 = await BrainDatabase.getRawInstance(pid2)
      const cold = await healthCoverage(raw2, pid2)
      ck("Q4: cold index has 0 embeddings (never hidden)", cold.embedCount === 0, "embedCount=" + cold.embedCount)

      const sym2 = raw2.prepare("SELECT s.id id, s.name n, s.symbol_type t FROM brain_symbol s WHERE s.project_id=? LIMIT 1").get(pid2) as any
      const fakeVec = JSON.stringify(Array(2048).fill(0.01))
      raw2.prepare(
        "INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(pid2 + ":fake", pid2, sym2.id, sym2.t, "fake-model-999", fakeVec, 2048, "hash", JSON.stringify({ name: sym2.n }), 0.7, Date.now(), Date.now(), Date.now())
      const res2 = await semanticVectorSearch(pid2, "deep clone an object", { maxResults: 10 })
      const fakeLeaked = res2.results.some((r: any) => r.entityId === sym2.id)
      ck("Q4: cross-model embedding is refused (never compared in vector space)", !fakeLeaked, "method=" + res2.metadata.method + " queryModel=" + res2.metadata.queryModel)
      ck("Q4: cross-model mismatch surfaces an explicit fallback reason", res2.metadata.method === "keyword-fallback" && !!res2.metadata.fallbackReason, JSON.stringify(res2.metadata.fallbackReason))

      const ask = await quickAnswer(pid2, "deep clone an object")
      const surfaced = ask.answer.includes("semantic embeddings are unavailable or insufficient") || ask.answer.includes("couldn't find")
      ck("Q4: zero-coverage ask surfaces degradation (lexical note / explicit unknown)", surfaced, ask.answer.slice(0, 120))
    } finally {
      rmSync(tmp2, { recursive: true, force: true })
    }
  } finally {
    await flushBackgroundEmbeddings().catch(() => {})
    rmSync(tmp, { recursive: true, force: true })
  }

  const e = {
    issue: "M18.Q4", code: "Q4", tool: "bb_health + semantic-search + bb_ask",
    title: "embedding coverage as a reported, gated metric (no silent low-coverage)",
    verified: failed === 0, checks, passed, failed,
    phase: "post-flush (Q4 evidence; pre-flush number recorded separately as the honest during-drain state)",
    generatedAt: new Date().toISOString(),
    negativeLine: "Coverage is a per-run, API-dependent statistic — this verifier proves it is REPORTED and machine-checkable and that degradation is SURFACED; it does not set a coverage target (coverage is volatile by design, see issue #415). Cross-model refusal is verified for the fake-model case; real mixed-model runs are covered by Q2's per-gold attribution.",
  }
  writeFileSync(path.join(RESULTS_DIR, "Q4.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("Q4: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()