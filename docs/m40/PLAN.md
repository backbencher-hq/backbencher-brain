# M40: Index Lifecycle Integrity — PLAN

## The milestone invariant (verbatim, enforced by G1)

> **Any indexing path that updates symbols must leave derived data (relationships,
> enrichment, gravity, taints, health) consistent — or visibly say it did not.**

Every acceptance criterion in this milestone traces to this sentence. Per-issue
gates prove pieces work; the A4 lifecycle corpus proves the system works.

Invariant anchors (checked by G1): the PLAN must contain both the trigger
clause — *any indexing path that updates symbols must leave derived data* —
and the honesty clause — *or visibly say it did not*.

## Findings recap (evidence from code, not memory)

Post-processing (the five heavy phases) is invoked from exactly ONE place:
`src/ast/parallel-indexer.ts:3221` — `} else if (!options.isIncremental && !options.skipPostProcessing) {`.
Every other path silently skips it, forever:

| Path | Post-processing today |
|---|---|
| `bb index` (bare, full) | runs |
| `bb index --changed` | skipped (isIncremental=true) |
| `bb index --resume` | skipped (isIncremental=true) |
| `bb index` after adoption (M23.P3) | skipped (isIncremental=true) |
| `bb index --skip-post-processing` | skipped (explicitly) |
| `bb health --refresh` (non-force) | skipped (health-provider.ts:67-68) |
| `bb edit` (M22.E1 agent-fresh) | skipped (edit-engine.ts:519 → reindexFilesParallel) |
| LSP didSave reindex | skipped (lsp/server.ts:445-465) |
| MCP `bb_index` file mode | skipped (reindexFilesParallel) |
| MCP `bb_index` dir mode | skipped (skipPostProcessing: true, tool-handlers.ts:641) |
| cancelled run | skipped deliberately (M21.R3 — correct, keep) |

No standalone post-processing entry exists anywhere: once a user indexes with
`--changed`, the only remediation for stale derived data is a full re-index.

## Issue inventory + attack order

