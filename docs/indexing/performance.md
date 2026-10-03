# Indexing performance — what to expect

> Every number on this page is quoted from a recorded evidence file in
> `validation/`, with the host it was measured on. Almost all of them come from
> **one** machine: an Intel Core i7-8650U Linux workstation with ~15.5 GiB RAM.
> They are that machine's numbers. They are **not** SLOs, not capacity claims,
> and not portable to your hardware. Where no measurement exists, this document
> says so instead of estimating.
>
> Statements about *behaviour* (which phase runs, which files are skipped) are
> gated against the code by `script/verify-docs-indexing.ts`; statements about
> *timings* are only as good as the evidence file named beside them.

## The short version

- **A small project takes seconds. A large one takes minutes to hours. That is
  normal.**
- **The cost is the number of eligible files**, and secondarily how expensive
  each language's analyzer is — not the number of languages.
- **The parse half of a re-run is nearly free**, because unchanged files are
  never re-parsed — on *every* mode, bare `bb index` included. On an unchanged
  project a bare re-run parses nothing and reports `derived: skipped-unchanged`.
  When a re-run *does* parse something, it pays for the full derived pass, where
  `--changed` pays for a bounded one. That is what the flag buys.
- **The two dominant costs are parsing and writing to the database.** Discovery
  and worker startup are measurable but negligible.
- If you want one number for your own project, run `bb index` once and read
  `bb status`. There is no way to predict it from file count alone.

## What actually determines the time

### 1. How many files are eligible, not how many exist

Discovery skips `.gitignore`d paths, `.bbignore`d paths, built-in skip patterns
(`node_modules`, `dist`, `build`, `out`, `target`, `coverage`, …), and files
over 5 MB (`src/ast/parallel-indexer.ts:253-300`, `:850-877`).

Two corpora can both contain 250,000 files and differ by two orders of
magnitude in index time, because only the eligible ones are parsed. Discovery
itself is cheap — see the bottleneck table below — so **reducing what
discovery finds is the single most effective speedup you have.**

### 2. How expensive each language's analyzer is

This is the dominant variable once file count is fixed. Measured full-index
wall times, one host:

| Corpus | Language | Files | Symbols | Wall | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| cargo | Rust | 1,328 | 16,088 | 38.6s | `validation/m11/systems-known-limitations.md:32` |
| cabal | Haskell | 2,140 | 19,137 | 141.0s | `validation/m11/fp-known-limitations.md:40` |
| elixir | Elixir + Erlang | 616 | 11,189 | 192.4s | `validation/m11/fp-known-limitations.md:38` |
| zig | Zig | 2,950 | 164,506 | 211s | `validation/m11/systems-known-limitations.md:33` |
| julia | Julia | 941 | 27,560 | 168–208s | `docs/analyzers/julia.md:166` |
| grails | Groovy | 7,114 | 64,719 | 494.6s | `reviews/groovy/master-review-2026-09-29.md:436-441` |

Note the shape: `cabal` has more files than `elixir` but takes **less** time;
`elixir` has fewer files than `cargo` but takes **five times** as long. File
count alone does not predict anything.

**There is no measurement in this repository of index time versus *number of
distinct languages*.** Every measurement above holds language count effectively
constant within a corpus. If you have a 20-language monorepo, nobody has
published a number for that shape and this document will not invent one.

### 3. Whether the run has anything to do

Every run — incremental or not — parses only files whose `mtime` **and** `size`
differ from what is stored (`src/ast/parallel-indexer.ts:887-894`). On an
unchanged project that is zero files. The one recorded unchanged-project run —
rake, 57 files — completed in **85 ms** with `parsedFiles: 0` and `noop: true`
(`validation/mA/results/probe-index-ux.json`).

Verified live by `script/verify-docs-indexing.ts --live`: a second bare
`bb index` on an unchanged fixture parses nothing and reports
`derived: skipped-unchanged`.

### 4. The derived phases

After parsing, the derived phases run over the whole project. Current code
records **eight**: `relationships`, `enrichment`, `gravity`, `taint`, `health`,
`integrity`, `vectorBlobs`, `analyze`
(`src/ast/parallel-indexer.ts:576`, `:5561-5680`). The measurement below predates
the last three being recorded, so its table has six rows — the five derived-data
phases plus `integrity`:

