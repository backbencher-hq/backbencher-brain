# M44: Agent-Fresh — Write-to-Read Consistency

## The milestone invariant (verbatim, enforced by G1)

> After any file change — by bb_edit, an external editor, or an agent's own
> tooling — no read answer is built from a world where the change does not
> exist. Every read either (a) repaired within its bounded budget and says so,
> or (b) explicitly reports exactly what is stale/missing — brand-new files
> are never silently absent. When a watcher is running for the project (MCP
> auto-start / bb watch), the write-to-fresh window closes in the background
> within a bounded time. **Watcher is an optimization, never the sole
> correctness mechanism.**

## Findings recap (evidence from code, not memory)

1. **bb_edit already reindexes post-write** (M40.A3, `src/intelligence/edit/edit-engine.ts`):
   an agent that edits through bb_edit is agent-fresh. The gap is external
   writes (agent's own editor/tooling, users' editors).
2. **Row-based repair only sees existing rows.** `collectStaleFiles`
   (`src/ast/auto-refresh.ts`) builds the repair set from rows a read
   resolved. A brand-new file has no row → invisible → search finds nothing,
   bb_ask answers from a world without it, **no stale signal at all**. Budgets
   cannot fix this; only a probe for files-without-rows can (W2).
3. **Auto-refresh is wired to bb_search only** (M43.A1/A2). bb_ask marks
   `[STALE ...]` sources; bb_analyze/graph/visualize/migrate/patterns/
   security/doc attach envelopes; none repair (W1.1).
4. **Only the LSP server has a watcher** (`src/lsp/freshness.ts`, M24.P2:
   300 ms debounce, catch-up, startup full-scan fallback). CLI and MCP
   sessions have nothing push-based (W3).
5. **Watcher activation must be owned by the indexer.** A per-project
   watch-intent recorded at index time, honored by any resident session (MCP
   auto-start), so the user never activates a watcher again and again. A
   detached daemon spawned by `bb index` is deliberately out of scope (zombie
   risk); the intent record makes it a later drop-in.

## Workstreams

| Code | Issue | Deliverable | Depends |
|---|---|---|---|
| G1 | #668 | Governance: ledger, gates registry, governance gate, mutation seams | — |
| W1.1 | #669 | Universal lazy repair on every row-resolving read tool (one shared helper) | G1 |
| W1.2 | #670 | Unified decline/envelope shape + counters across tools | W1.1 |
| W2.1 | #671 | Added-file probe — git layer (`git status --porcelain`) | W1.1 |
| W2.2 | #672 | Added-file probe — non-git bounded snapshot walk | W2.1 |
| W3.1 | #673 | Shared `src/ast/file-watcher.ts` + watch-intent + MCP auto-start | W2.x |
| W3.2 | #674 | `bb watch` CLI surface + status | W3.1 |
| W4 | #675 | Changed-files corpus on real repos + time bounds | W1.2, W2.2, W3.2 |
| X1 | #676 | Closure gate + milestone close | all |

## Order of attack

G1 scaffold → W1.1 (correctness floor for existing-file edits across tools) →
W1.2 (unified shape) → W2.1 → W2.2 (new-file correctness floor) → W3.1 →
W3.2 (real-time window) → W4 (corpus + bounds) → X1.

## Gates and evidence

- `script/m44/verify-*.ts`, one per issue (names in gates-registry.json).
- Evidence: `validation/m44/results/<CODE>.json`, synced into
  `validation/m44/ledger.json` by `script/m44/sync-ledger.ts` — never
  hand-edited.
- Every content gate carries a mutation seam (control passes, mutation exits
  non-zero); the closure gate re-runs every gate read-only at one stamp.
- Chain: M44 governance joins `npm run verify` at scaffold; content gates join
  in the same change that lands them.

## Honesty boundaries

- No per-tool forks of the repair path; one shared helper reused.
- M24 `src/lsp/freshness.ts` is NOT modified; watcher parity is proven by
  tests, not shared code.
- Non-git new-file detection without the probe declares unavailability —
  never silence.
- Real-repo corpus runs on copies only; temp dirs deleted after the run.

## Design-review addendum (accepted before build)

1. **bb_ask is two-layer, and repair must not over-promise.** quickAnswer
   ranks via `brain_semantic_embedding` (`semanticVectorSearch`) with a
   symbol-search fallback; the bounded derived pass (`runPostProcessing`:
   relationships → enrichment → gravity → …) has **no embedding phase**.
   Guarantee therefore: after repair the new file's symbols are retrievable
   (lexical/symbol path) AND the repair enqueues embedding coverage for the
   new rows (M21.E2 queue), OR the answer declares partial semantic coverage
   honestly. W2.1/W4 pin both layers; no "answer includes it" claim without
   the lexical guarantee + post-queue semantic path.
2. **Repair cost mechanics matter.** Each lazy repair uses the parallel
   reindex machinery; W1.1 measures per-read repair overhead on real repos
   and prefers a lightweight single-file/small-set path where honest, so
   repeated per-read repairs cannot thrash worker startup (W4 measurement).
3. **Cross-file expectations are touched-file scoped.** Callers of a brand-new
   symbol appear only after caller files are refreshed; W4 states this
   explicitly — no over-claim.
4. **Watcher root semantics.** Merged/nested-git roots follow discovery
   (M43.A4: nested .git subtrees excluded); submodules/nested repos never
   silently claimed. Watcher + MCP `bb_index` share the P1 lock:
   serialize / decline-and-retry, pinned in W3.1 tests and a W4 concurrency
   scenario.
5. **Documented limitation.** Over-budget burst on a one-shot CLI session
   (no watcher) answers with the honest decline; the agent-facing repair
   trigger is a documented follow-up, not silent auto-fix here.
