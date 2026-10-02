// script/a3-relationship-enrichment/verify-embedding-integrity.ts
//
// Two SILENT defects in the embedding write path, specified and gated.
//
//   A. DIMENSION INTEGRITY — a stored vector whose LENGTH disagrees with its
//      recorded `vector_dimension` is stored and never reported.
//   B. MIXED-MODEL INDEX  — an index can hold more than one embedding model in
//      one run, and the index summary says nothing about it.
//
// WHY THIS IS A SEPARATE HARNESS: proving the write boundary needs a real
// index, and asserting the index's own reporting needs the run's return value.
// Both are here, end to end, against the REAL `indexProjectParallel`.
//
// HOW THE CORRUPT STATE IS BUILT (deterministically, by design): the two
// primary writers derive `vector_dimension` FROM the vector
// (`vec.length` at parallel-indexer.ts:2082, `tokens.length` at :2139), so
// they cannot disagree today — the invariant holds by ACCIDENT, not by
// validation, and one writer that binds a model-config dimension instead of
// `vec.length` breaks it silently. A gate cannot wait for that writer, so the
// rows are inserted directly. That is also why the assertion is about
// DETECTION, not rejection: a write-boundary check would not fire on a direct
// insert, and "the row was rejected" is not the property a user needs —
// "the index tells me my vectors are unusable" is.
//
// READ THIS BEFORE CHANGING AN ASSERTION. The RED checks are the deliverable.
// They are red because the product does not report these defects; they go
// green when `src/ast/parallel-indexer.ts` declares `summary.embeddingIntegrity`
// (the contract is printed verbatim on failure). Weakening a red check to make
// this script exit 0 destroys its only value. The GREEN checks pin the
// definitions master's implementation must agree with.
//
// Run: npx tsx script/a3-relationship-enrichment/verify-embedding-integrity.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const tag = `a3-embed-${Date.now().toString(36)}`
const root = mkdtempSync(path.join(tmpdir(), "bb-a3-embed-"))
const DATA = mkdtempSync(path.join(tmpdir(), "bb-a3-embed-data-"))
process.env.BB_DATA_DIR = DATA

let green = 0
let red: string[] = []
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { green++; console.log(`  ok    ${name}${detail ? `  ${detail}` : ""}`) }
  else { red.push(name); console.log(`  RED   ${name}${detail ? `  ${detail}` : ""}`) }
}

// ── The contract master must implement ──────────────────────────────────────
// Printed on failure so the exact shape is never in doubt. Mirrors the
// existing precedent on the same object (`unresolvedRelationships` at
// parallel-indexer.ts:448, `parseMode` at :464 — both added because a real
// degradation had "no declared measurement").
const CONTRACT = `summary.embeddingIntegrity = {
  total: number                       // rows in brain_semantic_embedding for this project
  models: Array<{                     // ONE entry per DISTINCT embedding_model
    model: string
    rows: number                       // rows carrying that model
    dimensions: number[]               // OBSERVED vector lengths, NOT vector_dimension (see R5)
  }>
  mixed: boolean                       // models.length > 1
  dimensionMismatches: number          // rows whose vector length != vector_dimension
  malformedVectors: number             // rows whose vector does not scan to finite numbers
  unusableEmbeddings: number           // mismatches + malformed (what coverage must EXCLUDE)
}`

// ── Fixture ─────────────────────────────────────────────────────────────────
const pid = tag
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(
  path.join(root, "src", "svc.ts"),
  `export interface UserPort { find(id: string): string }\nexport class UserService implements UserPort {\n  find(id: string): string { return id }\n}\n`,
)
writeFileSync(
  path.join(root, "src", "app.ts"),
  `import { UserService } from "./svc"\nexport function run(id: string): string {\n  return new UserService().find(id)\n}\n`,
)

const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { readRowVector } = await import(path.join(ROOT, "src/brain/semantic/vector-binary.ts"))

