# M26.L — why `callHierarchy/outgoingCalls` takes 2–3.5 seconds

Measured 2026-10-08 on the owner's real index
(`064be526733c31e95c0ac2beb42d209af9bab8e6`, 201 files, 10,271 symbols,
58,324 relationships), Node v22.14.0, darwin-x64. Every number below is a
measurement with the command that produced it; nothing here is an estimate.

## The headline

`outgoingCalls` costs scale with **traversal depth**, not with fan-out:

| depth | outgoing calls | rows | latency |
|---|---|---|---|
| 0 | 32 | 32 | **238–244 ms** |
| 1 | 43–50 | 43–50 | 435–611 ms |
| 2 | 68 | 68 | **2 396 ms** |
| 4 | 67–84 | 67–84 | **2 593–3 392 ms** |

Measured through `expandCalls` (the LSP request), so these include the
request's own overhead on top of the walk. The worst cases are all methods of
the large per-language analyzers —
`ast/parallel-indexer.ts:2596 storeResults` (3 392 ms),
`ast/real-java-analyzer.ts:148 analyze` (2 775 ms),
`ast/real-graphql-analyzer.ts:358 analyze` (2 593 ms).

## The cost is symbol-dependent, and only part of it is understood

This is the part most likely to be over-read, so it is stated first: **there is
no single cause, and the dominant one changes with the symbol.** Two symbols that
cost the same, by two completely different routes:

```
intelligence/migration/migration-engine.ts:474  walk 2857ms   SQL   1ms   (5 statement texts)
ast/real-graphql-analyzer.ts:358                walk 2996ms   SQL 2973ms  (73 executions)
```

For the `real-*-analyzer` symbols, one SQL statement is essentially the whole
cost. For `migration-engine`, SQL is ~0 % and the 2.9 s is elsewhere in the walk
and **has not been attributed yet**. Any claim of the form "the walk is slow
because of query X" is therefore only true of a subset of symbols, and the
table in §1 spans both populations.

### The SQL half: one statement, on the analyzer symbols

Wrapping `brain_database.prepare().all()` on the handle the walk actually uses
(`BrainDatabase.getRawInstance`, `graph-engine.ts:440` — **not** the handle
`expandCalls` is handed, which is why a first attempt at this measurement showed
"3 ms of SQL" and was wrong):

```
walk 2996 ms; the edge query ran 73 times, 2973 ms total
```

One statement text (`sha1 41fbdf0f…`) runs 52× for 2 925 ms — **56 ms per
execution** — and accounts for 99 % of that walk. The other edge query runs 21×
for 17 ms total.

Reproduce with `script/m26/profile-outgoing-calls.mts` (leg 2). Note that the
same script reports ~0 % SQL for `migration-engine`: that difference is the
finding, not a measurement glitch.

## What it is NOT (each ruled out by measurement)

