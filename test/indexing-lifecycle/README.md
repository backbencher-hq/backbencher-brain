# Indexing-lifecycle tests

Regression tests for the launch-critical half of the indexer: **resume**,
**checkpoints**, **incremental (`--changed`)**, **the index lock**, **worker-pool
fallback**, and **empty/trivial projects**.

They follow the repo's existing verification convention (see
`script/verify-index.ts`, `script/m22/verify-r1-resume.ts`,
`script/m43/verify-p1-index-lock.ts`): a `check`/`negative` counter, one
`ok:`/`FAIL:` line per assertion, exit 1 when anything fails. They add three
things the existing gates do not have:

* **end-state equivalence** — a resumed / incremental / in-process-fallback index
  is compared against a *clean full index of the same fixture*, symbol by symbol
  and edge by edge, not just by count;
* **the sentinel instrument** — "was this file re-parsed?" is answered by a
  marker written into `brain_file.time_updated`, never by comparing timestamps
  around a run, so no assertion depends on wall-clock resolution;
* **real subprocesses** — the shipped CLI, lock holders that get SIGKILLed, and
  writers that are killed mid-write.

## Running

```bash
export PATH="<node-22-bin>:$PATH"

npx tsx test/indexing-lifecycle/run-all.ts              # whole suite
npx tsx test/indexing-lifecycle/store-integrity.ts      # one file
npx tsx test/indexing-lifecycle/run-all.ts --with-repair  # diagnostic mode, see below
```

`run-all.ts` accepts bare `.ts` file names to run a subset:
`npx tsx test/indexing-lifecycle/run-all.ts index-lock.ts`.

Requirements: Node 22, `node_modules` installed, **no network**. Nothing in this
suite reaches the network — the embedding provider is forced to its local
fallback by scrubbing `BB_EMBEDDING_*` and isolating `BB_DATA_DIR`
(`isolateDataDir` in `harness.ts`).

## Determinism

* every test file sets its own `$BB_DATA_DIR` to a fresh temp dir, so no test can
  see another's DB and nothing touches `~/.bb`;
* every fixture file gets a **fixed mtime**, so the indexer's mtime+size
  incremental filter never depends on clock resolution;
* "wait for the child to reach state X" is done by the child announcing it on
  stdout — there are no sleeps and no timing races;
* fixtures are tiny and built per test (`makeTsFixture`); the repo itself is
  never indexed.

## `--with-repair` (diagnostic mode)

`BB_TEST_INSERT_SYMBOL_REPAIR=1` patches ONE broken SQL statement in-process, at
the sqlite driver's `prepare`, so the rest of the lifecycle can produce signal
instead of every suite failing at the same first assertion. See
`installInsertSymbolRepair` in `harness.ts` for the exact defect it works
around.

**It is off by default and results produced with it do not describe the shipped
product.** It exists to answer one question: "is this one defect blocking
everything, or are there more behind it?"

## Layout

| file | covers |
|---|---|
| `harness.ts` | fixtures, DB snapshots, the sentinel, subprocess helpers, the diagnostic shim |
| `store-integrity.ts` | the store step: symbols actually land in the DB |
| `resume-equivalence.ts` | P0 resume correctness + end-state equivalence |
| `checkpoint-durability.ts` | P0 a torn checkpoint is safe, never trusted |
| `incremental-changed.ts` | P1 `--changed` re-parses exactly what changed, leaves no stale rows |
| `index-lock.ts` | P1 refusal, reclaim after a crash, and the shapes that wedge the project |
| `pool-fallback.ts` | P1 indexing survives a lost worker pool, and says so with a cause + remedy |
| `empty-projects.ts` | P2 empty / trivial projects complete cleanly and honestly |
| `run-all.ts` | runs the above, one process each, with a summary table |