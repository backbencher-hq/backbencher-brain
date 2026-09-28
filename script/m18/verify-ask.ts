// script/m18/verify-ask.ts — M18.Q3 (bb_ask open-ended answer precision + honesty).
//
// Turns the Q1 natural-language queries into real quickAnswer calls and scores:
//   - PRECISION: does the answer's sources cite the gold symbol (case-insensitive)?
//   - NO-FABRICATION: negative (no-gold) queries must never produce a confident
//     answer (confidence < 0.5); low-coverage answers must show an explicit
//     unknown (the fallback honesty note added in quick-answer.ts).
//   - COLD vs WARM delta: cold = no stored embeddings (BB_EMBEDDING_BATCH_LIMIT=1
//     skips the whole batch), warm = embeddings flushed. Both measured.
//   - NO-INDEX honesty: quickAnswer on an unindexed project must answer the
//     explicit "no index exists" message, never a fabricated count.
//
// Modes: --corpus=X [--warm|--cold]  (default: both)  |  --merge
// Partials land in validation/m18/results/partial/; merge emits Q2.json.

import { writeFileSync, readFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"

let checks = 0, passed = 0, failed = 0
function ck(label: string, cond: boolean, detail?: string) {
  checks++
  if (cond) passed++
  else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) }
}

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m18/results")
const PARTIAL_DIR = path.join(RESULTS_DIR, "partial")
for (const d of [RESULTS_DIR, PARTIAL_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true })
const bench = JSON.parse(readFileSync(path.join(ROOT_DIR, "validation/m18/benchmark/benchmark.json"), "utf8"))
const corpora = new Map<string, any>(bench.corpora.map((c: any) => [c.tag, c]))

const CORPUS_ONLY = process.argv.find((a) => a.startsWith("--corpus="))?.split("=")[1]
const WARM = process.argv.includes("--warm")
const COLD = process.argv.includes("--cold")
const MERGE = process.argv.includes("--merge")
const FLUSH_TIMEOUT_MS = Number(process.env.BB_Q2_FLUSH_TIMEOUT_MS || 90 * 1000)

async function indexCorpus(tag: string, cold: boolean): Promise<{ raw: any; pid: string; tmp: string; flushCompleted: boolean }> {
  const c = corpora.get(tag)
  const tmp = mkdtempSync(path.join(tmpdir(), "m18ask-"))
  try {
    cpSync(c.source, tmp, { recursive: true })
    const pid = getProjectId(tmp)
    if (cold) process.env.BB_EMBEDDING_BATCH_LIMIT = "1"
    else delete process.env.BB_EMBEDDING_BATCH_LIMIT
    await indexProjectParallel(pid, tmp, {})
    let flushCompleted = true
    if (!cold) {
      try {
        await Promise.race([
          flushBackgroundEmbeddings(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("flush timeout")), FLUSH_TIMEOUT_MS)),
        ])
      } catch {
        flushCompleted = false
      }
    }
    const raw = await BrainDatabase.getRawInstance(pid)
    return { raw, pid, tmp, flushCompleted }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true })
    throw e
  }
}

