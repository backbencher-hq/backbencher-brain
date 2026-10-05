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
 *     type           edges (min-max over 5 runs)   files   instrument
 *     calls             48,136 - 48,233 (Δ97)     1,294   production parseFile
 *     uses                4,799 -  4,810 (Δ11)      584   production parseFile
 *     contains          17,620 - 17,634 (Δ14)     1,874   production parseFile
 *     imports            2,090 -  2,095 (Δ5)      1,112   production parseFile
 *     references             389 -  2,137        1,116   production parseFile
 *     exports             3,581 -  3,592 (Δ11)       711   production parseFile
 *     extends               350 -    351 (Δ1)         61   production parseFile
 *     implements          1,133 (invariant)          221   production parseFile
 *     overrides             107 (invariant)            9   production parseFile
 *     instantiates            3 (invariant)            2   production parseFile
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
 * This header used to print one count per type. Four production walks over the SAME 2,184-file
 * population do not agree on them, so a single figure would be a claim the corpus does not
 * support. Measured, all four runs, production `parseFile`, 4 workers:
 *
 *     type            run A     run B     run C     run D     run E
 *     calls          48,205    48,136    48,230    48,195    48,233
 *     contains       17,629    17,620    17,632    17,625    17,634
 *     exports         3,590     3,581     3,590     3,584     3,592
 *     imports         2,094     2,090     2,095     2,094     2,095
 *     extends           351       350       351       351       351
 *     uses            4,810     4,799     4,810     4,810     4,810
 *     references        389       389       389       389     2,137
 *     implements      1,133     1,133     1,133     1,133     1,133
 *     overrides         107       107       107       107       107
 *     instantiates        3         3         3         3         3
 *
 *   A = validation/m14/fixtures/r/ontology-ten-types.txt        B = its predecessor
 *   C = validation/m14/fixtures/r/labels-and-resolution.txt      D = ontology-coverage-gate.ts r
 *   E = ontology-ten-types.ts after the `::`/`:::` dependsOn fix (references 389 -> 2,137)
 *
 * `references` is the one column where the spread is a CHANGE rather than a wobble: the
 * other four runs predate the fix that gave `::`/`:::` the `references` label
 * `src/ast/types.ts:72` makes it (DependsOn). Its lane oracle measured the effect as
 * recall 16.9% -> 95.5% with `unexplained` unmoved at 21. Four runs cannot measure a
 * change like that as variance, which is why run E is listed separately rather than
 * folded into a range.
 *
 * The cause is measured, not guessed: the wasm parser intermittently dies on R files with
 * `[BB-PARSE-ERR] … memory access out of bounds`, and WHICH files it dies on changes run to run
 * (logged: `ggplot2/R/scale-hue.R` on run B, `ggplot2/R/scale-manual.R` on run D). A file that
 * fails to parse contributes no edges, so the totals track the failures.
 *
 * The four types that DO NOT MOVE are the informative half of this table. `references`,
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
 * `docs/analyzers/real-r-analyzer.md` inherits the same ±0.2% band.
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
 *      (`validation/m14/fixtures/r/oracle-r.ts`, 2,058 files) reports `unexplained` counts of
 *      calls 6,780 / uses 1,095 / contains 6,334 / overrides 75 / extends 11 / references 21 /
 *      instantiates 2, and it is RULE-COUPLED for calls, uses, contains and overrides by its own
 *      declaration, so it cannot see a bug those four rules share. Correcting that is a
 *      supervisor-owned edit (§8 of the workstream brief).
 *   2. `evidenceClass` IS ABSENT ON 100% OF R EDGES — 78,309 of 78,309. 42 of the 51 analyzer files
 *      set it; R is one of six that do not (clojure, elixir, erlang, fsharp, r, vb). The store
 *      derives the tier from confidence instead (`src/lsp/evidence_tier.ts` rule 2), so every R
 *      edge reads `structural`. Legal, and an outlier.
 *   3. TWO SUBTYPES CARRY TWO LABELS BY DESIGN: `r_source` and `rcpp_source` appear under BOTH
 *      `imports` and `references` (real-r-analyzer.ts:2113-2114 emits the pair deliberately, and the
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
