# M21 — Indexing Performance & Reliability Truth

**Status:** proposed; no production fix is claimed.  
**Purpose:** explain and improve multi-hour indexing runs using measured evidence from real repositories, without attributing latency to embeddings, WASM, parsing, SQLite, or post-processing before measurement.

## Authority and evidence policy

This document is the local proposal. A GitHub milestone must not be created or closed from it until the scope is reviewed and the issue list is established.

Every issue must produce a persisted result containing:

- exact command and commit;
- repository path, revision, and corpus-selection rules;
- wall-clock and phase timings;
- file, symbol, relationship, error, retry, fallback, and embedding counts;
- positive and negative checks;
- resource measurements where relevant;
- limitations and explicitly unmeasured states.

`verified` means the checks ran and passed. `known-gap` means a required check failed or could not run. Missing measurements are never represented as zero.

## Confirmed baseline

The M20 diagnostic established:

- IntelliJ bounded incremental reindex: `database is locked` after 10,595 ms; source unchanged.
- IntelliJ existing index: 69,509 files, 1,071,964 symbols, 3,524,679 relationships, 0 embedding rows in the inspected DB.
- ASP.NET Core bounded unchanged sample: 113 ms; this is a no-op, not a cold-index benchmark.
- Persisted `performance_stats` is not populated.
- Normal status updates overwrite `indexing_errors` with `[]`.
- Reported index duration is recorded before heavy post-processing completes.
- Node enables WAL but no inspected adapter configures a busy timeout; Bun enables neither WAL nor busy timeout.

These facts establish an observability/reliability gap. They do not establish the root cause of the multi-hour runs.

## Proposed issue families

### C — Contract and evidence governance

- **C1:** phase schema, authority, evidence ledger, and fail-closed closure gate.
- **C2:** corpus registry covering local repositories and exact revisions without modifying active checkouts.
- **C3:** benchmark integrity: no tautological assertions, no fake zero values, bounded command execution, and source immutability checks.

### I — Indexing phase observability

- **I1:** measure discovery, filtering, worker startup, parse, DB flush, and final accounting separately.
- **I2:** measure relationship resolution, enrichment, gravity, taint, health, and integrity separately; completion duration must include or explicitly exclude each phase.
- **I3:** persist phase timings, counts, and errors without erasing prior worker/WASM failures.

### W — Worker and WASM reliability

- **W1:** record worker startup failures, engine/WASM load failures, file errors, timeouts, retries, and fallback-parser use per file/language.
- **W2:** real corpus matrix across available language repositories, with missing grammar assets failing visibly.
- **W3:** prove retry and poison-file behavior with deterministic fixtures and real-repository samples.

### D — Database concurrency and storage

- **D1:** reproduce lock contention with controlled one-writer/concurrent-reader tests.
- **D2:** compare SQLite runtime settings across Bun and Node, including WAL and busy-timeout behavior; no setting change without regression tests.
- **D3:** measure DB flush throughput, transaction duration, lock wait, and failed-batch recovery.

### E — Embedding separation

- **E1:** measure indexing with embeddings disabled, local embeddings, and configured provider embeddings where available.
- **E2:** expose queue depth, batch size, provider request duration, retries, drops, fallback model, and flush completion.
- **E3:** prove that structural indexing completion is not falsely reported as embedding completion.

### R — Relationship and post-processing scale

- **R1:** benchmark relationship resolution and enrichment over increasing relationship counts.
- **R2:** measure gravity, taint, health, and integrity passes independently, including partial-failure visibility and resource use.
- **R3:** measure cancellation, resume, and bounded-failure behavior on interrupted indexing runs.

### X — Real-repository acceptance

- **X1:** cold controlled fixture with known file/symbol/relationship ground truth.
- **X2:** real small, medium, and large repositories selected from `$HOME` and `$HOME/fixtures`.
- **X3:** final report that classifies each observed bottleneck as confirmed, disproven, or unresolved.

## Required repositories

The corpus registry should include exact revisions for suitable repositories from:

- `$HOME/fixtures/repositories`;
- `$HOME/TypeScript`;
- `$HOME/intellij-community`;
- `$HOME/aspnetcore`;
- `$HOME/openclaw`;
- `$HOME/paperclip`.

Active repositories must not be reset, cleaned, or rewritten by benchmark scripts. Dirty or unavailable repositories are recorded as blocked/known-gap, never silently substituted.

## Closure requirements

M21 cannot close until:

1. phase telemetry is persisted and independently verified;
2. worker/WASM/retry/fallback failures are durable and visible;
3. SQLite lock behavior is reproduced, classified, and tested;
4. embedding time is separated from structural indexing time;
5. post-processing timing and complexity evidence exist;
6. cold and real-repository benchmarks complete with raw artifacts;
7. cancellation/resume behavior is verified;
8. all known gaps are documented in the website-facing tool/performance docs;
9. the final gate passes from a clean source state, with no unrelated files staged.

Until then, M21 remains open and no claim of production performance or “near-perfect” indexing is permitted.
