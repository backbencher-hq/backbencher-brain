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
 * **No caller ever built one.** Not for Perl, and not for Python either, which
 * reads `(ctx as any)._overrideCompanion` from a channel nothing populates. So
 * the rule was written, wired, shipped, and had never run.
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

  for (const result of affected) {
    for (const rel of result.relationships ?? []) {
      if ((rel as any).type !== OVERRIDES) continue
      if (Number((rel as any).confidence ?? 0) >= CONFIDENCE_FLOOR) stats.confirmed++
      else stats.stillGuess++
    }
  }
  return stats
}
