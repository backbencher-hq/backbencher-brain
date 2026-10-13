/**
 * PERL-MR15 — the cross-file override companion, POPULATED.
 *
 * `src/ast/override-context.ts` has exported `buildOverrideCompanion` since it was
 * written. `engine.ts` accepts the result on `AnalyzeContext.overrideCompanion`.
 * `pool-worker.parseFile` forwards it to the analyzer. The Perl resolver reads it
 * correctly (PERL-MR14) and behaves exactly as specified with it: a guess becomes
 * a 0.95 `base-declares-method` edge when the base declares the method, and the
 * edge DISAPPEARS when the base is present and does not.
 *
 * **For a long time no caller built one for Python.** Perl's resolver had one
 * (`context.overrideCompanion`) but Python's read `(ctx as any)._overrideCompanion`
 * — an underscore-prefixed key nothing populates — and Python's `analyze()`
 * stopped at three parameters, so the engine's fourth (`AnalyzeContext`, which
 * is where the companion lives) never reached it at all. The rule was written,
 * wired to a channel, shipped, and had never run. `parallel-indexer` meanwhile
 * WAS calling this pass, with `language: "perl"` hardcoded, so the batch path was
 * not absent — it was half-present, which is harder to see than either state.
 * Fixed 2026-10-31: the batch indexer runs the pass for both lanes, and Python
 * takes the `AnalyzeContext` the engine already passes.
 *
 * Measured over the seven corpora (5,774 files) with a companion built from one
 * pass over the same corpus:
 *
 *     guesses         8,085
 *     confirmed 0.95  1,627  (20.1%)
 *     withdrawn       6,111  (75.6%)   <- base is IN the project and does not
 *                                         declare the method. The edge is false.
 *     still a guess     347  ( 4.3%)   <- base outside the project; unresolvable
 *
 * 75.6% of the lane's `overrides` relationships do not exist. The differential
 * never saw it: MISSING=0/unexplained=0 asks whether every emitted edge is
 * EXPLAINABLE from the tree, not whether it is TRUE, and a first-parent guess is
 * perfectly explainable — the subclass declares a method and `use parent` names a
 * base. A fabricated-but-explainable edge is the one falsehood a coverage gate
 * cannot see.
 *
 * ## Why a second pass is cheap here
 *
 * The obvious implementation parses every file twice. This one does not: a parse
 * run already holds each file's `symbols` in memory (`FileResult.symbols`), so
 * the project's method-name space is available for free once the run finishes.
 * Only files that actually published an `overrides` edge are re-analyzed, which is
 * a small subset, and the re-analysis reuses the existing `parseFile` context
 * channel rather than a new code path.
 *
 * ## Why this is perl-scoped
 *
 * Making the pass language-agnostic would move java/kotlin/python/php/swift/dart
 * output at the same time, and every one of those lanes has pinned baselines that
 * were measured WITHOUT a companion. Perl is the lane that carries the defect
 * (39% of its `overrides` edges are guesses) and the lane whose measurements are
 * in this repository, so Perl is the lane that gets it first. The other lanes
 * reading a permanently-empty channel is the pre-existing state, unchanged.
 */
import { buildOverrideCompanion, type OverrideCompanion } from "./override-context"
import type { FileResult } from "./parallel-indexer"

/** Re-analyze one file. Supplied by the caller so this module never imports the
 *  engine, the worker pool, or the database. */
export type ReparseFile = (
  filePath: string,
  projectPath: string,
  context: { overrideCompanion: OverrideCompanion },
) => Promise<any | undefined>

