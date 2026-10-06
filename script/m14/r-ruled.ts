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
 *     type           edges (min-max over 7 runs)    files   instrument
 *     calls             48,028 - 48,233 (Δ205)    1,294   production parseFile
 *     uses                4,789 -  4,810 (Δ21)      584   production parseFile
 *     contains          17,550 - 17,634 (Δ84)     1,874   production parseFile
 *     imports            2,087 -  2,095 (Δ8)      1,112   production parseFile
 *     references         2,129 -  2,137 (Δ8)      1,116   production parseFile
 *     exports             3,525 -  3,592 (Δ67)       711   production parseFile
 *     extends               351 (invariant)          61   production parseFile
 *     implements          1,133 (invariant)         221   production parseFile
 *     overrides          95 - 107 (Δ12)               9   production parseFile
 *     instantiates            3 (invariant)           2   production parseFile
 *
 * `overrides` carries a range for the first time and the reason is a CHANGE, not variance.
 * It read 107 on every pre-`d2fc8626f` run and 95 on every post-`d2fc8626f` one, and
 * `d2fc8626f` moved its base resolution from any-declaration to nearest-PRECEDING-declaration
 * (`src/ast/real-r-analyzer.ts:408-437`). The drop removed 12 edges and added none. This
 * header previously printed `107 (invariant)` across seven runs, which stopped being true at
 * run K — the table was written at 05:34 and runs K, M and N came after it, so the claim
 * was correct when written and stale when read. Both numbers are kept because the pair is
 * the measurement; a single one of them would attribute a code change to parse noise.
 *
 * Those min-max endpoints are PER-TYPE, each the smallest and largest value one run
 * observed for that type. They do NOT sum to an observed total: the minimums come from
 * different runs (run F holds three of them, run G one, run 2 three, run F again for
 * imports), so adding them
 * mixes sets — 79,702 is such a sum and is not a number any run printed. The totals the ten
 * tabled runs printed are 80,023 / 80,083 / 79,756 / 79,823 / 80,055 / 80,069 / 80,062 /
 * 79,914 / 79,900 / 79,783, so the TOTAL band over those ten is 79,756-80,083 (Δ327). Two
 * further walks, whose bytes were kept only in `/tmp`, printed 80,095 and 80,015; they are
 * named rather than tabulated because nothing on disk backs them, and including them would
 * widen the band to 79,756-80,095 (Δ339). The distinction is the
 * same two-sets error this header exists to avoid, so it is stated rather than left for
 * a reader to trip on.
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
 * support. Measured, all ten runs, production `parseFile`:
 *
 *     type            run 1     run 2     run F     run G     run H     run I     run J     run K     run M     run N
 *     calls          48,184    48,233    48,082    48,028    48,206    48,215    48,209    48,098    48,096    48,037
 *     contains       17,630    17,634    17,550    17,601    17,629    17,632    17,630    17,627    17,617    17,584
 *     exports         3,591     3,592     3,525     3,581     3,588     3,590     3,591     3,588     3,588     3,557
 *     imports         2,093     2,095     2,087     2,087     2,093     2,095     2,095     2,088     2,093     2,091
 *     references      2,135     2,137     2,129     2,129     2,135     2,137     2,137     2,130     2,135     2,133
 *     uses            4,808     4,810     4,789     4,803     4,810     4,806     4,806     4,801     4,789     4,799
 *     extends           351       351       351       351       351       351       351       351       351       351
 *     implements      1,133     1,133     1,133     1,133     1,133     1,133     1,133     1,133     1,133     1,133
 *     overrides          95        95       107       107       107       107       107        95        95        95
 *     instantiates        3         3         3         3         3         3         3         3         3         3
 *     TOTAL           80,023    80,083    79,756    79,823    80,055    80,069    80,062    79,914    79,900    79,783
 *
 *   run 1 = validation/m14/fixtures/r/ontology-ten-types.txt   (committed artifact)
 *   run 2 = validation/m14/fixtures/r/labels-and-resolution.txt (committed artifact)
 *   run F = script/m14/ontology-coverage-gate.ts r, 2026-10-05 03:42 (output NOT captured)
 *   run G = validation/m14/fixtures/r/arbiter/arbiter-r-runG-2026-10-05.txt (committed)
 *   run H = validation/m14/fixtures/r/arbiter/arbiter-r-runH-2026-10-05.txt (committed)
 *   run I = validation/m14/fixtures/r/arbiter/arbiter-r-runI-2026-10-05.txt (committed)
 *   run J = validation/m14/fixtures/r/arbiter/arbiter-r-runJ-2026-10-05.txt (committed)
 *   run K = validation/m14/fixtures/r/arbiter/arbiter-r-runK-2026-10-05.txt (committed)
 *   run M = validation/m14/fixtures/r/arbiter/arbiter-r-runM-2026-10-05.txt (committed)
 *   run N = validation/m14/fixtures/r/arbiter/arbiter-r-runN-2026-10-05.txt (committed)
 *
 * Rows "run 1" and "run 2" of THIS table were wrong until now and are worth naming, because
 * they were wrong in the direction that inflates. They carried `calls` 48,233 and 48,174
 * with totals 80,095 and 80,015 — the first of those is run 2's, and 48,174/80,015 belong
 * to neither committed artifact but to the two `/tmp` walks
 * (`/tmp/opencode/r-arbiter.txt`, `/tmp/opencode/r-arbiter2.txt`) whose bytes were never
 * kept. The artifacts themselves read 48,184 and 48,233, totals 80,023 and 80,083, and both
 * report `overrides` at 95, which places them AFTER `d2fc8626f`. The corrected rows are
 * above and the per-type figures in them are transcribed from the artifacts, not from any
 * earlier draft of this header.
 *
 * Runs G through N are the seven arbiter walks whose bytes are on disk; all seven printed
 * `emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0` and all
 * seven then exited 1 from the 120-second parse bomb, which is shared machinery (§8 of the
 * workstream). No run after F set a new extremum on any type, and run N is the strongest
 * evidence for that: it lost EIGHT files to the parse failure, four times any other run,
 * and every one of its ten counts still falls inside the span the others established.
 * Run N is also the only run taken with `--fresh`, so it is the only one independent of
 * the checkpoint (see the resume defect in the arbiter README: a resumed run reports
 * `emitted 0/10` for this lane). No tabled run after F set a new extremum on any type, and
 * run N is the strongest
 * evidence for that: it lost EIGHT files to the parse failure, four times any other run,
 * and every one of its ten counts still falls inside the span the others established.
 * Run N is also the only run taken with `--fresh`, so it is the only one independent of
 * the checkpoint (see the resume defect in the arbiter README: a resumed run reports
 * `emitted 0/10` for this lane). The total band over the ten tabled walks is therefore
 * unchanged at 79,756-80,083.
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
 * `usethis/R/course.R`), run H lost 2 (`usethis/R/ci.R`, `usethis/R/citation.R`), run I
 * lost 1 (`r-testthat/R/expect-invisible.R`), run J lost 1 (`r-cli/R/width.R`, the same
 * file run F lost, and in run J also the file the 120-second bomb hung on), run K lost 1
 * (`usethis/R/create.R`), run M lost 1 (`r-testthat/R/expect-condition.R`), run N lost 8
 * (`ggplot2/R/scale-hue.R`, `scale-identity.R`, `scale-linewidth.R`, `scale-manual.R`,
 * `scale-shape.R`, `r-cli/R/utils.R`, `r-cli/R/vt.R`, `r-cli/R/width.R`). A file that
 * fails to parse contributes no edges, so the totals track the failures. The per-run,
 * per-file tally is in `validation/m14/fixtures/r/arbiter/README.md`.
 *
 * The losses cluster — 9 of the 17 distinct lost files are `usethis` (4) or `r-cli` (5),
 * and `r-rlang`'s 160 files were walked by all ten runs without one loss. An earlier
 * revision of this header said "9 of the 11", which was wrong on both numbers:
 * counted file by file from the committed artifacts the numerator was 7 at the time, and
 * only ten losses were on record when 11 was written (run I supplied the eleventh, run J the
 * twelfth). Run N later moved both figures, to 17 distinct and 9. A second thing run N
 * settled is that `ggplot2` is a FAMILY and not one unlucky file: all five of its losses
 * are members of the `ggplot2/R/scale-*.R` series, and run N lost four of them at once.
 * The clustering remains a statement about
 * which files exhaust the wasm parser's memory, not about the analyzer, and no analyzer rule
 * reads a file count.
 *
 * The three types that DO NOT MOVE are the informative half of this table. `extends`,
 * `implements` and `instantiates` are identical in all ten runs, which says the
 * wobble is confined to the types whose counts are large enough to be sensitive to losing a
 * handful of files — not that those three are more correct than the others. `overrides` was
 * in this group until `d2fc8626f` moved it out of it by changing the code rather than the
 * parse rate; its zero variance is now measured rather than assumed, because run N lost
 * eight files and `overrides` stayed at 95. The spread is a
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
