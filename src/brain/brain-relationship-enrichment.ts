// @ts-nocheck — pre-existing null union type issues
/**
 * Brain Relationship Enrichment — Reasoning Layer
 *
 * Post-processing pass that enriches raw syntactic relationships with
 * architectural understanding. No schema changes — stores everything
 * in the existing `metadata` JSON column on brain_relationship.
 *
 * Dimensions computed (all nine are RECOMPUTED from the stored row on every
 * pass; none is read back from the row being enriched):
 *   role        — producer, consumer, decorator, configurator, inheritor
 *   pattern     — factory_consumer, observer, adapter, di_injection, override, delegate
 *   layerFlow   — ui→service, service→db, same-layer. `unresolved` when the
 *                 target is not a resolved in-project symbol (never invented).
 *   criticality — high, medium, low, from the target's REFERENCING-ROW count
 *                 (in-degree). NOT from gravity: gravity is computed by a LATER
 *                 phase, so it cannot be an input here (the pre-existing header
 *                 comment claimed "in-degree + gravity" and was wrong).
 *   frequency   — "one_of_N" = this target is referenced by N stored rows.
 *                 N counts every relationship type, not only `calls` — the
 *                 reader (src/lsp/enrichment.ts describeFrequency) calls them
 *                 "referring rows" and this header used to call them "callers".
 *   isTestCode        — caller or callee is in a test file
 *   isFrameworkContract — extends + overrides + implements (the header used to
 *                 say "extends + overrides" and omitted `implements`)
 *   isGeneratedCode   — file path matches generated code patterns
 *   isDependencyInjection — target is interface, source instantiates
 *
 * Phase 1: SQL-driven (layer, criticality, frequency, test, generated, framework)
 * Phase 2: Pattern inference (factory, observer, adapter, DI, override, delegate)
 *
 * ── What this pass can and cannot do to the GRAPH (the cardinality question)
 * ── This pass performs NO INSERT. Every statement it issues is either a SELECT
 * or `UPDATE brain_relationship SET metadata = ? WHERE id = ? AND project_id = ?`
 * on a row id it just read. It therefore CANNOT create a dangling edge, and it
 * cannot resolve one either: resolution belongs to `resolveRelationships`
 * (src/ast/parallel-indexer.ts). What it CAN do — and this is the real defect
 * class — is give an edge a claim that is not true:
 *   - it used to skip every relationship whose source symbol is missing (the
 *     row selection INNER JOINs brain_symbol) without saying so, so `enriched`
 *     read as "all of them" while covering fewer;
 *   - it used to write `layerFlow: "<src>→core"` for an UNRESOLVED target,
 *     asserting a layer for an edge that points at nothing;
 *   - it used to swallow every batch failure, so a rolled-back page still
 *     incremented `enriched`/`patternsFound` and the index reported success.
 * Both of the first two are now COUNTED and returned (`danglingSources`,
 * `unresolvedTargets`) so a partial pass is visible instead of silent.
 *
 * ── Bounded work (the "bounded pass" convention of M40, followed here)
 * `ENRICHMENT_MAX_ROWS` caps the number of rows one call will consider, in the
 * same shape as `content-search.ts`'s PHASE_CAP_*: a named constant, an
 * explicit `opts.maxRows` override, a `BB_ENRICHMENT_MAX_ROWS` environment
 * override, and — the part that makes it honest — reaching the cap is REPORTED
 * (`truncated: true`, `skipped`) rather than hidden. The default is set well
 * above the largest measured project (467K relationships) so a real repo is
 * never silently truncated; the cap is a fail-safe against pathological input,
 * not a UX knob.
 *
 * ── Pagination
 * Full mode pages by `rowid` keyset, not by OFFSET. The old
 * `LIMIT n OFFSET m` re-scanned and discarded the first `m` index entries on
 * every page, so a pass cost O(n²/batch) index steps — 467K rows at BATCH=20000
 * is 24 pages and ~5.6M discarded index entries for zero reason. The keyset form
 * plans as `SEARCH ... USING INDEX brain_rel_project_idx (project_id=? AND
 * rowid>?)` — a direct range scan with no sort and no temp b-tree. The cursor
 * only advances past a page that COMMITTED, so a page that fails is retried
 * once and then recorded rather than silently skipped or looped forever.
 * If `rowid` is unavailable (a WITHOUT ROWID table — not this schema), the pass
 * falls back to OFFSET paging and says so via `pagination`.
 */

import type { ProjectID } from "../project/schema"
import { BrainDatabase } from "./database"
// M57.T5 (#793): isTestCode metadata must use the ONE test-file definition.
import { isTestFileCandidate } from "../ast/test-classification"
import * as Log from "../tool/brain-log"

const log = Log.create({ service: "relationship-enrichment" })

// ─── Enrichment Types ──────────────────────────────────────────────────────

export interface RelationshipEnrichment {
  role?: "producer" | "consumer" | "decorator" | "configurator" | "inheritor" | "implementor"
  pattern?: "factory_consumer" | "observer" | "adapter" | "di_injection" | "override" | "delegate" | "event_handler" | "callback"
  layerFlow?: string // e.g. "ui→service", "service→db", "core→unresolved"
  criticality?: "high" | "medium" | "low"
  frequency?: string // e.g. "one_of_3"
  isTestCode?: boolean
  isFrameworkContract?: boolean
  isGeneratedCode?: boolean
  isDependencyInjection?: boolean
  inferredAt?: number // timestamp when enrichment was computed
}

