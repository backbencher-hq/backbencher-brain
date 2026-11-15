<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase A audit of the public MCP tool `bb_health`: corrected inventory, every code path and declared mode/option/refusal, defects with severity and evidence, doc drift, gate inventory + measured state, regex and process-attribution inventories, blocked legs, and the Phase B fix plan.
WHO IT IS FOR — the campaign owner of bb_health and the Lead reviewing the phase gate.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_health/**, src/intelligence/health/**, script/tool-docs/curation/bb_health.ts, docs/tools/bb_health.md, docs/BB_HEALTH.md, and the gate scripts listed in §7.
-->

# `bb_health` — Phase A audit

- Tool: `bb_health` (read, requiresIndex=false, 12 inputs, no `mode` parameter)
- Checkout: `backbencher-brain` 0.3.0, git HEAD `c43282e92`, working tree mid-split (module-per-tool layout present for all measurements below)
- Method: read-only for `src/` and `docs/`; all writes are under `validation/tools/bb_health/**` or gate fixture DBs in the isolated `BB_DATA_DIR=validation/tools/bb_health/bbdata`
- Evidence: this file, `LATENCY.json`, `gates/` (logs, snapshots, file hashes), `work/` (probes). Claimed-number policy: a claim here is backed by a command whose exit code and output are in `gates/logs/`, or it is marked `unknown`.

The checkout is shared and was being edited while this audit ran (`src/brain/brain-index-health.ts` changed mid-audit; `dist/` was rebuilt during it; the Lead's split landed). Audited file hashes are pinned in `gates/file-hashes.txt`; every measured result is labelled with the state it was measured against.

---

## 1 · Corrected inventory

The charter's `src/mcp/tools/<tool>/descriptor.ts` assumption was false for this tool until the split landed. As audited:

| Component | Path | Owner |
|---|---|---|
| Descriptor (executable contract) | `src/mcp/tools/bb_health/descriptor.ts` (after split; was `src/mcp/tool-registry.ts` inline) | mine now |
| Handler | `src/mcp/tools/bb_health/handler.ts` (after split; was a section of the 2,892-line `src/mcp/tool-handlers.ts`) | mine now |
| Engine — report provider + text renderer | `src/intelligence/health/health-provider.ts` (1,324 lines) | mine |
| Engine — integrity battery | `src/brain/brain-index-health.ts` (14 checks; grew from 13 to 14 during the audit via a Lead edit) | Lead-request only |
| Engine — freshness resolver / sample selection | `src/brain/freshness.ts` | Lead-owned (do not edit) |
| Engine — analysis history | `src/intelligence/analysis/run-history.ts` (`getAnalysisHistory`) | outside scope |
| Assemblers (Lead) | `src/mcp/tool-handlers.ts`, `src/mcp/tool-registry.ts`, `src/mcp/server.ts`, `src/mcp/tool-validation.ts` | Lead |
| Shared handler helpers | `src/mcp/tools/shared.ts`, `src/mcp/tools/types.ts` | Lead |
| Docs — generated page | `docs/tools/bb_health.md` (regenerated from descriptor + curation; edit only curation then `--only bb_health --write`) | generated |
| Docs — curated guide | `docs/BB_HEALTH.md` (hand-written, stale — see §6) | mine |
| Docs — analysis-history guide | `docs/BB_ANALYSIS_HISTORY.md` (mentions bb_health history; outside my write scope) | Lead request |
| Docs — curation | `script/tool-docs/curation/bb_health.ts` (24 lines, seeded header) | mine now |
| Contract artifact | `docs/data/public-tools.json` (generated from registry) | Lead |
| LSP twin | `bb/staleness` in `src/lsp/server.ts` (registration line 1067) + `src/lsp/freshness.ts` monitor | read-only inspection |
| Gates | `script/verify-health.ts`, `script/m13/verify-health-{mutability,verbose,integrity,refresh,e2e-corpus,docs}.ts`, `script/m15/verify-health-deep.ts`, `script/m40/verify-a6-health-refresh.ts`, `script/m51/verify-a2-health-split.ts`, `script/m64/verify-{sample-coverage,refresh-integrity,coverage-and-partial,freshness-reasons,actionability,unindexed,paths,embed-scan,wire,health-deep,evidence}.ts` | mine |
| CI wiring | `package.json` `verify` script names each gate; `script/verify-quality-gate.ts` requires the m13 five | Lead (wiring) |

The tool is NOT a stub around one query: the provider has 5 modes of work (status/refresh/integrity/paths/unindexed/history/analysis-runs), a deterministic sampling selector, a refresh queue with a detached-outcome ledger, a 14-check integrity battery, and 20+ warnings classified by severity. The default call is the one examined most closely because it is the one that timed out.

## 2 · Code paths

`bb_health` handler (`handler.ts`) → `validateToolArguments` (Lead assembler) → handler:
1. `refreshRequested = args.refresh === true || args.force === true`.
2. one `getUnifiedHealth(projectId, projectPath, { refresh, force, wait, freshness, sampleSize, integrity, includeAnalysisRuns, checkUnindexed, paths, verbose, logger })` call.
3. if `args.history === true`: `getAnalysisHistory(projectId, undefined, limit ?? 20)` → JSON text `{ health, history }`, plus `healthy` on the ToolResult.
4. else `formatUnifiedHealth(report)` → text, plus `healthy`.

`getUnifiedHealth` (health-provider.ts) unconditionally does, in order:
- `BrainDatabase.getRawInstance(projectId)` — **runs idempotent DDL/DML on open** (`ensureSchemaIfNew` → `migrateSchemaColumns`, `ensureHealthIndexes`, `cleanupOrphanedFkRows`, `ensurePlannerStats`, …); see D5.
- read prior detached-refresh record (in-process `Map`; running → REFRESH_IN_PROGRESS warning; failed → REFRESH_FAILED_ASYNC error).
- if refresh/force: `queueRefresh` (serialized per project; `force` wipes via `wipeProjectData` first; incremental otherwise; bounded derived pass). `wait !== false` awaits and re-opens the handle; `wait === false` records a `DetachedRefresh` and returns the current snapshot, later reporting the terminal outcome on the next call.
- 5 `COUNT(*)` queries: `brain_file`, `brain_symbol`, `brain_relationship`, `brain_import`, plus syntax-error files.
- `SELECT * FROM brain_index_status`; `SELECT id, relative_path FROM brain_file` (whole index); `selectSampleFiles` (deterministic FNV+murmur hash rank, k smallest; O(n) with k-sized insertion array).
- `resolveRowsFreshnessDetailed` for the sample: one `stat` per unique file, mtime+size fast path, SHA-256-16 content read only when metadata differs → fresh/stale/missing + per-row reason.
- `aggregatesStarted` mark; four full-table/group-by queries: file×language counts, symbol×language JOIN counts, embedding model counts, embedding entity-type counts; `COUNT(DISTINCT entity_id)`; **`kindsWithNoEmbeddings`** (one correlated `NOT EXISTS` per symbol); **`embeddedByLanguage`** (one correlated `EXISTS` per symbol + file JOIN).
- embedding chain diagnosis (`buildEmbeddingDiagnosis(describeEmbeddingConfig())`) — always, not verbose-gated.
- if `checkUnindexed`: `statSync(projectPath)` + `discoverIndexableFiles(projectPath)` walk, compare against `brain_file.path` set.
- if `paths`: realpath/containment checks, one row lookup per path, one batched freshness resolution, one symbol COUNT per indexed path; 5-state verdict + scope block + warnings.
- if `integrity`: `runIndexHealthCheck(projectId, { diskScan:"complete", preResolved: coversEveryFile ? {...} : null })` — with default sampled freshness this re-reads every indexed file (content hash when metadata differs).
- if `includeAnalysisRuns`: `getAnalysisHistory(projectId, undefined, 100)` + `COUNT(*) brain_analysis_run`.
- warnings: SYNTAX_ERRORS, UNRESOLVED_FILES, STALE_FILES (with reason mix), NO_INDEX_STATUS, INCOMPLETE_INDEX, INDEXING_ERRORS, EMPTY_INDEX, PATHS_*, UNINDEXED_*; `timing.totalMs`; return report.
- `formatUnifiedHealth`: scoped block first (paths), project lines (files/symbols/…, freshness + why mix, embeddings, models, schema, index, index run, this call, runtime), then refresh line (only when requested), unindexed, analysis, integrity non-ok checks (≤3 named + count), verbose sections (embedding config + chain, languages, searchable-by-language, unsearchable languages, embedded/unembedded kinds, capped stale/missing file lists), warnings last.

Interactive surfaces: CLI `bb health [dir] [--refresh] [--force] [--no-wait] [--complete] [--integrity] [--sample-size N] [--verbose-config]` calls the same provider and exits 1 on an error-severity warning; the MCP handler is analysed above; the LSP twin `bb/staleness` is a different, per-file marker (`{stale,status,pendingReindex}`) and does not consume the provider.

## 3 · Modes / options / refusals — measured matrix

Descriptor: 12 inputs, no `mode`. `modes: ["status","refresh"]` are *behaviours selected by flags*, not a parameter (D2). Measured through `validateToolArguments` + the real handler on an isolated fixture (`work/contract-probe.json`), and through a real MCP stdio session with the SOURCE server (`work/wire-probe.json`):

| Call | Result | Note |
|---|---|---|
| `{}` | ok, `healthy:true`, text report | default path |
| `{verbose:true}` | ok | adds verbose sections |
| `{history:true, limit:5}` | ok, JSON `{health, history}`, `healthy` on result | wire keeps `healthy` key (verified: response keys `["content","healthy"]`) |
| `{history:true, limit:0}` | ok, `runs:0` empty page | D4 |
| `{limit:5}` (no history) | ok, `limit` **ignored** | D3 |
| `{wait:false}` (no refresh) | ok, ignored | D3 |
| `{freshness:"complete", sampleSize:3}` | ok, `sampleSize` **ignored** | D3 |
| `{sampleSize:0}` | refused: "must be a whole number >= 1 — 0 would mean checking no files…" | correct |
| `{freshness:"bogus"}` | refused: "freshness must be one of: sampled, complete" | correct |
| `{complete:true}` | refused: "unknown or irrelevant options: complete — accepted options: …" | correct |
| `{includeAnalysisRuns:true}` / `{integrity:true}` / `{checkUnindexed:true}` | ok | opt-in work runs |
| `{paths:[]}` / `{paths:`51≈`}` / duplicate paths | refused with actionable messages | correct |
| `{paths:["../outside.ts"]}` | ok + `REFUSED (not checked)` + `healthy:false` | correct shape, see D9 for status words |
| `{paths:[abs-in-project]}` | ok, resolved project-relative | correct |
| `{paths:[fresh,stale,gone,not-indexed,absent]}` | 5-state block verified (fresh/stale/gone/not-indexed/absent) | correct |
| `{refresh:true}` (wait default) | ok, `refresh.completed`, derived signal | mutates index by design |
| `{force:true, wait:false}` | ok, pending snapshot + `REFRESH_STARTED` | success of that detached job is invisible later (D12) |

Wire facts verified: 16 tools listed; `bb_health` schema keys = 12; unknown option → `isError:true` with the accepted-set refusal; `healthy` boolean survives the MCP wire as a top-level result field (not inside the JSON text) — so a caller parsing `content` only must read error lines or the `healthy` key from the result object.

## 4 · Defects (severity, evidence, fix direction)

**D1 · CRITICAL — default call is O(symbols) and misses its latency budget; reproduces the >30 s timeout.**
- T2 (`.bb-data`, 6,452 files / 310,423 symbols): warm p50 **4,575 ms**, p95 **5,204 ms**; first call in a fresh process 12,880 ms. Budget is 2,000 ms (`LATENCY.json`).
- T2-scale reproduction (same index copied and raised to the charter's 1,283,638 symbols): first default call **76,713 ms**, warm p50 12,752 ms — the known >30 s defect reproduced with default arguments (`LATENCY.json`).
- Live MCP door: default and `paths` calls both returned `Request timed out` (client budget 120,000 ms) against the served `~/.bb` index (17 GB + 8.7 GB WAL, 1,284,808 symbols, 15 GB RAM).
- Mechanism: §2's unconditional aggregates. Cold per-query profile on `.bb-data`: `kindsWithNoEmbeddings` 6,792 ms, `embeddedByLanguage` 3,699 ms, `entityTypeRows` 3,225 ms, `symLangRows` 2,217 ms, `COUNT` symbol 1,001 ms / relationship 2,048 ms — 17.6 s total at 310k symbols, ~4.1x at 1.28M.
- Fix: compute the verbose-only aggregates only for `verbose:true` (D8 lists which); keep the default answer bounded (the same report, no verbose payload); declare the cost of the opt-ins; re-measure on T2 and on the scale copy.

**D2 · HIGH — `modes: ["status","refresh"]` is not a callable mode.** The tool accepts no `mode`; a caller reading the descriptor or the generated page ("Modes: `status`, `refresh`") will try `mode:"status"` and get `unknown or irrelevant options: mode`. Fix: say in the description that there is no mode parameter and that `refresh`/`force` select the refresh behaviour (and keep the two words only as behaviour names in docs).

**D3 · HIGH — accepted-but-ignored options.** `limit` without `history:true`, `wait` without `refresh`/`force`, and `sampleSize` with `freshness:"complete"` all validate clean and do nothing (matrix above). This is the defect class the project already rejected for `bb_search` mode-irrelevant options; the fix is a named refusal that teaches the correct call.

**D4 · HIGH — `history:true, limit:0` returns an empty page as a success.** "An empty page is indistinguishable from a real answer" is the standing rule for page-size 0 (`bb_analyze limit:0`, `bb_health sampleSize:0` both refuse). `limit` is a page-size parameter for the history query and must be refused at 0 (and only meaningful with `history:true`, see D3).

**D5 · HIGH — a plain call mutates the index.** `getUnifiedHealth` opens the DB through `BrainDatabase.getRawInstance`, whose `ensureSchemaIfNew` runs idempotent DDL/DML on *every* open (`migrateSchemaColumns`, `ensureHealthIndexes`, `cleanupOrphanedFkRows`, `ensurePlannerStats`, …). Measured on a clean fixture: brain.db-wal 2,092,992 → 2,125,952 bytes after one default call (`work/mutation-probe.mts`); the m13 mutability gate's negative "plain health call performs ZERO index mutation" is **red** because of it. Contradicts the descriptor's documented read semantics and `docs/BB_HEALTH.md` ("Status-only calls do not mutate the index"). Root cause is in Lead-owned `src/brain/database.ts`; the fix needs a read-only/immutable open path for read tools — **Lead request**, not a bb_health-only edit.

**D6 · MEDIUM — a self-contradicting index-status record is printed without comment.** On `.bb-data`, `brain_index_status` records `total_files=1, indexed_files=1` while `brain_file` holds 6,452; the report prints `indexedFiles=1/1 status=complete` next to `files=6452` and raises no warning (the shortfall check only fires when `indexed < total`). Add a counts-vs-record mismatch warning/flag (`INDEX_STATUS_MISMATCH`).

**D7 · MEDIUM — the `timing` phases are not a partition.** `aggregatesMs` is computed as "everything after freshness minus refresh/integrity", so it silently absorbs the `checkUnindexed` walk and the `paths` scan (whose own `walkMs`/`pathsMs` are reported separately), and the phases can exceed `totalMs`. Fix: close each phase around its own work; keep `totalMs` authoritative.

**D8 · MEDIUM — verbose-only work runs on every call.** `kindsWithNoEmbeddings` (unembedded kinds), `embeddedByLanguage` (searchable-by-language), `symLangRows` (per-language symbol counts), `entityTypeRows` (embedded kinds) and the `buildEmbeddingDiagnosis` chain feed only verbose output yet are computed for default calls. `report.languages` is documented as "always collected"; either collect only file-side counts by default and fill symbol counts when verbose, or declare the cost. This is the concrete lever for D1.

**D9 · MEDIUM — `paths` flattens "unreadable" into "gone".** For an indexed file that still exists but cannot be read, `pathChecks[].status` is `"gone"` (documented as "indexed, NOT on disk — it was deleted") while the `reason` field says `unreadable`. Carry the distinction in the status word or state the reason vocabulary in the descriptor.

**D10 · MEDIUM — the stale-file list tells the caller to raise `limit`.** `renderFileList` appends "raise `limit`/use freshness=\"complete\" …" but `limit` is the history page size and has no effect here (D3). Fix the remediation sentence.

**D11 · LOW — `integrity:true` cost is undeclared.** With default sampled freshness the battery falls back to `diskScan:"complete"`, i.e. it re-reads every indexed file (content hash on metadata mismatch) inside one call. Opt-in longer calls are allowed if bounded and declared; declare it in the option description and the curated performance text.

**D12 · MEDIUM — a successful detached refresh is never reported.** `wait:false` records the outcome and the next call reports in-progress/failure, but deletes the record silently on success — and since `refresh.requested` is false on that next call, no refresh line is printed. The descriptor says "the NEXT call reports whether it completed"; a caller cannot learn that it completed successfully. Emit a one-shot `REFRESH_COMPLETED` line/warning (and document the one-shot semantics).

**D13 · LOW — `healthy` is a non-spec result field.** It is not part of the MCP `CallToolResult` schema; it survives this SDK's serialization (verified on the wire) but a stricter client could drop it. The JSON history branch also does not repeat it inside the payload. Document it as an extension (and/or mirror it in the JSON payload).

**D14 · LOW — `paths` refused entries are not `isError`.** An out-of-project path is bad input; today the call answers success-shaped text with `healthy:false`. The declared design (refusal *in* the payload) is defensible, but the charter asks wrong input to be `isError:true`; decide and state it (I recommend keeping the payload channel and documenting why, since the rest of the report is still valid).

**D15 · LOW — docs page field name drift.** The generated page's staleness section (text owned by Lead `script/verify-tool-docs.ts` `FRESHNESS_TOOLS`) names the block `{ …, unresolved, isComplete, why }`; the payload field is `reasons` (with `byKind`, `freshVerifiedByContent`, `freshVerifiedByMetadata`, `isSample`). Fix in the Lead-owned generator text; the page regenerates from it.

**D16 · LOW — `languages` always-collected comment vs the perf budget.** Same fact as D8, recorded separately because the type doc says "always collected, printed only when verbose" — whichever behaviour wins must be stated once.

**Gate defects (mine to fix in Phase B; each is a gate that cannot be green/meaningful after the split):**
- **D17 · HIGH** `m13/verify-health-mutability` greps the monolith `src/mcp/tool-handlers.ts` for the refresh gate and for the verbose wiring → false red on the split layout.
- **D18 · HIGH** `m13/verify-health-integrity` hardcodes "exactly 13 checks"; the battery now reports 14 (M51 synthetic split + the Lead's mid-audit addition). The gate should derive the count (the code's own principle: a number in prose the code can drift from will be wrong).
- **D19 · HIGH** `m15/verify-health-deep` H6 reads the registry source for a `name: "bb_health"` block that moved to `descriptor.ts` → `FATAL TypeError: Cannot read properties of undefined (reading 'split')` at line 213; H1-H5 pass before the crash.
- **D20 · MEDIUM** `m13/verify-health-refresh`'s "injected refresh failure" is no longer a failure: deleting the DB directory now re-creates it and the refresh completes honestly (`completed=true`). The gate needs a failure injection that still fails (e.g. read-only DB directory) or the assertion needs the new truth.
- **D21 · MEDIUM** `m13/verify-health-e2e-corpus` "sampled mode detects the stale file" samples 2 of 5 files and asserts the stale one is in the sample — a deterministic hash selection, so this is luck, not detection. Assert over `freshness:"complete"`.
- **D22 · MEDIUM** `m13/verify-health-e2e-corpus` MCP leg does not forward `BB_DATA_DIR`: `StdioClientTransport` defaults to a safe env subset, so the spawned server targets `~/.bb` and fails with `ENOENT: mkdir '/home/ishaq2321/.bb/projects/<id>'` under this sandbox. Pass `env: {...process.env, BB_DATA_DIR}` (the pattern `script/verify-mcp.ts` now uses).
- **D23 · MEDIUM** `m64/verify-wire` is bun-only: under Node it reports `H64e: SKIPPED — requires bun (src/mcp/server.ts self-starts behind import.meta.main, a Bun API)`. It must be run with `bun run …` in the sweep (I ran an equivalent source-server wire probe that passed).
- **D24 · LOW** `m13/verify-health-docs` crashes under `npx tsx` (`import.meta.dir` is a Bun API) and depends on committed `h1..h5` evidence being `verified` — running any of the five H gates with the isolated fixture then breaks it. Run it with bun and treat the evidence dependency explicitly.

## 5 · Doc drift

| Document | Drift | Severity |
|---|---|---|
| `docs/tools/bb_health.md` | byte-fresh after the split (`verify-tool-docs.ts --only bb_health` PASS); staleness section names `why` instead of `reasons` (D15); modes line implies a mode parameter (D2); Performance section has no measured numbers | MED |
| `docs/BB_HEALTH.md` | stale: "M9.14" milestone title; MCP option list omits `verbose`, `history`, `limit`, `paths`, `checkUnindexed`; CLI list omits `--verbose-config`; no measured latency/limits; says "Status-only calls do not mutate the index" (currently false, D5) | MED |
| `docs/BB_ANALYSIS_HISTORY.md` | milestone framing ("M9.12", "M10.04"); claims "Public tools remain bb_security, bb_patterns, bb_analyze/bb_health" and describes bb_health history as "all finding kinds and run history" without the `{health, history}` shape or the run page limit | MED (outside my write scope) |
| `docs/data/public-tools.json` | generated from the registry; carries the same description/modes facts as the descriptor (D2) | LOW |
| `docs/website/TOOLS.md` | `bb_refresh → bb_health` mapping is historical and correct as a migration table; tool row says Modes `status`, `refresh` | LOW |
| `README.md` | `bb health [dir]` described only as "Index stats + file freshness sample" (omits refresh/integrity/paths) | LOW |

## 6 · Gates — inventory and measured state

All run from the working tree after the split, `BB_DATA_DIR=validation/tools/bb_health/bbdata`, `BB_NO_AUTO_REFRESH=1`, `BB_M40_READ_ONLY=1`. Logs: `gates/logs/postsplit-*.log`. Exit codes are the process exit codes (not a pipe's).

| Gate | Exit | Result |
|---|---|---|
| `script/verify-health.ts` | 0 | HEALTH VERIFICATION: PASS |
| `script/m13/verify-health-mutability.ts` | 1 | KNOWN-GAP 8/10 — D5 real; handler-grep false red (D17) |
| `script/m13/verify-health-verbose.ts` | 1 | KNOWN-GAP 13/14 — handler-grep false red (D17) |
| `script/m13/verify-health-integrity.ts` | 1 | KNOWN-GAP 18/19 — hardcoded 13 checks (D18) |
| `script/m13/verify-health-refresh.ts` | 1 | KNOWN-GAP 8/12 — injection invalid (D20) |
| `script/m13/verify-health-e2e-corpus.ts` | 1 | KNOWN-GAP 23/26 — sample-flake (D21), MCP env leg blocked (D22) |
| `script/m13/verify-health-docs.ts` (bun) | 1 | KNOWN-GAP 22/27 — evidence states from the isolated runs; see D24 |
| `script/m15/verify-health-deep.ts` | 2 | H1-H5 pass (H5 VERIFIED 4/4), FATAL at H6 (D19) |
| `script/m40/verify-a6-health-refresh.ts` | 0 | 17 passed, 0 failed, 3 negatives |
| `script/m51/verify-a2-health-split.ts` | 0 | 11/11 passed, sealed A2.json |
| `script/m64/verify-sample-coverage.ts` | 0 | PASS |
| `script/m64/verify-refresh-integrity.ts` | 0 | PASS |
| `script/m64/verify-coverage-and-partial.ts` | 0 | H64b VERIFIED 54/54, 6 negatives |
| `script/m64/verify-freshness-reasons.ts` | 0 | H64r VERIFIED 29/29, 2 negatives |
| `script/m64/verify-actionability.ts` | 0 | H64a VERIFIED 48/48, 7 negatives |
| `script/m64/verify-unindexed.ts` | 0 | H64c VERIFIED 35/35, 3 negatives |
| `script/m64/verify-paths.ts` | 0 | H64d VERIFIED 39/39, 3 negatives |
| `script/m64/verify-embed-scan.ts` | 0 | H64f VERIFIED 14/14, 2 negatives |
| `script/m64/verify-wire.ts` | 0 | H64e SKIPPED under Node — needs bun (D23) |
| `script/m64/verify-health-deep.ts` | 0 | H64 VERIFIED 60/60, 6 negatives |
| `script/m64/verify-evidence.ts` | 0 | H64X VERIFIED 12/12, 7 negatives |
| `script/verify-tool-docs.ts --only bb_health` | 0 | TOOL DOCS: PASS, page byte-fresh |
| `script/verify-tool-registry.ts` | 0 | PASS |
| `script/tools/verify-regex-policy.ts` | 0 | PASS — 112 frozen uses, 0 new |

Evidence side effects: gates write `validation/{m13,m15,m40,m51,m64}/results/**` (outside my write scope). I snapshotted the relevant committed files at 13:09, ran all gates, restored the snapshots, and kept fresh emissions under `gates/emitted/` (empty at close because the restore policy won); if the fleet regenerated one of those files between the snapshot and the restore, the restore may shadow that newer write — the Lead should treat the canonical evidence as unchanged by this audit.

## 7 · Regex inventory (charter §7)

Tool source (what `verify-regex-policy.ts` scans):
- `src/intelligence/health/health-provider.ts` — **3 literals**, 0 `new RegExp`:
  - `firstSentence()`: `/^(.*?[.!?])(?:\s|$)/` (line 1134) and `/\s+/g` (line 1135) — replaceable by string operations; no non-regex necessity; currently frozen debt, not allowlisted.
  - `renderChainSummary` filter: `/^No embedding provider is configured/` (line 1287) — a prefix test, `startsWith` suffices.
- `src/mcp/tools/bb_health/handler.ts`, `descriptor.ts`, `script/tool-docs/curation/bb_health.ts` — 0 literals.
- Phase B plan: remove all three (prefix/whitespace/sentence split as plain string code). `verify-regex-policy.ts` must stay green (it counts *new* uses; paying down frozen debt is the direction it wants).
Gate scripts use regexes heavily as test assertions (115 captured in the scan, e.g. m64 `verify-wire` 22, `verify-actionability` 31). These are verifier assertions, not parsing; §7's "tool code" scope does not cover them, but the audit records the count so the policy gate's scope can be decided explicitly by the Lead.

## 8 · Process-attribution comment inventory (charter §9)

Scanner: `validation/tools/bb_health/work/scan.mjs` (patterns: owner-narrative, the-Lead, lane, teammate, agent-door, issue #N, task-N, milestone IDs, `MEASURED <date>`, defect-fixed-date, shipped, standing rule, the fleet, Generated-with/Co-Authored-By).

| File | Banned-pattern lines | Notes |
|---|---|---|
| `src/intelligence/health/health-provider.ts` | 89 | almost all milestone IDs (`M64.*`, `M21.I3`, `M22.D2`, `M40.A6`, `M52.*`); plus "no gate in this lane noticed", "shipped" |
| `src/mcp/tools/bb_health/handler.ts` | 9 | inherited import-block comments from the monolith (`M28.T1 (issue #624)`, `M48.P1 (#696)`, `M55.T5`, `M64.P3`, `M64.P2`, "the agent door") |
| `src/mcp/tools/bb_health/descriptor.ts` | 2 | `M64.H5`, `M64.I2` |
| `script/tool-docs/curation/bb_health.ts` | 0 | clean; header is the seeded placeholder |
| gate scripts (21 files) | 115 | mostly milestone references in header narratives and check labels |
| `docs/BB_HEALTH.md` | milestone in title (`Unified Health (M9.14)`); `docs/BB_ANALYSIS_HISTORY.md` has `M9.12`/`M10.04` | documented separately in §5 |

`owner` in the technical sense (`owner_symbol_id`, "owner cascade", "orphan owner references") appears legitimately and is kept per §9.

## 9 · Blocked legs (exact commands and reasons)

1. `npx tsx script/m13/verify-health-docs.ts` → `TypeError: The "paths[0]" argument must be of type string. Received undefined` at line 37 (`import.meta.dir` is a Bun API). Run as `bun run script/m13/verify-health-docs.ts` (did: exit 1 only on evidence-state assertions, see D24).
2. `script/m13/verify-health-e2e-corpus.ts` MCP leg → `FAIL: MCP: health reports counts error: ENOENT: no such file or directory, mkdir '/home/ishaq2321/.bb/projects/1f51fd1e259f6dd166e7bc30b7ed023398541c56'`. Reason: `StdioClientTransport` defaults to `getDefaultEnvironment()` (drops `BB_DATA_DIR`), so the spawned server uses `~/.bb`, which this sandbox cannot write. Not a product defect; the gate must forward the env (D22). The CLI legs in the same gate inherit the env and passed.
3. `script/m64/verify-wire.ts` under `npx tsx` → exit 0 with `H64e: SKIPPED — requires bun (src/mcp/server.ts self-starts behind import.meta.main, a Bun API)`. Run with `bun run script/m64/verify-wire.ts` for the real leg; the equivalent source-server wire probe (`work/wire-probe.mts`) passed.
4. Live MCP stdio door through the configured server: `bb_health {}` and `bb_health {paths:[…]}` → `Error: Request timed out` (120 s client budget). Cause: served `~/.bb` index scale (D1) while `dist/` was being rebuilt; a later call returned `Cannot find module '/home/ishaq2321/mcp/backbencher-brain/dist/symbol-search-SCZXX3WR.js'`, so the server's lazy imports were invalidated by the concurrent build. The defect is reproducible by provider measurement (LATENCY.json) without the wedged server.
5. Canonical evidence writes: every gate run writes `validation/<milestone>/results/**`, outside my write scope; runs were snapshot/restored (§6). No write-mutating tool or indexer was run against `.bb-data`; the served `~/.bb` was only read by the MCP door (and its WAL grew from that read, which is D5).
6. The `~/.bb` 17 GB DB was NOT measured directly: opening it read-write from this sandbox is denied (outside the workspace), and copying 25.7 GB is out of budget. Its scale is taken from `brain_index_status` via an immutable read-only SQLite query (`total_symbols=1,284,808`, matching the charter appendix) and its evidence is the live-door timeout plus the controlled 1.28M-symbol reproduction.

## 10 · Phase B plan

1. **D1/D8 (critical, first):** make the default report bounded — compute `kindsWithNoEmbeddings`, `embeddedByLanguage`, `symLangRows`, `entityTypeRows` and the embedding chain only when `verbose:true`; keep `languages` as file-side always plus symbol counts when verbose (document). Then measure T2 and the 1.28M-symbol copy; target < 2 s p95 on T2 with a declared budget line in the description, curation and docs. If T2 still misses after removing the EXISTS work, the next lever is to make the four `COUNT(*)`s use the recorded status record *as a declared lower-bound/estimate* only when it agrees with `brain_file`, never as a silent substitute for a measurement.
2. **D2/D3/D4/D9/D10/D11/D12:** descriptor + validation-layer refusals (Lead assembler `tool-validation.ts` is Lead-owned — request the bb_health-specific refusals there, or implement the teaching refusal in the handler where possible), status words, remediation text, declared opt-in costs, one-shot detached-refresh completion line.
3. **D5:** Lead request — a read-only handle path for read tools in `src/brain/database.ts` (or make the open-time DDL conditional); the mutability gate's negative must then be green for a plain call.
4. **D6/D7:** index-record contradiction warning; honest timing partition.
5. **D13/D14/D15:** document the `healthy` extension (and mirror in JSON), decide paths-refusal shape, Lead request for the generator's `reasons` text.
6. **D17-D24:** repair the gate scripts to the split layout and to derived-not-hardcoded assertions; forward env on the MCP leg; run m13-docs/m64-wire with bun; then prove each gate red on a planted mutant and green on the fixed tree.
7. **Docs/authorship:** rewrite `docs/BB_HEALTH.md` (author header, no milestone framing, measured behaviour, all 12 options, runnable commands); regenerate `docs/tools/bb_health.md` via `--only bb_health --write`; replace the curated placeholder text with measured facts; strip the §8-banned comments from `health-provider.ts`/`handler.ts`/`descriptor.ts` and the gate headers; remove the three regex literals (`verify-regex-policy.ts` green).
8. **Evidence:** `validation/tools/bb_health/AUDIT.md`, `LATENCY.json`, gate logs and red-then-green proofs; final report to the Lead with exit codes and measured before/after latency.
