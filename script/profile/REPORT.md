# Where index time actually goes — the 1h 4m question

**Agent 4 · branch `agent/4-slot` · measured on the real repo index, not a fixture.**

Reproduce everything below with:

```bash
export PATH="/private/var/folders/4j/11tssyqj4kj0f8dfz06jsb700000gn/T/opencode/bb-runtime/node-v22.23.3-darwin-x64/bin:$PATH"
npx tsx script/profile/profile-post.mts     # per-phase wall clock, ~23 min
npx tsx script/profile/measure-costs.mts    # ANALYZE + gravity decomposition, ~8 min
npx tsx script/profile/i13-anatomy.mts      # why the name-resolution pass is slow
npx tsx script/profile/query-plans.mts      # EXPLAIN QUERY PLAN, read-only
```

Raw output: `script/profile/results/*.json`.

---

## 0. The answer

The derived pass on the real index takes **1,378.2 s (23.0 min)**, and **84% of it is one
statement** — the name-resolution pass in `resolveRelationships`. It materialises a
**52,829,262-row intermediate to choose 217,720 targets**.

The mechanism is measured, not guessed: 453,476 symbols share only **56,248 distinct
names**, so a relationship whose `target_external` is a bare identifier joins to
**242.65 symbols on average** — and `ROW_NUMBER()` then throws away 242 of every 243.
**20 parameter names account for 56.7% of that intermediate**; the name `name` alone
contributes 12.45M rows from 825 edges, because 15,091 symbols in this repo are called
`name`.

```
post-pass, 1,378.2s wall (the product's own timers)
  phase              ms       %wall
  relationships  1157541     84.0%   <-- 84% of the pass
  gravity           79397      5.8%
  enrichment        58917      4.3%
  analyze           37377      2.7%
  integrity         17166      1.2%
  health              2715      0.2%
  vectorBlobs          807      0.1%
  taint                468      0.0%
  UNATTRIBUTED       23791      1.7%   (lock acquire/release + DB open)
```

---

## 1. Corpus

| | |
|---|---|
| project id | `818db37d8f54173ad1357ab24627373da2e9418c` (the repo, itself) |
| files | 8,126 |
| symbols | 453,476 |
| relationships | 630,467 |
| embeddings | 94,484 |
| taint flows | 9,496 |
| DB size | 2,585,137,016 B (2.4 GiB; 630,646 pages × 4096) |
| distinct symbol names | 56,248 → **8.06 symbols per name** |
| max symbols for one name | **15,091** (`name`) |
| names with >100 / >1,000 symbols | 469 / 60 |
| bare-name edges (the i13 population) | 217,720 |
| edges with no attached target | 33,408 |
| relationships with `metadata` | 630,467 (of which 576,598 carry `inferredAt`) |
| edges whose source symbol is missing | 53,870 |

Machine: macOS (darwin), Node v22.23.3, better-sqlite3 11.10.0, SQLite WAL +
`synchronous=NORMAL`.

---

## 2. Method, and what it can and cannot see

Three independent levels, so no single tool has to be trusted:

1. **Phase wall clock** — `runPostProcessing`'s own `PostProcessingPhaseTiming[]`. This is
   the number the CLI prints. Authoritative by construction.
2. **Statement cost** — measured by running the statements directly against a copy of the
   corpus, with no product code involved (`measure-costs.mts`).
3. **Query plans** — `EXPLAIN QUERY PLAN`, read-only, against the same copy.

### An instrumentation result worth stating, because it changed the design

An earlier revision of `profile-post.mts` wrapped `BrainDatabase.getRawInstance` in a
`Proxy` to time every statement. It worked for six phases and **broke the seventh**:
`enrichRelationships` threw after **2 ms** under the Proxy and took **54 s** without it
(both measured, `script/profile/check-enrichment.mts`). better-sqlite3 11.10.0 exposes no
`db.trace`, so there is no hook that observes statements without changing the object's
behaviour.

The shipped profiler therefore **does not touch the product's DB handle at all**. It reports
only what the product measures itself. Statement costs come from level 2, where no product
code is involved. `script/profile/results/post-pass.json` is the discarded Proxy run, kept
because its *ratios* are still valid — every phase there faced the same cold cache — but its
absolute numbers are inflated and **are not used for any claim about seconds saved**.

