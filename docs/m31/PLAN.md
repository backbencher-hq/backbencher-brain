# M31: Tool Documentation Truth — Master Plan

**Milestone:** M31 · **GitHub milestone:** #31 "M31: Tool Documentation Truth"
**Status:** open
**Authority:** `src/mcp/tool-registry.ts` (executable registry, per M13.01) is the single source of truth for every advertised tool contract. Documentation may never advertise what the registry cannot execute.

## Mission

Make the tools documentation machine-verifiably true, keep the per-tool md files canonical (they are the website source), and add the missing overall tools-overview documentation.

## Doc-surface inventory (complete)

| Surface | Files | Current gate | M31 action |
|---|---|---|---|
| Per-tool references | `docs/tools/*.md` (11) | `script/verify-tool-docs.ts` (byte-diff vs generator) | D1: deepen — schema-valid examples, live-registry mode check, freshness stamp |
| Top-level tool docs | `docs/BB_*.md` (15) | **NONE** | D2: behavioral truth gate against real execution |
| Tools overview | *(missing)* | — | D3: create `docs/TOOLS_OVERVIEW.md` + structural gate |
| Integration guide | `docs/MCP_CLI_INDEXER_GUIDE.md` | `script/verify-integration-docs.ts` | none (already gated) |
| Generated artifact | `docs/data/public-tools.json` | `script/verify-tool-docs.ts` | none (already gated) |
| Behavioral baseline | *(missing)* | — | T1: tool-mode corpus snapshot, diffed by D2/D3 gates |

## Issues

| Code | Issue | Title |
|---|---|---|
| G1 | #555 | Governance: doc-truth ledger, gates wiring, mutation-based gate self-test |
| D1 | #556 | Per-tool docs: registry-freshness gate extended with example/schema validation |
| D2 | #557 | Top-level BB_*.md docs: behavioral truth gate |
| D3 | #558 | Tools-overview doc: how the ten tools connect to the system |
| T1 | #559 | Observed-behavior corpus: run every tool mode live and snapshot truth |
| X1 | #560 | Closure gate: full doc-truth audit at final HEAD |

## Attack order

G1 → T1 → D1 / D2 / D3 (parallelizable after T1 baseline) → X1.

## Gate registry (self-tested by G1)

| Gate | Script | Mutations (G1 self-test) |
|---|---|---|
| Governance | `script/m31/verify-governance.ts` | fabricated ledger evidence; missing evidence file |
| Doc-truth example gate | `script/m31/verify-tool-docs-deep.ts` (D1) | schema-invalid example injected; non-executable mode advertised |
| Behavioral claim gate | `script/m31/verify-bb-docs-truth.ts` (D2) | doc claim drifts from observed behavior |
| Overview gate | `script/m31/verify-tools-overview.ts` (D3) | tool mentioned that is not in the registry; cross-link row mutated |
| Corpus determinism | `script/m31/tool-mode-corpus.ts` + diff (T1) | behavior change alters baseline |
| Closure | `script/m31/verify-x1-closure.ts` (X1) | stale evidence accepted; mutation sweep must fail |

## Evidence policy

Identical to M21's proven contract:

- **Zero rule:** missing data is never zero — it is `known-gap`.
- Every issue closes only with a persisted evidence envelope in `validation/m31/results/`:
  `status`, `currentCommit`, `workingTreeRelevantChanges` (empty), `verifierCommand`,
  `evidenceFile`, `generatedAt`, `passed > 0`, `failed == 0`, `negativeCases > 0`.
- **No auto-pass assertions** in any M31 verifier (audited by grep in the governance gate).
- **Staleness scoping (X1):** evidence is re-stamped when doc-adjacent surfaces move
  (`src/mcp/`, `src/contracts/`, `docs/`, `script/verify-*doc*`, `script/m31/`). Analyzer
  commits outside these paths do not falsely flag M31 evidence stale (M21 precedent).
- **Ledger:** `validation/m31/ledger.json`, synced by `script/m31/sync-ledger.ts`.

## G1 finding (2026-09-02)

`bb_index` (M22.E1) had no curated doc entry, so `docs:verify` had been crashing since M22 and no one noticed — the doc gate itself was dead, and `npm run verify` never invoked `docs:verify`. Fixed in G1: curated entry added, `docs/tools/bb_index.md` generated (11 per-tool pages), and the M31 gates wired into `docs:verify` so drift is caught.

## Out of scope (honest boundaries)

- Non-tool project docs (ARCHITECTURE.md, GRAPH_ENGINE.md, etc.) — separate future work.
- Website itself — these docs are prepared as its source, not the site build.
- Analyzer accuracy — owned by M14 (co-agent).

## Post-closure perfection audit (2026-09-02, commits 08d324c..4bf1f30)

Full adversarial re-review after milestone closure. Found and fixed:

1. **D3 emitter wrote evidence to the repo root, not the governed root** — a sandboxed self-test run with stamping enabled could poison real `D3.json` (the emitter-side twin of the T1 baseline bug). Fixed: writes go to `BB_M31_ROOT`.
2. **Self-test child runs inherited `BB_M31_EVIDENCE`** — sandboxed gates could stamp real evidence. Fixed: `runGate` strips it; only the operator's explicit stamping pass writes evidence.
3. **Closure demanded stamp-equality on harness evidence** — a 2-cycle dependency (G1/self-test can only pass after X1's own evidence exists) made convergence luck-based. Fixed: mutual stamp-equality scoped to the four content gates; G1/self-test evidence is conformance-checked.
4. **#555 criterion 3 was not actually satisfied** — `npm run verify` did not run `docs:verify`; governance's check 6 never verified the `verify` script itself. Fixed: `verify` now chains `docs:verify`; governance (32/32) permanently enforces it.

Evidence model after the audit: gate runs are pure reads by default; evidence is written only by an explicit `BB_M31_EVIDENCE=1` stamping pass at the current HEAD, then synced into the ledger.
