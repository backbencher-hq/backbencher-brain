// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_ask honesty gate: it asserts the properties that make the
//   numbers trustworthy — no NaN or fake similarity, no confidence the answer calls
//   unreliable, per-model coverage that equals what was compared, declared bounds on every
//   route, page sizes refused rather than clamped, and a read that leaves the index files
//   untouched. It also names the one cross-lane dependency that can still write.
// WHICH TOOL IT SERVES — bb_ask (read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — each check targets a defect that was measured rather than
//   theoretical (confidence beside a non-discriminative notice; coverage counted across
//   models; a read that created a WAL). The read-only check declares its dependency on the
//   shared content-search/symbol-search engines instead of passing vacuously: when those
//   two files still open read-write, the check passes ONLY with the files named as a
//   blocked-on-bb_search leg, and it fails if the tool's own files reintroduce a write.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/a7.json and
//   validation/tools/bb_ask/gates/, validation/tools/bb_ask/LATENCY.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/search/{quick-answer,semantic-search}.ts,
//   src/mcp/tools/bb_ask/{handler,descriptor}.ts.
// CONTRACTS IT MUST NOT BREAK — every check must be able to go red; a declared dependency
//   is named, never silently green.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { quickAnswer, ASK_LIMIT_REFUSAL } from "../../src/intelligence/search/quick-answer"
import { semanticVectorSearch } from "../../src/intelligence/search/semantic-search"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { Harness, noNanSimilarity } from "./harness"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const harness = new Harness({
  issue: "bb_ask honesty: similarity semantics, confidence, coverage per comparison space, bounds, page-size refusals, read-only access",
  code: "A7",
  tool: "bb_ask",
  title: "bb_ask: honesty gate (no fake numbers, declared bounds, read-only read path)",
  layers: ["unit", "integration"],
  decisions: {
    similarity: "a similarity is null (no score computed) or finite; never NaN and never 0 used as a fake score",
    confidence: "when the ranking is non-discriminative the handler publishes no numeric confidence",
    coverage: "comparableEmbeddings counts only the query model's space and equals the rows actually scanned when the scan is not capped",
    bounds: "every route's wire answer carries [bounds: returned/totalMatches/truncated]",
    pageSize: "0 and >100 are refused with the page-size sentence at the handler and at the engine, never clamped",
    readOnly: "a vector answer and an aggregate answer leave brain.db and its WAL byte-identical; a missing index is not created",
  },
  limitations: [
    "The lexical-fallback leg's read-only status depends on shared engines outside this lane; when they still open read-write the check passes only with those files named as a blocked-on-bb_search leg (reported in the result detail and the lane evidence).",
  ],
})

