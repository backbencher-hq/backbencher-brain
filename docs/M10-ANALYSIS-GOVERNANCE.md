# M10 Analysis Run and Finding Governance

This document pins down the identity, state, ordering, and provenance rules for
persistent analysis runs and findings introduced by M10.04. Its goal is that
repeated intelligence runs are auditable, deterministic, and safe to compare
over time.

## Scope

- Canonical runs: `security`, `patterns`, `test`, `analyze`, `health`.
- Persistence: runs and findings live in `brain_analysis_run`,
  `brain_analysis_finding`, and `brain_analysis_occurrence`.
- Non-goals: legacy Sentinel persistence (removal is M10.06); runtime coverage
  ingestion (separate concern, already modelled as `runtimeCoverage`).

## Schema

### `brain_analysis_run`
- `id`, `project_id`, `kind`, `status`, `engine_version`, `input_hash`,
  `started_at`, `completed_at`, `finding_count`, `error`, `time_created`,
  `time_updated`.
- Status transitions: `running` → `completed` | `failed`. `completed` runs may
  embed `finding_count` which must equal the number of persisted findings
  recorded within the same transaction.

### `brain_analysis_finding`
- Core identity: `(project_id, kind, fingerprint)` unique index. The
  `fingerprint` is the canonical dedup key — it must not change for the same
  finding across repeated runs on unchanged inputs.
- `rule`, `title`, `severity`, `confidence`, `evidence (json)` and
  `limitations (json)` are stored alongside `location`, `evidence_class`,
  `engine`, and `engine_version` so each persisted finding retains the full
  evidence trail and its originating analysis-engine identity.
- Lifecycle: `state` ∈ {`open`, `resolved`, `suppressed`, `reopened`,
  `mitigated`, `stale`}; per-state transition timestamps
  (`resolved_at`, `suppressed_at`, `mitigated_at`) are stored.
- `occurrence_count` accumulates the number of **times** the finding was
  observed across runs for the same fingerprint.

### `brain_analysis_occurrence`
- Per-run observation: `finding_id`, `run_id`, `state`, `location`, `evidence`,
  `limitations`, `evidence_class`, `engine`, `engine_version`, `observed_at`.
- Bounded retention: `retentionDays` (default 90) drops occurrences older than
  the cutoff inside the completing transaction.

### Migration safety
`ensureHistorySchema` uses `CREATE TABLE IF NOT EXISTS` for new databases and
`PRAGMA`-backed `ALTER TABLE ADD COLUMN` (via `ensureColumn`) for incremental
schema upgrades (location, limitations, evidence_class, engine, engine_version)
on pre-existing M9.x analysis DBs. Indexes are idempotent; column adds are
no-ops when the column already exists.

## Finding identity

The `fingerprintFinding` helper derives the fingerprint as a stable SHA-256
hash of `{kind, rule, title, location, evidence, limitations, evidenceClass,
engine, engineVersion}`. If the caller supplies an explicit `fingerprint`
string it is used verbatim; otherwise the computed hash applies. Any change to
any input field changes the fingerprint, producing a new finding row rather
than an update to the prior row. This is the intended "changed evidence → new
identity" semantics.

Subsequent runs with the same fingerprint produce a `repeat` event
(`occurrence_count` increments, `last_seen_at` advances) and advance the
state via the lifecycle rules below.

## Lifecycle rules

- Run completes with the finding present: `new` if fingerprint unknown,
  `repeated` otherwise. State transitions: `resolved|stale` → `reopened`;
  `suppressed|mitigated` persist (explicit human action required to clear);
  otherwise prior state preserved.
- Run completes with a previously active finding absent: prior `open|reopened`
  transitions to `resolved` and `resolved_at` is stamped. Suppressed and
  mitigated findings are untouched.
- Incremental runs (`incremental: true`, `touchedFingerprints` provided) do
  not automatically resolve unrelated findings — only fingerprints explicitly
  touched are reconciled.

## Deterministic ordering

- `getAnalysisHistory` and the `findings`/`orderedFindings` field of each
  completed run return findings sorted by:
  1. State priority: open (0) → reopened (1) → mitigated (2) → stale (3) →
     suppressed (4) → resolved (5).
  2. `last_seen_at` descending (tie-break).
  3. `fingerprint` ascending (tie-break).
