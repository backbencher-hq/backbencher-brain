# Arbiter runs, R lane

Output of the repository's own arbiter, `npx tsx script/m14/ontology-coverage-gate.ts r`,
captured verbatim. The file name carries the run letter used in the per-run table in
`script/m14/r-ruled.ts` and in `docs/analyzers/r.md`, so a number quoted
in either document can be traced to bytes on disk.

Every run walks the same population: **2,184 admitted files across 16 repositories**
(every git-tracked file the production router `detectLanguageFromPath` maps to `r` in
`/home/ishaq2321/bb_tests/repositories`). No sampling, no per-repository cap.

| file | run | when | files lost to `memory access out of bounds` | `calls` | total |
| --- | --- | --- | --- | --- | --- |
| `arbiter-r-runG-2026-10-05.txt` | G | 2026-10-05 03:53 | 2 (`ggplot2/R/scale-manual.R`, `usethis/R/course.R`) | 48,028 | 79,823 |
| `arbiter-r-runH-2026-10-05.txt` | H | 2026-10-05 04:21, at commit 1b786fa44 | 2 (`usethis/R/ci.R`, `usethis/R/citation.R`) | 48,206 | 80,055 |
| `arbiter-r-runI-2026-10-05.txt` | I | 2026-10-05 04:56, at commit 070834be7 | 1 (`r-testthat/R/expect-invisible.R`) | 48,215 | 80,069 |
| `arbiter-r-runJ-2026-10-05.txt` | J | 2026-10-05 05:29, at commit dcd2cecf9 | 1 (`r-cli/R/width.R`) | 48,209 | 80,062 |
| `arbiter-r-runK-2026-10-05.txt` | K | 2026-10-05 06:58, at commit d2fc8626f | 1 (`usethis/R/create.R`) | 48,098 | 79,914 |
| `arbiter-r-runM-2026-10-05.txt` | M | 2026-10-05 07:44, at commit e971b8fcc | 1 (`r-testthat/R/expect-condition.R`) | 48,096 | 79,900 |
| `arbiter-r-runN-2026-10-05.txt` | N | 2026-10-05, `--fresh`, resumed 0 | 8 (`ggplot2/R/scale-{hue,identity,linewidth,manual,shape}.R`, `r-cli/R/{utils,vt,width}.R`) | 48,037 | 79,783 |
| `arbiter-r-runO-2026-10-05.txt` | O | 2026-10-05, `--fresh`, resumed 0, at analyzer sha256 `ecb02eec` | 4 (`ggplot2/R/scale-{manual,linetype,linewidth}.R`, `r-testthat/R/expect-comparison.R`) | 48,087 | 79,864 |

Run O is the run this lane's current numbers rest on: it was taken at the analyzer build every
other artifact in this lane was measured against (`ecb02eec`), with `--fresh`, so no resume sat
behind it. Its total 79,864 falls inside the 79,756–80,095 band the earlier runs established and
sets no new extremum on any type.

**Run O re-acquires the checkpoint defect, which is the point of recording it.** After
`--fresh` the checkpoint `validation/m14/measurements/walk-r.txt` again holds **2,184 lines and 0
`MARK_BAD` entries**, and again lists `usethis/R/ci.R`, `usethis/R/code-of-conduct.R` and
`r-testthat/R/evaluate-promise.R` as done — all three of which were measured to yield 0 symbols
and 0 edges on the walk that recorded them. `script/m14/resumable-walk.ts` `worker()` writes an
id whenever `run` resolves and has no state for "resolved with nothing", so `--fresh` cannot
clear it: it re-marks whatever the parser manages to return. The 0 `MARK_BAD` entries are the
same defect seen from the other side — the four files run O *did* print `[BB-PARSE-ERR]` for are
also recorded as walked. The §8 report item is in `docs/analyzers/r.md`.