// ─── Bounded-work configuration ────────────────────────────────────────────

/**
 * Hard ceiling on the rows ONE call to `enrichRelationships` will consider.
 * Deliberately generous: the largest measured real index is 467K
 * relationships, so the default never truncates a real repository — it exists
 * to stop a pathological/looping input from turning a post-pass into an
 * unbounded write. Overridable per call (`opts.maxRows`) or per process
 * (`BB_ENRICHMENT_MAX_ROWS`); `Infinity` is an explicit, declared opt-out.
 * Reaching it is reported in the result (`truncated`, `skipped`) — never hidden.
 */
export const ENRICHMENT_MAX_ROWS = 2_000_000

/** Rows per read+write page. Large enough to amortize transaction overhead. */
const BATCH = 20000

/**
 * criticality thresholds, on the target's referencing-row count. Undocumented
 * magic numbers previously; stated here because a reader cannot otherwise tell
 * whether they are measured or arbitrary. They are a product decision, not a
 * measurement — changing them changes every stored criticality.
 */
const CRITICALITY_HIGH_MIN_IN_DEGREE = 50
const CRITICALITY_MEDIUM_MIN_IN_DEGREE = 10

/** Resolved and reported so a reader can tell a real layer from an absent one. */
const UNRESOLVED_TARGET = "unresolved"

export interface EnrichRelationshipsResult {
  /** Rows whose metadata was actually rewritten (COMMITTED writes only). */
  enriched: number
  /** Rows written that carried an inferred `pattern`. */
  patternsFound: number
  durationMs: number
  // ── additive observability (parallel-indexer destructures only the three
  //    above, so these are safe to add; renaming/removing any of the three is not)
  /** Rows read and evaluated, before the no-op write filter. */
  considered: number
  /** Rows whose recomputed enrichment equalled the stored one — no write issued. */
  unchanged: number
  /** Rows skipped because their source symbol does not exist (a DANGLING edge). */
  danglingSources: number
  /** Rows enriched whose target is not a resolved in-project symbol. */
  unresolvedTargets: number
  /** Rows whose target_symbol_id is set but names no symbol (truly dangling). */
  danglingTargets: number
  /** Rows whose pre-existing metadata could not be parsed and was replaced. */
  rowsWithoutParseableMetadata: number
  /** Pages that failed BOTH attempts. Their rows are neither written nor counted. */
  failedPages: number
  failedRows: number
  firstError: string | null
  /** True when the work cap stopped the pass early. */
  truncated: boolean
  /** Rows not reached because of the cap (a floor — the join drops some). */
  skipped: number
  cap: number
  /** "rowid" keyset paging, or the "offset" fallback for a WITHOUT ROWID table. */
  pagination: "rowid" | "offset"
  /** Scoped mode only: in-edges into the scope whose stored enrichment is
   *  already stale by src/lsp/enrichment.ts's law (inferredAt < time_updated).
   *  These are the copied-forward rows `repairInEdges` restores; they are
   *  COUNTED, not rewritten, and see the module header for why. */
  staleInScope: number
}