async function collect(tag: string, cold: boolean): Promise<{ data: any; ok: boolean }> {
  const c = corpora.get(tag)
  if (!existsSync(c.source)) {
    console.log("  " + tag + " " + (cold ? "COLD" : "WARM") + ": SOURCE MISSING (" + c.source + ") — reported, not skipped")
    return { ok: false, data: { error: "corpus missing on disk" } }
  }
  console.log("  indexing " + tag + " " + (cold ? "COLD" : "WARM") + " ...")
  let raw: any = null, pid = "", tmp = "", flushCompleted = true
  try {
    const r = await indexCorpus(tag, cold)
    raw = r.raw; pid = r.pid; tmp = r.tmp; flushCompleted = r.flushCompleted
  } catch (e: any) {
    console.log("  FAIL: index " + tag + " — " + String(e?.message || e))
    return { ok: false, data: { error: String(e?.message || e) } }
  }

  try {
    const emb = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=?").get(pid) as any).c
    const queries = bench.queries.filter((q: any) => q.corpus === tag)
    const rows: any[] = []
    for (const q of queries) {
      const res = await quickAnswer(pid, q.query)
      const gold = q.expected ? q.expected.symbol : null
      const hit = gold ? res.sources.some((s) => (s.context || "").toLowerCase().includes(gold.toLowerCase())) : null
      const answersHasFallbackNote = res.answer.includes("semantic embeddings are unavailable or insufficient")
      const answersHasExplicitUnknown = res.answer.includes("couldn't find") || res.answer.includes("can't answer") || answersHasFallbackNote
      rows.push({
        id: q.id, query: q.query, negative: q.expected === null || !!q.negative, gold,
        hit, confidence: res.confidence,
        evidenceClass: res.provenance.evidenceClass,
        sourceContexts: res.sources.slice(0, 5).map((s) => s.context),
        answerExcerpt: res.answer.slice(0, 180),
        answersHasFallbackNote, answersHasExplicitUnknown,
      })
      console.log(`    ${q.id} ${q.negative ? "(neg) " : ""}conf=${res.confidence} hit=${hit}`)
    }
    const data = { tag, cold, embeddings: emb, flushCompleted, rows }
    console.log(`  ${tag} ${cold ? "COLD" : "WARM"}: embeddings=${emb} queries=${rows.length}`)
    return { ok: true, data }
  } finally {
    await flushBackgroundEmbeddings().catch(() => {})
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  if (CORPUS_ONLY) {
    const modes = COLD || WARM ? [(COLD ? "cold" : "warm")] : ["warm", "cold"]
    for (const mode of modes) {
      const { data, ok } = await collect(CORPUS_ONLY, mode === "cold")
      if (!ok) { process.exit(1) }
      writeFileSync(path.join(PARTIAL_DIR, `ask-${CORPUS_ONLY}-${mode}.json`), JSON.stringify({ mode, data, generatedAt: new Date().toISOString() }, null, 2) + "\n")
      console.log("Q3 partial: " + CORPUS_ONLY + "-" + mode + " " + (ok ? "COLLECTED" : "FAILED"))
    }
    process.exit(0)
  }

  if (MERGE) {
    console.log("── Q3  merge + floors ──")
    const perCorpus: Record<string, any> = {}
    let missing = 0
    for (const corpus of ["rake", "lodash", "element-plus"]) {
      for (const mode of ["warm", "cold"]) {
        const f = path.join(PARTIAL_DIR, `ask-${corpus}-${mode}.json`)
        if (!existsSync(f)) { console.log("  MISSING partial: " + corpus + "-" + mode); missing++; continue }
        const p = JSON.parse(readFileSync(f, "utf8"))
        perCorpus[corpus + "-" + mode] = p.data
      }
    }
    ck("Q3: all six corpus-mode partials collected", missing === 0, "missing=" + missing)

    // ── Precision floors ──
    const warmRows: any[] = []
    const coldRows: any[] = []
    for (const [k, v] of Object.entries(perCorpus) as any) {
      ;(k.endsWith("-warm") ? warmRows : coldRows).push(...(v.rows || []))
    }
    const warm = scoreForRows(warmRows, false)
    const cold = scoreForRows(coldRows, true)

    ck("Q3: warm precision floor >= 0.5", warm.precision >= 0.5, "precision=" + (warm.precision * 100).toFixed(1) + "% (" + warm.hits + "/" + warm.golds + ")")
    ck("Q3: cold precision floor >= 0.3", cold.precision >= 0.3, "precision=" + (cold.precision * 100).toFixed(1) + "% (" + cold.hits + "/" + cold.golds + ")")
    ck("Q3: warm beats cold (delta documented, not assumed positive)", warm.precision >= cold.precision, "warm=" + (warm.precision * 100).toFixed(1) + "% cold=" + (cold.precision * 100).toFixed(1) + "%")
    ck("Q3: no-fabrication — every negative query confidence < 0.5 (warm+cold)", warm.negConfViolations + cold.negConfViolations === 0, "violations=" + (warm.negConfViolations + cold.negConfViolations))
    ck("Q3: cold negatives carry explicit unknown (no silent lexical answers)", cold.coldUnknownViolations === 0, "violations=" + cold.coldUnknownViolations)

    // ── No-index honesty (independent of corpora) ──
    const tmp = mkdtempSync(path.join(tmpdir(), "m18noindex-"))
    let noindexOk = false
    try {
      const pid = getProjectId(tmp) // no files indexed
      const res = await quickAnswer(pid, "how many functions are in this project")
      noindexOk = res.answer.toLowerCase().includes("no index")
      ck("Q3: no-index — explicit unknown, never a fabricated count", noindexOk, res.answer.slice(0, 90))
    } finally { rmSync(tmp, { recursive: true, force: true }) }

    const e = {
      issue: "M18.Q3", code: "Q3", tool: "bb_ask",
      title: "bb_ask open-ended answer precision on real corpora",
      verified: failed === 0, checks, passed, failed,
      perCorpus,
      precision: { warm, cold, delta: warm.precision - cold.precision },
      generatedAt: new Date().toISOString(),
      negativeLine: "Precision here means the answer cites the gold source; it does NOT prove the prose is factually complete. Stat routes (how many/classes/files) are covered by M16/M17 A8; this issue exercises the semantic/ask path only.",
    }
    writeFileSync(path.join(RESULTS_DIR, "Q3.json"), JSON.stringify(e, null, 2) + "\n")
    console.log("Q3: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
    process.exit(failed === 0 ? 0 : 1)
  }

  console.log("Usage: verify-ask.ts --corpus=rake|lodash|element-plus [--warm|--cold] | --merge")
  process.exit(1)
}

function scoreForRows(rows: any[], cold: boolean) {
  const golds = rows.filter((r) => !r.negative)
  const negs = rows.filter((r) => r.negative)
  const hits = golds.filter((r) => r.hit).length
  const precision = golds.length ? hits / golds.length : 0
  const negConfViolations = negs.filter((r) => r.confidence >= 0.5).length
  const coldUnknownViolations = cold ? negs.filter((r) => !r.answersHasExplicitUnknown).length : 0
  return { golds: golds.length, hits, precision, negs: negs.length, negConfViolations, coldUnknownViolations }
}

await main()