This is why the totals in this directory run thousands below the lane's settled population figure
of **80,083 edges / 29,562 symbols**: the difference is files lost to `memory access out of
bounds`, some within a run and some inherited from an earlier one as done. The per-type counts
here are correct for the files each run actually walked; they are not a population figure, and
the population figure is quoted from `validation/m14/fixtures/r/r-incoming-all.txt`, which
re-walks empty rows and whose ten per-type counts tie `labels-and-resolution.txt` exactly.

Run N is the only run in this directory taken with `--fresh`, so it is the only
one that parsed all 2,184 admitted files inside a single process with no resume
behind it. Every other run walked a checkpoint populated by an earlier one.
That distinction matters for the resume defect recorded below, and run N is the
measurement that stands independent of it.

**Runs K and M are the only two taken AFTER `d2fc8626f`, the commit that changed base
resolution for `overrides` from any-declaration to nearest-PRECEDING-declaration
(`src/ast/real-r-analyzer.ts:408-437`). They are the pre-fix and post-fix pair for
that change, and the effect is confined to `overrides`: 107 edges in the pre-fix
`labels-and-resolution.txt` walk, 95 in the post-fix one, and 95 in BOTH runs K and M.
Every other type is unchanged across the two runs to within the parse-failure wobble
described below (`calls` 48,098 -> 48,096, `uses` 4,801 -> 4,789, `contains` 17,627 ->
17,617). So the change removed 12 `overrides` edges and invented none: the count went
down by 12 in the arbiter's own walk and the 12 are the pairs the analyzer was pairing
against a LATER base declaration, which R never evaluates. Which 12, named file by
file, is `validation/m14/fixtures/r/probe-overrides-scoping.txt`.

Run H was taken after the doc corrections in 1b786fa44, so its bytes describe the tree
this document and `script/m14/r-ruled.ts` are written against. Runs I through M are
further walks of the same population and **set no new extremum on any type** other than
`overrides`, whose change is explained below: every one of their ten counts falls inside
the span the other runs had already established, and `references` 2,137 and `imports`
2,095 both TIE the observed maximum in each. The total band is therefore unchanged at
79,756–80,095 across ten walks. All seven runs in this directory printed
`emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0`.

**Runs K and M are the only two taken AFTER `d2fc8626f`, the commit that changed base
resolution for `overrides` from any-declaration to nearest-PRECEDING-declaration
(`src/ast/real-r-analyzer.ts:408-437`).** They are the post-fix pair, and the effect is
confined to `overrides`: **107 in all four pre-fix runs, 95 in both post-fix runs.**

That is the strongest statement this directory supports, and it is worth stating
precisely because it is not a wobble: `overrides` is the one type with ZERO run-to-run
variance here — a file lost to `memory access out of bounds` contributes no `overrides`
edges, so the loss rate that moves every other type cannot move this one. The 12-edge
drop is therefore attributable to `d2fc8626f` and to nothing else. The walker's
independent re-derivation of those edges is what says the 12 were not facts; that number
is in `oracle-evidence.json`, and which 12, named file by file, is
`validation/m14/fixtures/r/probe-overrides-scoping.txt`.

Every other type is unchanged across the two runs to within the parse-failure wobble
described below (`calls` 48,098 -> 48,096, `uses` 4,801 -> 4,789, `contains` 17,627 ->
17,617, `imports` 2,088 -> 2,093, `references` 2,130 -> 2,135).

Run N continues the same shape with no new extremum: its ten counts all fall
inside the span the earlier runs established, and its total 79,783 is inside the
79,756–80,095 band. It is the run that lost the MOST files (8, against 1–2 for
runs G through M), and the fact that its counts still sit inside the band is the
best evidence in this directory that the wobble is bounded by the file-loss rate
rather than unbounded.

