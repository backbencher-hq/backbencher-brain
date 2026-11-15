<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Lead's durable ledger for the tools campaign: cross-cutting
findings, rulings, central gate repairs, and integration items that belong to no single tool
owner. It is the handoff surface if the session is compacted: read this plus
docs/tools-campaign/CHARTER.md before acting.

WHO IT IS FOR — the Lead and any teammate returning to the campaign.

EDIT TOGETHER WHEN THIS CHANGES — the charter, the shared gate repairs (script/m28, script/lib,
script/tools), and the integration checklist at the bottom.
-->

# TOOLS CAMPAIGN — LEAD FINDINGS AND RULINGS

## A · Central repairs landed by the Lead (verified)

| Item | State | Evidence |
|---|---|---|
| Split: handlers → `src/mcp/tools/<tool>/handler.ts`, descriptors → `.../descriptor.ts`, curation → `script/tool-docs/curation/<tool>.ts`; assemblers keep every public export | done, tsc clean, docs byte-identical | `npx tsc --noEmit`; `script/verify-tool-docs.ts` |
| `script/lib/tool-sources.ts` — one accessor for tool source text (gates no longer read the monolith) | added | gates below |
| m28 T1 `verify-mcp-tools.ts` — registration read from the live registry, mutants planted in the tool's own module | **VERIFIED 24/24, 2/2 mutants** | validation/m28/results/T1.json |
| m28 U1 `verify-union.ts` — copy-projection mutant now targets `bb_graph/handler.ts`; composed handler map | **VERIFIED 30/30, 6/6 mutants** | validation/m28/results/U1.json |
| m28 V1 `verify-surface-parity.ts` — per-tool bodies; P1 delegation checks read the module that holds the code | **VERIFIED 39/39, 5/5 mutants** | validation/m28/results/V1.json |
| m15 C2 `verify-registry-handlers.ts` — rewritten from a stale 10-tool text scan to a behavioural gate (live registry/handlers, pinned write/index policy, 7 planted-defect controls) | **VERIFIED 23/23** | validation/m15/results/c2.json |
| `script/verify-mcp.ts` — forwards `env` to the MCP child (SDK allowlist dropped `BB_DATA_DIR`) | fixed, ALL PASS | run output |
| `script/tools/verify-regex-policy.ts` + `validation/tools/regex-allowlist.json` + `validation/tools/regex-baseline.json` | installed; 112 uses frozen as debt, 0 new allowed, allowlist rows need a reason + edge-case test file | validation/tools/regex-policy.json |
| `$JsonSchemaProperty` gained `minimum`/`maximum` (documentation-only, like `default`) | done | src/mcp/tools/types.ts |
| Docs truth: "ten tools" → sixteen in README / ARCHITECTURE / TOOL-REGISTRY; per-tool generated pages now carry the author header from the generator; "ten descriptors" fixed | done | generated pages |

## B · Rulings in force (campaign-wide)

1. **T2 is the index as measured.** Record file/symbol/relationship counts AND mtime with every
   measurement. Campaign-start sample was 11,440/1,283,638/4,418,260; live sample at first owner
   measurements was 6,452/310,423/820,040 (fleet reindexed concurrently; load average 12–22
   during T2 sweeps — p50 is the honest figure, contention is a declared qualification).
2. **Commits are required, and blob commits are forbidden** (owner instruction). Each lane
   commits its own scope after green checkpoints with `git add <paths>` (never `-A`), a plain
   owner-authored message, no agent footers; the Lead commits shared/central files. Indexes,
   copies, caches, artifact duplicates and previews are gitignored and never committed.
   Evidence that still requires a settled tree (m20 status, m31 verify-gate-selftest, full docs
   regeneration, dist rebuild) is deferred to the Lead's integration pass.
3. **Source door only** during Phase B: `npx tsx`/`bun` entry. `dist/` is stale (built
   2026-10-20, 70 src files behind) and is rebuilt centrally at integration; nobody edits dist/bin.
4. **Mid-campaign docs rule:** owners regenerate/verify their page with
   `npx tsx script/verify-tool-docs.ts --only <tool> [--write]`. Shared artifacts
   (`docs/data/public-tools.json`, `website/src/data/tools.generated.ts`) are Lead-regenerated
   once at integration; a red full `verify-tool-docs` mid-flight is expected.
5. **Gates must be able to fail.** A gate that passes on its own refusal text, exits 0 on
   failure, or asserts over a file path that no longer holds the code is a gate defect and is in
   scope for the lane that owns it.
6. **Read paths do not write the index.** A read that creates persistent schema in the shared
   index is a defect (bb_search D9, already disclosed and being fixed; the existing tables in
   `.bb-data` are fleet data and are not repaired by us).
7. **Regex is a last resort** (charter §7): AST over text, allowlist + edge-case tests for an
   unavoidable use, no new use without both. 112 current uses are frozen debt to be paid down by
   the owning lanes.

## C · Open cross-cutting items (not owned by one lane)

| Item | Where | Status |
|---|---|---|
| `docs/indexing/**` has 12 stale line citations after the split (incl. `tool-handlers.ts:880`) | docs/indexing | assign at integration (bb_index lane + Lead) |
| `m16 verify-docs-truth` red (BB_PATTERNS claim) | shared doc gate | Lead integration |
| `m31 tool-mode-corpus --check` drift (16 non-bb_doc invocations) | shared doc gate | Lead integration |
| `m56 docs-completeness` red (CLI help empty) | shared doc gate | Lead integration |
| `m31/verify-gate-selftest` mutates src/ with fleet active | script/m31 | Lead, integration clean-tree only |
| `m20` evidence `known-gap` while `DOC_EVIDENCE_PATHS` dirty | script/m20 | Lead integration (after no-commit ruling) |
| `m48 P4` red rows: `bb_visualize`, `bb_edit` | script/m48 | their lanes |
| Phantom tools `bb_test_quality`/`bb_test_suggestions` in docs + shared gates | docs/BB_TEST_QUALITY, gates | bb_analyze lane |
| `brain_index_status` reports 1/1 files while the DB holds thousands (anomaly) | `src/brain/brain-index-health.ts` (fleet is editing it) | verify at integration; do not patch under the fleet |
| `dist/` stale; compiled-door evidence deferred | dist | Lead, integration |
| Shared index has FTS schema/triggers created by a read path (search D9) | `.bb-data` project | disclosed; code fix in bb_search lane; no data repair |
| `src/intelligence/analysis/impact.ts` consumed by bb_analyze; `src/intelligence/graph/**` consumed by analyze/graph/impact | cross-lane | coordinate through Lead before contract changes |