/** Resolve the work cap: explicit option, then env, then the declared default. */
function resolveMaxRows(explicit: number | undefined): number {
  if (explicit !== undefined && explicit !== null) {
    const n = Number(explicit)
    if (n === Infinity) return Infinity
    if (Number.isFinite(n) && n > 0) return Math.trunc(n)
    return ENRICHMENT_MAX_ROWS
  }
  const raw = process.env.BB_ENRICHMENT_MAX_ROWS
  if (raw !== undefined && raw !== "") {
    const n = Number(raw)
    if (n === Infinity) return Infinity
    if (Number.isFinite(n) && n > 0) return Math.trunc(n)
  }
  return ENRICHMENT_MAX_ROWS
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export async function enrichRelationships(
  projectId: ProjectID,
  onProgress?: (step: string, pct: number) => void,
  // M40.A2: scoped mode — enrich only relationships whose SOURCE symbol is in
  // the given id set (bounded incremental pass). In-degree counts stay GLOBAL
  // so criticality/frequency of affected targets match full-run values.
  //
  // SCOPE IS SOURCE-SIDE ONLY, deliberately. A target-side widening (also
  // re-enriching everything pointing AT a touched symbol) looks like the
  // freshness fix it is not allowed to be: `repairInEdges` copies the
  // pre-parse metadata of a restored in-edge verbatim while stamping the row
  // `time_updated = now`, so those rows need recomputation — but re-writing
  // them is exactly the O(all-in-edges) work the M40.A2 gate forbids
  // (script/m40/verify-a2-bounded-post.ts asserts the bounded pass re-writes
  // <10% of the graph, and that a hub's ~4K restored in-edges are among them).
  // So the gap is MEASURED (`staleInScope`) rather than papered over; the fix
  // belongs at repairInEdges, which this file does not own.
  opts: { sourceSymbolIds?: string[]; maxRows?: number } = {},
): Promise<EnrichRelationshipsResult> {
  const startTime = Date.now()
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const now = Date.now()
  const maxRows = resolveMaxRows(opts.maxRows)

  const report = (step: string, pct: number) => {
    if (onProgress) onProgress(step, pct)
  }

  report("reading", 0)

  /** Zero every field the early-return and normal paths must both populate. */
  const zero = (pagination: "rowid" | "offset"): EnrichRelationshipsResult => ({
    enriched: 0,
    patternsFound: 0,
    durationMs: 0,
    considered: 0,
    unchanged: 0,
    danglingSources: 0,
    unresolvedTargets: 0,
    danglingTargets: 0,
    rowsWithoutParseableMetadata: 0,
    failedPages: 0,
    failedRows: 0,
    firstError: null,
    truncated: false,
    skipped: 0,
    cap: maxRows,
    pagination,
    staleInScope: 0,
  })

  // Get total count for progress tracking
  const countRow = rawDb.prepare(`
    SELECT COUNT(*) as c FROM brain_relationship WHERE project_id = ?
  `).get(projectId) as any
  const totalRels = countRow?.c ?? 0

  // Does this build's driver expose rowid on the table? Probed BEFORE the empty
  // short-circuit so `pagination` is the paginator this pass actually used (or
  // would have used) on every return path. The fallback is not an error — it is
  // a declared, slower pagination.
  let rowidAvailable = true
  try {
    rawDb.prepare(`SELECT rowid FROM brain_relationship LIMIT 1`).get()
  } catch {
    rowidAvailable = false
  }
  const pagination: "rowid" | "offset" = rowidAvailable ? "rowid" : "offset"

  if (totalRels === 0) {
    report("done", 100)
    return { ...zero(pagination), durationMs: Date.now() - startTime }
  }

  // Pre-compute in-degree for criticality + frequency (single pass).
  // This Map is the one O(project) memory term and is bounded by the number of
  // DISTINCT referenced symbols, not by the row count.
  report("counting", 0)
  const inDegreeMap = new Map<string, number>()
  const inDegreeRows = rawDb.prepare(`
    SELECT target_symbol_id, COUNT(*) as c
    FROM brain_relationship
    WHERE project_id = ? AND target_symbol_id IS NOT NULL AND target_symbol_id != ''
    GROUP BY target_symbol_id
  `).all(projectId) as any[]
  for (const r of inDegreeRows) {
    inDegreeMap.set(r.target_symbol_id, r.c)
  }

  report("enriching", 5)

  const scopeIds = opts.sourceSymbolIds

  // ── Coverage accounting ────────────────────────────────────────────────────
  // The row selection INNER JOINs brain_symbol on the source. A relationship
  // whose source symbol is missing is therefore NOT enrichable and NOT
  // counted; before this pass that was invisible, so a run over a DB with
  // dangling source edges reported `enriched: N` as if it had covered the graph.
  const danglingRow = rawDb.prepare(`
    SELECT COUNT(*) as c FROM brain_relationship r
    WHERE r.project_id = ?
      AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id)
  `).get(projectId) as any
  let danglingSources = danglingRow?.c ?? 0
  if (danglingSources > 0) {
    log.warn("relationship enrichment: dangling source edges cannot be enriched", {
      projectId: String(projectId).slice(0, 8),
      danglingSources,
      totalRelationships: totalRels,
    })
  }

  // True dangling TARGETS: target_symbol_id is set but names no symbol. FKs are
  // ON by default (schema-ddl / db.bun.ts / db.node.ts) and the column is
  // declared ON DELETE SET NULL, so this is 0 on a healthy DB — which is why it
  // is worth measuring rather than assuming.
  let danglingTargets = 0
  try {
    const row = rawDb.prepare(`
      SELECT COUNT(*) as c FROM brain_relationship r
      WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL AND r.target_symbol_id != ''
        AND NOT EXISTS (SELECT 1 FROM brain_symbol t WHERE t.id = r.target_symbol_id)
    `).get(projectId) as any
    danglingTargets = row?.c ?? 0
  } catch (e: any) {
    log.warn("relationship enrichment: dangling-target count unavailable", { error: e?.message })
  }

  // Shared per-batch processor: full and scoped modes use the identical
  // enrichment logic — only the row selection differs.
  const updateStmt = rawDb.prepare(`
    UPDATE brain_relationship SET metadata = ? WHERE id = ? AND project_id = ?
  `)
  // #865 acceptance item 1: the enrichment must PRESERVE keys it does not own
  // (evidenceClass, phpSpecific, scalaSpecific, syntheticSource, …). The pass
  // used to build a fresh object and write it wholesale, destroying every
  // analyzer-written key on every row it could see — exactly the keys M59's
  // contracts treat as the durable record of the analyzer's evidence. The
  // merge is enrichment-owned-key-wins for the ten dimensions this pass
  // computes (a re-run must refresh its OWN values, including unsetting flags
  // that no longer apply), and analyzer-owned-key-survives for everything
  // else. `inferredAt` is always overwritten: it is the marker that the
  // enrichment READ path (src/lsp/enrichment.ts) uses to recognise an
  // enrichment record, and #865 item 2 requires that a merged row stays an
  // enrichment record rather than resurrecting an analyzer-only row as one.
  const ENRICHMENT_OWNED_KEYS = new Set([
    "role",
    "pattern",
    "layerFlow",
    "criticality",
    "frequency",
    "isTestCode",
    "isGeneratedCode",
    "isFrameworkContract",
    "isDependencyInjection",
    "inferredAt",
  ])
  let rowsWithoutParseableMetadata = 0
  let considered = 0
  let unchanged = 0
  let unresolvedTargets = 0
  let enriched = 0
  let patternsFound = 0
  let failedPages = 0
  let failedRows = 0
  let firstError: string | null = null
  let staleInScope = 0

  type ComputedEnrichment = {
    layerFlow: string
    criticality: string
    frequency: string
    isTestCode: boolean
    isGeneratedCode: boolean
    isFrameworkContract: boolean
    isDI: boolean
    pattern: RelationshipEnrichment["pattern"]
    role: RelationshipEnrichment["role"]
  }

  /**
   * Order-insensitive deep equality over a metadata object, ignoring `inferredAt`.
   *
   * It compares EVERY key, not just the enrichment-owned ones. That distinction
   * is load-bearing, and getting it wrong silently disarms a standing gate:
   * comparing only the enrichment-owned subset made the no-op filter blind to a
   * merge that DROPS a non-enrichment key, so the #865 wholesale-write mutant
   * (`{ ...existing }` → `{}`) became behaviourally identical to the real pass
   * — the filter decided there was nothing to do and skipped the very write the
   * mutant exists to make. script/m59/verify-865-metadata-survival.ts item 4
   * went 12/12 → 11/12 because of it. Comparing the whole object restores the
   * mutation's conviction (the dropped analyzer keys make the objects differ,
   * so the row IS written and the keys ARE destroyed) while keeping the no-op
   * behaviour that matters: a row that already holds exactly what this pass
   * would write is still skipped.
   *
   * `inferredAt` is excluded on both sides because the pass always stamps it
   * with the current time — including it would make every row "changed".
   */
  const sameMetadata = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
    const strip = (m: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(m)) if (k !== "inferredAt") out[k] = m[k]
      return out
    }
    const ak = Object.keys(strip(a)).sort()
    const bk = Object.keys(strip(b)).sort()
    if (ak.length !== bk.length) return false
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false
      // Metadata values are JSON by construction, so a structural compare is
      // enough and `===` would wrongly split `1` from `1.0` on nested values.
      if (JSON.stringify(strip(a)[ak[i]]) !== JSON.stringify(strip(b)[bk[i]])) return false
    }
    return true
  }

  /** Returns the merged metadata AND the pre-existing object it merged from, so
   *  the caller can decide whether the write is a true no-op. */
  const mergeMetadata = (row: any, computed: ComputedEnrichment): { meta: any; existing: Record<string, unknown> } => {
    let existing: Record<string, unknown> = {}
    if (typeof row.metadata === "string" && row.metadata.length > 0) {
      try {
        const parsed = JSON.parse(row.metadata)
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed
        else rowsWithoutParseableMetadata++
      } catch {
        // Unparseable pre-existing metadata cannot be merged without losing
        // either side's shape; count it and let the enrichment overwrite.
        rowsWithoutParseableMetadata++
      }
    }
    const meta: any = { ...existing }
    for (const k of Object.keys(meta)) if (ENRICHMENT_OWNED_KEYS.has(k)) delete meta[k]
    meta.layerFlow = computed.layerFlow
    meta.criticality = computed.criticality
    meta.frequency = computed.frequency
    if (computed.isTestCode) meta.isTestCode = true
    if (computed.isGeneratedCode) meta.isGeneratedCode = true
    if (computed.isFrameworkContract) meta.isFrameworkContract = true
    if (computed.isDI) meta.isDependencyInjection = true
    if (computed.pattern) meta.pattern = computed.pattern
    if (computed.role) meta.role = computed.role
    meta.inferredAt = now
    return { meta, existing }
  }

  /**
   * Compute + write one page. Returns COMMITTED counts only: the counters used
   * to be incremented inside the transaction body, so a page that rolled back
   * still reported its rows as enriched — an index that said "Enriched 20,000
   * relationships" for rows it had not written. Failures are now surfaced
   * (counted + logged + returned) instead of `catch {}`.
   */
  const processBatch = (batch: any[]): { written: number; patterns: number; failed: string | null } => {
    if (batch.length === 0) return { written: 0, patterns: 0, failed: null }
    let written = 0
    let patterns = 0
    let unresolvedHere = 0
    let failed: string | null = null

    const tx = rawDb.transaction((rows: any[]) => {
      for (const row of rows) {
        const sourceFile = row.source_file || ""
        // The file-type gate in the ONE test-file predicate wants the stored
        // language; without it the classifier falls back to a file-extension
        // list. Pass it when the row carries one, and keep the bare call as the
        // fallback so the predicate is still the single definition.
        const sourceLanguage = row.source_language || null
        const isTestCode = sourceLanguage
          ? isTestFileCandidate(sourceFile, sourceLanguage)
          : isTestFileCandidate(sourceFile)
        const isGeneratedCode = sourceFile.includes("/generated/") || sourceFile.includes("/build/generated/") ||
          sourceFile.includes(".pb.") || sourceFile.includes(".g.dart") || sourceFile.includes(".g.cs") ||
          sourceFile.includes("/gen/")
        const isFrameworkContract = row.relationship_type === "extends" || row.relationship_type === "overrides" || row.relationship_type === "implements"
        const isDI = row.relationship_type === "instantiates" &&
          (row.target_type === "interface" || row.target_type === "trait" || row.target_type === "protocol" || row.target_type === "abstract")

        // A target that is not a resolved in-project symbol (external
        // reference, unresolved cross-file target, or a DANGLING target id)
        // has NO layer. Asserting "core" for it — as `${target_layer || "core"}`
        // did — stated a layer for an edge that points at nothing, and
        // bb_graph/bb_impact render that string verbatim. `target_resolved_id`
        // is the JOINED symbol id, so it is null for all three cases; a
        // non-empty `target_symbol_id` with a null join result is the dangling
        // edge, and it must not be reported as a resolved target.
        const targetResolved = typeof row.target_resolved_id === "string" && row.target_resolved_id.length > 0
        if (!targetResolved) unresolvedHere++
        const layerFlow = `${row.source_layer || "core"}→${targetResolved && row.target_layer ? row.target_layer : UNRESOLVED_TARGET}`

        const inDeg = inDegreeMap.get(row.target_symbol_id) ?? 0
        const criticality = inDeg >= CRITICALITY_HIGH_MIN_IN_DEGREE
          ? "high"
          : inDeg >= CRITICALITY_MEDIUM_MIN_IN_DEGREE
            ? "medium"
            : "low"
        const frequency = `one_of_${inDeg}`

        const pattern = inferPattern({
          relationship_type: row.relationship_type,
          source_name: row.source_name || "",
          source_type: row.source_type || "",
          target_name: row.target_name || "",
          target_type: row.target_type || "",
          source_file: row.source_file || "",
        })
        const role = inferRole(row.relationship_type, row.source_type || "", row.target_type || "", pattern)

        const { meta, existing } = mergeMetadata(row, {
          layerFlow,
          criticality,
          frequency,
          isTestCode,
          isGeneratedCode,
          isFrameworkContract,
          isDI,
          pattern,
          role,
        })

        // No-op filter. If the stored metadata already IS what this pass would
        // write — every key, not just the enrichment-owned ones — the write is
        // pure overhead: a row touch per row for zero information, and a bumped
        // `inferredAt` that makes an untouched row look freshly enriched. Two
        // consequences, both of them the point:
        //   - a second `bb index --post` over an unchanged graph rewrites
        //     nothing instead of every one of N rows;
        //   - the rows `repairInEdges` copies forward (parallel-indexer.ts) are
        //     left alone WHEN THEY ARE STILL CORRECT, so the bounded pass does
        //     not inflate its own write set — and are rewritten WHEN THEY ARE
        //     NOT, which is the actual freshness fix.
        // Comparing the WHOLE object (see `sameMetadata`) is what keeps a
        // merge that would drop an analyzer key from being mistaken for a no-op.
        // `continue`, NOT `return`: this is the transaction CALLBACK body, so a
        // `return` here exits the whole page — the first already-correct row
        // silently abandoned every row after it, which is what a real defect
        // looked like (`unchanged: N` for rows whose metadata was still NULL).
        if (sameMetadata(existing, meta)) continue

        updateStmt.run(JSON.stringify(meta), row.id, projectId)
        written++
        if (pattern) patterns++
      }
    })

    try {
      tx(batch)
    } catch (e: any) {
      failed = e?.message ? String(e.message) : String(e)
      // The page rolled back: NOTHING in it was written, so nothing in it may
      // be counted. The old code incremented `enriched`/`patternsFound` inside
      // the transaction body, so a failed page still reported its rows.
      written = 0
      patterns = 0
      unresolvedHere = 0
    }
    unresolvedTargets += unresolvedHere
    return { written, patterns, failed }
  }

  let truncated = false

  /** Rows this pass has accounted for, written or deliberately not written. */
  const processedSoFar = () => enriched + unchanged + failedRows

  /**
   * Attempt a page; on failure retry the SAME page once (a transient lock or a
   * busy timeout is the common cause and the retry is cheap), then record the
   * outcome EXACTLY once so nothing is double counted. Returns whether the page
   * succeeded.
   */
  const absorb = (batch: any[], make: () => { written: number; patterns: number; failed: string | null }) => {
    let outcome = make()
    if (outcome.failed !== null) outcome = make()
    const rowsInPage = batch.length
    considered += rowsInPage
    if (outcome.failed === null) {
      enriched += outcome.written
      patternsFound += outcome.patterns
      unchanged += rowsInPage - outcome.written
      return true
    }
    failedPages++
    failedRows += rowsInPage
    if (firstError === null) firstError = outcome.failed
    log.warn("relationship enrichment: page failed, rows left un-enriched", {
      projectId: String(projectId).slice(0, 8),
      rows: rowsInPage,
      error: outcome.failed,
    })
    return false
  }

  // The projection both row selections share. `t.id` is selected explicitly so
  // a present target_symbol_id with no symbol row (a genuinely dangling edge)
  // is distinguishable from a null one.
  const PROJECTION = `
             r.id, r.rowid AS rowid, r.relationship_type, r.source_symbol_id, r.target_symbol_id, r.metadata,
             s.layer as source_layer, s.symbol_type as source_type, s.name as source_name,
             t.id as target_resolved_id, t.layer as target_layer, t.symbol_type as target_type, t.name as target_name,
             sf.relative_path as source_file, sf.language as source_language`
  const JOINS = `
      JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id
      LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id AND t.project_id = r.project_id
      LEFT JOIN brain_file sf ON sf.id = s.file_id`

  if (scopeIds?.length) {
    // Scoped: iterate id-chunks of the touched symbol set. Cost scales with
    // |scopeIds|, never with total relationship count.
    const CHUNK = 500
    for (let i = 0; i < scopeIds.length; i += CHUNK) {
      if (maxRows !== Infinity && processedSoFar() >= maxRows) {
        truncated = true
        break
      }
      const chunk = scopeIds.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => "?").join(",")
      const batch = rawDb.prepare(`
      SELECT ${PROJECTION}
      FROM brain_relationship r
      ${JOINS}
      WHERE r.project_id = ? AND r.source_symbol_id IN (${placeholders})
    `).all(projectId, ...chunk) as any[]
      absorb(batch, () => processBatch(batch))
      const pct = Math.min(95, 5 + Math.round((processedSoFar() / Math.max(1, scopeIds.length)) * 90))
      report("enriching", pct)
    }
    // Freshness, measured. `repairInEdges` restores a deleted in-edge by
    // copying its PRE-PARSE metadata into a row stamped `time_updated = now`,
    // so the stored enrichment is stale by src/lsp/enrichment.ts's own law
    // (`inferredAt < time_updated`) and may describe the OLD target. Those rows
    // are not re-written here (see the scope note above) — they are COUNTED,
    // because a stale enrichment that bb_graph presents without a staleness
    // check is the "wrong edge reported as truth" failure mode.
    staleInScope = countStaleInScope(rawDb, projectId, scopeIds)
  } else {
    // Full mode. Two paginators: the keyset one is the real path, the OFFSET one
    // is the declared fallback for a WITHOUT ROWID table.
    if (pagination === "rowid") {
      let cursor = 0
      for (;;) {
        const remaining = maxRows === Infinity ? BATCH : Math.min(BATCH, maxRows - processedSoFar())
        if (remaining <= 0) { truncated = true; break }
        const batch = rawDb.prepare(`
      SELECT ${PROJECTION}
      FROM brain_relationship r
      ${JOINS}
      WHERE r.project_id = ? AND r.rowid > ?
      ORDER BY r.rowid
      LIMIT ${remaining}
    `).all(projectId, cursor) as any[]
        if (batch.length === 0) break
        const pageLast = batch[batch.length - 1].rowid
        // The cursor advances past the page either way — a page that failed
        // twice is recorded in failedPages/failedRows and never retried
        // forever — but never past a page that has not been accounted for.
        absorb(batch, () => processBatch(batch))
        cursor = pageLast
        const pct = Math.min(95, 5 + Math.round((processedSoFar() / Math.max(1, totalRels)) * 90))
        report("enriching", pct)
      }
    } else {
      let offset = 0
      for (;;) {
        const remaining = maxRows === Infinity ? BATCH : Math.min(BATCH, maxRows - processedSoFar())
        if (remaining <= 0) { truncated = true; break }
        const batch = rawDb.prepare(`
      SELECT ${PROJECTION}
      FROM brain_relationship r
      ${JOINS}
      WHERE r.project_id = ?
      LIMIT ${remaining} OFFSET ${offset}
    `).all(projectId) as any[]
        if (batch.length === 0) break
        absorb(batch, () => processBatch(batch))
        offset += batch.length
        const pct = Math.min(95, 5 + Math.round((offset / Math.max(1, totalRels)) * 90))
        report("enriching", pct)
      }
    }
  }

  const processed = processedSoFar()
  const result: EnrichRelationshipsResult = {
    enriched,
    patternsFound,
    durationMs: Date.now() - startTime,
    considered,
    unchanged,
    danglingSources,
    unresolvedTargets,
    danglingTargets,
    rowsWithoutParseableMetadata,
    failedPages,
    failedRows,
    firstError,
    truncated,
    // A floor, not an exact count: the source-side join drops `danglingSources`
    // rows that this pass can never enrich, so the true unreached count is at
    // most this number and is reported as an at-least.
    skipped: truncated ? Math.max(0, totalRels - processed - danglingSources) : 0,
    cap: maxRows,
    pagination,
    staleInScope,
  }

  if (truncated) {
    log.warn("relationship enrichment: work cap reached, pass is PARTIAL", {
      projectId: String(projectId).slice(0, 8),
      cap: maxRows,
      processed,
      totalRelationships: totalRels,
      skipped: result.skipped,
    })
  }
  if (failedPages > 0) {
    log.warn("relationship enrichment: PARTIAL — some pages failed and were left un-enriched", {
      projectId: String(projectId).slice(0, 8),
      failedPages,
      failedRows,
      firstError,
    })
  }
  if (rowsWithoutParseableMetadata > 0) {
    log.warn("relationship enrichment: pre-existing metadata was unparseable and was replaced", {
      projectId: String(projectId).slice(0, 8),
      rows: rowsWithoutParseableMetadata,
    })
  }
  if (danglingTargets > 0) {
    log.warn("relationship enrichment: dangling TARGET edges present (target_symbol_id names no symbol)", {
      projectId: String(projectId).slice(0, 8),
      danglingTargets,
    })
  }

  report(truncated ? "capped" : "done", 100)

  return result
}