Run J is also the first run in which the file that raised `[BB-PARSE-ERR]` is the SAME
file the 120-second bomb then hung on (`r-cli/R/width.R`), so in that run one file
accounts for both symptoms. Every other run printed the parse error on files
distinct from its hang file. That does not change the loss tally — it is still one
file — but it is the reason a reader counting `[BB-PARSE-ERR]` lines in a run's bytes
can get this directory's per-run loss column wrong, so it is recorded here.

Three earlier runs on 2026-10-05 are not in this directory and are named rather than
cited as evidence, because their bytes were not kept:

- **run F** — `calls` 48,082, `uses` 4,789, `contains` 17,550, `exports` 3,525. It lost
  5 files to `memory access out of bounds` (`ggplot2/R/scale-manual.R`,
  `r-cli/R/width.R`, `r-cli/exec/news.R`, `r-cli/R/zzz.R`,
  `r-testthat/R/expect-equality.R`). It holds the observed MINIMUM for `uses`,
  `contains` and `exports`, so it is in the table; a reader who wants those minima
  re-checked should run the command above and expect a value at or below them.
- the two runs quoted in the document as the arbiter's own two runs (`calls` 48,133
  then 48,008) were captured to `/tmp/opencode/r-arbiter.txt` and
  `/tmp/opencode/r-arbiter2.txt` before this directory existed. `/tmp` is not part of
  the repository, so those two are reported as a rate and not relied on for a minimum.

## The file-loss tally, counted file by file

Twenty-one files were lost to `memory access out of bounds` across eight runs, seven of
whose bytes are in this directory. This README previously implied a different figure
by printing "9 of the 11 are `usethis` or `r-cli`", and listed `usethis/R/badge.R`
among its losses. `badge.R` is not lost by any of these eight runs — it appears in the
`labels-and-resolution.txt` walk and in the two `/tmp` walks named below, neither of
which is one of the eight. Recounting:

| repository | losses |
| --- | --- |
| `usethis` | 4 (`course.R`, `ci.R`, `citation.R`, `create.R`) |
| `r-cli` | 5 (`width.R` in run F and again in runs J and N, `exec/news.R`, `zzz.R`, `utils.R`, `vt.R`) |
| `r-testthat` | 3 (`expect-equality.R`, `expect-invisible.R`, `expect-condition.R`) |
| `ggplot2` | 5 (`scale-manual.R` in run F and again in runs G and N, `scale-hue.R`, `scale-identity.R`, `scale-linewidth.R`, `scale-shape.R`) |

Run N moves the total from 11 distinct files to **17**, and it is what turns
`ggplot2` from one unlucky file into a family: `scale-manual.R` had been lost
twice already, and run N lost four more members of the same
`ggplot2/R/scale-*.R` series in a single walk. Five of the five `ggplot2` losses
are that one series. No rule in `src/ast/real-r-analyzer.ts` reads a filename, so
this is a property of the wasm parser exhausting memory on those files, not of the
analyzer — but it is a property with a NAME, and naming it is worth more than
counting it as five anonymous events. A reader re-running the gate should expect
the `ggplot2/R/scale-*.R` series to contribute losses on roughly half of runs.

Sixteen of the 21 loss events come from the seven run files in this directory and
are countable from their bytes; the other five are run F's, which exist as prose
only. Those 21 losses across 8 runs are **17 distinct files**, and the sixteen
countable ones alone cover 14 of them — the three that only run F lost are
`r-cli/exec/news.R`, `r-cli/R/zzz.R` and `r-testthat/R/expect-equality.R`.

`ggplot2/R/scale-manual.R` is one of the two files lost more than once, lost in run F,
again in run G and again in run N — evidence that WHICH file the parser dies on is not
stable even for a file known to be vulnerable. `r-cli/R/width.R` is the other, lost in
run F and again in runs J and N. Those two files account for 21 events minus 17
distinct files = the 4 repeat events. The figure
that matters for a reader is **9 of the 17 lost files are `usethis` or `r-cli`**.
`r-rlang` (160 files) lost nothing in any run.