## D · Team state

Eight owners, one per wave-1 tool: `tool-health`, `tool-search`, `tool-analyze`, `tool-edit`,
`tool-doc`, `tool-graph`, `tool-impact`, `tool-cross-language`. Phase A reports received:
cross-language, search, analyze, doc. Each report's decisions were sent by the Lead and the
owner continues in Phase B. Wave 2 (ask, patterns, security, visualize, migrate, index, annotate,
annotations) opens as wave-1 tools complete; slots refill to eight with a DIFFERENT tool.

## E · Integration checklist (Lead, when lanes land)

1. `npx tsc --noEmit` clean; run the repaired m28 T1/U1/V1 + m15 C2 + public-surface + mcp.
2. Rebuild `dist/`; run the compiled-door evidence each lane recorded as blocked.
3. Regenerate shared docs: full `verify-tool-docs --write`, then full `docs:verify`; fix shared
   doc gates listed in §C.
4. Run the campaign gate battery per tool (m13/m15/m20/m28/m40/m43/m48/m55/m64 as relevant) and
   record exit codes; any known-gap must name its reason.
5. Publish the final T2 baseline (counts + mtime) and the campaign latency table.
6. Re-run regex policy, confirm 112 debt decreased or allowlisted with tests.
7. Only then consider any commit/merge; the owner decides commit policy.

## F · Lead fixes and rulings — round 2

| Fix | Where | Effect |
|---|---|---|
| Byte-read-only DB open | `src/brain/database.ts` `BrainDatabase.getRawInstance(projectId, { readonly: true })`: driver read-only mode, no migrations/healers, separate `ro:` cache key, loud error on missing/uninitialised index | a read tool no longer moves the WAL (health D5; graph/impact T2 measurement protocol). Owners switch read paths to it; rw stays for refresh/force/index/mutation |
| Owner-range index | `src/brain/schema-ddl.ts`: `brain_symbol_project_owner_idx ON brain_symbol(project_id, owner_symbol_id)` in fresh DDL + the self-healing list | the owner-cascade seek no longer scans every symbol in the project (graph D-06 root cause; impact D1 830× JOIN); pre-existing DBs gain it at next rw open |
| `timeBudgetMs` contract comment | `src/intelligence/contracts.ts` | states the engine applies no clock unless asked; tool surfaces declare their own ceiling (bb_analyze passes 2,000) |
| m48 P4 gate | `script/m48/verify-p4-param-matrix.ts` `registrySurface()` imports the live registry instead of regex-scraping `tool-registry.ts` | the gate enumerates the real 16-tool surface; the committed matrix must be regenerated at integration (it is now honestly FAILING on missing rows) |
| bb_health docs text | `script/verify-tool-docs.ts` FRESHNESS_TOOLS | `why` → the wire's real `reasons` object (`byKind`, content/metadata fresh counts, isSample) |
| Schema fields for bounds | `src/mcp/tools/types.ts` | `minimum`/`maximum` (documentation-only) so owners can state real numeric ranges |

Rulings recorded this round: bb_impact may add optional `file` (matches the LSP twin); bb_impact D2/D3 are its lane's fixes, the shared graph-engine plan is the graph owner's, m48 P2 is impact's, m48 P4 was Lead's (done); graph aligns MCP default depth to 5 and refuses fractional bounds; graph keeps the 2,000 ms ceiling documented as between-statements; bb_health REQUIRED <2 s on the campaign T2 (`.bb-data`, 310k symbols) and reports the larger ~/.bb index (1.28M symbols) honestly without gating it; analysis `BB_ANALYSIS_HISTORY.md` belongs to the bb_analyze lane.


## G · Lane completions and wave 2

| Lane | State | Evidence |
|---|---|---|
| **bb_edit** | **PHASE B COMPLETE — first finished lane.** Commits `dc9a52c9d`, `d321cc23d`, `15543ef1b`. F1 critical (regex import pruner corrupting Haskell/Groovy/Python source while reporting validated) fixed by deleting the regex pruner: pruning is AST-only TS/JS, every other language byte-identical and DECLARED skipped. F2/F3/F4/F5/F6/F7/F12/F13/F14 fixed with red→green proofs; F8/F10/F11 docs/denominators/headers; E9 34/34, E13 61/61, m15 e2e-docs 11/11 (the two wire gates were the SDK env, not the engine). 20/20 edit gates + 7/7 probes green; `validation/tools/bb_edit/artifacts/final-sweep/`. | task-4 completed |
| Lead after edit | bb_edit's generated staleness sentence no longer quotes the read-tool `refresh=false` remediation; page regenerated; edit lane's canonical gate evidence checkpointed — commit `86d65c3c5`. `verify-edit.ts` PASS requires an explicit `BB_DATA_DIR` (the sandbox home is read-only; the earlier failure was environmental). | — |
| **tool-ask** | Spawned as the first WAVE-2 owner (bb_ask), refilling the slot freed by bb_edit; runs Phase A now. | task-9 |

Wave-2 order after ask: bb_patterns (task-10), bb_security (task-11), bb_visualize (task-12), bb_migrate (task-13), bb_index (task-14), bb_annotate (task-15), bb_annotations (task-16) — one slot per wave-1 completion, each a DIFFERENT tool (the permanent-owner rule).

## H · Commit hygiene and lane notes (round 3)