- **Not statement recompilation.** 0 `prepare()` calls during a measured warm
  walk; the `STATEMENT_CACHE` in `graph-engine.ts:256` is working. (The cache
  was itself a past fix: "84–132 compilations per call … the busiest text
  compiled 52 times per call".)
- **Not a Node/better-sqlite3 problem.** Python's SQLite 3.43.2 runs the *same
  SQL with the same parameters* in 84 ms. A hand-built variant of the query runs
  in 3 ms — but it is not the real query, which is how a wrong conclusion was
  nearly drawn here.
- **Not the cascade.** `cascadeBounds` gives 3 ids for the hot symbol
  (`analyze` owns 2 members), and `brain_symbol_owner_idx` serves the range.
- **Not the `ORDER BY` temp b-tree.** Stripping the sort takes 83.6 ms → 2.4 ms
  *at LIMIT 201*, but the cliff below is present with the sort removed entirely,
  so the sort is a symptom, not the cause.
- **Not row marshalling or `metadata` volume.** Dropping `r.metadata` from the
  projection changed nothing (83.7 ms).
- **Not a `LIMIT` that is too small.** No edge is dropped: `LIMIT -1` returns
  276 rows, the same set.

## What it is: a post-join filter cliff

The query filters `relationship_type IN (10 kinds)` **after** joining
`brain_symbol` and `brain_file`, while the index it seeks is
`brain_rel_proj_source_idx (project_id, source_symbol_id)` — which does not
contain `relationship_type`. Rows that fail the filter therefore still cost a
seek plus four joins each. Sweeping the LIMIT exposes the cliff directly:

```
LIMIT   50      0.7ms     50 rows
LIMIT  150      1.6ms    150 rows
LIMIT  201      2.7ms    201 rows
LIMIT  210      3.3ms    210 rows
LIMIT  250     55.5ms    250 rows
LIMIT  276     85.2ms    276 rows
LIMIT  -1      83.5ms    276 rows
```

Rows 211–250 cost 52 ms. Past the point where matches become rare, the engine
scans a long way to find the last ones — and every visited symbol whose cliff
sits below its own LIMIT pays the full price, which is why the per-call average
is 56 ms even though this one symbol is cheap at the walk's LIMIT of 201.

## Rejected fix, measured

Adding `brain_relationship(project_id, source_symbol_id, relationship_type)` —
the index that would put the filter in the seek — makes it **4.6× slower**:

```
BEFORE  worst case  85 ms
AFTER   worst case 393 ms
```

(measured on a throwaway copy of the DB, never on the owner's index). Shipped
without measurement it would have looked like the obvious fix.

The other candidate — pushing the LIMIT into each `UNION ALL` branch so each
terminates early — is **not expressible in SQLite**:
`LIMIT clause should come after UNION ALL not before`. Doing it properly means
two queries plus a JS merge, and therefore needs a correctness gate before it
can be considered.

## A separate finding: the time budget fires without changing the answer

`DEFAULT_WALK_TIME_BUDGET_MS = 2_000` (`graph-engine.ts:81`).

```
budget=2000ms -> 2094ms  exhausted=true   reason=…+walk-time-budget-exhausted
budget=8000ms -> 2944ms  exhausted=false  reason=(no walk-time reason)
   both: depth=4/5  callees=338  callers=211  nodes=116
```

The budget fires, declares `timeBudgetExhausted: true`, costs ~1 s of waiting —
and produces **exactly the same answer** the other caps (caller-site-limit,
callee-site-limit, depth cap) would have produced unaided. So the flag currently
tells a reader "I stopped early for time" when the time bound was not what
bounded the result. That is the same class of claim §14 exists to police, and it
is worth deciding deliberately whether the flag should be dropped when the run
would have stopped anyway — which requires knowing the answer without the budget,
i.e. the 8 s run above.

## Status

Diagnosis, **partial**. No fix is committed. Both candidate fixes measured so far
are wrong or unsafe, and the remaining route needs a correctness gate rather than
a patch.

What is settled: the depth→latency relationship; that the SQL half is one
statement on the analyzer symbols; the post-join-filter cliff behind it; and that
the obvious index fix makes it 4.6× worse.

What is **not** settled: where the ~2.9 s goes for `migration-engine`,
`doc-engine`, `health-provider` and the other deep non-analyzer symbols, where SQL
is ~0 %. Until that is attributed, no single fix for "outgoingCalls is slow" can be
proposed honestly, and this document should not be read as one.

Reproduce any of it with:

```
export PATH="$HOME/.local/node/bin:$PATH"
npx tsx script/m26/profile-outgoing-calls.mts [projectId]
```

Three measuring-tool bugs were found and fixed while writing it, all recorded in
the script's comments because each produced a confident wrong number rather than
an error: instrumenting the handle you were handed instead of the one the walk
opens; patching `getRawInstance` when `traverseGraph` only reaches it on a cache
miss; and `mkdirSync`'s return value.