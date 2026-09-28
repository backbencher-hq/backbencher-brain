# M19 Scale Results

Status: measured evidence, not a universal performance guarantee. The hardware
affects these results, and analyzer precision is not established by indexing
scale alone.

M19 tested the indexing and retrieval substrate against real repositories on one
Linux workstation. S2 is verified for its measured contract, including four
clean ASP.NET ingestion slices and a separate full-finalization Paperclip
control. S3 is verified-partial: its live MEGA index and bounded worker/memory
controls pass, while a complete cold ten-slice timing run is explicitly not
claimed. A completed symbol/file count does not prove analyzer precision;
analyzer correctness remains the M14 lane.

## Measured Corpora

| Repository | Evidence | Files indexed | Symbols | Relationships | Timing status |
| --- | --- | ---: | ---: | ---: | --- |
| rake | `validation/m19/results/S1.json` | 57 | 779 | not recorded in S1 | measured: 1.928s |
| lodash | `validation/m19/results/S1.json` | 36 | 1,048 | not recorded in S1 | measured: 3.414s |
| element-plus | `validation/m19/results/S1.json` | 2,580 | 27,751 | not recorded in S1 | measured: 51.579s |
| aspnetcore | `validation/m19/results/S2.json` | 10,431 | 132,744 | 268,793 | **verified: four clean deferred-finalization slices; full-finalization control is Paperclip** |
| paperclip | `validation/m19/results/S2.json` | 676 | 8,054 | 22,491 | **verified: full-finalization control, 100.907s, runner RSS 150,716 kB, external RSS 399,164 kB** |
| intellij-community | `validation/m19/results/S3.json` | 69,509 | 1,071,964 | 3,524,679 | **verified-partial: bounded controls pass; full cold ten-slice timing not claimed** |

The giant repository file counts discovered by S1 are larger than the indexed
source subsets. S1 recorded 59,027 files for aspnetcore, 42,925 files for
paperclip, and 273,587 files for intellij-community. S2/S3 indexed the
supported source extensions selected by the bounded slice runner. Candidate and
eligible counts are recorded in the corresponding timing ledgers.

## What Was Proven

- The indexer produced a real 132,744-symbol aspnetcore database, an 8,054-symbol
  Paperclip database, and a 1,071,964-symbol intellij-community database.
- The stored relationship counts were read from the live databases at
  verification time.
- Known symbols selected from each real repository resolved in the resulting
  databases.
- All four ASP.NET timing slices processed every eligible file with zero
  skips, timeouts, or errors, and each row records runner peak RSS.
- A separate full-finalization Paperclip run processed 676/676 files with zero
  failures and records both runner and `/usr/bin/time -v` RSS. The ASP.NET slice
  timings intentionally defer heavy relationship enrichment, taint, gravity,
  and health work; they are not full ASP.NET end-to-end wall-time claims.
- The intellij live index passed its scale and known-symbol checks. Disjoint,
  sequential 100-file controls measured one-worker and twelve-worker ingestion
  plus peak RSS, with zero failures.
- Retrieval on the intellij database remained bounded after the scale fixes:
  case-insensitive symbol search uses the NOCASE schema index, and giant content
  search avoids building an unbounded one-million-row temporary FTS table.
- When embeddings are unavailable at giant scale, the fallback is labeled and
  `bb_ask` exposes the low-coverage state rather than presenting lexical results
  as semantic proof.

## Timing Limitations

S2's ASP.NET slice timings use explicit deferred finalization so the expensive
post-index pipeline is not repeated for every bounded slice. That makes the
ingestion measurements finishable and auditable, but excludes heavy relationship
enrichment, taint, gravity, and health from those ASP.NET wall times. The
separate Paperclip control proves that full finalization can complete on an
in-scope S2 repository; it does not turn the ASP.NET deferred rows into full
ASP.NET end-to-end timings.

S3's issue permits an honest measured partial when a full cold run is infeasible.
The live 1,071,964-symbol index, one fresh 1,000-file batch, worker-count
comparison, and sequential RSS controls are recorded. The first fresh batch
took 1,216.877 seconds, so a complete cold ten-slice timing ledger is not
claimed. This is a limitation, not a hidden pass.

No timing values are inferred from timeout limits, log modification times, or
partial progress output. A timeout is not a measured duration. The S3 full cold
ten-slice timing is outside the bounded verification window and is not claimed.

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
bun run script/m19/verify-bench-docs.ts
bun run script/m19/verify-closure-gate.ts
```

S2 is a verified measured result. S3 is a verified-partial result by the issue's
explicit partial acceptance path; neither status claims analyzer AST correctness
or portable production performance.