### The profiler's own cost

Row counts are taken through a **separate read-only handle**. In the shipped run that cost
**18,805 ms over 13 calls**; in the discarded Proxy run it was **39,200 ms over 56 calls** and
is excluded from the statement tables. Counting 630k rows is not free.

---

## 3. Phase-level breakdown (task 1)

### 3.1 The derived pass — measured, `profile-post.mts`

| phase | ms | % wall | outcome |
|---|---:|---:|---|
| relationships | 1,157,541 | 84.0% | ok |
| gravity | 79,397 | 5.8% | ok |
| enrichment | 58,917 | 4.3% | ok |
| analyze (planner stats) | 37,377 | 2.7% | ok |
| integrity | 17,166 | 1.2% | ok |
| health | 2,715 | 0.2% | ok |
| vector blobs | 807 | 0.1% | ok |
| taint | 468 | 0.0% | ok |
| unattributed | 23,791 | 1.7% | lock + DB open |
| **wall** | **1,378,179** | | |

**This run validates against the user's reported numbers:** `analyze` measured **37,377 ms**
here against the **35.5 s** in the real run. The conditions are comparable.

Row counts at every phase edge (`post-pass-phases.json`) show the pass changes
`attached` 597,059 → 597,530 and rewrites 107,138 relationship metadata rows; files,
symbols, relationship count, taints and embeddings are unchanged throughout.

### 3.2 The statements inside the pass

From the discarded Proxy run, profiler queries removed. **Ratios are usable; absolutes are
inflated by a cold 2.4 GiB cache** — treat them as relative shares.

| ms | calls | rows changed | statement | where |
|---:|---:|---:|---|---|
| 992,643 | 1 | — | `CREATE TEMP TABLE _i13_pick AS … ROW_NUMBER() OVER (PARTITION BY rel_id …)` | `parallel-indexer.ts:4193` |
| 82,328 | 1 | — | `ANALYZE` | `parallel-indexer.ts:5529` |
| 70,727 | 1 | 597,530 | cross-language normalisation, 2 correlated `EXISTS` | `:4248` |
| 65,566 | 1 | 406,752 | gravity step 2 (correlated COUNT + `EXISTS`) | `:85` |
| 53,056 | 1 | 453,476 | gravity step 1 (full-table rewrite) | `:77` |
| 46,947 | 1 | 191,157 | i13 APPLY: `UPDATE … FROM _i13_pick` | `:4215` |
| 23,965 | 1 | 436,537 | gravity step 3 (`layer='core'`) | `:98` |
| 16,624 | 1 | 152,223 | `is_cross_file` recompute (implicit self-join) | `:4225` |
| 15,706 | 1 | — | integrity `checkOrphanTargets` (`COUNT` + `NOT EXISTS`) | `brain-index-health.ts:252` |
| 11,668 | 1 | — | integrity `checkDanglingSources` | `brain-index-health.ts:290` |
| 11,024 | 1 | 415,799 | populate `_res_qname` | `:4043` |

The single statement is **67.5% of the whole post pass** and **85.7% of the relationships
phase**.

### 3.3 Parse side — NOT MEASURED, and why

`script/profile/profile-parse.mts` exists and runs, but its result is **not reported here
as a number**. The user's run parsed 352 newly-changed files; the worktree had moved
substantially since the staged index was taken, so an incremental run re-parsed far more
and ran past 1h 15m before being stopped. Its numbers would describe a different scenario
than the one being investigated, and quoting them would be worse than quoting nothing.

**Discovery, worker startup, parse, and `dbFlush` are therefore unmeasured.**

One incidental observation from that run: `[STORE] grammar.json: 7496ms 7495r` — the large
JSON corpus fixtures under `validation/` are individually slow to store (up to ~7.5 s each).
Not quantified; noted only so it is not rediscovered from scratch.

### 3.4 The gap between 1,378 s and 3,850 s

The user's full index took 3,850 s. The derived pass on the same corpus is 1,378 s. That
leaves **~2,470 s (64%) unaccounted for**, and it is **not** in any phase timer the indexer
records.

