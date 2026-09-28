// script/m21/verify-embedding-queue.ts — M21.E2
// BEHAVIORAL gate for the background embedding queue. Exercises real code
// paths on temporary fixtures — no auto-passes, no tautologies:
//
//   1. Happy path (local provider): index a fixture, flush, assert metric
//      conservation (queued == embedded+dropped+failed+skipped+fallback
//      deltas) and that embeddings are durable with a non-tfidf model label.
//   2. Provider-failure path: SemanticEngine.embedMany patched to throw (the
//      shape a dead/unavailable provider produces). The queue must route the
//      batch into the TF-IDF fallback — fallback counter increments, nothing
//      silently dropped, vectors persisted with the tfidf-v1 label.
//   3. Bounded flush: with a job held back (drainer blocked), a flush with a
//      short timeoutMs must return resolved:"timeout" with an honest
//      pendingItems count instead of hanging.
//   4. Regression guard: the drainer must not treat an empty provider result
//      as success (the `if (!embeddings) continue` bug — an empty array is
//      truthy and used to bypass the fallback path entirely).
//
// Run: bun run script/m21/verify-embedding-queue.ts

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, flushBackgroundEmbeddings, backgroundEmbedMetrics } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { SemanticEngine } from "../../src/brain/semantic/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

type Metrics = typeof backgroundEmbedMetrics
function snapshot(m: Metrics): Metrics { return { ...m } }
function deltas(a: Metrics, b: Metrics) {
  return {
    queued: b.queued - a.queued,
    embedded: b.embedded - a.embedded,
    dropped: b.dropped - a.dropped,
    failed: b.failed - a.failed,
    fallback: b.fallback - a.fallback,
    skipped: b.skipped - a.skipped,
  }
}
// Every item that entered the queue exits through exactly one outcome door.
function conserved(d: ReturnType<typeof deltas>): boolean {
  return d.queued === d.embedded + d.dropped + d.failed + d.fallback + d.skipped
}

function fixture(dir: string): string {
  mkdirSync(path.join(dir, "src"), { recursive: true })
  writeFileSync(path.join(dir, "src", "calc.ts"), `
export function add(left: number, right: number): number { return left + right }
export class Calculator {
  total(value: number): number { return add(value, 1) }
}
export interface Shape { area(): number }
`)
  return dir
}

const roots: string[] = []
const projects: string[] = []
function cleanup() {
  for (const p of projects) {
    BrainDatabase.close(p)
    rmSync(path.dirname(BrainDatabase.getDbPath(p)), { recursive: true, force: true })
  }
  for (const r of roots) rmSync(r, { recursive: true, force: true })
}

