# Launch-Ready Indexing — Master Coordination Plan

Branch: `launch-ready-indexing` (integration branch, master-only merge point)
Repo: `$HOME/Documents/Default Project/ishaq/backbencher-brain`

## Ownership partition (disjoint file sets — no agent touches another's files)

| Owner | Scope | Files |
|---|---|---|
| **MASTER** | indexer core + CLI + all shared wiring | `src/ast/parallel-indexer.ts`, `src/cli/index.ts`, anything crossing boundaries |
| Agent 1 | pool worker reliability | `src/ast/pool-worker.ts` + new `src/ast/pool-diagnostics.ts` |
| Agent 2 | embeddings | `src/brain/semantic/**`, embeddings provider config |
| Agent 3 | relationship enrichment | `src/brain/brain-relationship-enrichment.ts` |
| Agent 4 | health / status / checkpoint | `src/brain/brain-index-health.ts`, `src/ast/index-status.ts`, `src/ast/index-lock.ts` |
| Agent 5 | documentation | `docs/**` (additive only) |
| Agent 6 | tests | `test/**` (additive only) |

Rules:
- Agent branches: `agent/<n>-<name>`, branched from `launch-ready-indexing`.
- Each agent has its own git worktree. No shared working tree. No agent commits to `launch-ready-indexing`.
- **An agent must never edit a file it does not own.** If it needs a change in a
  master's file, it reports the requirement in its final summary instead.
- Shared/cross-cutting files are committed by MASTER only.

## Confirmed pre-existing findings (do not re-investigate, verify and fix)

1. **`fork(null, ...)` bug** — `resolvePoolWorkerFork()` (parallel-indexer.ts:1208)
   returns `{ workerPath: null }` when tsx is absent (line 1226), but line 4542
   calls `fork(testWorkerPath, ...)` unguarded. The throw is swallowed by the
   surrounding try/catch and reported as "worker pool unavailable" → silent
   downgrade to in-process. Prime suspect for "pool workers don't start".
2. **Terminal UX** — only 21 `_log.log` call sites; no ETA, no elapsed clock, no
   "so far" counts, no completion/support messaging. `docs/m40/PLAN.md` referenced
   by CLI help may not cover the new UX.
3. `--resume` / `--changed` / `--post` / `--force` already exist (cli/index.ts:682-685).
   Work is on making them reliable + discoverable, not inventing them.

## Secrets policy

The embeddings API key is provided by the user for local use only.
- MUST be read from env var (e.g. `OPENROUTER_API_KEY`).
- MUST NOT be committed, and MUST NOT appear in any file, log, doc, or test fixture.
- Master verifies no secret leaks before merging.