1. **M40.G1 (#630)** — governance first: ledger, evidence dir, closure gate,
   mutation self-test, stamp agreement. (Do first; everything lands inside it.)
2. **M40.A1 (#631)** — `runPostProcessing(projectId, opts)` extraction +
   `bb index --post` + MCP `bb_index` mode=post. The missing remediation command.
3. **M40.A2 (#632)** — bounded incremental post-pass inside the indexer for
   incremental runs; provably sub-linear (timing evidence required).
4. **M40.A3 (#633)** — write-path parity: bb_edit / LSP / MCP file-mode run the
   A2 scoped pass; deferrals visible, never silent.
5. **M40.A4 (#634)** — the lifecycle-invariant corpus (6 scenarios), wired into
   closure + self-test with mutations. The non-negotiable system gate.
6. **M40.A5 (#635)** — flag semantics matrix + combination guards + honest help.
7. **M40.A6 (#636)** — health --refresh honesty (derived-data freshness signal).
8. **M40.A7 (#637)** — CLI/MCP read parity + command-selection table.
9. **M40.A8 (#638)** — config precedence single-source; test-hook quarantine.
10. **M40.A9 (#639)** — dead-surface purge: used-or-removed, purge report here.

Order rationale: A1 before A2 (A2 reuses the extracted entry in scoped mode);
A3 depends on A2; A4 after A1-A3 (it gates their composition); A5-A9 are
independent of each other once A1-A4 land.

## bb index flag semantics matrix (A5 will enforce this verbatim)

| Combination | Verdict |
|---|---|
| (bare) | full index + all post-processing |
| `--changed` | incremental parse + **bounded post-pass (A2)** |
| `--resume` | incremental from checkpoint + bounded post-pass |
| `--post` | **no parse**; re-run 5 phases only (A1) |
| `--skip-post-processing` | parse+store only; summary must say deferred |
| `--file <p>` | single-file reindex + scoped post-pass |
| `--import <db>` | adopt DB, then incremental top-up |
| `--force` | wipe + full index + full post-processing |
| `--force --changed` | **REJECT** (wipe then incremental = contradictory) |
| `--file --changed` | **REJECT** (scope conflict) |
| `--resume --changed` | **REJECT** (double-incremental) |
| `--skip-post-processing --post` | **REJECT** (contradictory) |
| `--force --post` | **REJECT** (nothing to post-process after wipe) |
| `--import --force` | **REJECT** (adopt then wipe = destroys imported index) |

## Latency budget (A3)

Edit round-trip (bb_edit call → DB queryable with resolved edges) must stay
interactive: **p95 < 2s on the fixture corpus**. LSP didSave may opt down to a
recorded deferral; the deferral must be visible in tool output.

## Purge rule (A9, user-directed)

Present-but-useless is **removed**, not verified-and-tolerated. The purge
report in this file lists every audited surface item with verdict
used / fixed / removed + proof. No zombie flags, no no-op env vars, no
exported functions without callers.

## Evidence rules (M35 discipline, inherited)

- Evidence files in `validation/m40/results/*.json` are the ONLY truth;
  ledger blocks are synced from them by `script/m40/sync-ledger.ts`, never hand-edited.
- Every gate: real runs, no auto-pass predicates, registered negative cases,
  mutation proof in the self-test (a gate that cannot fail is not a gate).
- Stamps: evidence records the commit it was produced at; governance enforces
  stamp agreement across the chain; closure refuses hand-closing.
- Control seam: gates spawned by the self-test honor `BB_M40_SELFTEST_CONTROL=1`
  for checks that are mid-flight by construction (M31/M35 pattern).
- Co-agent surfaces (M14/M20/M24/M37 analyzer work) are out of scope and
  untouched; commits carry only M40 files.

## M40.A8: embedding config precedence (user-facing)

One function owns the order — `resolveEmbeddingConfig()` in `src/config/config.ts`.
Engine and openai-embed consume it; none re-implements it. Per field, highest first:

1. **Environment** — `BB_EMBEDDING_BASE_URL`, `BB_EMBEDDING_MODEL`, `BB_EMBEDDING_API_KEY`
2. **Config files** — `BB_CONFIG_FILE` > `./bb.json` > `<data-dir>/config.json`
3. **Built-in default** — `https://api.openai.com/v1` + `text-embedding-3-small`

`configured` is true only when BOTH base-url and model resolve to env or file
(an api key alone or a model alone does not configure a remote provider).
Inspect the resolved truth with `bb health --verbose-config` (or MCP `bb_health`
`verbose=true`): every field is shown with its `env:<VAR>` / `file:<key>` /
`default` source; the API-key value is never printed, only its source.

Test-only worker fixtures (`BB_WORKER_CRASH_ON_BATCH`, `BB_WORKER_DELAY_PARSE_MS`,
`BB_WORKER_DELAY_READY_MS`) are quarantined behind `BB_TEST_HOOKS=1`: without the
explicit opt-in they are no-ops in every process, so a stray env var can never
crash or stall a production index. `BB_FILE_TIMEOUT_MS` is NOT quarantined — it
has a safe production default (45s) and is a legitimate operations knob.

## M40.A9: dead-surface purge report

Rule: present-but-useless is REMOVED, not verified. Every surface item below
carries a verdict and its proof. The A9 gate re-enumerates this surface and
fails if any item loses its proof.

### bb index CLI flags (8)

| flag | verdict | proof |
|---|---|---|
| `--force` | used | cmdIndex wipe+full path; A5 matrix row; health --force (A6) |
| `--no-setup` | used | cmdIndex → maybeRunFirstRunSetup({noSetup}) (M30.S2) |
| `--skip-post-processing` | used | parse+store only; remediation documented in --post help |
| `--post` | used (was M22-phantom, made real by A1) | A1 gate; M22 C2 updated to prove reality |
| `--file <path>` | used | scoped reindex + bounded pass; A5 matrix row |
| `--changed` | used | A2 bounded pass; A5 matrix row |
| `--resume` | used | checkpoint resume (M21.R3); A5 truthful no-checkpoint message |
| `--import <db>` | used | M23.P3 adoption; dual-runtime fix in A5 |

### MCP bb_index modes (4)

`auto` / `file` / `dir` / `post` — all four branch in tool-handlers.ts; file
carries A3 derived telemetry, post carries the A1 phase report. No phantom
mode values in the registry enum.

### BB_* env vars (production read surface)

| var | verdict | proof |
|---|---|---|
| BB_LOG_LEVEL, BB_QUIET | BB_LOG_LEVEL used; **BB_QUIET removed** | M22.W1 quiet path; BB_QUIET was written but never read anywhere (phantom) |
| BB_DATA_DIR, BB_CONFIG_FILE | used | data-dir resolution; explicit config (M22/M23) |
| BB_EMBEDDING_BASE_URL / _MODEL / _API_KEY | used | A8 single-source precedence |
| BB_PROVIDER | used | provider override (config.ts) |
| BB_FILE_TIMEOUT_MS | used (NOT a test hook) | safe 45s default; ops knob |
| BB_WORKER_CRASH_ON_BATCH, BB_WORKER_DELAY_* | used, **quarantined (A8)** | inert without BB_TEST_HOOKS=1 |
| BB_WORKER_STARTUP_TIMEOUT_MS, BB_POOL_WORKER, BB_POOL_WORKER_PATH | used | pool lifecycle; compiled-binary worker path |
| BB_VECTOR_SCAN_CAP | used | semantic search scan cap (perf knob) |
| BB_EMBEDDING_QUEUE_LIMIT, BB_EMBEDDING_BATCH_LIMIT, BB_EMBEDDING_CALL_TIMEOUT_MS | used | background embed queue knobs with defaults |
| BB_LSP_STDERR_LOG | used | LSP stderr trace (M25.E5) |
| BB_TEST_HOOKS | used | A8 quarantine opt-in |
| BB_M35_SKIP_FRESHNESS | test seam, **now quarantined (A9)** | M35 S1 gate measures with/without; requires BB_TEST_HOOKS=1 |
| BB_TEST_QUALITY, BB_SECURITY, BB_PATTERNS, BB_MIGRATE, BB_DOC | doc paths (strings), not env vars | evidence.ts doc references |

### Exported lifecycle functions (parallel-indexer.ts)

| export | verdict | proof |
|---|---|---|
| indexProjectParallel | used | CLI/MCP/health/LSP callers |
| reindexFilesParallel | used | edit-engine, MCP file mode, LSP reindex |
| runPostProcessing | used | CLI --post, MCP mode=post (A1) |
| wipeProjectData | used | --force, health refresh, registry wipe |
| storeResults | used | indexer store path; M21 gates |
| calculateGravityScores, resolveCrossSymbolTaints | used | post-processing phases + M21 gate |
| processWithWorkerPool | used | indexer internal |
| shouldSkipCli, hasValidExtension | used | discovery filter + tests |
| ParallelIndexerConfig | used | pool tuning + M21 fixtures |
| flushBackgroundEmbeddings | verifier seam (marked internal) | drains the self-draining queue deterministically for m18/m21 gates |
| backgroundEmbedMetrics | verifier seam (marked internal) | m21 observability; product reads DB rows |
| excludePatterns (option) | marked internal | plumbed through, no in-tree caller yet |
| setQuiet (util/log + tool/brain-log) | **REMOVED** | zero callers; quiet lives in BB_LOG_LEVEL |

Removals compile (`tsc --noEmit` clean) and the full chain is re-run green at
the A9 commit.

## Out of scope (deliberate)

- `bb watch` daemon — real value, own milestone after the lifecycle is coherent.
- Consolidating status/stats/health/doctor/projects — A7 documents a selection
  table; no consolidation rewrite.
- Analyzer internals (co-agent territory), embeddings quality (M30 territory).