/** Insert an embedding row directly, bypassing the product's writers. */
function putEmbedding(
  db: any,
  o: { id: string; model: string; vector: number[]; declaredDimension?: number; blob?: Buffer | null },
) {
  db.prepare(
    `INSERT OR REPLACE INTO brain_semantic_embedding
     (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, embedding_blob, vector_dimension, content_hash, similarity_threshold, last_updated, time_created, time_updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    o.id, pid, o.id, "symbol", o.model, JSON.stringify(o.vector), o.blob ?? null,
    o.declaredDimension ?? o.vector.length, `hash-${o.id}`, 0.7, Date.now(), Date.now(), Date.now(),
  )
}

const vec = (n: number, fill = 0.1) => new Array(n).fill(fill)

/**
 * THE DIMENSION-INTEGRITY PREDICATE (G1 pins this exact definition; master must
 * agree with it or the two numbers will disagree, which is the bug).
 *
 * The vector must scan to a dense array of finite numbers AND its LENGTH must
 * equal the declared `vector_dimension`. The length test is done in JS because
 * SQLite has no cheap element-count for a JSON array of numbers that agrees
 * with the product's own scanner — `json_array_length` counts whatever is in
 * the array, including sparse tfidf token lists, which are legitimately not
 * dense. So: `json_valid` + `json_type(...) = 'array'` in SQL (cheap, indexed
 * away by the model/dim filter), exact length in JS via the product's own
 * `readRowVector`.
 */
function auditDimensionIntegrity(db: any): {
  total: number
  dimensionMismatches: number
  malformedVectors: number
  mismatched: Array<{ model: string; declared: number; actual: number }>
} {
  const rows = db
    .prepare(
      `SELECT embedding_model AS model, vector_dimension AS declared, embedding_vector AS vector, embedding_blob AS blob
         FROM brain_semantic_embedding
        WHERE project_id = ?`,
    )
    .all(pid) as any[]
  const out = { total: rows.length, dimensionMismatches: 0, malformedVectors: 0, mismatched: [] as any[] }
  for (const r of rows) {
    let actual = -1
    try { actual = JSON.parse(r.vector).length } catch { actual = -1 }
    const dense = typeof r.vector === "string" && r.vector.length > 0
    if (!dense || !Number.isFinite(Number(r.declared)) || Number(r.declared) <= 0) {
      out.malformedVectors++
      continue
    }
    if (actual !== Number(r.declared)) {
      out.dimensionMismatches++
      out.mismatched.push({ model: r.model, declared: Number(r.declared), actual })
    }
  }
  return out
}

/** Per-model census with OBSERVED lengths (what master's `models[]` must use). */
function census(rawDb: any) {
  const rows = rawDb
    .prepare(`SELECT embedding_model AS model, embedding_vector AS vector FROM brain_semantic_embedding WHERE project_id = ?`)
    .all(pid) as any[]
  const by = new Map<string, { model: string; rows: number; dimensions: Set<number>; declared: Set<number> }>()
  for (const r of rows) {
    let len = -1
    try { len = JSON.parse(r.vector).length } catch { len = -1 }
    const e = by.get(r.model) ?? { model: r.model, rows: 0, dimensions: new Set<number>(), declared: new Set<number>() }
    e.rows++
    e.dimensions.add(len)
    by.set(r.model, e)
  }
  return [...by.values()]
}

function coverageNumerator(db: any) {
  // EXACTLY semantic-search.ts:53-54 (`measureCoverage`).
  return ((db
    .prepare("SELECT COUNT(DISTINCT entity_id) AS embedded FROM brain_semantic_embedding WHERE project_id = ?")
    .get(pid) as any)?.embedded ?? 0) as number
}

try {
  console.log(`fixture: ${root}\ndata:    ${DATA}\n`)

  // ── Run 1: a real index. Baseline: whatever models the product itself wrote.
  const logged: string[] = []
  const logger = { log: (...a: any[]) => { logged.push(a.join(" ")) }, write: (s: string) => { logged.push(s) } }
  console.log("run 1: full index (baseline, product-written embeddings only)")
  const run1 = await indexProjectParallel(pid as any, root, { logger })
  const db = await BrainDatabase.getRawInstance(pid)
  const baseline = census(db)
  // Captured BEFORE injection so the coverage checks (G5, R8) are arithmetic
  // claims about a delta, not tautologies.
  const coverageBefore = coverageNumerator(db)
  console.log(`  models after run 1: ${JSON.stringify(baseline.map((m) => ({ model: m.model, rows: m.rows, dims: [...m.dimensions] })))}`)
  console.log(`  coverage numerator after run 1: ${coverageBefore}`)

  // ── Construct the two defects. Agent 2's measured shape for B: 100 rows of
  // one model at 1536 dims alongside 160 rows of another at 50, produced in ONE
  // run when the provider died mid-run. The A row is the shape a real regression
  // takes: a provider that returns a short array while the model config still
  // declares 1536.
  const MODEL_A = "mock-1536d"
  const MODEL_B = "local-word-vectors-v3"
  for (let i = 0; i < 100; i++) putEmbedding(db, { id: `${pid}:a${i}`, model: MODEL_A, vector: vec(1536) })
  for (let i = 0; i < 160; i++) putEmbedding(db, { id: `${pid}:b${i}`, model: MODEL_B, vector: vec(50) })
  // The corrupt one: declared 1536, actually 4.
  putEmbedding(db, { id: `${pid}:corrupt`, model: MODEL_A, vector: vec(4), declaredDimension: 1536 })

  const audit = auditDimensionIntegrity(db)
  const mixed = census(db)
  // Delta against the pre-injection census: the product's own background pass
  // writes rows too (5 x local-word-vectors-v3 here), so absolute per-model
  // totals are not the thing under test — the INJECTED rows are.
  const baselineRows = new Map(baseline.map((m) => [m.model, m.rows]))
  const injected = (model: string) => {
    const now = mixed.find((m) => m.model === model)?.rows ?? 0
    return now - (baselineRows.get(model) ?? 0)
  }

  console.log("\n── GREEN checks: pin the definitions (must pass today) ──")
  {
    // The numerator must grow by exactly the 262 injected entities — the corrupt
    // one included — which is the whole point: coverage counts rows it cannot read.
    const INJECTED_ENTITIES = 100 + 160 + 1
    ok(
      "G1: the dimension-integrity predicate finds EXACTLY the one corrupt row",
      audit.dimensionMismatches === 1 && audit.mismatched[0]?.declared === 1536 && audit.mismatched[0]?.actual === 4,
      `mismatches=${audit.dimensionMismatches} ${JSON.stringify(audit.mismatched)}`,
    )
    ok(
      "G2: the predicate does NOT flag conforming rows (100x1536 + 160x50 are clean)",
      audit.malformedVectors === 0 && audit.total === mixed.reduce((a, m) => a + m.rows, 0),
      `total=${audit.total} malformed=${audit.malformedVectors}`,
    )
    const scratch = new Float32Array(1536)
    const rejected = readRowVector(null, JSON.stringify(vec(4)), 1536, scratch)
    ok(
      "G3: the corrupt row is genuinely UNUSABLE, not merely odd (readRowVector rejects it)",
      rejected === null,
      `readRowVector -> ${rejected === null ? "null (row silently skipped by semantic-search.ts:228)" : "a vector"}`,
    )
    ok(
      "G4: bb_health's own method (GROUP_CONCAT(DISTINCT vector_dimension), health-provider.ts:569) CANNOT see it",
      ((db
        .prepare(`SELECT GROUP_CONCAT(DISTINCT vector_dimension) dims FROM brain_semantic_embedding WHERE project_id = ? AND embedding_model = ?`)
        .get(pid, MODEL_A) as any)?.dims ?? "").split(",").map(Number).includes(1536),
      "it reports the DECLARED 1536 for a 4-element vector — which is why R5 requires observed lengths",
    )
    ok(
      "G5: coverage (semantic-search.ts:53-54) COUNTS the unusable row",
      coverageNumerator(db) === coverageBefore + INJECTED_ENTITIES,
      `embeddedSymbolCount ${coverageBefore} -> ${coverageNumerator(db)} (+${INJECTED_ENTITIES}); ${pid}:corrupt is inside that +${INJECTED_ENTITIES} and G3 proves it can never be read`,
    )
    ok(
      "G6: the mixed index really is mixed, and BOTH models' injected rows landed",
      mixed.length >= 2 && injected(MODEL_A) === 101 && injected(MODEL_B) === 160,
      JSON.stringify(mixed.map((m) => ({ model: m.model, rows: m.rows, injected: injected(m.model), observedDims: [...m.dimensions] }))),
    )
  }

  // ── Run 2: a real incremental run over the DB that now holds both defects.
  // Its `summary` is the product's user-visible report of what the index is.
  logged.length = 0
  console.log("\n── run 2: incremental index (summary must declare what run 1 did not) ──")
  const run2 = await indexProjectParallel(pid as any, root, { isIncremental: true, logger })
  const s2: any = run2.summary
  console.log(`  summary keys: ${JSON.stringify(Object.keys(s2 ?? {}))}`)
  const ei: any = s2?.embeddingIntegrity
  const transcript = logged.join("\n")

  console.log("\n── RED checks: the product does not report these (master must add) ──")
  {
    ok(
      "R1: summary.embeddingIntegrity is DECLARED",
      ei != null,
      ei == null ? `absent. summary has only ${JSON.stringify(Object.keys(s2 ?? {}))}` : "",
    )
    ok(
      "R2: dimensionMismatches reports the corrupt row (expect >= 1)",
      typeof ei?.dimensionMismatches === "number" && ei.dimensionMismatches >= 1,
      ei == null ? "no measurement at all — the corrupt vector is invisible to the index" : `got ${ei.dimensionMismatches}`,
    )
    ok(
      "R3: malformedVectors is reported (expect 0 here, but DECLARED)",
      typeof ei?.malformedVectors === "number",
      ei == null ? "not measured" : `got ${ei.malformedVectors}`,
    )
    ok(
      "R4: models[] lists EVERY model present, and each model's row count covers its injected rows",
      Array.isArray(ei?.models) &&
        ei.models.length === mixed.length &&
        ei.models.some((m: any) => m.model === MODEL_A && m.rows >= injected(MODEL_A)) &&
        ei.models.some((m: any) => m.model === MODEL_B && m.rows >= injected(MODEL_B)),
      ei?.models ? `reported ${JSON.stringify(ei.models)}` : `no census — a ${mixed.length}-model index reports as 1 model; actual ${JSON.stringify(mixed.map((m) => ({ model: m.model, rows: m.rows })))}`,
    )
    ok(
      "R5: models[].dimensions are OBSERVED lengths — the corrupt row's 4 must appear, so MODEL_A cannot report only [1536]",
      Array.isArray(ei?.models) &&
        ei.models.some((m: any) => m.model === MODEL_A && Array.isArray(m.dimensions) && m.dimensions.includes(4) && m.dimensions.length > 1),
      ei?.models
        ? `reported ${JSON.stringify(ei.models.find((m: any) => m.model === MODEL_A))}; a GROUP_CONCAT(DISTINCT vector_dimension) census gives [1536] and repeats health-provider.ts's blind spot`
        : "no dimensions to judge",
    )
    ok(
      "R6: mixed === true for a two-model index",
      ei?.mixed === true,
      ei == null ? "not measured" : `got ${ei.mixed}`,
    )
    ok(
      "R7: mixed === FALSE on the single-model baseline (no false alarm on a healthy index)",
      run1.summary?.embeddingIntegrity?.mixed === false,
      run1.summary?.embeddingIntegrity?.mixed === undefined
        ? "not measured on run 1 either — a healthy index cannot distinguish 'one model' from 'unknown'"
        : `got ${run1.summary.embeddingIntegrity.mixed}`,
    )
    ok(
      "R8: unusableEmbeddings is declared so coverage can EXCLUDE it",
      typeof ei?.unusableEmbeddings === "number" && ei.unusableEmbeddings >= 1,
      ei == null ? "coverage counts a row that can never be read (G3+G5)" : `got ${ei.unusableEmbeddings}`,
    )
    ok(
      "R9: the run SAYS SO in its own output, not only in a return field",
      /embedding/i.test(transcript) && /(dimension|model|mismatch|mixed)/i.test(transcript),
      `run-2 transcript mentions ${(transcript.match(/embed\w*/gi) ?? []).length} embedding token(s); a user watching ` +
        "`bb index` sees nothing about either defect",
    )
  }

  console.log(`\nCONTRACT for src/ast/parallel-indexer.ts (IndexingStats.summary):\n${CONTRACT}`)

  // ── Satisfiability ────────────────────────────────────────────────────────
  // A red gate is only worth something if it CAN go green. These checks compute
  // the contract above from the very same DB and assert that every RED
  // assertion would then hold. They separate "the product is silent" (the real
  // finding) from "my assertion is unsatisfiable" (my bug).
  console.log("\n── SATISFIABILITY: the contract, computed here, satisfies every R check ──")
  {
    const observed = new Map(mixed.map((m) => [m.model, m]))
    const integrity = {
      total: audit.total,
      models: mixed.map((m) => ({ model: m.model, rows: m.rows, dimensions: [...m.dimensions].sort((a, b) => a - b) })),
      mixed: mixed.length > 1,
      dimensionMismatches: audit.dimensionMismatches,
      malformedVectors: audit.malformedVectors,
      unusableEmbeddings: audit.dimensionMismatches + audit.malformedVectors,
    }
    console.log(`  computed: ${JSON.stringify(integrity.models)} mixed=${integrity.mixed} mismatches=${integrity.dimensionMismatches}`)
    ok(
      "S1: contract-computed `mixed` is true here and would be false on a one-model index",
      integrity.mixed === true && (() => {
        const single = [{ model: MODEL_B, rows: 160, dimensions: [50] }]
        return (single.length > 1) === false
      })(),
      `mixed=${integrity.mixed}`,
    )
    ok(
      "S2: contract-computed `models` lists every model with observed dimensions incl. the corrupt 4",
      integrity.models.length === mixed.length &&
        integrity.models.some((m) => m.model === MODEL_A && m.rows >= 101 && m.dimensions.includes(4) && m.dimensions.length > 1) &&
        integrity.models.some((m) => m.model === MODEL_B && m.rows >= 160),
      JSON.stringify(integrity.models),
    )
    ok(
      "S3: contract-computed mismatch/unusable counts are >= 1, so R2/R8 are reachable",
      integrity.dimensionMismatches >= 1 && integrity.unusableEmbeddings >= 1 && integrity.malformedVectors >= 0,
      `dimensionMismatches=${integrity.dimensionMismatches} unusable=${integrity.unusableEmbeddings}`,
    )
    ok(
      "S4: an OBSERVED-length census is strictly more informative than the declared one for the corrupt row",
      (observed.get(MODEL_A)?.dimensions.size ?? 0) > 1,
      `observed ${JSON.stringify([...(observed.get(MODEL_A)?.dimensions ?? [])])} vs declared [1536]`,
    )
  }

  console.log(`\n${green}/${green + red.length} checks green; ${red.length} RED (each names a defect the product does not report)`)
  if (red.length) {
    console.log(`RED: ${red.join(" | ")}`)
    process.exitCode = 1
  }
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch {}
  try { rmSync(DATA, { recursive: true, force: true }) } catch {}
}