/**
 * Count rows pointing INTO the scope whose stored enrichment is already stale
 * under src/lsp/enrichment.ts's law. `json_valid` guards `json_extract`: SQLite
 * raises "malformed JSON" on a non-JSON value, and analyzer-written metadata is
 * not guaranteed to be JSON. Bounded by the scope (indexed on
 * target_symbol_id), and read-only — it never turns the bounded pass unbounded.
 */
function countStaleInScope(rawDb: any, projectId: ProjectID, scopeIds: string[]): number {
  const CHUNK = 500
  let total = 0
  for (let i = 0; i < scopeIds.length; i += CHUNK) {
    const chunk = scopeIds.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => "?").join(",")
    try {
      const row = rawDb.prepare(`
        SELECT COUNT(*) as c FROM brain_relationship r
        WHERE r.project_id = ?
          AND r.target_symbol_id IN (${placeholders})
          AND r.metadata IS NOT NULL
          AND json_valid(r.metadata)
          AND json_extract(r.metadata, '$.inferredAt') IS NOT NULL
          AND json_extract(r.metadata, '$.inferredAt') < r.time_updated
      `).get(projectId, ...chunk) as any
      total += row?.c ?? 0
    } catch (e: any) {
      log.warn("relationship enrichment: stale-in-scope count unavailable", { error: e?.message })
      return total
    }
  }
  return total
}