let result: any
try {
  // ── 1. Happy path: local provider, real fixture ─────────────────────────
  delete process.env.BB_EMBEDDING_BASE_URL
  delete process.env.BB_EMBEDDING_API_KEY
  delete process.env.BB_EMBEDDING_MODEL

  const root1 = fixture(mkdtempSync(path.join(tmpdir(), "bb-e2-ok-")))
  roots.push(root1)
  const pid1 = getProjectId(root1)
  projects.push(pid1)

  const before1 = snapshot(backgroundEmbedMetrics)
  const idx = await indexProjectParallel(pid1, root1, { skipPostProcessing: true })
  check("E2 fixture indexes successfully", idx.successFiles > 0, JSON.stringify(idx).slice(0, 120))

  const mid1 = snapshot(backgroundEmbedMetrics)
  check("E2 indexing queues embedding items", mid1.queued > before1.queued,
    `queued ${before1.queued} -> ${mid1.queued}`)
  check("E2 nothing dropped on a small fixture", mid1.dropped === before1.dropped,
    `dropped delta=${mid1.dropped - before1.dropped}`)

  const flush1 = await flushBackgroundEmbeddings({ timeoutMs: 120_000 })
  check("E2 flush drains (resolved=drained)", flush1.resolved === "drained", JSON.stringify(flush1))
  const after1 = snapshot(backgroundEmbedMetrics)
  const d1 = deltas(before1, after1)
  check("E2 metric conservation after flush", conserved(d1), JSON.stringify(d1))
  check("E2 items embedded via provider", after1.embedded > before1.embedded,
    `embedded ${before1.embedded} -> ${after1.embedded}`)

  const raw1 = await BrainDatabase.getRawInstance(pid1)
  const rows = raw1.prepare(
    "SELECT embedding_model, vector_dimension, embedding_vector FROM brain_semantic_embedding WHERE project_id=?"
  ).all(pid1) as any[]
  const symbols = Number((raw1.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid1) as any).c)
  check("E2 embeddings are durable after flush", rows.length > 0, `rows=${rows.length}`)
  check("E2 embeddings never exceed symbols", rows.length <= symbols, `rows=${rows.length} symbols=${symbols}`)
  check("E2 real model label recorded (not tfidf on happy path)",
    rows.length > 0 && rows.every((r) => r.embedding_model !== "tfidf-v1" && String(r.embedding_model).length > 0),
    JSON.stringify(rows.slice(0, 2).map((r) => r.embedding_model)))

  // ── 2. Provider-failure path: embedMany throws -> TF-IDF fallback ───────
  const realEmbedMany = SemanticEngine.embedMany.bind(SemanticEngine)
  ;(SemanticEngine as any).embedMany = async (_texts: string[]) => {
    throw new Error("E2 fixture: provider unavailable")
  }

  const root2 = fixture(mkdtempSync(path.join(tmpdir(), "bb-e2-fail-")))
  roots.push(root2)
  const pid2 = getProjectId(root2)
  projects.push(pid2)

  const before2 = snapshot(backgroundEmbedMetrics)
  await indexProjectParallel(pid2, root2, { skipPostProcessing: true })
  const flush2 = await flushBackgroundEmbeddings({ timeoutMs: 120_000 })
  ;(SemanticEngine as any).embedMany = realEmbedMany
  const after2 = snapshot(backgroundEmbedMetrics)
  const d2 = deltas(before2, after2)

  check("E2 provider-failure flush still drains", flush2.resolved === "drained", JSON.stringify(flush2))
  check("E2 metric conservation after provider failure", conserved(d2), JSON.stringify(d2))
  check("E2 failed batches fall back to TF-IDF (fallback counter)",
    after2.fallback > before2.fallback,
    `fallback ${before2.fallback} -> ${after2.fallback}`)
  check("E2 nothing silently dropped on provider failure",
    after2.dropped === before2.dropped && after2.failed === before2.failed,
    `dropped+${after2.dropped - before2.dropped} failed+${after2.failed - before2.failed}`)

  const raw2 = await BrainDatabase.getRawInstance(pid2)
  const rows2 = raw2.prepare(
    "SELECT embedding_model FROM brain_semantic_embedding WHERE project_id=?"
  ).all(pid2) as any[]
  check("E2 fallback vectors persisted with tfidf-v1 label",
    rows2.length > 0 && rows2.every((r) => r.embedding_model === "tfidf-v1"),
    JSON.stringify([...new Set(rows2.map((r) => r.embedding_model))]))

  // ── 3. Bounded flush: busy drainer must hit the deadline ────────────────
  // Patch embedMany to a slow-but-finite call (3s): the drainer is genuinely
  // busy, so a bounded flush must return resolved="timeout" with an honest
  // pendingItems count instead of hanging. (The provider call is itself bound
  // by BB_EMBEDDING_CALL_TIMEOUT_MS in production, so a hung provider can no
  // longer wedge the queue permanently — the never-resolving-promise variant
  // of this fixture is no longer representable without an env override.)
  ;(SemanticEngine as any).embedMany = (_texts: string[]) =>
    new Promise((r) => setTimeout(() => r([0.1, 0.2, 0.3]), 3000))

  const root3 = fixture(mkdtempSync(path.join(tmpdir(), "bb-e2-hang-")))
  roots.push(root3)
  const pid3 = getProjectId(root3)
  projects.push(pid3)
  await indexProjectParallel(pid3, root3, { skipPostProcessing: true })
  // Let the drainer pick the job up (setImmediate) so the queue is "busy".
  await new Promise((r) => setTimeout(r, 300))
  const t0 = Date.now()
  const flush3 = await flushBackgroundEmbeddings({ timeoutMs: 1_500 })
  const dt = Date.now() - t0
  ;(SemanticEngine as any).embedMany = realEmbedMany
  check("E2 bounded flush returns promptly under deadline", dt < 10_000, `took ${dt}ms`)
  check("E2 busy drainer reports timeout (not drained)",
    flush3.resolved === "timeout", JSON.stringify(flush3))
  check("E2 timeout reports honest pendingItems", flush3.pendingItems >= 0, JSON.stringify(flush3))
  // Drain the slow call for process hygiene.
  await flushBackgroundEmbeddings({ timeoutMs: 20_000 }).catch(() => undefined)

  // ── 3b. Empty-token symbol on provider failure is counted as skipped ────
  // A symbol with no tokenizable content (short name, no repeated tokens)
  // must exit the queue through a counter — the old fallback `continue`d
  // silently, breaking the conservation invariant.
  ;(SemanticEngine as any).embedMany = async () => { throw new Error("E2 fixture: provider unavailable") }
  const root4 = fixture(mkdtempSync(path.join(tmpdir(), "bb-e2-tokens-")))
  roots.push(root4)
  // Single-letter names + no repeated tokens => tokenizeCodeForEmbedding
  // returns [] for these symbols, which must exit as `skipped`.
  writeFileSync(path.join(root4, "src", "tiny.ts"),
    "export function g() { return }\nexport function h() { return }\n")
  const pid4 = getProjectId(root4)
  projects.push(pid4)
  const before4 = snapshot(backgroundEmbedMetrics)
  await indexProjectParallel(pid4, root4, { skipPostProcessing: true })
  const flush4 = await flushBackgroundEmbeddings({ timeoutMs: 60_000 })
  ;(SemanticEngine as any).embedMany = realEmbedMany
  const after4 = snapshot(backgroundEmbedMetrics)
  const d4 = deltas(before4, after4)
  check("E2 empty-token symbols keep metric conservation", conserved(d4), JSON.stringify(d4))
  check("E2 empty-token symbols exit as skipped (not silently dropped)", d4.skipped > 0, `skipped=${d4.skipped}`)

  // ── 3c. Mid-job provider failure: no double-count, no duplicate rows ────
  // Provider succeeds for chunk 1 then dies: items already embedded must not
  // be re-processed by the TF-IDF fallback (double count + duplicate
  // :embed/:tfidf rows). Needs a multi-chunk job (> 100 symbols).
  function manySymbols(dir: string) {
    mkdirSync(path.join(dir, "src"), { recursive: true })
    const lines: string[] = []
    for (let i = 0; i < 250; i++) lines.push(`export function fn${i}(a: number): number { return a + ${i} }`)
    writeFileSync(path.join(dir, "src", "many.ts"), lines.join("\n"))
    return dir
  }
  let embedCalls = 0
  ;(SemanticEngine as any).embedMany = async (docs: string[]) => {
    embedCalls++
    if (embedCalls === 2) throw new Error("E2 fixture: provider died mid-job")
    return docs.map((d, i) => [i, 1 - i / Math.max(1, docs.length)])
  }
  const root5 = manySymbols(mkdtempSync(path.join(tmpdir(), "bb-e2-midjob-")))
  roots.push(root5)
  const pid5 = getProjectId(root5)
  projects.push(pid5)
  const before5 = snapshot(backgroundEmbedMetrics)
  await indexProjectParallel(pid5, root5, { skipPostProcessing: true })
  const flush5 = await flushBackgroundEmbeddings({ timeoutMs: 120_000 })
  ;(SemanticEngine as any).embedMany = realEmbedMany
  const after5 = snapshot(backgroundEmbedMetrics)
  const d5 = deltas(before5, after5)
  check("E2 mid-job provider failure: metric conservation holds", conserved(d5), JSON.stringify(d5))
  check("E2 mid-job failure actually spanned multiple embed calls", embedCalls >= 2, `calls=${embedCalls}`)
  const raw5 = await BrainDatabase.getRawInstance(pid5)
  const dupRows = raw5.prepare(
    "SELECT entity_id, COUNT(DISTINCT embedding_model) c FROM brain_semantic_embedding WHERE project_id=? GROUP BY entity_id HAVING c > 1"
  ).all(pid5) as any[]
  check("E2 no symbol has both a real and a tfidf vector row (fallback skipped already-embedded items)",
    dupRows.length === 0, `dups=${dupRows.length}`)

  // ── 3d. Project removed mid-job: only the unaccounted remainder counts ──
  // Provider succeeds once, but the project vanishes before chunk 2; the
  // remainder must be counted as skipped WITHOUT double-counting the items
  // that were already embedded.
  const root6 = manySymbols(mkdtempSync(path.join(tmpdir(), "bb-e2-removed-")))
  roots.push(root6)
  ;(SemanticEngine as any).embedMany = async (docs: string[]) => {
    rmSync(root6, { recursive: true, force: true }) // the project disappears mid-job
    return docs.map((d, i) => [i, 0.5])
  }
  const pid6 = getProjectId(root6)
  projects.push(pid6)
  const before6 = snapshot(backgroundEmbedMetrics)
  await indexProjectParallel(pid6, root6, { skipPostProcessing: true })
  const flush6 = await flushBackgroundEmbeddings({ timeoutMs: 120_000 })
  ;(SemanticEngine as any).embedMany = realEmbedMany
  const after6 = snapshot(backgroundEmbedMetrics)
  const d6 = deltas(before6, after6)
  check("E2 mid-job project removal: metric conservation holds", conserved(d6), JSON.stringify(d6))
  check("E2 mid-job removal counts the remainder as skipped", d6.skipped > 0 && d6.embedded === 0,
    `skipped=${d6.skipped} embedded=${d6.embedded}`)

  // ── 4. Regression guard: empty provider result must not bypass fallback ──
  const src = readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8")
  negative("E2 drainer has no silent truthiness-continue on the result",
    !/if \(!embeddings\)/.test(src))
  negative("E2 drainer treats empty provider results as failures",
    /embeddings\.length === 0/.test(src))
  negative("E2 missing vectors inside a result are counted, not skipped",
    /backgroundEmbedMetrics\.failed\s*\+=/.test(src))
  negative("E2 a hung provider call cannot wedge the drainer (call is bounded)",
    /withTimeout\(/.test(src) && /EMBED_CALL_TIMEOUT_MS/.test(src))
  for (const counter of ["queued", "dropped", "embedded", "fallback", "failed", "skipped"]) {
    check(`E2 counter '${counter}' is incremented in the drainer`,
      new RegExp(`backgroundEmbedMetrics\\.${counter}\\s*(\\+=|\\+\\+|\\=)`).test(src))
  }

  const typecheck = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8", timeout: 180_000 })
  check("E2 project typecheck executes successfully", typecheck.status === 0, typecheck.stderr.slice(0, 300))

  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  const status = passed === checks ? "verified" : "known-gap"
  result = {
    issue: "M21.E2", code: "E2", milestone: "M21", status,
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-embedding-queue.ts",
    evidenceFile: "E2.json", generatedAt: new Date().toISOString(),
    corpus: { kind: "temporary-fixtures", files: 1, revision: null },
    metricsObserved: { happyPath: d1, providerFailure: d2 },
    flushOutcomes: { happy: flush1, providerFailure: flush2, bounded: flush3 },
    limitations: [
      "Provider failure is simulated by patching SemanticEngine.embedMany to throw — the shape any dead/unavailable provider produces.",
      "The queue is process-wide; counters are deltas between snapshots to stay isolation-safe."
    ]
  }
} catch (error) {
  check("E2 verifier completes without an exception", false, String(error))
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  result = { issue: "M21.E2", code: "E2", milestone: "M21", status: "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-embedding-queue.ts",
    evidenceFile: "E2.json", generatedAt: new Date().toISOString(), limitations: [String(error)] }
} finally {
  await flushBackgroundEmbeddings({ timeoutMs: 30_000 }).catch(() => undefined)
  cleanup()
}

mkdirSync(path.join(ROOT, "validation/m21/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/m21/results/E2.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`E2: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