| Phase | Time |
| --- | ---: |
| relationships | 2,299ms |
| enrichment | 3,091ms |
| gravity | 409ms |
| taint | 2,582ms |
| health | 124ms |
| integrity | 905ms |
| **total post-processing** | **9,494ms** |

`validation/mA/results/probe-index-ux.json` (element-plus, 2,580 files,
27,781 symbols, 47,480 relationships, 7 workers on an 8-CPU host).

So on that run: parse 141s, dbFlush 169s, post-processing 9.5s. **Parse and DB
flush dominate; enrichment is secondary.** Note this run's shape differs from a
cold full index — see the wall-clock caveat at the end of this document before
using it to reason about first runs.

## Where the time goes

Measured bottleneck classification across five repositories, taking the median
fraction of total wall time each phase consumed
(`validation/m21/results/X3.json`):

| Phase | Median fraction of wall | Verdict |
| --- | ---: | --- |
| Parse | **0.74** | confirmed bottleneck |
| DB flush | **0.345** | confirmed bottleneck |
| Worker startup (fork probe) | 0.009 | disproven as a bottleneck |
| Discovery | 0.002 | disproven as a bottleneck |

Practical consequences:

- **More CPU cores will not rescue a slow index past the worker cap.** Worker
  count is `max(2, min(cpus - 1, 12))` (`src/ast/parallel-indexer.ts:120`), and
  the pool then sizes itself as `min(concurrency, ceil(files / 10))`
  (`src/ast/parallel-indexer.ts:1243`, `:131`). On a 32-core machine you still
  get 12 workers. On a 4-core machine you get 3.
- **12 workers is not automatically faster than 1.** The one controlled A/B in
  the repo (`validation/m19/results/S3.json:37-101`, 100-file disjoint samples on
  intellij) found 12 workers *faster* on the throughput control (20,705ms vs
  22,767ms) but *slower* on the memory control (39,775ms vs 25,482ms). The
  evidence file states these were disjoint sequential samples, "not a
  same-input benchmark". Treat "add workers" as unproven.

## Measured anchors, full index, from scratch

| Corpus | Files | Symbols | Wall | Evidence |
| --- | ---: | ---: | ---: | --- |
| rake | 57 | 779 | 1.93s | `validation/m19/results/S1.json:11-14` |
| lodash | 36 | 1,048 | 3.41s | `validation/m19/results/S1.json:68-73` |
| element-plus | 2,580 | 27,751 | 51.58s | `validation/m19/results/S1.json:74-80` |
| paperclip | 676 | 8,054 | 100.9s | `validation/m19/results/S2-paperclip-timings.json:33` |

**Do not read these as a scaling curve.** They are three points on three
different codebases and the relationship is non-monotonic: lodash (36 files)
took *longer* than rake (57 files). The evidence file says so itself
(`validation/m19/results/S1.json:82-101`, `:103-106`): *"Wall-time is
hardware-bound (machine recorded); not portable"* and *"a scaling curve, not a
production-wide latency promise"* (`docs/m19/BENCHMARKS.md:14-16`).

The full per-phase breakdown for one complete run, element-plus:

```
total 151805ms | parse 141079ms | dbFlush 169079ms | discovery 646ms | startup 322ms
mode worker-pool | workers 7 | noop no
18.1 files/s
```

`validation/mA/results/probe-index-ux.json`. (The `dbFlush` figure exceeds the
parse figure because flushing is overlapped with parsing across workers; the two
are not additive.)

## Very large repositories

| Corpus | Indexed files | Symbols | Wall | Status |
| --- | ---: | ---: | ---: | --- |
| ASP.NET Core | 10,431 | 132,744 | 161s + 92s + 77s + 68s, four slices | verified, finalization deferred per slice (`validation/m19/results/S2-timings.json:55,109,163,217`) |
| IntelliJ Community | 69,509 | 1,071,964 | **not claimed** | counts verified; a single fresh 1,000-file batch took 1,216.9s, so a complete cold run was outside the verification window (`validation/m19/results/S3.json:116`, `:129-131`) |
| groovy (grails) | 7,114 | 64,719 | 494.6s | single process, all tracked files, 0 failures |