What runs K and M add to this table is one new `usethis` file (`create.R`) and one new
`r-testthat` file (`expect-condition.R`), which moves `r-testthat` from 2 to 3. Run N
then adds six more distinct files and moves the `usethis`/`r-cli` share from 8 to 9.
That share is a coincidence of which files the
parser happened to die on, not a property of those two repositories.

## A RESUMED run reports `emitted 0/10` for a lane that emits ten — measured

This is the defect most likely to be read as a verdict about R, so it is recorded
here rather than left in a log. Running the gate a second time WITHOUT `--fresh`,
against a checkpoint that already lists all 2,184 files:

    walk: 2184/2184 files (100.0%)  newly walked 0, resumed 2184
    calls         RULED-UNJUSTIFIED NOT EMITTED and its construct is absent, but NO written ruling was found in the spec
    …  (all ten rows identical)
    emitted 0/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 10

All ten types are EMITTED, on the same tree, in the same corpus, minutes earlier —
run N above is that measurement. The cause is in the shape of
`script/m14/ontology-coverage-gate.ts`: the `observed` map is populated inside the
`run:` callback passed to `resumableWalk`, and `resumableWalk` never calls `run` for a
path the checkpoint already holds. A fully-resumed walk therefore walks zero files and
observes zero edges, which is indistinguishable in the output from a lane that emits
nothing.

It is worse than a wrong number for this lane specifically. Because `R_RULED` is
legitimately empty (all ten types are emitted, so there is nothing left to rule), the
`observed`-empty state falls through to the ruling branch, finds no ruling, and prints
`RULED-UNJUSTIFIED` for all ten — so a resume artifact converts a 10/10 lane into a
lane that appears to have ruled on nothing. A lane with a populated ruling table does
not have this failure mode, which means the defect is invisible on precisely the lanes
most likely to be re-run.

Both files are shared machinery (workstream §8): `script/m14/ontology-coverage-gate.ts`
and `script/m14/resumable-walk.ts`. Reported, not worked around. The workaround for a
reader is `--fresh`, which is why run N is the run this lane's current numbers rest on.

## Every run exits 1, and the verdict is printed first

All of these runs end with

    emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0
    [BB-HANG] parser stuck 120s on <file> — exiting

and a non-zero exit code. Every one of the ten verdict rows prints before the hang
fires; the 120-second parse bomb in `src/ast/engine.ts:1442` calls `process.exit(1)`
process-wide afterwards. `validation/m14/fixtures/r/probe-gate-exit-code.ts` measures
that shape, and the defect is shared machinery (workstream §8), so it is reported
rather than worked around here.

## Reading the counts

The counts are not stable to the digit and are not expected to be. The wasm parser
dies on a different file each run, and a file that fails to parse contributes no
edges, so the totals track the failures. What the gate tests is that every type is
non-zero on the files a run did walk, and it has printed `10/10` on every run
recorded here.

**The exception, and it is the one a reader should not generalize from: `overrides` does
not wobble at all.** In this directory it read 107 in four consecutive pre-fix runs
(G, H, I, J) and 95 in three consecutive post-fix runs (K, M, N), with one commit
between the two groups. A type whose edges all
live in a handful of hand-written test fixtures is immune to the parse-loss rate that
moves the other nine, so its stability here says nothing about the stability of those
nine. Run N is the evidence that it is immune rather than merely stable: that run lost
eight files and `overrides` did not move.

Two things a reader must not do with this directory. First, do not sum the per-type
MINIMUMS in `script/m14/r-ruled.ts` and call the result an observed total: those
minima come from different runs, so the sum mixes sets — 79,702 is such a sum and no
run printed it. The totals runs actually printed are 80,095 / 80,015 / 79,756 /
79,823 / 80,055 / 80,069 / 80,062 / 79,914 / 79,900 / 79,783. Second, do not read a
total here as the population figure; the admitted population is 2,184 files and every
run walked fewer than that.