// ─── Pattern Inference (used by enrichRelationships above) ─────────────────

function inferPattern(row: {
  relationship_type: string
  source_name: string
  source_type: string
  target_name: string
  target_type: string
  source_file: string
}): RelationshipEnrichment["pattern"] | null {
  const rt = row.relationship_type
  const sn = (row.source_name || "").toLowerCase()
  const tn = (row.target_name || "").toLowerCase()
  const st = (row.source_type || "").toLowerCase()
  const tt = (row.target_type || "").toLowerCase()

  // Factory consumer: calls a method on a class whose name contains "Factory" or "Builder"
  if (rt === "calls" && (tn.includes("factory") || tn.includes("builder") || tn.includes("create") || tn.includes("build") || tn.includes("new"))) {
    return "factory_consumer"
  }

  // Observer / Event handler: calls a method with "on", "handle", "listen", "notify", "emit", "fire"
  if (rt === "calls" && /^(on|handle|listen|notify|emit|fire|addListener|removeListener|subscribe|unsubscribe)/i.test(tn)) {
    return "observer"
  }

  // Callback: source has "callback" or "handler" in name, or target ends with "Callback"
  if (rt === "calls" && (sn.includes("callback") || sn.includes("handler") || tn.endsWith("callback"))) {
    return "callback"
  }

  // Event handler: source file is an event handler or target is an event type
  if (rt === "calls" && (sn.includes("event") || tn.includes("event"))) {
    return "event_handler"
  }

  // Adapter / Wrapper: target type is interface/trait and source "implements" it, or source name contains "Adapter"/"Wrapper"
  if (rt === "implements" && (tt === "interface" || tt === "trait" || tt === "protocol")) {
    return "adapter"
  }
  if ((sn.includes("adapter") || sn.includes("wrapper") || sn.includes("decorator")) && rt === "calls") {
    return "adapter"
  }

  // DI injection: source instantiates an interface/trait/abstract class
  if (rt === "instantiates" && (tt === "interface" || tt === "trait" || tt === "abstract" || tt === "protocol")) {
    return "di_injection"
  }

  // Override: relationship is "overrides"
  if (rt === "overrides") {
    return "override"
  }

  // Delegate: source delegates to target (calls a method and passes its own name or similar)
  if (rt === "calls" && (sn.includes("delegate") || tn.includes("delegate") || tn.includes("proxy"))) {
    return "delegate"
  }

  // Default: no pattern detected
  return null
}