The IntelliJ row is the important one. A complete cold full-index wall time for
a repo of that size has **not been measured** and this repository does not
claim one. Anyone who tells you "it'll take N hours" for a 70k-file Java repo is
extrapolating, not reporting.

## How to speed it up

In descending order of effect:

1. **Use `bb index --changed`, not a bare `bb index`.** Both parse only files
   whose mtime or size changed — that filter is not a flag. What `--changed`
   changes is the derived pass: `bounded` (scoped to touched files) instead of
   `full` (the whole project). On a steady codebase this is close to free.
2. **Cut discovery with `.bbignore`.** Discovery is cheap in absolute terms
   (0.002 of wall) but it decides how many files the expensive phases must
   handle. Excluding generated code, vendored trees and fixtures with a
   `.bbignore` (same syntax as `.gitignore`, and it overrides `.gitignore` —
   `src/ast/parallel-indexer.ts:889-894`, `:969-971`) is the highest-leverage
   change you can make on a huge repository. Use it to exclude what you have
   excluded, not to exclude source you intend to search.
3. **Split parse from derived work.** `bb index --skip-post-processing` parses
   and stores and stops; `bb index --post` derives later. The bounded derived
   pass is genuinely cheaper than the full one — one recorded comparison was
   74ms bounded vs 1,940ms full on the same project
   (`validation/m40/results/A2.json:10-24`) — though that measurement is small
   and project-specific.
4. **Fix a silent serial run.** If the summary says `parsed in-process — the
   worker pool was unavailable`, you are paying for a single-threaded parse and
   every number else looks fine. See
   [`troubleshooting.md`](troubleshooting.md); this is the most common cause of
   "indexing is mysteriously slow".
5. **Target one file when you only changed one file.** `bb index --file <path>`
   parses one file and scopes the derived pass to it.
6. **Do not reach for `--force` to make things faster.** It cannot; it is the
   most expensive mode, because it re-parses everything and recomputes every
   derived phase.

## Honest limits of this document

- **Every timing is one machine's.** Intel i7-8650U, ~15.5 GiB RAM, Linux
  (`validation/m19/results/S1.json:15-20`). Hardware, disk and load change these
  numbers by large factors. Load alone moved this repo's own measured latency
  from p50 1,655ms to p50 2,618ms at roughly double the machine load
  (`validation/m57/results/T3-latency-idle.json:53-58`).
- **No cold full-index time exists for this repository.** Its index has been
  measured for *counts* (2,681 files / ~168k symbols;
  `docs/m57/issues/t1.md:13`) and for *read-tool latency*, but no `bb index`
  wall clock is recorded anywhere. Don't infer one from the symbol count.
- **Declared budgets are not measurements.** `docs/M10-BENCHMARKS.md:52-53`
  declares `index cold <= 8s` and `warm single-file reindex <= 1.5s` for a
  ~12-file contract fixture — but `docs/data/m10-benchmark-last-run.json`
  records **no** `index_cold` or `index_warm_reindex` row. Those budgets have
  never been measured. Treat them as unverified.
- **No throughput figure is claimed for the three M19 anchors.**
  `validation/m19/results/S1.json` records milliseconds only. The one
  files-per-second in this area, 18.1 for element-plus, comes from a different,
  second run of that corpus on a different host
  (`validation/mA/results/probe-index-ux.json`).
- **Per-language analyzer timings are not comparable across languages.**
  `validation/m60/analyzer-budget-register.json:24-30` records that 39 of 41
  lanes carry an unresolved scoring debt and that no complexity artifact in the
  repo records node counts, so per-1k-node normalization **cannot be derived**.
  The analyzer table above is a list of measured wall times, not a league table.
- **Embedding time as a share of index time is unknown.**
  `docs/m20/PERFORMANCE-DIAGNOSTIC.md:24` explicitly declines to attribute a
  slow run to embeddings or to WASM parsing for lack of evidence. Embeddings are
  drained in the background after the parse, so they usually land outside the
  measured index window — which is exactly why nobody can attribute them.
- **Nothing here is a promise about your machine.** The only reliable number for
  your project is the one your own `bb status` prints after your own run.

## Related

- [`README.md`](README.md) — what each flag actually does
- [`resume.md`](resume.md) — interrupting and resuming
- [`troubleshooting.md`](troubleshooting.md) — when the run degrades to serial