export interface OverrideCompanionPassOptions {
  projectPath: string
  /** `FileResult`s from the run that just finished. Mutated in place. */
  results: FileResult[]
  /** Defaults to the module's own re-analysis. */
  reparse?: ReparseFile
  /** Restrict to one language. Perl only, deliberately — see the module note. */
  language?: string
  /**
   * THE ID-CARRYING JOIN (r-lane, 2026-10-12). The store's primary key is
   * `${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}`, and `sourceId` is the
   * SOURCE SYMBOL's id, found by scanning the file's storeable spans for the innermost holder of the
   * edge's line. So the pass needs exactly three things it does not have, and THEY ARE PASSED IN rather
   * than imported: this module must not import `parallel-indexer`, which imports this one.
   *
   * A KEY CAN ONLY BE UNIQUE IF IT IS `brain_relationship.id`. The tuple key that preceded this one
   * multi-matched 292 of 1,301 times on the corpus — because it omitted `sourceId`, the component that
   * distinguishes one source's override from another's at the same target and line. A row keyed by id
   * cannot collide, so clause 4 (no unconfirmed row is ever touched) becomes a STRUCTURAL PROPERTY
   * rather than a test.
   *
   * ALL THREE ARE OPTIONAL, AND THAT IS DELIBERATE: with them absent the pass behaves exactly as it does
   * today and `confirmedIds` stays empty, so the write-back is skipped. The change is inert until the call
   * site supplies them.
   */
  projectId?: string
  /** The store's file id for a path — `${projectId}:${relativePath}` in `storeResults`. */
  fileIdOf?: (filePath: string) => string
  /** The store's span index for one file's symbols. INCLUDES ITS SORT — a caller-supplied one must too. */
  buildSpans?: (
    symbols: any[],
    fileId: string,
  ) => Array<{ id: string; name: string; start: number; end: number; kind: string }>
  /** The store's innermost-enclosing-span scan. */
  enclosingSpanId?: (
    spans: Array<{ id: string; name: string; start: number; end: number; kind: string }>,
    line: number | null,
  ) => string | null
}

export interface OverrideCompanionPassStats {
  /** Owner names in the companion, i.e. classes/roles that declare something. */
  owners: number
  /** Files that published an `overrides` edge and were re-analyzed. */
  refiles: number
  /** Re-analyzed files that came back with a companion attached. */
  reapplied: number
  /** `overrides` edges at or above the confirmed threshold after the pass. */
  confirmed: number
  /**
   * THE IDENTITIES BEHIND `confirmed` (r-lane, 2026-10-12). Counts are not enough to persist the pass's
   * work: the write-back must UPDATE the exact stored rows it confirmed, and re-deriving the match at the
   * write-back site would be A SECOND COMPUTATION OF THE SAME PREDICATE, free to disagree with this one.
   * One computation, one answer — so the identity list is built BESIDE the count, not instead of it.
   *
   * `target` and `line` are the pair the store can be joined on: the analyzer's `target` is what the row
   * carries as `target_external`, and `line_number` is stored as-is. `confidence` is carried rather than
   * assumed so the write-back stores the value the analyzer actually produced.
   */
  confirmedKeys: Array<{ target: string; line: number | null; confidence: number }>
  /**
   * THE STORE PRIMARY KEYS BEHIND `confirmed`. Empty when the id-carrying inputs were not supplied, which
   * is what makes this change inert until the call site provides them. `confirmedIdsMissed` is the count
   * of confirmations the id path could NOT serve — a confirmed edge whose enclosing symbol could not be
   * found, or whose `line_number` is absent — and it is reported rather than silently dropped, because a
   * confirmation with no id is a row the write-back cannot reach.
   */
  confirmedIds: string[]
  /** Confirmations for which no store id could be computed: no spans, or no enclosing symbol at the line. */
  confirmedIdsMissed: number
  /**
   * THE IDENTITIES OF THE UNCONFIRMED (r-lane). Clause 4's second form asks whether these rows are STILL
   * PRESENT AND STILL AT 0.5 after the write-back — the clause that catches a write-back which tidies a
   * confirmed count by quietly moving the rest. Symmetric to `confirmedKeys`, and exposed for the same
   * reason: the acceptance needs the identities, not the count.
   */
  stillGuessKeys: Array<{ target: string; line: number | null }>
  /** `overrides` edges still below it: the base is outside the project. */
  stillGuess: number
  /** Errors from a re-analysis; the pass keeps the first-run result for these. */
  failed: number
}

const OVERRIDES = "overrides"
const CONFIDENCE_FLOOR = 0.7

/**
 * Build the companion from a completed run and re-analyze the files that depend
 * on it. Returns what it did, so a caller can record it rather than assert it.
 */