The prime suspect is named and cited: embedding generation runs through a **background queue
with no phase timer at all**. `parallel-indexer.ts:1915` documents `flushBackgroundEmbeddings`
as "Await completion of all queued background embedding jobs, with a deadline", and its
comment records "**no production caller BY DESIGN**". `phases` records `discoveryMs`,
`workerStartupMs`, `parseMs`, `dbFlushMs`, `postProcessingMs`, `finalAccountingMs` — and no
embedding term. 79,649–94,484 embeddings over an HTTP API is the largest untimed block in an
index run.

**I could not measure it**: it requires an embeddings API key, which this work is not
permitted to use.

---

## 4. The top 3 costs (task 2)

### #1 — the i13 name-resolution pass: **1,157 s phase / ~993 s in one statement**

**CPU-bound or I/O-bound?** CPU-bound in SQLite's sorter, not I/O: peak RSS for the whole
pass is **592 MiB** against a 2.4 GiB database, and the statement's own cost was reproduced
four times at 147.7 s / 565.5 s / 438.8 s / 1010.0 s on partial populations with RSS flat
at ~62 MiB.

**Is it super-linear?** Its cost is

```
candidates = Σ (over bare-name edges) |symbols sharing that name|
```

— a **product** of two quantities that both grow with the project. Measured at four edge
scales:

| edges | candidate rows | candidates/edge |
|---:|---:|---:|
| 31,976 | 7,027,381 | 220 |
| 87,325 | 25,054,623 | 287 |
| 127,518 | 33,147,862 | 260 |
| 198,519 | 50,280,273 | 253 |
| **217,720 (all)** | **52,829,262** | **242.65** |

`candidates/edge` is roughly **constant**, so the pass is **linear in edges with a ~250×
multiplier** — not quadratic in edges. But the multiplier is itself a function of project
size (more symbols per name as the vocabulary and the parameter-name set grow), so total
cost grows as the product of two growing factors. **On this corpus the practical growth is
super-linear overall and linear-in-edges within it.**

I could not fit a clean exponent: the timing at each scale was dominated by page-cache and
disk contention (two jobs were running), and a rowid prefix is not a random sample of the
edge population. The candidate **counts** are stable and are what the recommendation rests
on.

**The concrete cost, and why it is waste:** the statement materialises 52,829,262 rows to
assign 217,720 targets. It is **not** a fixpoint on this index — a second pass still
re-resolves and re-binds (attached 597,059 → 597,530).

**The distribution is the whole story** — top 20 names by symbol count, share of the
intermediate:

| name | symbols | edges | product | share |
|---|---:|---:|---:|---:|
| `name` | 15,091 | 825 | 12,450,075 | 23.6% |
| `type` | 10,881 | 187 | 2,034,747 | 3.8% |
| `kind` | 10,451 | 184 | 1,922,984 | 3.6% |
| `file` | 9,772 | 254 | 2,482,088 | 4.7% |
| `target` | 9,185 | 135 | 1,239,975 | 2.3% |
| `id` | 6,268 | 255 | 1,598,340 | 3.0% |
| `from` | 6,002 | 272 | 1,632,544 | 3.1% |
| `detail` | 5,423 | 438 | 2,375,274 | 4.5% |
| `line` | 4,978 | 260 | 1,294,280 | 2.4% |
| *(top 20 combined)* | | | | **56.7%** |

Every one of these is a **parameter or local-variable name**. A relationship whose
`target_external` is `detail` fans out to all 5,423 symbols named `detail`, in every file in
the repo, to pick one. 56.7% of 16.5 minutes is spent resolving edges that name an
identifier so common it cannot identify anything.

### #2 — gravity: **79 s, and 99% of it is row rewrites**

Measured decomposition (`measure-costs.mts --only-gravity`, 64 MiB page cache, same copy):

| | ms |
|---|---:|
| (a) read every column the SET expression needs, **no write** | **5** |
| (b) sum the payload bytes a rewrite must move (90 MiB counted; `source_text` double-counted in this query, real payload ≈ 57 MiB) | 656 |
| (c) correlated `COUNT` + `EXISTS` per symbol, **no write** | **38** |
| (d) **WRITE** step 1 — full-table rewrite, 453,476 rows | **11,573** |
| (e) **WRITE** step 2 — correlated + rewrite | **15,188** |
| (f) **WRITE** steps 3 + 3b + 4 — layer-weighted | **12,892** |