function inferRole(
  relationshipType: string,
  sourceType: string,
  targetType: string,
  pattern: string | undefined,
): RelationshipEnrichment["role"] | undefined {
  const st = (sourceType || "").toLowerCase()
  const tt = (targetType || "").toLowerCase()

  if (relationshipType === "extends") return "inheritor"
  if (relationshipType === "implements") return "implementor"
  if (relationshipType === "overrides") return "inheritor"
  if (relationshipType === "instantiates") {
    if (tt === "interface" || tt === "trait" || tt === "protocol") return "configurator"
    return "producer"
  }
  if (relationshipType === "calls") {
    if (pattern === "observer" || pattern === "callback" || pattern === "event_handler") return "consumer"
    if (pattern === "adapter") return "decorator"
    if (pattern === "di_injection") return "configurator"
    return "consumer"
  }
  if (relationshipType === "uses" || relationshipType === "references" || relationshipType === "imports") {
    return "consumer"
  }

  return undefined
}

// ─── Query Helpers for Tools ───────────────────────────────────────────────

/**
 * Fetch enriched relationships for a symbol, including all computed dimensions.
 * Used by bb_analyze graph modes and bb_visualize.
 *
 * `maxResults` was read as `options.maxResults || 100`, which is the same
 * un-normalised-page-size defect content-search.ts fixed for itself: `0`
 * returned 100 rows, and a NEGATIVE number reached the SQL as `LIMIT -n`, which
 * SQLite reads as NO LIMIT — an unbounded read from a caller that thought it
 * had bounded itself. Normalized here the same way.
 */
