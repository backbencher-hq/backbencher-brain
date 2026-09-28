# M43: Freshness Automation — PLAN

## The milestone invariant (verbatim, enforced by G1)

> **No read tool answers from data it knows is stale when repairing is within budget — and no two indexers can ever race on one project.**

Every acceptance criterion in this milestone traces to this sentence. The second half is the P1 prerequisite: inline auto-reindex (A1/A2) *guarantees* concurrent index attempts, so the single-flight lock lands first.

GitHub issues (enforced by the ledger): P1=#656, A1=#657, A2=#658, A3=#659, A4=#660, G1=#661, X1=#662. Ledger: `validation/m43/ledger.json`.

## Why now (evidence, not memory)

- M35 gave every read path a staleness envelope with a remediation footer ("run: bb index --changed") — the system says what to run, nothing runs it. User-reported gap.
- bb_edit already re-indexes touched files via `reindexFilesParallel` + bounded post-pass (M40.A3, gate-proven). A1/A2 reuse that exact proven mechanism on the read path.
- **No single-flight lock exists in parallel-indexer.ts** (verified by grep during research) — two concurrent runs can race today. P1 fixes this even before any automation exists.
- No file watcher exists; a watcher daemon is explicitly out of scope (CLI/MCP users; daemon adoption uncertain). Inline bounded reindex keeps zero new processes. A watcher MAY be a later follow-up once lock + budget machinery exist.

## Issues

| Code | Scope |
|---|---|
| P1 (#656) | Single-flight index lock per project: refuse-or-wait semantics, stale-lock recovery (crashed holder), clear CLI/MCP error, corpus test proving two concurrent runs cannot interleave writes. |
| A1 (#657) | MCP read-path auto-refresh: when staleness detection (M35) finds stale/missing files within budget (<= N files and <= B bytes, env-tunable, defaults documented), run reindexFilesParallel inline before answering; response declares "auto-refreshed N files in Xms" or honestly declines with the budget reason. Opt-out flag. |
| A2 (#658) | CLI read-path auto-refresh: same mechanism for bb search / bb status with --no-auto-refresh opt-out; help text updated. |
| A3 (#659) | Flag/config semantics: every new flag/env enters the A5-style whitelist matrix; test hooks quarantined behind BB_TEST_HOOKS (M40.A8 rule); FRESHNESS_REMEDIATION strings updated to name the automatic behavior. |
| A4 (#660) | E2E corpus on real repos (fixtures/): edit outside bb_edit -> read -> prove auto-repair; concurrency corpus: parallel readers + user-run bb index under the lock; budget-exceeded path proves honest decline. |
| G1 (#661) | Governance: ledger, gates registry, mutation gate selftest, evidence policy (M40 pattern). |
| X1 (#662) | Closure gate: all subordinate gates live-green at HEAD, evidence converged, milestone close with evidence comments. |

## Non-goals (explicit)

- No watcher daemon, no fs-event subsystem.
- No semantic/embedding re-computation in the auto path (lexical/AST only; embeddings follow the existing background queue).
- No changes to full-index behavior or the A5 matrix's existing rows (only additive rows for new flags).