**Reads and subqueries: 43 ms. Writes: 39,653 ms — a ratio of 922:1.** Gravity is
**I/O-bound on row rewrites**, not CPU and not algorithmic. The correlated subqueries that
look quadratic are **38 ms**.

The reason it is I/O: five separate passes mutate the same column over a 2.4 GiB database
with a 64 MiB page cache.

**A hypothesis I checked and rejected:** I expected `source_text` to make `brain_symbol` rows
large and so explain the write cost. Measured: `source_text` averages **76.9 bytes**, is
present on only **93,255 of 453,476** symbols, and totals **33.3 MiB**. The rows are not the
problem; the **number of passes** is.

### #3 — planner stats (`ANALYZE`): **37 s, on every post pass, unconditionally**

| condition | ms |
|---|---:|
| in the post pass (authoritative, cold-ish cache) | **37,377** |
| standalone, warm cache, runs 2-3 | 4,838 / 4,859 |
| standalone, first run on a freshly copied 2.4 GiB DB | **60,469** |
| `PRAGMA optimize` on an already-analyzed DB | **1** |
| `ANALYZE` with `analysis_limit=1,000` | 1,418 |
| `ANALYZE` with `analysis_limit=10,000` | 1,594 |
| `ANALYZE` with `analysis_limit=100,000` | 2,138 |

**The 4.8 s -> 60.5 s spread is page-cache, not the database — a 12.5x swing between the first and second run of the SAME statement on the SAME file.** Across four standalone runs the warm figure moved between 4.4 s and 7.6 s. The spread is the finding; the table quotes the committed run. It is a full scan of every
index — `brain_symbol` has **15** indexes and `brain_relationship` has **15**. The user's
reported 35.5 s and my 37.4 s agree, so their cache state resembles the post-pass run's.

**Is it worth it?** Yes, and this must not be read as "delete it". The comment at
`parallel-indexer.ts:5520-5526` records the measurement that the statistics are load-bearing:
without `sqlite_stat1` the planner guessed a full `brain_symbol` scan per graph hop, ~15 s per
`bb_graph` call, and `bb_patterns` timed out at 45 s. `sqlite_stat1` is present here (60
rows). The finding is that the cost is paid **unconditionally on every post pass**, including
passes that changed little.

---

## 5. The obvious suspects, checked with evidence (task 3)

### Is relationship resolution indexed lookups or scans?

Mixed, and the plan tells you which is which (`query-plans.mts`, with `sqlite_stat1` present):

| statement | plan | verdict |
|---|---|---|
| gravity step 1 | `SCAN brain_symbol` | full scan — unavoidable, it rewrites every row |
| gravity step 2 | `SCAN brain_symbol` + 2 `CORRELATED SCALAR SUBQUERY`, each `SEARCH … USING COVERING INDEX brain_rel_target_cross_idx` | **indexed**, 51 ms read-only |
| i13 pick | `SCAN t` (temp) + `SEARCH r USING PK` + `SEARCH s USING brain_sym_proj_name_type_idx (project_id=? AND name=?)` | **indexed lookup, but the result is 52.8M rows** |
| i13 cross-language | `SEARCH brain_relationship USING brain_rel_proj_target_idx` + 4 PK lookups per row | indexed |
| i13 `is_cross_file` | `SCAN brain_relationship` + 2 PK lookups | scan (no usable index: `instr(…)` and `<> 'contains'`) |
| enrichment page | `SEARCH r USING INTEGER PRIMARY KEY (rowid>?)` + 3 PK/rowid lookups | indexed — the keyset paginator works |
| enrichment in-degree | `SEARCH … USING COVERING INDEX brain_rel_proj_target_idx` | indexed |

**So resolution is NOT doing quadratic per-row scans.** The lookups are indexed. The cost is
the **size of the join result**, which no index can fix.

### Is enrichment bounded? Is it O(n²)?

**Bounded, and O(n).** `ENRICHMENT_MAX_ROWS = 2,000,000`
(`brain-relationship-enrichment.ts:106`) against 630,467 rows, so the cap never engages.
`BATCH = 20,000` with keyset pagination; the plan for the page query is all-indexed.