const textOf = (result: any) => (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")

// ── Fixture: identical bodies guarantee identical cosines (deterministic ranking) ──
const root = mkdtempSync(path.join(tmpdir(), "bb-ask-honesty-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
const identical = "export function requestHandler(request: string): string { return request + \"handled\" }\n"
writeFileSync(path.join(root, "src", "alpha.ts"), identical)
writeFileSync(path.join(root, "src", "beta.ts"), identical)
writeFileSync(path.join(root, "src", "delta.ts"), identical)
writeFileSync(path.join(root, "src", "gamma.ts"), "export function otherThing(): number { return 42 }\n")
await indexProjectParallel(projectId, root, {})
await flushBackgroundEmbeddings()
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (p: string) => (existsSync(p) ? { size: statSync(p).size, mtimeMs: Math.round(statSync(p).mtimeMs) } : null)
const files = () => ({ db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) })
// A read must not change the database bytes and must not append WAL frames. A zero-byte
// -wal sidecar (or an absent one) is the absence of frames, not a write — SQLite may
// create either; asserting on file existence would fail a correct read.
const walFrames = (files: ReturnType<typeof files>) => files.wal?.size ?? 0
const unchanged = (before: ReturnType<typeof files>, after: ReturnType<typeof files>) =>
  before.db?.size === after.db?.size && before.db?.mtimeMs === after.db?.mtimeMs && walFrames(after) === walFrames(before)

// ── 1. Similarity semantics: null or finite; never NaN, never a fake 0 ─────
{
  const vector = await semanticVectorSearch(projectId, "request handler")
  harness.negative("vector: every similarity is finite, never NaN", vector.results.every(noNanSimilarity), JSON.stringify(vector.results.map((r) => r.similarity).slice(0, 6)))
  harness.check("vector: results carry real numbers on the vector path", vector.results.every((r) => typeof r.similarity === "number"), JSON.stringify(vector.results.map((r) => r.similarity).slice(0, 3)))
}

// ── 2. Confidence honesty: a non-discriminative ranking publishes no number ──
{
  const res = await quickAnswer(projectId, "request handler")
  harness.check("ranking: the identical-body fixture is non-discriminative", res.retrieval?.discriminative === false, `discriminative=${res.retrieval?.discriminative} competitors=${res.retrieval?.nonDiscriminativeCompetitors}`)
  harness.check("confidence: capped and kind-labelled as non-discriminative", res.confidenceKind === "non-discriminative" && res.confidence <= 0.4, `${res.confidence}/${res.confidenceKind}`)
  harness.check("answer: says the ranking does not distinguish its top results", /does not distinguish its top results/.test(res.answer), res.answer.slice(0, 120))
  const handler = createToolHandlers().bb_ask
  const out: any = await handler({ query: "request handler" }, { projectId, projectPath: root } as any)
  const text = textOf(out)
  harness.negative("wire: no numeric confidence is printed beside the non-discriminative notice", !/^confidence: 0\.\d/m.test(text), text.split("\n").find((line) => line.startsWith("confidence:")) ?? text.slice(0, 120))
  harness.check("wire: the confidence line says it is not a measurement", text.includes("confidence: not a measurement"), "")
}

// ── 2b. A truncated page says it was truncated, and names why ─────────────
// Three identical candidates and a page of one: the page is a prefix, and the answer
// must say so with the page size named as the cause (not a scan cap).
{
  const limited = await quickAnswer(projectId, "request handler", { limit: 1 })
  harness.check("bounds: a page smaller than the match set is declared truncated", limited.bounds.truncated === true, JSON.stringify(limited.bounds))
  harness.check("bounds: the truncation reason names the page size", String(limited.bounds.truncationReason ?? "").includes("limit"), String(limited.bounds.truncationReason))
  harness.check("bounds: totalMatches reports the match set, not the page", (limited.bounds.totalMatches ?? 0) >= 3 && limited.bounds.returned === 1, JSON.stringify(limited.bounds))
}

// ── 3. Per-space coverage: comparable equals what was compared ─────────────
// A mixed-model index: two of the three symbols are re-embedded in a FOREIGN model
// space only, so the library holds three embedded entities while the local space has
// one comparable symbol. A model-blind coverage count would report three.
{
  const mixedRoot = mkdtempSync(path.join(tmpdir(), "bb-ask-mixed-model-"))
  const mixedId = getProjectId(mixedRoot)
  mkdirSync(path.join(mixedRoot, "src"), { recursive: true })
  writeFileSync(path.join(mixedRoot, "src", "one.ts"), identical)
  writeFileSync(path.join(mixedRoot, "src", "two.ts"), identical)
  writeFileSync(path.join(mixedRoot, "src", "three.ts"), identical)
  await indexProjectParallel(mixedId, mixedRoot, {})
  await flushBackgroundEmbeddings()
  const raw = await BrainDatabase.getRawInstance(mixedId)
  const embedded = raw.prepare("SELECT entity_id AS entityId FROM brain_semantic_embedding WHERE project_id = ? ORDER BY entity_id").all(mixedId) as Array<{ entityId: string }>
  const now = Date.now()
  const insert = raw.prepare(
    "INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
  const moved = embedded.slice(1)
  for (const row of moved) {
    raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id = ? AND entity_id = ?").run(mixedId, row.entityId)
    insert.run(`foreign:${row.entityId}`, mixedId, row.entityId, "symbol", "foreign-model-x", JSON.stringify(new Array(2048).fill(0.01)), 2048, "hash", "{}", 0.7, now, now, now)
  }
  const res = await semanticVectorSearch(mixedId, "request handler")
  harness.check("coverage: comparable count ignores foreign-model rows", res.comparison.comparableEmbeddings <= res.scan.scannedRows, `comparable=${res.comparison.comparableEmbeddings} scanned=${res.scan.scannedRows}`)
  harness.negative("coverage: library coverage is larger than the compared space on a mixed-model index", res.comparison.libraryEmbeddings > res.comparison.comparableEmbeddings, `library=${res.comparison.libraryEmbeddings} comparable=${res.comparison.comparableEmbeddings}`)
  harness.check("coverage: comparable count equals scanned rows when the scan is not capped", res.scan.capped || res.comparison.comparableEmbeddings === res.scan.scannedRows, `comparable=${res.comparison.comparableEmbeddings} scanned=${res.scan.scannedRows} capped=${res.scan.capped}`)
  harness.check("coverage: the compared model is named on the comparison facts", res.comparison.queryModel === res.metadata.queryModel, `${res.comparison.queryModel} vs ${res.metadata.queryModel}`)
  rmSync(mixedRoot, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(mixedId)), { recursive: true, force: true })
}

// ── 4. Read-only: a vector answer and an aggregate answer write nothing ────
{
  const before = files()
  await quickAnswer(projectId, "request handler")
  harness.negative("read-only: a vector answer leaves brain.db and its WAL unchanged", unchanged(before, files()), `before=${JSON.stringify(before)} after=${JSON.stringify(files())}`)
  const beforeAggregate = files()
  await quickAnswer(projectId, "how many functions are in this project")
  harness.negative("read-only: an aggregate answer leaves brain.db and its WAL unchanged", unchanged(beforeAggregate, files()), `before=${JSON.stringify(beforeAggregate)} after=${JSON.stringify(files())}`)
}

// ── 5. Read-only: a missing index is not created ──────────────────────────
{
  const missingId = "bb-ask-honesty-missing-" + Date.now()
  const missingDb = BrainDatabase.getDbPath(missingId)
  await quickAnswer(missingId, "how many functions are in this project")
  harness.negative("read-only: asking about an unindexed project creates no database", !existsSync(missingDb), missingDb)
}

// ── 6. Bounds on every route at the wire ──────────────────────────────────
{
  const handler = createToolHandlers().bb_ask
  const cases: Array<{ label: string; args: Record<string, unknown> }> = [
    { label: "aggregate", args: { query: "how many functions are in this project" } },
    { label: "retrieval", args: { query: "request handler" } },
    { label: "exact-name", args: { query: "requestHandler", limit: 1 } },
    { label: "no-match", args: { query: "xyzzyplugh" } },
  ]
  for (const entry of cases) {
    const out: any = await handler(entry.args, { projectId, projectPath: root } as any)
    const text = textOf(out)
    harness.check(`bounds: ${entry.label} answer declares returned/totalMatches/truncated`, /\[bounds: returned=\d+, totalMatches=(?:\d+|unknown), truncated=(?:true|false)/.test(text), text.split("\n").find((line) => line.includes("[bounds:")) ?? "missing")
  }
}

// ── 7. Page size: refused at the wire and at the engine, never clamped ────
{
  const handler = createToolHandlers().bb_ask
  for (const bad of [0, 101]) {
    const out: any = await handler({ query: "request handler", limit: bad }, { projectId, projectPath: root } as any)
    harness.negative(`page size ${bad}: handler refuses with the page-size sentence`, out?.isError === true && textOf(out).includes(ASK_LIMIT_REFUSAL), textOf(out).slice(0, 140))
    const engine = await quickAnswer(projectId, "request handler", { limit: bad })
    harness.negative(`page size ${bad}: engine refuses with the page-size sentence and does no retrieval`, engine.answer === ASK_LIMIT_REFUSAL && engine.sources.length === 0, engine.answer.slice(0, 120))
  }
}

// ── 8. Lexical fallback: no similarity printed; read-only leg declared ────
{
  const raw = await BrainDatabase.getRawInstance(projectId)
  raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id = ?").run(projectId)
  BrainDatabase.close(projectId)
  const fallback = await semanticVectorSearch(projectId, "request handling")
  harness.check("lexical: fallback similarity is null, not 0", fallback.results.every((result) => result.similarity === null), JSON.stringify(fallback.results.map((r) => r.similarity).slice(0, 5)))
  harness.check("lexical: fallback names its reason", typeof fallback.metadata.fallbackReason === "string", String(fallback.metadata.fallbackReason))
  const handler = createToolHandlers().bb_ask
  const before = files()
  const out: any = await handler({ query: "request handling" }, { projectId, projectPath: root } as any)
  const after = files()
  const wire = textOf(out)
  harness.negative("lexical: the wire answer prints no similarity number", !/similarity \d/.test(wire) && wire.includes("method=keyword-fallback"), wire.split("\n").find((line) => line.includes("[retrieval:")) ?? wire.slice(0, 140))

  // The read-only leg. The lexical fallback crosses two shared engines that are now
  // byte-read-only too; if this ever writes again the gate fails and names every
  // read-write open it can find, so the regression is diagnosable rather than blocked.
  const readWriteOpens = (rel: string): string[] => {
    const source = readFileSync(path.join(REPO_ROOT, rel), "utf8")
    const lines = source.split("\n")
    const hits: string[] = []
    lines.forEach((line, index) => {
      if (!line.includes("getRawInstance(")) return
      if (/readonly:\s*true/.test(line)) return
      hits.push(`${rel}:${index + 1}`)
    })
    return hits
  }
  const ownReadWrite = [...readWriteOpens("src/intelligence/search/quick-answer.ts"), ...readWriteOpens("src/intelligence/search/semantic-search.ts")]
  const sharedReadWrite = [...readWriteOpens("src/intelligence/search/content-search.ts"), ...readWriteOpens("src/intelligence/search/symbol-search.ts")]
  const wrote = !unchanged(before, after)
  harness.negative("read-only: the bb_ask engines open the index read-only", ownReadWrite.length === 0, ownReadWrite.join(", "))
  harness.check(
    "read-only: the lexical-fallback answer leaves brain.db and its WAL frames unchanged",
    !wrote,
    wrote ? `changed: before=${JSON.stringify(before)} after=${JSON.stringify(after)}; read-write opens found: ${[...ownReadWrite, ...sharedReadWrite].join(", ") || "none"}` : "",
  )
}

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(dbPath), { recursive: true, force: true })
harness.emit()