- Runs are returned by `started_at` descending.
- The same code path is applied both inside `completeAnalysisRun` and
  `getAnalysisHistory`, so on-disk order and run-return order are identical.

## Shared execution wrapper

`executeAnalysis` (in `src/intelligence/analysis/run-history.ts`) is the only
supported entry point for persistence-aware callers. It guarantees:
1. `startAnalysisRun` creates a `running` run with the correct `engineVersion`
   (defaults to the fixed M10.04 tag).
2. Persisted findings are produced by a caller-supplied `persist` callback
   returning `AnalysisFindingInput[]`.
3. `completeAnalysisRun` reconciles fingerprints, resolves suppressed-
   findings-on-absence unless incremental, truncates retaining occurrences
   per `retentionDays`, and returns findings in deterministic order.
4. On error, the run is marked `failed` with the error message so retries can
   branch on `status` rather than on thrown exceptions.

Tool handlers (`bb_patterns`/`bb_security` `recordRun` flag) call
`executeAnalysis`; other engines (graph, documentation, health) call the
three primitive functions directly because they do not persist findings.

## Per-finding provenance requirements

Every persisted finding must retain:
- `evidence` (JSON) — the raw evidence items used to derive the finding
  (same shape each engine emits at the boundary).
- `limitations` (JSON strings) — known false-positive classes (must be
  per-finding, not just per-report).
- `location` — stable human-comparable sink identifier (`file:line`).
- `engine`, `engineVersion`, `evidenceClass` — provenance identity so a
  finding can be traced back to the engine that produced it after the run is
  complete.

If a report-level provenance exists on the same engine, findings must carry
it through rather than rely on the report boundary alone.

## Determinism and reproducibility

- Unchanged repeated runs: absence of new fingerprint keys means no unexplained
  duplicates. Run `input_hash` is computed at run start from the sha256 of the
  JSON-ified input, so `hist` is reproducible.
- Changed-source behavior: when the content-derived evidence changes, the
  fingerprint changes, producing a new finding. The prior fingerprint's
  absence flips it to `resolved` (unless suppressed/mitigated).
- Run output ordering: stable (see Deterministic ordering).

## Retention

- `brain_analysis_occurrence` rows older than `retentionDays` (default 90)
  are dropped inside the completing transaction. A smaller retention window
  is supported by passing `retentionDays` at `startAnalysisRun` or via the
  `ExecuteAnalysisArgs` wrapper.
- `brain_analysis_finding` rows are bounded by the `findingCount` per run and
  the identity uniqueness constraint on `(project, kind, fingerprint)`;
  repeated runs reuse the same row on the same fingerprint.

## Contract version metadata

The wrapper records a single engine version tag (`m10.04`) on every run
(`ENGINE_VERSION`) so concurrent runs with the same fingerprint hash describe
the same finding schema. The persisted per-row `engine_version` column is
available for future cross-version comparisons.

## Fixture and verifier

`src/intelligence/analysis` behaviour is exercised by
`script/verify-analysis-governance.ts` which uses the shared
`createContractFixture` plus a phased write/delete workflow to demonstrate:

- repeated same-input run → deduplication, no new findings
- changed evidence → new identity (new fingerprint)
- absence after reopen → `resolved`
- explicit `setFindingState` moves state without touching occurrence history
- deterministic ordering on repeated invocations
- `retentionDays` truncation and bound
- failure recording on failed runs

The verifier is wired into `npm run verify` and `verify-quality-gate.ts`
(e.g. `verify-evidence-governance.ts` already checks per-engine provenance at
the result boundary).

## Residual risks

- The current schema cannot roll back `Nullable`→`NOT NULL` migrations
  without a full table rebuild; current pattern is to add nullable columns.
- Deterministic ordering relies on `(state, last_seen_at, fingerprint)`
  uniqueness; concurrent writes from two processes sharing the last_seen_at
  tick would still be stable because `fingerprint` is unique per
  `(project, kind)`.
- Existing pre-M10.04 findings can null out `location`/`limitations`/`engine*`
  after the additive migration; consumers must tolerate nulls until new runs
  rewrite the row.