Measured: **58,917 ms in the post pass**, rewriting **107,138 rows** (`considered` 576,597,
`unchanged` 469,459). The no-op filter means a second pass rewrites nothing.

One structural observation: **53,870 edges have no source symbol** (measured), so they are
`LEFT JOIN`-dropped, never written, and **re-selected on every pass**. That is 8.5% of the
page scan spent on rows the pass can never enrich.

### Is `ANALYZE` run every time? Is it worth it?

Every post pass, unconditionally, at `:5529`. Worth it (see above) but see R2.

### Are indexes present on the columns these queries filter/join on?

Mostly yes, and this was **checked rather than assumed** — 31 indexes exist across the two
tables. Three gaps found:

1. **No index on `brain_symbol(layer)`** — gravity steps 3/3b/4 each `SCAN brain_symbol`.
   Measured cost of all three: 16,838 ms, so the scans are not free, but an index would add
   write amplification to an already write-bound phase. **Untested trade-off — do not assume
   it is a win.**
2. **`brain_symbol(project_id, name)` has no `file_id`** — the i13 ranking's first key after
   the declaration flag is same-file, and it cannot be satisfied from the index.
3. **No usable index for the `is_cross_file` recompute** — `instr(target_external,'.')` and
   `instr(target_external,':')` are function calls on the column.

---

## 6. Recommendations, ranked by seconds saved per unit of risk

> **I did not implement any of these.** The brief says measure and recommend, and the
> duplicate-`VALUES` bug is the standing example of what an unmeasured optimisation costs.
> Every "expected saving" below is **derived from a measured component, not from an
> implemented and timed change.** They are estimates and are labelled as such.

### R1 — bound the i13 name fan-out · **expected ~12–16 min of the 23** · risk: MEDIUM-HIGH

The single largest term, and it is 56.7% concentrated in 20 names that cannot identify
anything. Three options, **all of which change graph semantics and therefore need a
decision, not a tweak**:

- **(a) Two-pass resolution — non-lossy.** Resolve same-file candidates first, then run the
  global ranking only for the remainder. Measured: **58,765 of 217,720 edges (27%)** have a
  same-file candidate. That removes ~27% of the edges from the global fan-out with no loss.
  Expected saving: ~27% of 993 s ≈ **4.5 min**.
- **(b) Cap candidates per name at K, record the overflow as unresolved — LOSSY.** With
  `K = 100`, the top-20 names alone drop from 29.9M rows to well under 1M. This is the option
  with the largest expected saving (potentially ~15 min) and the largest semantic cost: edges
  that currently resolve will stop resolving. **This is a product decision about what the
  graph means, not a performance change.**
- **(c) Reject a name whose ambiguity exceeds a threshold — LOSSY, same class as (b).**

**Recommendation: ship (a) first** — it is non-lossy and independently verifiable — and treat
(b)/(c) as a graph-semantics decision. **Do not ship (b) or (c) as a performance fix without
an explicit decision and an equivalence report.**

Secondary, independent of the above: the `LEFT JOIN brain_file f` per candidate row adds ~52.8M
lookups. It only feeds the third ORDER BY key (same-language), which is reached only after
same-file fails. **Unmeasured.**

### R2 — `PRAGMA optimize` instead of unconditional `ANALYZE` · **~35 s/pass** · risk: LOW

`ANALYZE` costs **37,377 ms** in the post pass and `PRAGMA optimize` costs **0 ms** on a
database that has not changed structurally. `PRAGMA optimize` re-analyses precisely the
tables whose rootpages changed, so a pass that rewrote rows still refreshes them.

**The statistics stay load-bearing** — the measured 15 s-per-graph-hop regression documented at
`:5520-5526` is what `sqlite_stat1` prevents, and `PRAGMA optimize` maintains it.

Expected: ~35 s saved on a post pass that changed little; close to zero on one that changed a
lot, which is correct.

### R3 — collapse gravity's five rewrites into one · **~30 s of 79 s** · risk: MEDIUM

Measured: **46.5 s of gravity's 79 s is row rewrites; 56 ms is reads and subqueries.** Steps
1, 2, 3, 3b and 4 mutate the same column over the same 453,476 rows in five passes. One
statement computes the same value.

