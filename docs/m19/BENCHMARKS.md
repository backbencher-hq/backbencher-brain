# M19 Benchmark Contract

This document declares what M19 measures and what it does not claim. Numbers
are evidence from `validation/m19/results`, not targets adjusted after a run.

## Anchor Indexing Measurements

| Corpus | Files | Symbols | Wall time | Interpretation |
| --- | ---: | ---: | ---: | --- |
| rake | 57 | 779 | 1.928s | measured anchor |
| lodash | 36 | 1,048 | 3.414s | measured anchor |
| element-plus | 2,580 | 27,751 | 51.579s | measured anchor; largest indexed anchor |

These are one-run measurements on the recorded host. They establish a scaling
curve, not a production-wide latency promise. The hardware affects the result,
and analyzer precision is not established by an indexing benchmark.

## Giant-Repository Acceptance Bars

A giant index must expose all of the following before its evidence is accepted:

- positive file, symbol, and relationship counts read from the live database;
- a machine-readable timing or partial-measurement ledger;
- positive `wallMs` for every claimed timing row or control;
- host and exact repository state information;
- explicit candidate-versus-eligible file accounting;
- an explicit negative record for any timeout, OOM, skipped phase, or incomplete
  enrichment step.

### S2: aspnetcore and paperclip

S2 is verified for its issue contract. The ASP.NET source inventory is derived at
verification time: 11,910 candidates, 10,431 eligible/indexed files, 132,744
symbols, and 268,793 relationships. Four current-schema deferred-finalization
slices processed every eligible file with zero skips, timeouts, or errors and
recorded runner peak RSS values of 147,832, 168,756, 150,528, and 139,312 kB.
Deferred finalization is explicit: those ASP.NET wall times measure ingestion and
do not include the heavy relationship-enrichment, taint, gravity, and health
phase.

The second in-scope repository, Paperclip, has a complete full-finalization
control: 676/676 eligible files, 8,054 symbols, 22,491 relationships, 100.907s,
runner peak RSS 150,716 kB, and external `/usr/bin/time -v` peak RSS 399,164 kB.
This proves the complete finalization path on an in-scope S2 repository; it does
not convert the deferred ASP.NET rows into full ASP.NET end-to-end timings.

### S3: intellij-community

S3 is verified-partial under the issue's explicit partial acceptance path. The
live index contains 69,509 indexed source files, 1,071,964 symbols, and 3,524,679
relationships. Four disjoint, sequential 100-file controls all completed with
zero failures, including one-worker and twelve-worker wall-time controls and
peak-RSS controls. The first fresh 1,000-file batch also completed with zero
failures in 1,216,877 ms.

A complete cold ten-slice timing run is not claimed: the first fresh batch alone
took 1,216.877 seconds on this machine, so completing the remaining cold workload
was outside the bounded verification window. The full cold ten-slice timing is not
claimed. That measured limitation is part of
the result, not a missing or inferred duration.

## Retrieval Budgets At Scale

M19 uses these engineering budgets for the giant-index retrieval probe:

| Operation | Budget | Result |
| --- | ---: | --- |
| symbol search, median | < 3,000ms | passed after NOCASE index fix |
| matched content search, median | < 2,000ms | passed after bounded giant path |
| no-match content scan | < 15,000ms | bounded and measured |
| semantic fallback on no embeddings | < 15,000ms | passed and labeled |

The budgets are diagnostic acceptance bars for this machine. They do not mean
that every repository, disk, CPU, or cold cache will satisfy the same latency.

## Memory And Embedding Limits

M19 records host RAM and measured peak RSS in the scale evidence where available.
It does not claim a universal memory ceiling. Runner RSS and `/usr/bin/time -v`
RSS are retained as measurements from different observers; they are not silently
normalized into one number.

The intellij giant index was built with embeddings bounded off. Q2 proves that
zero coverage is reported and that lexical fallback carries an explicit reason.
It does not prove semantic recall with one million dense vectors.

## Evidence Rules

- Missing timing is a failure of the relevant full-timing claim, not a zero.
- A timeout is recorded as a timeout, never converted into a duration; it is not a measured duration.
- Counts and inventories are read from the database and source walk at verifier
  runtime.
- Deferred-finalization timings must state which phases were excluded.
- An explicitly accepted partial must state the measured reason and must not be
  labeled as a complete cold benchmark.
- Analyzer precision and AST correctness are outside this scale milestone's
  indexing-completion claim.
- Any website statement must link to the corresponding evidence and preserve
  the negative lines above.

Primary evidence: `S1.json`, `S2.json`, `S3.json`, `Q1.json`, and `Q2.json`.
The machine-checkable B1 verifier checks that these docs contain the same
measured values and the required limitations.