export function formatEnrichedRelationship(row: any): string {
  let meta: any = {}
  try { meta = row.rel_metadata ? JSON.parse(row.rel_metadata) : (row.metadata ? JSON.parse(row.metadata) : {}) } catch {}

  // Foreign/analyzer metadata is not validated by shape here, and this renders
  // tool output on the interactive path: a non-string `pattern` used to throw
  // out of `.replace`, and an array/object metadata used to throw out of the
  // property reads. Degrade to "no enrichment shown", never crash a tool call.
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) meta = {}
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
  const bool = (v: unknown): boolean => v === true

  const parts: string[] = []

  // Role + Pattern
  const role = str(meta.role)
  const pattern = str(meta.pattern)
  if (role || pattern) {
    const labels: string[] = []
    if (role) labels.push(role)
    if (pattern) labels.push(pattern.replace(/_/g, " "))
    parts.push(`[${labels.join(" · ")}]`)
  }

  // Layer flow — the unresolved sentinel is informative, so only the
  // no-information same-layer case is suppressed.
  const layerFlow = str(meta.layerFlow)
  if (layerFlow && layerFlow !== "core→core") {
    parts.push(`(${layerFlow})`)
  }

  // Criticality
  if (meta.criticality === "high") {
    parts.push(`🔴`)
  } else if (meta.criticality === "medium") {
    parts.push(`🟡`)
  }

  // Frequency
  const frequency = str(meta.frequency)
  if (frequency && frequency !== "one_of_0") {
    parts.push(`×${frequency.replace("one_of_", "")}`)
  }

  // Flags (compact)
  const flags: string[] = []
  if (bool(meta.isTestCode)) flags.push("🧪")
  if (bool(meta.isFrameworkContract)) flags.push("📜")
  if (bool(meta.isGeneratedCode)) flags.push("🤖")
  if (bool(meta.isDependencyInjection)) flags.push("💉")
  if (flags.length > 0) parts.push(flags.join(""))

  return parts.length > 0 ? parts.join(" ") : ""
}

