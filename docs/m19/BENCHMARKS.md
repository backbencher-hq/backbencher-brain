# M19 Benchmark Contract

This document declares what M19 measures and what it does not claim. Numbers
are evidence from `validation/m19/results`, not targets adjusted after a run.

## Anchor Indexing Measurements

| Corpus | Files | Symbols | Wall time | Interpretation |
| --- | ---: | ---: | ---: | --- |
| rake | 57 | 779 | 3.765s | measured anchor |
| lodash | 36 | 1,048 | 3.929s | measured anchor |
| element-plus | 2,580 | 27,751 | 89.580s | measured anchor; largest indexed anchor |

These are one-run measurements on the recorded host. They establish a scaling
curve, not a production-wide latency promise. The hardware affects the result,
and analyzer precision is not established by an indexing benchmark.

## Giant-Repository Acceptance Bars

A giant index is not timing-verified until all of the following are present:

- positive file, symbol, and relationship counts read from the live database;
- a complete machine-readable slice ledger;
- one positive `wallMs` and `filesInSlice` for every planned slice;
- host information recorded with the evidence;
- an explicit negative record for any timeout, OOM, skipped phase, or incomplete
  enrichment step.

S2 currently passes the database-count and known-symbol checks but fails the
complete four-slice timing-ledger check. S3 currently passes the database-count
and known-symbol checks but fails the complete ten-slice timing-ledger check.
Both issues remain open. The M19 closure gate enforces this condition. The
required ledgers are `S2-timings.json` and `S3-timings.json`; a timeout is not a
measured duration.

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

M19 records host RAM in every scale evidence file. It does not claim a fixed
memory ceiling because peak RSS was not captured by the existing slice runs.
That is an open measurement limitation, not an omitted result.

The intellij giant index was built with embeddings bounded off. Q2 proves that
zero coverage is reported and that lexical fallback carries an explicit reason.
It does not prove semantic recall with one million dense vectors.

## Evidence Rules

- Missing timing is a failure of the timing acceptance bar, not a zero.
- A timeout is recorded as a timeout, never converted into a duration.
- Counts are read from the database at verifier runtime.
- Analyzer precision and AST correctness are outside this scale milestone's
  indexing-completion claim.
- Any website statement must link to the corresponding evidence and preserve
  the negative lines above.

Primary evidence: `S1.json`, `S2.json`, `S3.json`, `Q1.json`, and `Q2.json`.
The machine-checkable B1 verifier checks that these docs contain the same
measured values and the required limitations.