Two things to get right, both of which are why the risk is MEDIUM and not LOW:

1. **Float ordering.** `(a × b) + c` and `((a × b) + c) × d` are not bit-identical to the
   current sequential application. Gravity is a float column consumed by ranking; this needs
   an equivalence test over all 453,476 rows, not a spot check.
2. **`layer` has no index** (gap 1 above), so the three layer passes are full scans today.
   Merging them into the base pass removes two of those scans outright.

Expected: ~30 s, i.e. gravity 79 s → ~45 s. **Not measured as an implemented change.**

### R4 — skip the two correlated integrity scans · **~12 s** · risk: LOW-MEDIUM

`checkOrphanTargets` (**15,706 ms**) and `checkDanglingSources` (**11,668 ms**) each scan all
630,467 relationships with a correlated `NOT EXISTS` into `brain_symbol`, on **every** post
pass, and again in `bb_health`.

Both measure the same shape of defect ("an edge points at a symbol that is not there") and
could be one join, or gated on a cheap precondition. Note the tension: these checks exist
precisely because they were cheap to be wrong about, so any precondition must be a proof, not
a heuristic.

### R5 — do not re-select the 53,870 permanently unenrichable edges · **~5 s** · risk: LOW

8.5% of every enrichment page scan is spent on edges whose source symbol does not exist and
which the pass can never write. Filterable at the row-selection level.

### Explicitly NOT recommended

- **Adding `brain_symbol(layer)`** to speed gravity steps 3/3b/4. The phase is write-bound;
  more indexes mean more index maintenance per rewrite. The trade-off is real and
  **unmeasured — this could easily be a net loss.**
- **Moving `ANALYZE` earlier** so the phases before it are planned with statistics. Tempting,
  but `ANALYZE` costs 37 s and moving it does not remove it; it would only make the run
  slower overall. Combine with R2 instead.
- **Anything about the unmeasured 2,470 s.** See §7.

---

## 7. What I could not measure

Stated plainly, because the gaps are the size of the answer:

1. **~2,470 s of the user's 3,850 s run (64%).** Embedding generation is a background queue
   with **no phase timer** (`parallel-indexer.ts:1915`, and no embedding term in `phases`).
   Measuring it needs an embeddings API key, which this work may not use.
2. **The parse-side phase split** (discovery / worker startup / parse / `dbFlush`). The run
   that would have produced it did not reproduce the user's 352-file condition and was
   stopped at 1h 15m.
3. **The predicted savings in R1/R3/R4.** None was implemented and timed.
4. **The growth exponent** for the i13 pass. Candidate *counts* are measured at four scales;
   the timings were contaminated by I/O contention.
5. **Whether the `is_cross_file` recompute's full scan is worth an index.** Not tested.

## 8. Incidental findings, outside the brief

- **`enrichment` fails under a `Proxy`-wrapped DB handle** (2 ms vs 54 s). Reproduced in both
  directions by `script/profile/check-enrichment.mts`. Whatever the cause, it means the
  enrichment pass cannot be instrumented by wrapping the driver — worth knowing before
  anyone builds a profiler on that approach.
- **12 worker-pool batches timed out and were killed** during the (aborted) parse run, while
  files continued to store correctly. Consistent with the documented in-process fallback.
  Not quantified.

---

## 9. Files

| file | purpose |
|---|---|
| `script/profile/lib.ts` | corpus staging, project-id derivation, free-space guard |
| `script/profile/profile-post.mts` | **authoritative** per-phase wall clock; touches no product DB handle |
| `script/profile/measure-costs.mts` | `ANALYZE`, gravity decomposition, i13 candidate counts |
| `script/profile/i13-anatomy.mts` | why the name-resolution pass is slow; concentration |
| `script/profile/query-plans.mts` | `EXPLAIN QUERY PLAN`, read-only |
| `script/profile/check-enrichment.mts` | attributes the Proxy/profiler interaction |
| `script/profile/profile-parse.mts` | parse-side phases (**result not reported — see §3.3**) |
| `script/profile/results/*.json` | raw measurement output |

**`measure-costs.mts --growth`** reproduces the four-scale timing series; it is off by default
because the timings are only meaningful on an otherwise-idle machine.