- **Foreign staged paths.** `git add validation/tools/bb_ask` committed 144 paths another writer had already staged (docs/**, archive/**, stray plan files) into `942347f62`. No reset/restore: we do not unstage another writer's work by force. Going forward every lane verifies `git diff --cached --name-only` before committing, and uses `git commit -- <own paths>` (or `git update-index --force-remove` for index-only unstaging) when the shared index is polluted.
- **bb_ask Phase A** (task-9, commit `942347f62`): 2 critical + 8 high + 5 medium + 3 low. C1 read path opens read-write and WRITES (one ask moved a 32,992-byte WAL; an unindexed project CREATED a db); C4 confidence number contradicts the answer's own "order is unreliable" disclosure; C6 coverage measured before the embed await. Phase B approved with rulings: readonly opens, limit=0 refused, ceiling 50 default/100 max with declared truncation, model-aware coverage, scan-cap disclosure, provider await capped to the tool budget. Lead fixed `src/brain/semantic/engine.ts` localVocabulary to open readonly (commit `4eb9b74ff`).
- **Wave 2:** tool-ask running (slot from bb_edit). Next: patterns, security, visualize, migrate, index, annotate, annotations as wave-1 lanes complete.

## I · Shared-index commit collisions (round 3b)

The shared checkout's git index is used by every writer. Two collisions observed and ruled on:

1. `942347f62` (bb_ask) carried 144 paths another writer had left staged. Leave such commits alone — never reset/restore another writer's staging.
2. `eeaa89dc9` ("DOCUMENTATION CONSOLIDATION…", another writer's commit) swept the working tree and therefore committed the Lead's unstaged `src/mcp/tool-validation.ts` bb_ask-limit change under its own message. Verified present at HEAD (1 occurrence). We do not rewrite history; the lesson is procedural: commit a Lead-owned edit immediately after writing it, and verify content at HEAD (`git show HEAD:<path>`) rather than trusting a commit subject. Same rule applies to lanes: broad adds sweep other lanes' uncommitted edits into foreign commits.

## J · Lane completions round 4

| Lane | State | Evidence |
|---|---|---|
| **bb_search** | **PHASE B COMPLETE** (task-2 completed, commit `a10274912`): D1 critical content search fixed (bodies reachable, matchMode/bodyCoverage, no read-path schema), D2 regex budget, D3 symbol-mode noise-path, D5 case folding, D9 no write-on-read, D12 paging on the Lead door change. Five gates flipped known-gap→VERIFIED (S1 47/47, S4 21/21, S3 28/28, S2 23/23, S5 24/24; m15 44/44 with a planted-failure control). T2 content 4755/8825 → 578/602 ms; symbols 1809/3573 → 318/356; read-immutability probe `dbUnchanged:true` across five modes (`validation/tools/bb_search/audit/t2-read-immutability.json`). | task-2 complete |
| **tool-patterns** | Spawned as wave-2 owner (bb_patterns, task-10), refilling the slot from bb_search. | task-10 |
| Lead after search | The last three shared read-write opens are now read-only (commit `4ec588f79`): `describeUnknownFilters` (shared.ts), a new `BrainDatabase.getReadOnlyInstance` used by `ASTEngine.findSymbol`, and the MCP server's start-up index check. This closes the read path end-to-end: no tool call moves the WAL just by being served. | — |

Wave-2 order now: ask (running), patterns (running); next security (task-11), visualize (task-12), migrate (task-13), index (task-14), annotate (task-15), annotations (task-16) as wave-1 lanes complete (analyze, health, doc, graph, impact, cross-language still in Phase B).

## K · Central-gate regression watch (round 4)

- Re-ran the three shared m28 gates after the graph lane's engine/door rewrite (`83fe26dba`): U1 30/30 + 6/6, V1 39/39 + 5/5, T1 24/24 + 2/2. T1 first came back KNOWN-GAP (23/24, 1/2 mutants) because the bb_impact handler no longer contains the old error-return text — the mutant anchor silently skipped. Re-anchored to the handler's current single-prefix branch (`15e967259`). Rule: a mutant whose anchor disappears must fail the gate, and the Lead re-anchors it to the responsible module — never delete the mutant.
- Wave-1 lanes still mid-Phase-B (health, analyze, doc, graph, impact, cross-language); wave-2 ask and patterns running; bb_edit + bb_search complete (tasks 4, 2). bb_graph has committed its door contract (depth 5 default, whole-number bounds, blank refused, tier/target basis published).

## L · Lanes complete — graph and cross-language (round 5)

| Lane | State | Numbers |
|---|---|---|
| **bb_graph** | **PHASE B COMPLETE** (task-6; `17cb85926`, `83fe26dba`, `c28cacee5`): engine rewrite + plan gate with pre-fix plans as built-in negative control + 5/5 mutant battery. | T2 leaf 131,230/168,335 ms → **16/19 ms**; mid/hub previously no-answer-in-10-min → 162/246 / 57/145 ms; db open 18,714→19.6 ms; cascade 976→0.83 ms (composite owner-range index picked first); caller arm 4,985→9 ms; unattributed 10,698→0.49 ms. Unknown-symbol containment fallback stays 5.3 s (declared, semantics unchanged). |
| **bb_cross_language** | **PHASE B COMPLETE** (task-8; `d8a0f8052`, `d83dc3a00`, `dc58f216d`, `6cecd6ec8`): absence law over the store pin, both-direction depth count, member-fact self/owner/pair shape, index-driven statements (row-set equality proved on 714 rows), named count fields, exact door validation, seeded-state mutant suite. | T2 handler worst p95 **1,609 ms at load 33** (pre-fix p50 3.3–6.5 s, one 33.6 s); gates CL1 403/403+16/16, wiring 31/31+16/16, W3 21/21+5/5, seeded 43/43+8/8. |

- **m28 on current HEAD** (`cf5f5bdab`): T1 now pins `factCount` and DISTINCT `pairCount` and is **26/26 + 2/2**; U1 30/30 + 6/6; V1 39/39 + 5/5 (Lead commit `15e967259` + the count pin).
- **T2 protocol wording**: a byte-read-only run leaves db and `-wal` untouched; only the `-shm` coordination file may move. `dbUnchanged:true` means content + non-empty WAL unchanged, not file-existence.
- **Process incident**: I briefly marked the wrong task complete (task-7 is bb_impact, not bb_graph) and reopened it in the same turn — task-7 back to pending for the impact lane.
- **Open for integration**: full docs generator (public-tools.json + site data + stale per-tool pages), `src/lsp/evidence_tier.ts` §8 header (Lead) and twin headers (graph lane authorized), m26 external arm BLOCKED (golden project absent), compiled-door dist rebuild.
- Wave-2: ask + patterns running; **tool-security spawned** (task-11) after cross-language's slot freed.

## M · More lanes complete — health, analyze; graph twins; integration queue (round 6)

| Lane | State | Headline |
|---|---|---|
| **bb_health** | **COMPLETE** (task-1; `6a584e8a2`, `2e8cf980e`): default call bounded (verbose-only aggregates), reads byte-read-only, options/refusals corrected, docs rewritten. | T2 default **p50 1,271 / p95 1,758 ms** (10 warm runs) vs 2,000 ms budget (before p50 4,575, first call 12,880 ms); 1.28M-symbol copy **p50 2,559 / p95 3,278 ms** vs 5,000 ms (before first call 76,713 ms); T0 53/58, T1 35/65 ms. |
| **bb_analyze** | **COMPLETE** (task-3; `ef3031280`): limit-bounded test_quality, bounded test_impact with summary, missing-file stale, exact-file scoping, complexity breakdown bounds, docs/descriptor corrected, four gate rewrites with red-mutant proofs, regex conversions + 61-check suite that found two real classifier defects. | An1 84/84+27 negatives, An2 18/18, An3 42/42, An4 17/17; regex policy 14 allowlisted / 73 frozen / 0 new. Open: T2 re-measure after graph rewrite; m48 P1 truncation red routed to graph/impact. |
| **bb_graph** | closed twins (`888d7bd80`): both LSP doors carry §8 headers, containment-fallback cost declared in descriptor/page, `-shm` wording recorded. | Asked to re-take T0/T1 post-rewrite for the campaign table. |
| Lead | **`2be07ae49`**: integrity battery (`runIndexHealthCheck`, `preFlightCheck`) and `getAnalysisHistory` are byte-read-only — `integrity:true`/`history:true` no longer migrate the DB on a read; history without schema returns the declared empty report. | closes the last known write-on-read legs. |
| Wave-2 | **tool-visualize spawned** (task-12). Running: ask, patterns, security, visualize. Wave-1 remaining: doc, impact. | 8-slot refill continues. |

Integration queue (unchanged): full docs generator (shared artifacts + stale pages incl. `verify-tool-page-claims` bb_doc claim routed), `src/lsp/evidence_tier.ts` §8 (Lead), campaign T2 baseline with quiet-load re-measures, dist rebuild, m26 external arm BLOCKED. Environment reds (not our 16-tool scope): `m65/refresh-resolution` analyzer census.

## N · m48 P1 resolved; bb_graph fully closed (round 7)

- **`m48/verify-p1-impact-unity` does not reproduce on current HEAD** (Lead-verified: exit 0, 68 passed / 0 failed / 6 negatives; "a row cap that hid no dependent is NOT a set truncation" green with `truncated=false`, engine bound still declared `engineTruncated=true`). Root cause was the shared engine's same-site collapse key identifying a site by the TRACED symbol — under the owner cascade two call-sites of two different dependents could collapse as one spelling variant, which is exactly a row cap hiding a dependent. Graph commit `c28cacee5` keys the collapse on the row's matchedId; impact's biconditional contract holds. Routed to bb_analyze and bb_impact to re-run and cite green.
- **bb_graph lane fully closed**: commits `17cb85926`, `83fe26dba`, `c28cacee5`, `951163dc1`, `888d7bd80`, `5fe40bd3a`, `48396fb6e`. Fresh post-rewrite T0/T1 recorded next to the older pass: T0 p50 24.2 / p95 57.5 ms (load 27), T1 p50 284.8 / p95 372.9 ms (331 edges, 353 KB, load 27). Residual reds are environmental/other-lane only (`verify-tool-page-claims` bb_doc claim; `m65/refresh-resolution` analyzer census).

## O · bb_impact complete; the T2 attribution correction (round 8)

- **bb_impact COMPLETE** (task-7; commit `365c423b7`): D2 truncation biconditional with engine bounds split into `traversal.engineTruncated`/`engineTruncationReason` and a three-state `countVerification.complete`; D3 empty `relationshipTypes` refused with failed-and-null counts (never a measured zero); approved optional `file` hint resolves ambiguous members and refuses unusable hints; read door byte-read-only; P2 builder discovery found and fixed a scanner defect that could never go red; P3 now asks the same declared-depth question. **Lead re-ran serially on current HEAD: P1 68/0/6, P2 21/0/7, P3 30/0/5 — all exit 0.** 12/12 planted mutants red-then-restored; docs/curation regenerated, §8 headers, §9 zero.
- **T2 ATTRIBUTION CORRECTION (recorded)**: the earlier impact T2 13.7–359.5 s and the "830× query form" pinpoint were measured through READ-WRITE opens on the pre-owner-range-index planner state. On the current byte-read-only path the same JOIN is **1.1–1.2 ms** and the walk **40–63 ms** (worst p95 327.7 ms, `dbUnchanged:true`). The historical numbers stay only as evidence justifying the owner-range index; the graph-owner defect attribution is withdrawn. This is exactly why the campaign required read-only measurement protocols.
- Wave-1 now has only **bb_doc** outstanding. Wave-2 running: ask, patterns, security, visualize, **migrate** (spawned, task-13). Integration queue unchanged: full docs generator, `evidence_tier.ts` §8, quiet-load campaign T2 baseline, dist rebuild, m26 external arm BLOCKED, P4 matrix/D1 artifacts at integration.

## P · bb_analyze final closure — all T2 inside budget (round 9)

- **bb_analyze FINAL** (task-3 already completed; commits `ef3031280` + `622281532`): P1 re-confirmed on HEAD (`68/0/6`, "row cap that hid no dependent is not a truncation" green with engine bound declared); full m13 suite green — An1 84/84+27, An2 18/18, An3 42/42 (11 modes over real MCP + CLI source doors + corpus), An4 17/17 (4 negatives), verify-analyze/test-intel/test-quality PASS, regex 14 allowlisted / 73 frozen / 0 new, edge suite 61/61.
- **D-20 found and fixed in the final re-measure**: `dependencies` materialised a project-wide symbols→file Map (310,423 rows) that nothing read. Removed → T2 p50 **5,120/6,016 → 635/708 ms** (limit:5 → 1,152/1,200).
- **T2 all inside 5 s now** (load 23–30 throughout, identical-load pre/post): callers 8.6/9.4 ms, callers-hub 44.3/51.5, callers-leaf 555.6/903.7, callees 52.6/81.9, trace 51.8/66.6, impact 28.4/31.8, stats 2,283/3,092, complexity 1,312/2,799, test_mapping 1,661/2,334, test_gaps 1,003/1,079, test_impact 2,692/3,802, test_quality 312/412. Quiet-machine baseline remains the Lead's integration call.
- Blocked legs unchanged: m48 c1-corpus (corpus indexing, exit 124 @400 s) and m48 P4 verifiedBy pointers (Lead-owned matrix population at integration; 27 bb_analyze rows still null).

## Q · Session resume: bb_ask complete, systemic trigger churn fixed, CLI door gated (round 10)

- **bb_ask COMPLETE** (task-9, commit `5874347f5`): 10 gates verified (bun + node, 75 observed negatives), 13/13 mutants observed red then restored byte-identically, honesty gate NEW and now wired centrally (`script/verify-quality-gate.ts` + `npm run verify`, commit `9fd61b517`), m35 envelope label cleared, real-corpus `allDbUnchanged:true` across rake/graphql-js/rebar3 through the real MCP stdio door. **Open release item routed back to the lane**: T2 local-only route p95 8.0 s vs the 5 s default budget — must be bounded/fixed before that lane is fully closed.
- **SYSTEMIC trigger churn fixed (Lead, `93bb7f826`)**: `ensureAnnotationTable` compared a TWO-trigger constant sliced at its first BEFORE against only the INSERT trigger from sqlite_master, so `guardIsStale` was permanently true and every read-write open dropped/recreated both triggers — schema_version and WAL churn on every open (the second half of visualize's C1, and a hidden cost for every write tool). Per-trigger comparison now; proven by three consecutive rw opens byte-identical (trigger hash, sqlite_master count, db size, WAL), annotation-store gate VERIFIED 22/22 + 4/4 mutants.
- **CLI door gated**: `bb tool` now refuses an unindexed project with the same named message as the MCP door (readonly probe; index-free modes exempt per descriptor), so a CLI caller cannot get a clean zero or a created database.
- **m64/m65 selftests runtime-agnostic**: their TS subjects now spawn through the running runtime (bun native, node via tsx); m64 selftest PASS 8/8 under node with an isolated BB_DATA_DIR (m65's remaining data-dependent check is the lane's fixture, declared).
- **Import repair**: bb_visualize handler now imports freshness helpers from `brain/freshness` (shared tool module does not re-export them); tsc green.
- **Slots 8/8 with real-corpus mandate**: active lanes are doc, patterns, security, visualize, migrate, index, annotate, annotations; every lane must index real corpora from `<corpus-root>`, exercise its tool through the real MCP stdio door, and commit `validation/tools/<tool>/REAL-CORPUS.json` (commands, population, results, latency, dbUnchanged) before closing. 8 of 16 tools complete.

## R · Round 11 — bb_doc complete, free-model adversarial review works, health blocker found

- **bb_doc COMPLETE** (task-5; `f3744dbda`, `17774fd6e`): T2 all modes inside 5 s (project 7033→756 ms p50, feature 18982→1967; DBM/open/citation costs fixed by indexed query plans), cold-open declared (2 ms readonly open; 3.9 s cold-cache first default call, 1.4 s warm), real-corpus leg on FIVE real repos through the real MCP stdio door (35/35 modes, 932/932 citations resolved, 30/30 refusals named, 49–887 ms), gate suite red→green incl. a new falsifiable m20 truth lane (128/128 + 29 negatives). Shared artifacts + m20 settled-tree stamp remain Lead integration steps.
- **Free-model adversarial review is now working** (Nemotron 3.5 Super VL via the installed catalog, medium thinking — high thinking is what failed): its first review of three completed lanes returned PASS_WITH_FINDINGS and named a real inconsistency in bb_health's PHASE-B claims vs its own gate logs. I re-ran those gates myself: integrity/refresh/docs are green now, but **m13-mutability is RED (H1 KNOWN-GAP 10/11): a plain health call still mutates the index** — routed to the health lane as a release blocker together with the mismatched PHASE-B claims. A second free review (doc/edit/ask) is running.
  Rule adopted: a free-model finding is a LEAD, never a verdict — the Lead reproduces it before it changes the record.
- **NVIDIA direct-provider setup**: the owner withdrew it; the installed `llm-pi-ai` config remains `openrouter`+free-model routes. Not pursued further.

## S · Round 12 — free models retired; the trigger churn is finally closed (verified)

- **Model policy (owner instruction):** free-model routes are retired for all work. Every lane runs on DeepSeek (deepseek-official / deepseek-flash); the free Nemotron route was useful only as a read-only adversarial reviewer (its findings are leads the Lead reproduces) and is no longer used for code. A failed free-model edit attempt (“R[id] vs a[id]”) was detected before landing; no file was changed.
- **Trigger churn: FIXED AND VERIFIED** (`31adab4ad`). The second half of the bug was that SQLite stores a trigger's SQL WITHOUT the trailing semicolon while the compiled constant carries it, so the comparison could never match and every fresh read-write open dropped/recreated both guards (schema_version bumped per process). `normalise()` strips trailing semicolons on both sides (plain string ops). Proof: four consecutive fresh-process rw opens of a fixture DB hold **schema_version 1333 and 2 triggers**; annotation-store gate VERIFIED 22/22 + 4/4 mutants; regex policy PASS. Found by the bb_visualize lane — the earlier probe hashed trigger SQL but not schema_version, so it missed it; the lesson (hash the observable the reader would see, not a proxy) is recorded.
- Fleet (all DeepSeek): health is fixing the remaining write-on-read (m13-mutability RED: plain health call mutates the index); patterns, security, visualize, migrate, index, annotate, annotations in progress; 8 lanes busy, 8 tools complete.

## T · Round 13 — health closure verified, central battery green, migrate + index Phase A in

- **HEALTH BLOCKER CLOSED AND VERIFIED** (`755157b7f`). The failure was the GATE's measurement, not a write path: HEAD's fingerprint folded every file in the DB dir (including SQLite's `-shm` sidecar) and took the "before" reading while background embedding writes could still drain. Fixed gate: flush background embeddings before the reading, fingerprint = sha256 of `brain.db` + `brain.db-wal` bytes + symbol count through the read-only handle, `-shm` reported separately as the only file a reader may move. My independent re-run: **m13-mutability exit 0, H1 VERIFIED 12/12 (2 negatives), changed=false**. Five fresh-process byte-read-only probes show db+WAL unchanged (all five: no DB-dir file moved at all). PHASE-B.md now carries an "Evidence supersession" section (first sweep marked SUPERSEDED; `final-sweep.tsv`+`final2-*.log` AUTHORITATIVE) and a write-on-read closure section. The only remaining writable opens are the genuinely-writing history ops (`failAnalysisRun`/`setFindingState`); integrity/history READ paths are byte-read-only.
- **Central regression battery green after the lane commits**: tsc 0; m28 T1 VERIFIED 26/26+2/2; U1 30/30+6/6; V1 39/39+5/5; m15 C2 exit 0; verify-mcp ALL PASS.
- **bb_migrate Phase A** (`f401a5275`): C1 CRITICAL read path writes the index (public MCP door created 98 KB WAL and changed db sha256; direct handler on unindexed project CREATES the DB), H1 batch-by-name unbounded on T2 (12 names → 844 symbols/46,753 relationships; p50 9.5 s / p95 29 s vs 5 s; cap is over entries not resolved symbols), H2 same component planned twice while claiming dedup, H3 symbolName silently dropped, H4 docs claim no-route refusal that the code does not do. Real-corpus through the real MCP stdio door: 82/82 checks on elixir/rebar3/clojure/graphql-js, including the elixir↔erlang pair (714 cross-language facts); single-plan door p50/p95 41/90–123/248 ms. Phase B authorized: readonly first, bounded batch, identity, gate repairs, mutants.
- **bb_index Phase A**: D1 unchanged file reparsed in file mode, **D2 dir mode silently deletes index entries for files that exist on disk** (vendor skip asymmetry — a lying index), D3 post path containment breach, D4 stale gate sentinel, D5/D6/D7/D8. Phase B instructed: existence-guarded deletes, walk/discovery parity, honest no-op reasons, containment refusal, WAL checkpoint, mutants for deletion guard/path/lock.

## U · Round 14 — annotation surface closed, m31 selftest triaged

- **bb_annotate Phase A** (`validation/tools/bb_annotate/AUDIT.json`): store identity/provenance already hardened; HIGH defect PA-1 = surfacing claims the editor renders a joint symbol+file annotation when only the halves match (reproduced through the real MCP door: hover and graph badge show nothing). Also PA-2 (A1 gate never exercises the real MCP door), PA-3 (string checks instead of planted defects), PA-4 docs truth. Latency fine (T2 cold 1,833 ms, warm p50 3.81/p95 5.82 ms; T0/T1 inside budgets); real door: 14 writes, 14 refusals, hostile-body and re-annotate behaviour verified; REAL-CORPUS legs on graphql-js/rake/T2 snapshot. Phase B authorized with PA-1 first.
- **Lead-owned annotation surface repaired** (`27c7cb973`): closure provenance anchor now reads the split bb_annotate/bb_annotations modules (it read the empty aggregator, so the completion bar could never see provenance enforcement); the generated surface no longer prints "verified verified"; `src/lsp/hover.ts` + `src/lsp/annotation_ui.ts` now carry canonical §8 headers and zero milestone/issue narration (0 remaining), technical statements preserved.
- **m31 gate self-test triaged** (Lead-owned run): 47/69 with reds split by owner — stale generator artifacts (Lead integration), `BB_EDIT.md`/`BB_HEALTH.md` invalid JSON fences (routed to their owners), and two m20 doc mutants not detected (`doc-truth-signature`, `doc-modes-contract` — routed to the bb_doc owner because the rewritten gates no longer exercise the mutated branch). A2 in-editor leg (nvim absent) and V1 surface status remain declared gaps.
- Note: `src/ast/index-space.ts` currently carries 6 foreign typecheck errors from another writer's in-flight edit; not campaign scope, not committed by us.

## V · Round 15 — m31 self-test genuinely green, generator refreshed, docs fences closed

- **m31 gate self-test PASS 69/69 on the current tree** (`86e05729e`). Two "blind gate" reports were SELF-TEST defects, not gate defects: (a) the bb-docs-truth mutation replaced a heading the edit lane had rewritten, so no corruption landed; it now appends the false read-only claim unconditionally; (b) the mode-corpus check wrote a shared `.fresh` file, so concurrent runs diffed against a file another run was writing — the target is now process-unique and removed on both outcomes. The bb_doc owner re-anchored the two m20 doc mutants to the split modules and strengthened T30 (empty brackets beside the "no parameter list" caveat are now convicted), commits `60fa91be9` + `e49079e4e`; full sweep passed in my run with that evidence.
  Remaining intermittency is understood: `tool-mode-corpus` compares the committed baseline against LIVE registrations, so any lane editing a descriptor mid-sweep drifts it. The final settled-tree integration run re-stamps `gate-selftest.json`; the corpus baseline was regenerated (26 invocations legitimately changed shape after the split).
- **Full docs generator run committed** (`b266a88b0`): 18 canonical artifacts (`docs/data/public-tools.json`, `website/src/data/tools.generated.ts`, five changed tool pages), then `verify-tool-docs` PASS (16 tools, 18 artifacts) and `verify-tool-page-claims` PASS (34 passed, 0 failed, 15 negatives).
- **Docs fences closed**: `BB_HEALTH.md` (health lane, `4b44132e5`/`9cda86950`: fence is one valid JSON array + a real measured report, validated against the live schema) and `BB_EDIT.md` (edit lane, `f1c6bc4dc`: complete measured JSON object). `verify-bb-docs-truth` now PASS 50/50 with no executed claim failing.
- Fleet: 9 tools complete; patterns, security, visualize, migrate, index, annotate, annotations running on DeepSeek.

## W · Round 16 — migrate page truth + deep gate already green

- **bb_migrate's generated page now states the manual-repair truth** (Lead branch in `script/verify-tool-docs.ts`, registered in CUSTOM_STALENESS_TOOLS): it no longer claims the read tool auto-refreshes with a `refresh=false` option; it describes the per-plan `sourceFile`/`stale` flags + `freshness` envelope, names the manual repairs (`bb index --changed` project scope, `bb index "<file>"` file scope), and records the mtime+size/content-hash detection trade-off. Page regenerated with `--only bb_migrate --write`; verify PASS.
- **The routed m15-deep crash is already fixed**: `script/m15/verify-visualize-migrate-deep.ts` no longer reads the monolith; it resolves descriptors from the live registry and handlers from their per-tool modules, and runs **exit 0 — V2/V3/V4/M1/M2/M3/M4 all VERIFIED** on the current tree. (Display quirk noted: some sections print "passed/checks" as e.g. 10/9 because a negative check is counted in `passed` but not in `checks`; cosmetic, not a claim error.)
- bb_migrate lane's Phase B so far: C1 readonly GREEN (db sha256 unchanged; one read; direct handler on unindexed project throws and creates no DB), H1 bounded naming (≤100 entries resolved to ids BEFORE the relationship pass), H2/H3/M2/M3 GREEN through the real door (name+id → 1 plan, truncation 2/2/1, union of symbolName+symbolNames, blank inputs refused), L5 regex 22→0 in its files, M5 dictionary gate repaired with a completeness negative control (declared class = measured 4/486 = 0.8%), §8 headers + §9 cleanup, tsc clean.

## X · Round 17 — patterns T2 root cause: metadata reads; schema fix landed

- **bb_patterns T2 profile was measured, not guessed**: 103.8 s total, of which 43.1 s + 18.9 s + 17.0 s are relationship scans. The 43 s statement reads `json_extract(metadata,'$.evidenceClass')` per one of 820k rows, so the planner cannot use any index for the gate and must read the wide `metadata` TEXT from the 3.6 GB heap per row.
- **Schema fix (Lead)**: `brain_relationship.evidence_class` as a VIRTUAL GENERATED column (same pattern as `target_basis`, no 820k-row backfill) + `brain_rel_pattern_cover_idx(project_id, relationship_type, target_symbol_id, source_symbol_id, confidence, evidence_class)`; both wired as additive, idempotent migrations on the open path and in the fresh DDL. Verified on a copy: column + index created, and EXPLAIN shows `SEARCH r USING INDEX brain_rel_pattern_cover_idx (project_id=? AND relationship_type=?)` — no table heap.
- **Engine rewrite handed back to the permanent owner**: patterns.ts/orphans.ts must read `r.evidence_class` instead of re-extracting the JSON per row, then re-measure T2 (the index cannot help a SELECT-only expression the query never names). That is the only remaining T2 item.
- **m65 R8 repaired (Lead gate)**: the gate patched its own read-write handle while the engine now opens its own read-only one, so it captured 0 statements and failed. It now instruments the accessor the engine uses plus the cached read-only handle; m65 exits 0 with R8/R8b/R8c ok.
- **bb_index COMPLETE** (task-14, `163fb6614`, `55a073095`, `b4f3e96c3`): D2 spot-checked by the Lead — pre-fix dir mode reported `deleted:2` and purged two vendor files that existed on disk (files 3→1, symbols 3→1); post-fix the same script reports `deleted:0`, files 3, index equals disk, and the mutant `BB_M40_MUTATE_A3_WALK_DELETE=1` turns the gate red. Also D1 honest no-op (11.8 s → 16–23 ms), D3 post containment, D5/D6/D7/D8 fixed, D9 eligibility-gated walk. Residual: m40 A9's two cross-scope checks and the long m40/m43 lifecycle sweep are declared blocked, not green.

## Y · Round 18 — migrate complete; corpus drift cleared; 12/16

- **bb_migrate COMPLETE** (task-13; `f401a5275`, `56a80c5e5`, `72bf152b6`): C1 read path is byte-read-only (public-door sha256 unchanged; unindexed reads refuse loudly and create nothing); bounded batch T2 12-name p95 **29,041 → 833 ms**, first call **9,794 → 2,026 ms**; one plan per component with honest truncation identities; legacy `symbolName` unions instead of dropping; 22 source-text regexes → explicit string/token helpers with boundary tests; dictionary gate's vacuous rule replaced by a measured declared class (4/486 = 0.8%) with a completeness control; accuracy gate turned from a 9/9 text scan into a **behavioural 49/49 with 9 negatives**; **6/6 planted mutants killed** with byte-for-byte restores; **82/82 real-corpus checks + 6 negative controls** through the real MCP stdio door on elixir/rebar3/clojure/graphql-js (714 cross-language edges in the elixir pair). Two declared blocked legs stay declared (pre-split reference index for the directory-cohort shape; m48 C1 covered by C2 + REAL-CORPUS).
- **Mode-corpus baseline regenerated**: the fleet drift named by migrate (sole drifting invocation `bb_ask.answer`) is cleared; `tool-mode-corpus --check` PASSES against the committed baseline, which is now committed.
- **Attribution routed, not absorbed**: `verify-visualize-migrate`'s `visualization provenance uses canonical engine` red is the bb_visualize owner's (its migration-side checks all pass); this was sent to that lane with the H4 truth rule.
- 12 of 16 tools complete. Remaining: patterns (T2 rewrite on the new covering index), security, visualize, annotations; annotate is fixing A1 evidence determinism for the last m28 closure bar.

## Z · Round 19 — 14/16; a gate-blindness bug found and fixed; patterns index coverage extended

- **A source-scan gate was blind and nobody knew**: `script/m28/verify-surface-parity.ts`'s `codeOnly()` stripped BLOCK comments before LINE comments. The campaign header convention writes `validation/tools/<tool>/ **` on a `//` line; with block-first stripping that `/*` opened a comment swallowing every following line up to the next `*/` — ACROSS file boundaries — so the gate could not see the `lsp/evidence_tier` import it asserts about and reported a false regression. Fixed by stripping line comments first (39/39 + 5/5 again); the `shared.ts` header was also reworded so the trap is not recreated. Lesson: a source-grep gate is only as good as its stripper.
- **Patterns T2 coverage extended** (lane measured floor 9.3 s with the first index): `brain_rel_pattern_cover_idx` now also carries `target_external` (the 4.58 s DISTINCT-external scan becomes a covering-index scan) and `brain_symbol_type_cover_idx(project_id, symbol_type)` narrows the 52,903-row reported-type scan. The migration replaces the narrower index by column inspection (not by name), so an existing database converges instead of keeping a stale narrower index. Plans verified: `SEARCH r USING COVERING INDEX` for externals, `SEARCH s USING INDEX brain_symbol_type_cover_idx` for symbols. Engine rewrite by the lane took T2 85.2 s → 9.34 s p50 before this extension; the lane re-measures now against the extended schema.
- **bb_visualize COMPLETE** (task-12, `99e4f21e4`, `03acfe5cb`, `2d075c099`, `7b72cb8ed`): T2 default 1,396/6,674 → **372/496 ms p50/p95**, cold call 14,556 → 723 ms (root cause: one statement binding two 400-param IN lists, 9,825 ms → 91 ms in chunks); read path byte-read-only across all six layers; HTML carries its declared bounds; provenance now states the independent SQL projection (the routed H4 truth); REAL-CORPUS 9/9 across 5 real repos via the real MCP stdio door, 15 self-contained HTML artifacts with zero external URLs; 5/5 mutants; compiled door 7/7. Blocked/Lead: m48 P4 matrix `verifiedBy` population, optional renderer patch, shared generated docs, zig whole-repo index declared.
- **bb_annotations COMPLETE** (task-16, `ba597a3be`, `f9cf61b54`): read path no longer creates a DB or recreates a dropped table; qualified-name set matches what the hover shows (doorAgreesWithHover true; real corpora read back both rows); T2 cold **17,644.6 → 7.158 ms**, warm p50 0.447; adaptive truncation, declared bounds, §9 zero; falsifiable read-door gate 40/40 + 5/5 mutants with planted-defect red runs. Routed: generator staleness wording for a stored-annotation read, "Modes: annotate" line, visualization badge name-only matching, and the two shared reds.
- **m28 milestone CLOSED**: closure `X1: VERIFIED (31/31, 4 negatives)` after the annotation A1 evidence determinism fix (`e7a43f472`).

## AA · Round 20 — campaign T2 baseline (Lead-measured) and the two budgets it caught

- **Baseline exists** (`validation/release/T2-BASELINE.json`, runner `validation/release/run-t2-baseline.ts`): all 13 read tools run in-process against the shared 3.6 GB reference index (project 1d3d57…, 3,885,883,392 B at run time), one warm-up + 3 measured runs, `BB_NO_AUTO_REFRESH=1`.
- **Read-only proof is attributable, not global**: the first run's whole-index comparison moved +246 MB — an EXTERNAL writer on a shared machine. The runner now stats the DB before/after EACH tool; the re-run records **toolWriters=none** for all 13 (health 636/647 ms, search 264/266, ask 1660/1684, analyze 2707/2729, patterns 3504/3506, visualize 264/264, migrate 985/989, doc 296/297, graph 3488/3492, cross-language 4/4, annotations 0/0). So no read tool writes; the whole-run delta is declared as a concurrent writer.
- **Two defaults exceed the 5 s budget on this index** and are routed back to their owners with the numbers, not papered over: **bb_security** default live scan 5,515/5,546 ms; **bb_impact** on the hub symbol `getRawInstance` 6,337/6,539 ms. Both lanes had reported lower numbers (in-process/other shapes), which is exactly why the common harness exists.
- **bb_patterns now measures inside budget**: 3,504/3,506 ms p50/p95 (was 85.2 s before the schema + engine work) — the extended covering index did its job.
- bb_health default **636 ms** on the 3.6 GB index, comfortably inside the 2 s charter target.

## AB · Round 21 — 16/16 lanes closed; the release battery is green

- **bb_patterns CLOSED** (task-10, `7b4ca16af`): extended-schema 5-run confirmation p50 **4,535–4,583 ms**, inside the 5,000 ms budget, with shared-host p95 5.4–5.9 s reported as marginal rather than rounded green; rule findings are now plan-independent (deterministic tie-breaks, fingerprints byte-identical with the indexes present and absent); 16 gates green, mutant selftest 6/6. `ANALYZE` was measured to make the covering-index plans ~3× worse, so its stats were removed and the copy runs are cited only as plan evidence — that is the kind of measured trade-off the campaign wants recorded.
- **RELEASE BATTERY GREEN** (`validation/release/run-release-battery.ts` → `RELEASE-BATTERY.json`): the compiled door (`node bin/bb mcp`) serves **all 16 registered tools** on the real multi-language workspace (graphql-js/rake/rebar3; 622 indexed files / 13,386 symbols): every tool answered, all four refusal assertions returned error envelopes (search limit 2001, ask limit 0, migrate unknown option, doc limit 101), and the read phase left the DB bytes and mtime untouched (`readPhaseUntouched: true`). Latencies 2–2,846 ms on this corpus; write tools exercised safely (annotation stored through the door, index no-op on the settled tree, edit dryRun planned and wrote nothing).
- **Open**: the two T2 default latency breaches (bb_security default live scan; bb_impact hub symbol) are re-opened with exact numbers; their fixes are the last code changes before the final docs refresh and gate sweep.

## AC · Round 22 — settled-tree verification: the last two gate defects and the release numbers

- **Global T2 baseline is green** (`validation/release/T2-BASELINE.json`): all 13 read tools inside budget on the 3.6 GB reference index with no tool writing it — health 562/564 ms (2 s target), search 278, ask 1,703, analyze 2,869, patterns 3,549/3,594, security 409/465, visualize 227, migrate 1,000, doc 293, graph 3,729, impact 2,423/2,451, cross-language 4, annotations 0. The two re-opened defaults are closed by their owners with measured root causes: security's `project_id`-in-predicate query planned a whole-project covering scan (5,515→560 ms) and impact's OR'd range predicates abandoned the target index (6,539→2,450 ms with published walk/call deadlines).
- **Release battery green through the compiled door** (`RELEASE-BATTERY.json`): 16/16 tools registered and answered on the real multi-language workspace, 4/4 refusals are error envelopes, read phase leaves bytes untouched; write tools exercised without collateral damage.
- **V1 defect found and fixed**: the surface-parity gate hung because its synthetic tier corpus (2,184 direct-insert rows) hits a tiny-database quadratic join plan — a fixture-size property, not a tool property. The gate now samples kinds (declared vocabulary + odd spellings), keeps **all classes** and the **STRUCTURAL_FLOOR bracket plus endpoints** (1,248 shapes), and restores the exhaustive matrix with `BB_U2_FULL_SHAPE_MATRIX=1`; documented. V1: 39/39 + 5/5 mutants.
- **D1 defect found and fixed**: the custom-staleness check required bb_edit's "No freshness flags are returned" wording from every custom tool, but bb_patterns/bb_security/bb_migrate have registered freshness surfaces and publish surface-specific sentences — the gate was checking text the generator no longer produced (exactly the drift its own header warns about). It now requires surface-describing wording when a surface is registered and the no-flags wording only when it is not. D1: 139/0/4.
- m28 closure **31/31 verified**; T1/U1/m15-C2/verify-mcp/page-claims/regex/docs/tsc all green.

## AD · Round 23 — the two objective-level audits and the release statement

- **§8 author header: 83/83 campaign files carry `Muhammad Ishaq Khan`** (16 handler+descriptor pairs, shared plumbing, curation, `docs/tools/*.md`, `docs/BB_*.md`) — the central audit that the objective asks for, not a lane claim.
- **§9 process narration: 0 hits** over the same 81-file set after cleaning the last sixteen: milestone/issue IDs were removed from shared plumbing comments, two product source labels that carried a milestone suffix were reduced to their technical form (`impact@lsp-canonical (computeImpact)`), and the bb_patterns performance prose no longer credits "the Lead's campaign baseline" (it is the common campaign baseline, committed evidence). The patterns page was regenerated and verified; the cleaned files were re-gated: T1 26/26, V1 39/39, impact P1 80/0/6, P2 21/0/7, all four analyze gates, verify-mcp, regex policy, closure 31/31, tsc clean.
- **Release statement written**: `validation/release/RELEASE-STATUS.md` — the one page that lists the sixteen tools with their final lane commits, the falsifiability evidence (self-test 69/69 plus per-lane mutant batteries), the real-door release battery, the complete T2 baseline (all read tools in budget, no tool writes), the docs/author/comment/regex audits, reproduction commands, and the declared limitations. That is the artifact the release is cut from.
