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

## The root cause (corrected - an earlier version of this doc had it wrong)

**Every slow walk is one statement, at ~56 ms a call, ~100 % of the time.**

```
real-graphql-analyzer.ts:358   walk 2996ms   SQL 2973ms   41fbdf0f ran 52x @ 56ms
migration-engine.ts:474        walk 2931ms   SQL 2856ms   41fbdf0f ran 51x @ 56ms
```

An earlier version of this document claimed the cost was symbol-dependent - that
`migration-engine` spent 1 ms in SQL. **That was a bug in the measuring tool, not
a fact about bb.** `STATEMENT_CACHE` (`graph-engine.ts:256`) holds the statement
objects created by the *first* `db.prepare(sql)`; a `prepare` wrapper installed
after that never sees their `.all()` calls. So the instrumentation reported ~0 ms
SQL for a 2 857 ms walk. Instrumenting before the first walk - the fix is in
`script/m26/profile-outgoing-calls.mts` - shows 100 %. A clean negative result
that looks exactly like a finding is the failure mode this repository keeps
meeting.

### Why one call costs 56 ms for ~9 rows

The statement is a `UNION ALL` of two branches. Split and timed on the
migration-engine symbol (157 rows total):

```
LEFT  branch (source side)     0.7ms    62 rows
RIGHT branch (EXTERNAL side)  65-74ms    95 rows
```

The cost is entirely the **external** branch, whose predicate ends
`AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL`.

`target_symbol_id IS NULL` **cannot use an index seek** - an index seek on
`target_symbol_id = ?` never matches NULL. So for each of the ten relationship
types in the `IN` list, SQLite falls back to scanning that type's rows for the
whole project and discarding the non-NULL ones. The index holds **17,193
external rows out of 58,324**, and the walk re-scans that population once per
visited node: 51 visits x 10 types.

That is also why the cost tracks depth and not fan-out: depth is the number of
nodes visited, and the external scan is paid per node.

### Fixes measured, and rejected

| candidate | result |
|---|---|
| `INDEXED BY` both branches to their own index | **2.0x faster, identical rows, no schema change** (72.3 -> 35.6 ms) |
| add `(project_id, source_symbol_id, relationship_type)` | **4.6x slower** (85 -> 393 ms) |
| add `(project_id, target_external)`, pin the external branch | **4.2x slower** (65 -> 273 ms) |
| add `(project_id, relationship_type, target_external)`, pin it | **3.5x slower** (65 -> 229 ms) |
| `LIMIT` into each `UNION ALL` branch | not expressible: `LIMIT clause should come after UNION ALL not before` |

The `INDEXED BY` result is real and needs no schema change, but it is only 2x,
which takes a 2.9 s walk to roughly 1.5 s. Not enough - and it carries a hazard
worth stating: `INDEXED BY` naming an index that does not exist is a
*prepare-time* error, so a single older index file would take the whole surface
down rather than degrade. It needs a gate over many symbols plus a presence
check, not a patch.

### The fix that should actually work

Hoist the external fetch **out of the per-node query**. The external population
depends on `project_id` and the relationship types, not on which node is being
walked - only the `source_symbol_id IN cascade` filter is node-specific. Fetching
it once per walk and filtering in JS turns 51 scans of the external population
into 1, at the cost of a JS-side membership test against the cascade ids.

This drops no edge: the same predicate, applied to the same rows, just once. It
is a structural change to `graph-engine.ts` and therefore needs an equivalence
gate over many roots - external edge sets identical before and after - before it
can be considered. **It has not been written.**

## Secondary effect: a LIMIT cliff on the same statement

Still real, still worth knowing, but a *consequence* of the above rather than
the main cause - and it is the shape that made the first diagnosis wrong.

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