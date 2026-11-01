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
| julia | Julia | 941 | 27,560 | 168–208s | `validation/m12/corpus-manifest.json` (the julia entry: 941 `*.jl` files, `corpusSymbols` 27,560) + `docs/analyzers/julia.md:2147` (the timing) |
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

**A phase's time can be a plan rather than work, and on a fresh index the plan is
chosen blind.** The pipeline runs `ANALYZE` at the END of the derived pass, so a
fresh index prepares these statements against tables nothing has measured. One
cold run reported 440.8s for the taint phase; the same statement, same data and
same 1,530 resolved flows cost **520.2s planned without statistics and 1.7s with
them** — and a post pass on the same index after the fix reported the phase at
1.3s. Resolution, enrichment and gravity query tables the run has just written
too; only the taint statement has been measured and fixed so far
(`validation/m60/results/taint-plan-stats.json`, probe:
`script/perf/probe-taint-plan-stats.ts`). Before attributing a slow phase to its
algorithm, check whether its plan was chosen blind.

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
  the repo (`validation/m19/results/S3-controls.json:1-60`, 100-file disjoint samples on
  intellij) found 12 workers *faster* on the throughput control (20,705ms vs
  22,767ms) but *slower* on the memory control (39,775ms vs 25,482ms). The
  evidence file states these were disjoint sequential samples, "not a
  same-input benchmark". Treat "add workers" as unproven.

## Does throughput decay as the index grows?

There is a recorded curve now. It says the per-file rate does not fall because
later files are more expensive — but the number a run finishes with *is* lower
than the number the bar showed at its best, for a different reason.

`validation/m60/results/index-scaling-curve.json` holds nested pool tiers
(n50 ⊂ n200 ⊂ n400 ⊂ n800 — prefixes of one deterministic ordering of this
repository's own TypeScript, materialised by `script/perf/make-pools.sh`, each
indexed into a fresh data dir by `script/perf/profile-stages.ts`), two real
corpora indexed through the CLI, and the rendered `files/s` series of two runs.
It carries two arms — the resolution plan before and after the linear fix — and
the raw per-tier output is committed beside it.

Pool tiers, after-arm, on the Linux workstation (load1 5.1–13.9 across the runs;
each tier is a superset of the tier above it):

| Tier | Files | Relationships | Wall | files/s | parse | dbFlush | derived |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| n50 | 47 | 7,968 | 19.8s | 2.4 | 84% | 21% | 7% |
| n200 | 196 | 63,331 | 76.1s | 2.6 | 80% | 47% | 17% |
| n400 | 396 | 91,379 | 105.8s | 3.7 | 74% | 54% | 23% |
| n800 | 796 | 124,114 | 147.0s | 5.4 | 72% | 70% | 26% |

Three things to read out of it:

- **files/s rises with size here, it does not fall** — 2.4 → 5.4 over 17× the
  files, and the largest tier ran against *more* machine load than the smallest.
  The small tiers are where discovery, worker startup and the first flush are a
  larger fraction of a short run.
- **Parse and DB flush are the run at these sizes**, and workers overlap them, so
  the two columns are not a partition and do not add up to 100%.
- **The derived phases grow as a share of the run** (7% → 26% across these tiers,
  41% at the 12k-file corpus below). What does *not* grow is the per-relationship
  cost of resolution: 0.45 candidate rows per stored relationship at 47 files →
  0.57 at 196 files, a 1.25× growth over 4× the files, and resolve milliseconds
  per relationship at 1.03×. Both growth factors are gated
  (`validation/m60/results/scaling-linear.after-linux.json`).

The two arms of that curve produce the same *graph* at every tier: the
relationship-multiset digest is byte-identical between the window plan and the
linear plan at n50, n200, n400 and n800. What changed is cost, not output.

### The rate the bar shows is not a parse rate

The `X/s` on the progress line — and in `bb status` while a run is in flight — is
`processed files / elapsed-since-start`: a running average over the **whole**
run. It climbs while the pool is saturating, peaks when the last file is stored,
and then decays through the derived pass, where no file completes and the clock
keeps running. `script/perf/live-rate-series.ts` captures it. On element-plus
(2,581 files) the recorded series peaks at **30.1 files/s at 85s**, and the run
as a whole reports 102.6s — **25.2 files/s**. That 20% gap is the tail, not a
parse slowdown. On lodash (73 files, 27.4s) the same arithmetic is starker: peak
5.7 files/s, whole run 2.7 files/s.

So a figure like "22 files/s" is a whole-run number: files divided by everything
the run did, tail included. The parse-only rate is always higher, and the gap is
as large as the derived pass is.

## Measured anchors, full index, from scratch

| Corpus | Files | Symbols | Wall | Evidence |
| --- | ---: | ---: | ---: | --- |
| rake | 57 | 779 | 1.93s | `validation/m19/results/S1.superseded-e7c9819f4.json:61-65` |
| lodash | 36 | 1,048 | 3.41s | `validation/m19/results/S1.superseded-e7c9819f4.json:68-72` |
| element-plus | 2,580 | 27,751 | 51.58s | `validation/m19/results/S1.superseded-e7c9819f4.json:75-79` |
| paperclip | 676 | 8,054 | 100.9s | `validation/m19/results/S2-paperclip-timings.json:33` |

**Do not read these as a scaling curve.** They are three points on three
different codebases and the relationship is non-monotonic: lodash (36 files)
took *longer* than rake (57 files). The evidence file says so itself
(`validation/m19/results/S1.superseded-e7c9819f4.json:104`): *"Wall-time is
hardware-bound (machine recorded); not portable"* and, for the second quote,
`docs/m19/BENCHMARKS.md:14-16`.

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
| IntelliJ Community | 69,509 | 1,071,964 | **not claimed** | counts verified; a single fresh 1,000-file batch took 1,216.9s, so a complete cold run was outside the verification window (`validation/m19/results/S3.superseded-e7c9819f4.json:116-131`, `validation/m19/results/B1.json:42-43`) |
| groovy (grails) | 7,114 | 64,719 | 494.6s | single process, all tracked files, 0 failures |
| ASP.NET Core | 12,177 | 196,030 | 2,207.7s | one cold run at this repository's HEAD, full derived pass: 898.8s of the 2,207.7s (41%) is post-processing — `taint` alone is 440.8s, larger than the 297.2s resolution phase (`validation/m60/results/index-scaling-curve.json`) |

The last row is a different measurement from the four-slice row above it: a
single cold run, on a later build, with the derived pass included rather than
deferred per slice. Its shape is the one worth carrying away — **41% of a 37-minute
index stores no files at all**, so a `files/s` figure for a corpus this size is
dominated by work that has nothing to do with files.

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
  `validation/m19/results/S1.json` records milliseconds only. The 18.1
  files-per-second for element-plus comes from a different, second run of that
  corpus on a different host (`validation/mA/results/probe-index-ux.json`); the
  newer figures on this page — 23.9 and 25.2 files/s for element-plus, 5.5 for
  ASP.NET Core — come from `validation/m60/results/index-scaling-curve.json` and
  are one machine's and two builds', not a portable rate.
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