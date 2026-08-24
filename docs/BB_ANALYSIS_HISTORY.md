# Analysis Runs & Finding History (M9.12)

The reusable persistence service is `src/intelligence/analysis/run-history.ts`.
It stores generic runs, findings, and occurrences in:

- `brain_analysis_run`
- `brain_analysis_finding`
- `brain_analysis_occurrence`

No `bb_sentinel` tool is exposed. Public tools remain `bb_security`,
`bb_patterns`, `bb_analyze`/`bb_health`, and related existing surfaces.

## Lifecycle

1. `startAnalysisRun` creates a `running` run with a deterministic input hash.
2. `completeAnalysisRun` transactionally upserts findings and occurrences, marks
   the run `completed`, and reconciles findings absent from a successful run.
3. `failAnalysisRun` marks a run `failed` and stores the error text.

Finding states:

- `open`: currently observed, no prior terminal state.
- `resolved`: absent from a later successful run.
- `reopened`: observed again after `resolved` or `stale`.
- `suppressed`: intentionally hidden by an operator.
- `mitigated`: observed with a known mitigation.
- `stale`: reserved for retention/index freshness workflows.

## Identity and History

Findings are deduplicated by `(project_id, kind, fingerprint)`. Engines should
provide an explicit stable fingerprint based on rule and semantic location when
volatile evidence changes between runs. If no fingerprint is provided, the
service hashes kind, rule, title, location, and evidence.

Each observation creates an occurrence tied to both the finding and run. The
finding retains first/last seen timestamps and occurrence count. This preserves
repeated observations without duplicating the canonical finding row.

## Retention and Incremental Runs

Occurrence rows older than `retentionDays` are pruned at successful completion;
the default is 90 days. Canonical findings and their lifecycle state are retained
so resolved/reopened history remains understandable. Run rows are retained for
status/trend queries; future policy may add run-level retention separately.

A full successful run resolves previously open findings that are absent from its
result set. An incremental run never resolves unrelated findings: it may only
resolve fingerprints explicitly listed in `touchedFingerprints`. An empty
incremental run therefore records completion but changes no existing finding
states.

## Public Presentation

`bb_security` supports:

- `recordRun: true` to persist the scan and return run ID plus new/repeated/resolved counts.
- `history: true` to return persisted security runs and findings.

`recordRun` persists the **full analyzed result set**, never a display/truncated
slice (`bb_security` excludes `source_only`/`unresolved` observations entirely;
`bb_patterns` records every detected pattern, not just the first `limit` shown).
A persisted run must equal the analysis that produced it, so history stays an
honest record and the auto-resolve pass never marks real findings as gone.

`bb_patterns` supports the same two options for pattern scans. `bb_health`
with `history: true` returns all finding kinds and run history. These are
optional modes on existing public tools, not a new dispatcher.

## Verification Semantics

`script/verify-analysis-history.ts` covers transactional completion, stable
fingerprint deduplication, occurrence counts, resolved/reopened transitions,
suppression, mitigation, failed runs, history summaries, table creation, and
state persistence. The dormant Sentinel implementation remains quarantined and
is not registered or advertised.

Static analysis findings remain evidence-based. Persistence records what an
engine observed; it does not turn a static result into proof of runtime behavior.