export async function populateOverrideCompanion(
  opts: OverrideCompanionPassOptions,
): Promise<OverrideCompanionPassStats> {
  const stats: OverrideCompanionPassStats = {
    owners: 0,
    refiles: 0,
    reapplied: 0,
    confirmed: 0,
    confirmedKeys: [],
    confirmedIds: [],
    confirmedIdsMissed: 0,
    stillGuessKeys: [],
    stillGuess: 0,
    failed: 0,
  }

  const language = opts.language ?? "perl"
  const results = opts.results
  const reparse = opts.reparse
  if (!reparse) return stats

  // Pass A's symbols are already in hand. Scoped to the language so a
  // non-perl file can never contribute a name to a perl base's entry.
  const symbols = results.flatMap((r) => (r.success && r.language === language ? (r.symbols ?? []) : []))
  const companion = buildOverrideCompanion(symbols)
  stats.owners = companion.size
  if (companion.size === 0) return stats

  // Only files that published the edge can have it settled. Everything else is
  // untouched, which is what keeps this a small subset rather than a second
  // parse of the project.
  const affected = results.filter(
    (r) => r.success && r.language === language && (r.relationships ?? []).some((x: any) => x.type === OVERRIDES),
  )
  stats.refiles = affected.length

  for (const result of affected) {
    let again: any
    try {
      again = await reparse(result.filePath, opts.projectPath, { overrideCompanion: companion })
    } catch {
      stats.failed++
      continue
    }
    if (!again || !again.success || !Array.isArray(again.relationships)) {
      stats.failed++
      continue
    }
    // A re-analysis that produced NO overrides edges is a real outcome, not a
    // failure: that is exactly the withdrawn case, where the base is in the
    // project and does not declare the method. Keeping the first run's guess
    // here would discard the whole point of the pass, so the replacement is
    // unconditional on success.
    result.symbols = again.symbols ?? result.symbols
    result.relationships = again.relationships
    result.imports = again.imports ?? result.imports
    // `FileResult` carries a single `error` string, not the parse's error list --
    // the batch's structured errors are assembled elsewhere from the results, so
    // the honest thing here is to leave the first run's outcome alone rather than
    // invent a field the type does not have.
    stats.reapplied++
  }

  // ── THE STORE PRIMARY KEY, COMPUTED FROM THE PASS'S OWN RE-PARSE ─────────────────────────────────
  // The store's id is `${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}`, and
  // `sourceId` is the SOURCE SYMBOL's id found by scanning the file's storeable spans. The spans are
  // built ONCE PER FILE and cached: building them per relationship would repeat the same work for every
  // edge in a file, and the store's own construction includes a sort.
  //
  // RETURNS null WHEN IT CANNOT KNOW — no inputs supplied, no symbols, no enclosing symbol at the line.
  // null is COUNTED (`confirmedIdsMissed`) rather than dropped: a confirmation with no id is a row the
  // write-back cannot reach, and the acceptance needs that number.
  //
  // AND IT DOES NOT COMPUTE THE SPAN INDEX ITSELF. `buildSpans` and `enclosingSpanId` are the STORE'S
  // functions, passed in — one implementation, two callers. Computing them here from copied rules would
  // be the second computation the design forbids, and two copies are free to drift apart silently.
  const spansByResult = new WeakMap<object, Array<{ id: string; name: string; start: number; end: number; kind: string }>>()
  const relIdOf = (result: FileResult, rel: any): string | null => {
    if (!opts.projectId || !opts.buildSpans || !opts.enclosingSpanId || !opts.fileIdOf) return null
    try {
      let spans = spansByResult.get(result as unknown as object)
      if (!spans) {
        if (!result.filePath) return null
        spans = opts.buildSpans(result.symbols ?? [], opts.fileIdOf(result.filePath))
        spansByResult.set(result as unknown as object, spans)
      }
      const line = (rel as any).line_number ?? null
      const sourceId = opts.enclosingSpanId(spans, line)
      if (!sourceId) return null
      // EXACTLY THE STORE'S FORMULA, including `?? "?"` — a line-less edge keeps the previous identity.
      return `${opts.projectId}:rel:${sourceId}:${String((rel as any).target ?? "")}:${String((rel as any).type ?? "")}:${line ?? "?"}`
    } catch {
      return null
    }
  }

  for (const result of affected) {
    for (const rel of result.relationships ?? []) {
      if ((rel as any).type !== OVERRIDES) continue
      if (Number((rel as any).confidence ?? 0) >= CONFIDENCE_FLOOR) {
        stats.confirmed++
        // THE IDENTITY, BESIDE THE COUNT. The write-back persists these exact rows; recomputing the match
        // there would be a second computation of this predicate and free to disagree with it.
        stats.confirmedKeys.push({
          target: String((rel as any).target ?? ""),
          line: (rel as any).line_number ?? null,
          confidence: Number((rel as any).confidence ?? 0),
        })
        // THE KEY, BESIDE THE COUNT AND BESIDE THE TUPLE. Only this one can be unique.
        const key = relIdOf(result, rel)
        if (key) stats.confirmedIds.push(key)
        else stats.confirmedIdsMissed++
      } else {
        stats.stillGuess++
        stats.stillGuessKeys.push({
          target: String((rel as any).target ?? ""),
          line: (rel as any).line_number ?? null,
        })
      }
    }
  }
  return stats
}
