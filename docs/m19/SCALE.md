# M19 Scale Results

Status: measured evidence, not a universal performance guarantee. The hardware
affects these results, and analyzer precision is not established by indexing
scale alone.

M19 tested the indexing and retrieval substrate against real repositories on one
Linux workstation. The evidence is split into completed measurements and open
measurement gaps. A completed symbol/file count does not prove analyzer
precision; analyzer correctness remains the M14 lane.

## Measured Corpora

| Repository | Evidence | Files indexed | Symbols | Relationships | Timing status |
| --- | --- | ---: | ---: | ---: | --- |
| rake | `validation/m19/results/S1.json` | 57 | 779 | not recorded in S1 | measured: 3.765s |
| lodash | `validation/m19/results/S1.json` | 36 | 1,048 | not recorded in S1 | measured: 3.929s |
| element-plus | `validation/m19/results/S1.json` | 2,580 | 27,751 | not recorded in S1 | measured: 89.580s |
| aspnetcore | `validation/m19/results/S2.json` | 10,431 | 132,744 | 471,421 | **open: complete four-slice ledger missing** |
| intellij-community | `validation/m19/results/S3.json` | 69,504 | 1,071,809 | 4,017,382 | **open: complete ten-slice ledger missing** |

The giant repository file counts discovered by S1 are larger than the indexed
source subsets. S1 recorded 59,027 files for aspnetcore and 273,587 files for
intellij-community; S2/S3 indexed the supported source extensions selected by
the bounded slice runner.

## What Was Proven

- The indexer produced a real 132,744-symbol aspnetcore database and a real
  1,071,809-symbol intellij-community database.
- The stored relationship counts were read from the live databases at
  verification time.
- Known symbols selected from each real repository resolved in the resulting
  databases.
- Retrieval on the intellij database remained bounded after the scale fixes:
  case-insensitive symbol search uses the NOCASE schema index, and giant content
  search avoids building an unbounded one-million-row temporary FTS table.
- When embeddings are unavailable at giant scale, the fallback is labeled and
  `bb_ask` exposes the low-coverage state rather than presenting lexical results
  as semantic proof.

## Open Measurements

S2 and S3 are intentionally not timing-closed. Their original logs were
interrupted during enrichment or taint work and do not contain complete
machine-readable end-to-end slice summaries. A controlled rerun of an ASP.NET
slice exceeded the 600-second execution bound because the enrichment pipeline
reprocessed the accumulated graph. No timing values are inferred from timeout
limits, log modification times, or partial progress output.

The issues remain open until `S2-timings.json` and `S3-timings.json` contain a
complete positive `wallMs` record for every slice. A timeout is not a measured
duration. Until then, this document must not claim giant-repository wall-time
or memory performance.

## Hardware And Reproduction

The measured host recorded by each evidence file is an Intel i7-8650U Linux
workstation with approximately 15.5 GiB RAM. These measurements are comparable
on that host only; they are not portable SLOs.

Run the verifiers from the project root:

```bash
bun run script/m19/verify-scale-bench.ts
bun run script/m19/verify-giant-aspnetcore.ts
bun run script/m19/verify-giant-intellij.ts
bun run script/m19/verify-retrieval-scale.ts
bun run script/m19/verify-fallback-scale.ts
bun run script/m19/verify-closure-gate.ts
```

A non-zero exit from S2 or S3 is expected while the timing ledgers are absent.
That is a known gap, not a successful scale claim.
