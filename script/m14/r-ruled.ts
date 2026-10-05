/**
 * R_RULED — the ruling table `script/m14/ontology-coverage-gate.ts` requires before it will
 * report this lane at all.
 *
 * ## The table is EMPTY, and that is the measurement, not an omission
 *
 * The gate's own header states the failure it exists to catch: `overrides` was absent from Bash
 * for a whole wave while the differential stayed green, because the analyzer omitted it and the
 * oracle was written after the ruling — nothing agrees with nothing. So the gate needs, per type,
 * either production edges or a corpus-backed ruling. R needs neither for any of the ten:
 *
 *     type           edges (min-max over 4 runs)   files   instrument
 *     calls             48,028 - 48,233 (Δ205)    1,294   production parseFile
 *     uses                4,789 -  4,810 (Δ21)      584   production parseFile
 *     contains          17,550 - 17,634 (Δ84)     1,874   production parseFile
 *     imports            2,087 -  2,095 (Δ8)      1,112   production parseFile
 *     references         2,129 -  2,137 (Δ8)      1,116   production parseFile
 *     exports             3,525 -  3,592 (Δ67)       711   production parseFile
 *     extends               351 (invariant)          61   production parseFile
 *     implements          1,133 (invariant)         221   production parseFile
 *     overrides             107 (invariant)           9   production parseFile
 *     instantiates            3 (invariant)           2   production parseFile
 *
 * Population: every git-tracked file the production ROUTER
 * (`detectLanguageFromPath`) maps to `r` in `$HOME/fixtures/repositories` —
 * 2,184 files across 16 repositories, no sampling, no per-repo cap. Reproduce with
 *
 *     npx tsx validation/m14/fixtures/r/ontology-ten-types.ts     # counts + grammar inventory
 *     npx tsx validation/m14/fixtures/r/labels-and-resolution.ts  # labels, resolution, confidence
 *
 * and the committed outputs `validation/m14/fixtures/r/ontology-ten-types.txt` and
 * `validation/m14/fixtures/r/labels-and-resolution.txt`.
 *
 * ## Why a RANGE and not a single number — this table's first version was wrong that way
 *
 * This header used to print one count per type. Production walks over the SAME 2,184-file
 * population do not agree on them, so a single figure would be a claim the corpus does not
 * support. Measured, all four POST-FIX runs, production `parseFile`:
 *
 *     type            run 1     run 2     run F     run G
 *     calls          48,233    48,174    48,082    48,028
 *     contains       17,634    17,622    17,550    17,601
 *     exports         3,592     3,585     3,525     3,581
 *     imports         2,095     2,095     2,087     2,087
 *     references      2,137     2,137     2,129     2,129
 *     uses            4,810     4,808     4,789     4,803
 *     extends           351       351       351       351
 *     implements      1,133     1,133     1,133     1,133
 *     overrides         107       107       107       107
 *     instantiates        3         3         3         3
 *
 *   run 1 = validation/m14/fixtures/r/ontology-ten-types.txt   (committed artifact)
 *   run 2 = validation/m14/fixtures/r/labels-and-resolution.txt (committed artifact)
 *   run F = script/m14/ontology-coverage-gate.ts r, 2026-10-05 03:42 (output NOT captured)
 *   run G = validation/m14/fixtures/r/arbiter/arbiter-r-runG-2026-10-05.txt (committed)
 *
 * Three runs predate the `::`/`:::` fix and reported `references` at 389 — that is a CHANGE,
 * not variance, and they are kept out of the table above for that reason. Their counts are
 * preserved because the pre/post comparison is the measurement: `references` 389 → 2,137 and
 * the total 78,311 → 80,095 (+2.28%), with the lane oracle's `unexplained` unmoved at 21.
 *
 * The cause of the spread is measured, not guessed: the wasm parser intermittently dies on R
 * files with `[BB-PARSE-ERR] … memory access out of bounds`, and WHICH files it dies on
 * changes run to run. Run F lost 5 files to it (`ggplot2/R/scale-manual.R`,
 * `r-cli/R/width.R`, `r-cli/exec/news.R`, `r-cli/R/zzz.R`,
 * `r-testthat/R/expect-equality.R`), run G lost 2 (`ggplot2/R/scale-manual.R`,
 * `usethis/R/course.R`). A file that fails to parse contributes no edges, so the totals
 * track the failures.
 *
 * The four types that DO NOT MOVE are the informative half of this table. `extends`,
 * `implements`, `overrides` and `instantiates` are identical in all four runs, which says the
 * wobble is confined to the types whose counts are large enough to be sensitive to losing a
 * handful of files — not that those four are more correct than the others. The spread is a
 * property of the PARSER, not of the analyzer: no analyzer rule reads a file count, and the
 * fixture `validation/m14/fixtures/r/probe-oom.ts` shows per-file counts stable to 0 of 160
 * `r-rlang` files across 3 passes.
 *
 * So every count below is a RANGE, and no type's EMITTED verdict depends on which end of it is
 * true: the smallest observed value of every one of the ten is non-zero, which is what the gate
 * tests. The delta is reported because a reader planning a re-measure needs to know that two runs
 * will not agree to the digit, and the DENOMINATOR of every rate printed in
 * `docs/analyzers/real-r-analyzer.md` inherits the same band.
 *
 * ## Why the table is registered rather than omitted
 *
 * The gate refuses a lane for which it can find NO ruling source at all:
 *
 *     ontology coverage gate — no RULING SOURCE for r.
 *     Refusing to report: …
 *
 * That guard is correct in general and it fires on R for a reason that has nothing to do with R:
 * the guard counts a ruling source for each UN-EMITTED type, and R has none, so the count is 0 and
 * 0 reads as "no evidence anywhere". A lane that emits all ten is refused by the same predicate that
 * refuses a lane that never looked. Registering an empty table is the fix, and it is the whole fix:
 * every row then takes the EMITTED branch, which is backed by the gate's own full-corpus walk and
 * not by this file.
 *
 * ## What this file therefore does NOT claim
 *
 * Emitting a type is not the same as being right about it, and the three gaps below are open. They
 * are recorded here rather than in a comment on the analyzer because the arbiter is the thing a
 * reader runs, and a table that reads as a clean bill of health when the lane has three named
 * defects is worse than no table.
 *
 *   1. NO ORACLE IN THE SHARED DIFFERENTIAL. `r` is absent from `LANGS` in
 *      `script/m14/differential.ts`, so all ten types are DERIVATION findings — emitted and compared
 *      against nothing by the project's own auditor. The lane's own oracle
 *      (`validation/m14/fixtures/r/oracle-r.ts`, 2,058 files, committed output
 *      `oracle-evidence.json`) reports `unexplained` counts of calls 6,799 / uses 1,095 /
 *      contains 6,343 / overrides 75 / extends 12 / references 21 / instantiates 2, and it is
 *      RULE-COUPLED for calls, uses, contains and overrides by its own declaration, so it cannot
 *      see a bug those four rules share. Correcting that is a supervisor-owned edit
 *      (§8 of the workstream brief).
 *   2. `evidenceClass` IS ABSENT ON 100% OF R EDGES — 80,015 of 80,015. 42 of the 48
 *      `src/ast/real-*-analyzer.ts` files set it; R is one of six that do not (clojure, elixir,
 *      erlang, fsharp, r, vb). The store derives the tier from confidence instead
 *      (`src/lsp/evidence_tier.ts` rule 2), so every R edge reads `structural`. Legal, and an
 *      outlier.
 *   3. TWO SUBTYPES CARRY TWO LABELS BY DESIGN: `r_source` and `rcpp_source` appear under BOTH
 *      `imports` and `references` (real-r-analyzer.ts:1884 and :1907 emit the pair deliberately, and the
 *      comment there says why). A consumer keying on the subtype cannot recover the label.
 *
 * The shape below restates the gate's local `Ruled` type structurally, the same way
 * `script/m14/julia-ruled.ts` and `script/m14/zig-ruled.ts` do: the gate does not export the type,
 * and TypeScript's structural typing makes the empty array assignable without either side changing.
 * The type is kept so that the first entry this lane ever adds is a compile error until it carries a
 * probe.
 */

type Type =
  | "calls" | "uses" | "contains" | "imports" | "references"
  | "exports" | "extends" | "implements" | "overrides" | "instantiates"

export type Ruled = {
  type: Type
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

/**
 * Zero entries. All ten ontology types are EMITTED by production `parseFile` on the whole admitted
 * R corpus, so there is no type left to rule. See the header for the counts and the harnesses.
 */
export const R_RULED: Ruled[] = []