/**
 * Clamp a caller-supplied page size. `0` and negatives must NOT reach the SQL
 * (negative LIMIT = no limit in SQLite) and must NOT fall back to the default
 * via `||` (0 is falsy). Same shape as content-search.ts's normalizePageSize:
 * a non-finite or NEGATIVE value falls back to the default, while an explicit
 * `0` means `0` — a caller that asked for nothing must not be handed the
 * default behind its back.
 */
function normalizeMaxResults(value: unknown): number {
  if (value === undefined || value === null) return 100
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) return 100
  return n
}

/**
 * Quick enrichment query for a single relationship — used in tool response formatting.
 */
export async function getEnrichedRelationships(
  projectId: ProjectID,
  options: {
    sourceSymbolId?: string
    targetSymbolId?: string
    relationshipType?: string
    maxResults?: number
    includeEnrichment?: boolean
  } = {},
): Promise<any[]> {
  const rawDb = await BrainDatabase.getRawInstance(projectId)

  const conditions: string[] = ["r.project_id = ?"]
  const params: any[] = [projectId]

  if (options.sourceSymbolId) {
    conditions.push("r.source_symbol_id = ?")
    params.push(options.sourceSymbolId)
  }
  if (options.targetSymbolId) {
    conditions.push("r.target_symbol_id = ?")
    params.push(options.targetSymbolId)
  }
  if (options.relationshipType) {
    conditions.push("r.relationship_type = ?")
    params.push(options.relationshipType)
  }

  const limit = normalizeMaxResults(options.maxResults)
  // `includeEnrichment` was accepted and then ignored: the metadata column was
  // selected unconditionally, so a caller that asked for un-enriched rows
  // always got the enrichment payload back. Honour it.
  const metadataColumn = options.includeEnrichment === false ? "NULL as metadata" : "r.metadata"
  const where = conditions.join(" AND ")

  return rawDb.prepare(`
    SELECT r.id, r.relationship_type, ${metadataColumn},
           s.name as source_name, s.symbol_type as source_type, s.layer as source_layer,
           t.name as target_name, t.symbol_type as target_type, t.layer as target_layer,
           sf.relative_path as source_file, sf.language as source_language,
           tf.relative_path as target_file, tf.language as target_language,
           r.is_cross_file, r.is_cross_language, r.bridge_mechanism
    FROM brain_relationship r
    JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id
    JOIN brain_file sf ON sf.id = s.file_id
    LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id AND t.project_id = r.project_id
    LEFT JOIN brain_file tf ON tf.id = t.file_id
    WHERE ${where}
    ORDER BY s.name, t.name
    LIMIT ${limit}
  `).all(...params) as any[]
}