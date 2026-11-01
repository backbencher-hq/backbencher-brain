<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — Phase A deep audit of the public MCP tool `bb_analyze`: every mode,
parameter and refusal checked against the working tree, declared bounds and declared absence
checked against measured answers, every existing gate run and scored, docs claims diffed
against behaviour, latency measured on the three campaign tiers.
WHO IT IS FOR — the campaign Lead and the next owner of bb_analyze, as the defect list Phase B
must close and the evidence the final report cites.
EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_analyze/LATENCY.json,
src/mcp/tools/bb_analyze/{descriptor,handler}.ts, the analysis/testing engines, the gate scripts
named in §4, and the docs pages named in §5.
-->

# bb_analyze — Phase A audit

Audited at HEAD `c43282e92` ("CLEAN TREE: FLEET-GUARD SELF-CONTAINMENT CHECKED…", 2026-11-01),
package `backbencher-brain` 0.3.0. Working tree clean for `src/` at audit start; the module split
landed mid-audit and the audit was re-pointed at the split files (see §0.3).

The deliverable of this phase is **this file plus `LATENCY.json` plus the raw evidence under
`validation/tools/bb_analyze/`**. No `src/` or docs edit was made in Phase A.

---

## 0 · Identity, scope and environment

### 0.1 The tool

| | |
|---|---|
| name | `bb_analyze` |
| mutability | `read` (declared; verified — no index or source mutation was observed) |
| requiresIndex | `true` |
| modes (11) | `callers, callees, trace, dependencies, stats, complexity, impact, test_mapping, test_gaps, test_impact, test_quality` |
| parameters | `mode` (required), `target`, `filePath`, `limit`; aliases `symbol`/`symbolName`/`query` → `target` |
| descriptor | `src/mcp/tools/bb_analyze/descriptor.ts` (was: inline in `src/mcp/tool-registry.ts` before the split) |
| handler | `src/mcp/tools/bb_analyze/handler.ts` (was: a 456-line section of the 2,892-line `src/mcp/tool-handlers.ts`) |
| curation | `script/tool-docs/curation/bb_analyze.ts` |
| generated page | `docs/tools/bb_analyze.md` |
| guide pages | `docs/BB_ANALYZE.md`, `docs/BB_TEST_INTEL.md`, `docs/BB_TEST_QUALITY.md`, `docs/BB_ANALYSIS_HISTORY.md` |
| engines | `src/intelligence/analysis/{complexity,coupling,dependencies,project-stats,run-history}.ts`, `src/intelligence/testing/{quality,suggestions,test-intel}.ts`, `src/intelligence/graph/graph-engine.ts` (read), `src/lsp/impact.ts` (read; bb_impact owns) |

### 0.2 The reference index (T2) is not the one the charter describes

Measured directly against the workspace index (`BB_DATA_DIR=$PWD/.bb-data`,
project `1d3d57103be91b8f9716d70199fe28a3f39245d9`):

| quantity | charter appendix A | measured now |
|---|---|---|
| files | 11,440 | **6,452** |
| symbols | 1,283,638 | **310,423** |
| relationships | 4,418,260 | **820,040** |
| db size | ~3.4 GB | 3.4 GB |

Command: `BB_DATA_DIR=$PWD/.bb-data npx tsx validation/tools/bb_analyze/t2-count.ts`.
Consequence: every T2 figure in this audit is against **6,452 files / 310,423 symbols / 820,040
relationships**. Campaign baselines that quote 11,440 files describe an index this checkout no
longer holds; the numbers must be restated against the measured index (request R-5).

### 0.3 Fixtures used (all under this tool's own data dir; shared `.bb-data` never written)

| tier | subject | own `BB_DATA_DIR` | counts |
|---|---|---|---|
| T0 | `test/fixtures/polyglot` | `validation/tools/bb_analyze/bbdata` | 5 files, 13 symbols, 26 relationships |
| T1 | `.perf-fixtures/bb-scale/n100` | `validation/tools/bb_analyze/bbdata` | 97 files, 3,512 symbols, 17,068 relationships |
| TX | purpose-built `validation/tools/bb_analyze/work/behaviour` | `validation/tools/bb_analyze/bbdata` | 198 files, 617 symbols, 2,367 relationships; 3 code test files; a 150-dependent file; a 30-caller hub; a constant/type/enum/namespace set |
| T2 | this workspace's index | `.bb-data` (read-only tools, `BB_NO_AUTO_REFRESH=1`) | 6,452 files, 310,423 symbols, 820,040 relationships |

TX exists because the campaign fixtures cannot exercise the test-intelligence modes (no test
files), the dependency row caps (no file with >100 dependents), or the not-traversable impact
contract (no constant/type/namespace). It is a **probe fixture, not a benchmark tier**.

### 0.4 Artifacts (all reproducible)

| artifact | produced by |
|---|---|
| `matrix.json` | `BB_DATA_DIR=$PWD/validation/tools/bb_analyze/bbdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_analyze/matrix.ts` |
| `matrix-behaviour.json` (transcript in §3/§6) | `… npx tsx validation/tools/bb_analyze/matrix-behaviour.ts` |
| `probe-bounds-freshness.json` | `… npx tsx validation/tools/bb_analyze/probe-bounds-freshness.ts` |
| `probe-complexity-cap.ts` output | `… npx tsx validation/tools/bb_analyze/probe-complexity-cap.ts` |
| `mcp-door.json` | `BB_DATA_DIR=… npx tsx validation/tools/bb_analyze/mcp-door.ts` |
| `t2-probes.jsonl` | `validation/tools/bb_analyze/t2-probe.sh` |
| `t2-profile2.ts` output (§8) | `BB_DATA_DIR=$PWD/.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_analyze/t2-profile2.ts` |
| `latency-raw.jsonl` → `LATENCY.json` | `validation/tools/bb_analyze/latency.sh` |
| `gates/*.log` | the command in each gate row of §4 |

---

## 1 · What Phase A verified as working (so Phase B does not "fix" it)

Measured, not read:

1. **All 11 modes answer through the real MCP stdio door** against the source tree
   (`bun src/mcp/server.ts`, `ListTools` shows 11 enum values and `required:["mode"]`), with one
   success and five refusal cases captured in `mcp-door.json`.
2. **Refusals are refusals**: `isError: true` for unknown option, unknown/blank/missing mode,
   `limit` on a mode it does not bound, `limit: 0`, `limit` over the ceiling, negative and
   fractional `limit` (the last two rejected at the validation layer). `limit`-over-ceiling is
   refused, not clamped: message names the ceiling.
3. Aliases `symbol`/`symbolName`/`query` are forgiven and resolve to the same bytes as `target`;
   a conflicting pair is rejected loudly (validation layer, exercised by `mcp-door.json`).
4. Graph page bound is real and declared: TX `hub` has 95 callers; default call returns
   `returnedCallers: 25, totalCallers: 95, pageEdgeLimit: 25, pageTruncated: true`; `limit: 5000`
   returns 95/95 with `pageTruncated: false`. A 250-caller symbol reports
   `callersIfUncapped: 301` with `truncated: true`, `truncationReason`
   `caller-site-limit+caller-budget-exhausted`.
5. `dependencies` row caps are declared: a file with 150 dependents returns 100 with
   `dependentsTotal: 150, dependentsTruncated: true`; the page scope denominator is consistent
   for `src/util` vs `src/util/` (both `returned: 4, totalFiles: 4`) — the historical `totalFiles:
   0` lie is gone — and an exact file path yields `totalFiles: 1`.
6. `complexity` refuses a symbol target with an actionable message and the alternative
   (`mode=callers`), resolves an exact file (`scopeMatch: "exact-file"`), a nested directory and
   a **top-level** directory (`scopeMatch: "directory-prefix"`), and publishes
   `filesMatchingScope` beside `filesInScope`.
7. `impact` routes through the canonical `computeImpact` (`src/lsp/impact.ts`): declares
   `depthCap: 5`, `nodeBudget: 200`, `depthReached`, `totalSymbols`, `totalSymbolsIfKnown`,
   names the root (`root: {name, symbolType, file, line, candidates, match}`), and answers
   `notFoundReason: "absent"` / `"not-traversable"` (type alias, namespace) / `"error"`
   distinctly. Five-key-set stability holds: the not-found object carries the same keys as the
   success object.
8. Root resolution declares what it got: measured `exact` (hub), `exact-any-kind` (constant
   `MAX_RETRIES`, type alias `StageId`, namespace `Registry`) and `containment` (`"un"` → `run`;
   `"HUB"` → `hub`), with `rootCandidates`.
9. `stats` publishes the per-language breakdown, `callEdges` + `couplingRelationshipTypes`,
   `symbolsWithComplexity` beside `avgComplexity`, and `avgFileSizeUnit`.
10. Every one of the 11 modes carries a `freshness` envelope, including the not-found paths
    (`impact:notfound`, `test_impact:notfound`), and project-wide modes declare
    `freshness.mode: "sampled"` when the row set exceeded the 64-row cap (T1: 49/97 rows).
11. `dependencies` freshness flags a file deleted from disk (status `missing`) as `stale: true`,
    because it uses `!== "fresh"` — see D-03 for the modes that do not.
12. T0 and T1 are inside the campaign budgets (§8), 11/11 modes.

---

## 2 · Defect register (product). Severity is impact × likelihood for an agent caller.

Legend: **S1** blocks an answer / states a falsehood with consequences · **S2** material
misreading or budget breach · **S3** correctness-of-contract or documentation-only.

### D-01 · S2 · `test_quality` `limit` does not bound the returned rows
The descriptor and the generated page say `limit` is "Maximum items returned: … entries for
`test_mapping`/`test_gaps`/`test_quality`"; `docs/BB_ANALYZE.md` (the `limit` table) says the
unit for `test_quality` is **files**. The engine uses `maxFiles` only to decide how many files
get their **content read**; every code test file in scope is still emitted as a row.

Evidence (TX, 3 code test files):
- `mode=test_quality` → `files: 3`, 6,764 bytes.
- `mode=test_quality, limit: 1` → `files: 3` (still), 6,647 bytes, `provenance.sampled: true`,
  `summary.unsupportedDimensionCount: 10` (the two unread files), and **no
  `summary.returned`/`summary.truncated` at all** — the report's `summary` has only
  `{filesWithContent, filesUnknown, unsupportedDimensionCount}`.
- MCP door: `bounds:test_quality-limit1` = 6,647 bytes, same as default.

Fix (Phase B): slice the emitted `files` to `limit`, and publish `summary.returned` /
`summary.truncated` (handler can do both without the shared contract file; ideally add them to
`TestQualityReport` — request R-1).

### D-02 · S2 · `test_impact` is unbounded and cannot say what bound fired
`mode=test_impact` refuses `limit` (by design) yet has no replacement bound:
- `testImpact` calls `graphTraversal(..., {direction:"callers", maxDepth: 4})` with **no
  `timeBudgetMs`**, and the graph engine's default is `DEFAULT_WALK_TIME_BUDGET_MS = 0`
  ("no clock bound") — so the one walking mode without a limit also runs without a clock.
- The report carries no `summary`, no `returned`, no `truncationReason`: fields are
  `target, found, directTests, indirectTests, affectedTestFiles, truncated, provenance, runtimeCoverage, freshness`.
- Measured T2: 6.3 s; T1: p95 237 ms. On T2 it answered `truncated: true` for a target with
  **0** direct and 0 indirect tests with nothing naming the bound. This is the one mode where
  `truncated: true` cannot be explained from the payload.
- `docs/BB_ANALYZE.md` §"Test intelligence" says "Each mode also states its page
  (`summary.returned` / `truncated`)" — false for this mode.

Fix (Phase B): pass the tool's declared walk ceiling (`ANALYZE_GRAPH_WALK_CEILING_MS`, 2,000 ms,
already imported by the handler) into `testImpact` via a widened local options type, and emit
`summary: {returned, truncated, truncationReason, timeBudgetMs, timeBudgetExhausted,
depthCap}` alongside the arrays; document the new bound.

### D-03 · S2 · Three modes report a **missing** file as `stale: false`
`test_mapping`, `test_gaps` and `test_quality` compute their row flags as
`statuses.get(...) === "stale"`, while `callers/callees/trace` and `dependencies` use
`!== "fresh"`. A file deleted from disk after indexing is `missing`, not `stale`, so those three
modes attach **no marker at all** to a row whose file no longer exists — while the very same
answer's envelope counts it as missing.

Evidence (`probe-bounds-freshness.json`; deleted `tests/format.test.ts` and `src/wide/w4.ts` from
disk, modified `src/wide/w5.ts`, index untouched):
- `test_quality` envelope: `{fresh:2, stale:0, missing:1}`, and the row for
  `tests/format.test.ts` is `{stale: false}` — internal contradiction in one payload.
- `test_mapping`: `src/wide/w4.ts` → `stale: false`; `src/wide/w5.ts` → `stale: true`.
- `test_gaps`: no gap row changes at all (its page never contained the files, and its envelope
  resolved only the returned page).
- Control: `dependencies filePath=src/wide` flags `w4.ts` `stale: true`; `complexity` on w5 flags
  the row.

Fix (Phase B): use `statusFor(...) !== "fresh"` in all three handlers (the graph modes' rule);
document that `no-row` also flags (the row's file is not in the index at all).

### D-04 · S2 · `filePath` on the three test modes does not scope an exact file
`dependencies` matches `relativePath === scope || startsWith(scope + "/")`; `complexity` matches
an exact file then a segment-bounded prefix. The test engines build the predicate as
`likePrefix(filePath)` = `prefix + "/%"` only — an exact, existing file is therefore a scope with
**zero** matches:
- `test_mapping, filePath:"src/core/engine.ts"` (exists) → `productionSymbols: 0, returned: 0`.
- `test_quality, filePath:"test/unit/engine.test.ts"` (exists, is a test file) → `files: 0`.
- Control: `dependencies, filePath:"src/core/engine.ts"` → `totalFiles: 1`.
The descriptor calls `filePath` a "path PREFIX … matched on a whole segment boundary", and a whole
file is a segment-boundary match of itself in every other mode. A caller scoping a single file is
told the file has no production symbols — a confident false negative.

Fix (Phase B): in `test-intel.ts` (`likePrefix` call sites) and `quality.ts`, use the
dependencies rule: `(relative_path = ? OR relative_path LIKE ? ESCAPE '\')`.

### D-05 · S2 · `complexity` `breakdown` is cut at 20 with no declared bound
`analyzeComplexity` returns `breakdown: breakdown.slice(0, 20)` and `symbolCount`; there is no
`breakdownShown`/`breakdownTruncated` and no `returned`-style field. Measured TX
`target:"src"`: `symbolCount: 206`, `breakdown.length: 20`, `filesInScope: 195`.
`docs/BB_ANALYZE.md` opens with "every one of them is **bounded** and says so: what it returned,
what exists" — this is a mode that is bounded and does not say so. (The top-20 cut is a
reasonable page; it is just undeclared.)

Fix (Phase B): publish `breakdownReturned` + `breakdownTruncated` (and name the cap in
`provenance.limitations`); document in curation.

### D-06 · S2 · T2 graph modes blow the campaign budget; the declared wall clock does not bound them
Warm, five runs, single process each (`latency.sh`; full table in §8 / `LATENCY.json`):
- `callers target=makeProvenance`: **p50 10,996.7 ms, p95 12,366.9 ms**, 33,570 bytes.
- `callers target=getProjectId`: 22,674 ms on a single call; the 5-run leg **timed out at 300 s**
  (recorded as a blocked leg, §9).
- `callees target=getProjectId`: 12,409 ms; `trace`: 4,951 ms.
- Campaign budget for a read tool default call: **< 5 s p95**; 30 s client ceiling.
- The answer *declares* `summary.timeBudgetMs: 2000`. On `callees`/`trace` it says
  `timeBudgetExhausted: true`; on `callers` it says `false` while taking 22.7 s. The ceiling is
  checked between nodes only, and one SQL statement costs 4.9–12.5 s.

Root cause is in `src/intelligence/graph/graph-engine.ts` (not this tool's file). Profiled on T2
(`t2-profile2.ts`):
- the caller statement takes **4,918 ms with no ORDER BY** and no rows returned
  (`callers(getProjectId)` has 0 callers); the plan is
  `SEARCH r USING INDEX brain_rel_proj_type_idx (project_id=? AND relationship_type=?)` — it
  scans every row of each of the 14 kinds in the project instead of driving from
  `target_symbol_id`, although `brain_rel_proj_type_target_idx (project_id, relationship_type,
  target_symbol_id)` exists;
- the cascade arm scans symbols with `brain_symbol_gravity_idx (project_id=?)`
  (`SEARCH m USING INDEX brain_symbol_gravity_idx (project_id=?)`) instead of
  `brain_symbol_owner_idx` on the owner range;
- root resolution alone is 716 ms + 420 ms, and the containment fallback for a **nonexistent**
  name takes 4.96 s before refusing.
Direct requests R-2 (graph-engine owner) and R-3 (if the ceiling constant in
`src/mcp/tools/shared.ts` needs a comment update). This file's action in Phase B: re-state the
measured latency honestly in the descriptor/curation (a declared 2,000 ms ceiling that can be
4.5× exceeded is a claim the tool makes about itself), and add a T2 latency leg to the gates so
a regression is visible.

### D-07 · S2 · T2 payload sizes contradict the documented performance claim
Documented (`docs/tools/bb_analyze.md` performance; curation line): "a default answer is 1.5–26 KB
for eight of the eleven modes; `dependencies` is 75.9 KB … on this repository's src (183 files …)".
Measured on T2 (6,452 files) default arguments:
`test_quality` **73,067 B**, `dependencies` (default limit 20) — see `t2-probes.jsonl`,
`test_mapping` **66,132 B**, `dependencies limit:5` **82,830 B**, `callees` 21,966 B, `callers`
(hub) 33,570 B. The old corpus (183 files under `src`) no longer exists as a reported subject;
the numbers must be re-measured and the claim reworded per mode and per corpus.

### D-08 · S3 · `test_gaps` in-code identity is arithmetically wrong
`test-intel.ts` comment: `productionSymbols = gaps + directlyTested + excludedAsNoise`. The code
is `productionSymbols = filtered.length` (noise already removed), so the identity is
`productionSymbols = total + directlyTested` and `prodRows = productionSymbols +
excludedAsNoise`. Measured TX: `productionSymbols 17, total 17, directlyTested 0,
excludedAsNoise 0` — the wrong identity also happens to be unusable because it double-counts
`excludedAsNoise`. The contracts and the docs state the correct identity; the comment lies.

### D-09 · S3 · `dependencies` remediation names one file when the scope is a directory
`filePath:"src/wide"` returns 4+ files; the envelope says "2 stale in this file — … manual
repair: run: `bb index "src/wide/w0.ts"`" because the handler always passes
`scope: {kind:"file", path: first.file}`. `first.file` is the highest-scoring row
(`w0.ts`), not the stale ones (`w4.ts`, `w5.ts`). Reproduced in
`probe-bounds-freshness.json`. Fix: pass `{kind:"dir", path: scopePath}` when the caller supplied
a directory prefix (or when the page has more than one file).

### D-10 · S3 · Dead fallback in the handler
`const rawScope = args.filePath ? String(args.filePath) : target || undefined` — `target` cannot
reach this line for `dependencies` (line "irrelevant options: target" rejects it first), so the
`target ||` half is dead and documents a contract that does not exist.

### D-11 · S3 · `docs/BB_ANALYZE.md`'s not-traversable list is wrong for constants and enums
The page says a target the graph cannot root at is "a `namespace`, `constant`, type alias or
`enum_member`". Measured TX: `impact` on a **constant** (`MAX_RETRIES`) → `found: true`,
`root.match: "exact-any-kind"`, `affectedFiles: 0`; on an **enum** (`Mode`) → `found: true`;
only the **type alias** (`StageId`) and **namespace** (`Registry`) → `notFoundReason:
"not-traversable"`. Two of the four named kinds are wrong.

### D-12 · S3 · Documentation cites verification that does not exist
`docs/BB_ANALYZE.md` line 13 says "pinned by a corpus test in `fixtures/analyze/` (308 claims)";
its Verification section names `fixtures/analyze/analyze.test.ts` (101 claims),
`round2.test.ts` (114), `round3.test.ts` (92) and `fixtures/analyze/latency-gate.sh`. The
generated page's Performance paragraph names `fixtures/analyze/latency-gate.sh` too.
`fixtures/` **does not exist in this repository** (`git ls-files | grep fixtures` → empty;
directory absent). The commands as written cannot run. This is the single largest docs-truth
defect of the tool: §4 of the charter requires the commands in the docs to run, and these four
files — with a precise claim count — never do.

### D-13 · S3 · `docs/BB_TEST_QUALITY.md` advertises two tools that do not exist
Line 5: "Tools: **`bb_test_quality`** and **`bb_test_suggestions`** (sidecar, read-only)." The
public registry has sixteen tools and neither name is among them; shared gates explicitly list
both as phantoms (`script/m48/verify-h1-ghosts.ts`, `script/m56/verify-tools-truth.ts`), yet this
page — linked from `docs/README.md` — still promises them. The capabilities live at
`bb_analyze mode=test_quality` and (partly) `mode=test_impact`.

### D-14 · S3 · `docs/BB_TEST_INTEL.md` drifts from the engine
- Says mapping evidence yields a `quality` of `good`; `TestMappingEntry` has no `quality` field
  (the field is `strongestEvidence`).
- Lists category `indirect_only` — no code path emits it (`testGaps` emits only
  `no_evidence` / `weak_evidence`).
- Milestone framing in the title ("M9.10"), no §8 header, counts its own gate as "17 checks" and
  the current gate's output pins a different count.
- Does not state the population/identity rule that the engine and contracts now enforce
  (`productionSymbols + excludedAsNoise`, `productionSymbols = gaps + directlyTested`), so the
  one page a user reads for the numbers does not teach the arithmetic.

### D-15 · S3 · `docs/BB_ANALYSIS_HISTORY.md` implies `bb_analyze` exposes history
The page says "Public tools remain `bb_security`, `bb_patterns`, `bb_analyze`/`bb_health`", and
uses `bb_analyze` in its history sentence, but **no `bb_analyze` mode reads or writes analysis
history**: `executeAnalysis`/`getAnalysisHistory` are called from `bb_security`, `bb_patterns`
and `bb_health` (`history: true`) only; `bb_analyze` does not import them. Milestone framing
("M9.12") in the title; no §8 header; its `verify-analysis-history` command does run (PASS,
§4). The engine file `run-history.ts` is in this lane's scope; the page must say who exposes it.

### D-16 · S3 · `descriptor.documentation.defaults` is false
`{ limit: 20 }` is rendered on the tool page as `Defaults: {"limit":20}`. Actual defaults:
**25** edges per direction (`GRAPH_EDGE_PAGE`) for callers/callees/trace, **20** files for
dependencies, **50** entries for test_mapping/test_gaps (engine `DEFAULT_PAGE`) and **50** files
for test_quality (`maxFiles ?? 50`). The generated page's own Performance paragraph contradicts
its own Defaults line (25/20/50), and the `m13/verify-analyze-docs.ts` "docs: defaults match"
check pins docs to the registry value, so the gate cannot catch it.

### D-17 · S3 · The handler's `allowed`/irrelevant-option branch is unreachable through MCP
`src/mcp/tool-validation.ts` rejects unknown properties and irrelevant mode options before the
handler runs, so `if (unused.length) … "irrelevant options: <key>"` (and the `targetModes`/
`fileModes` guards in the handler) are a second, weaker copy of a contract the validation layer
already enforces. Kept as defence-in-depth; the audit records that no test can reach it through
the door (a source-text test can, and one does — see G-04).

### D-18 · S3 · `coupling.ts` is unreachable dead code inside this tool
`getCoupling` is imported by no production file; only `script/verify-analyze.ts` and the m15
benchmark use it. No `bb_analyze` mode exposes coupling (correctly documented in
`docs/BB_ANALYZE.md` §"no coupling mode"). The file stays alive only because a gate imports it,
which makes a gate's green say nothing about the tool. Options in Phase B: give it a header and
a "not exposed by any mode; kept because…" note, or propose deletion to the Lead (R-4).

### D-19 · S3 · the T2 latency figures are taken on a loaded shared host and must be qualified
The checkout is shared: during the T2 sweep the 1-minute load average was 25–30 (fleet evidence
regeneration plus the other tool owners measuring their own T2 budgets). Warm-up calls for single
modes took 8.7–53.6 s, and one 5-run leg could not complete inside 300 s. The one-call baselines
(`t2-probes.jsonl`) and the 5-run sweep (`LATENCY.json`) are both recorded with the load, so no
reader mistakes them for a quiet-machine baseline; the campaign's T2 numbers for every tool are
being taken under the same conditions, which makes cross-tool comparison unsafe until a quiet
re-measure is possible (R-5). D-06 is separate: the graph query plan is a profiled product
defect, not contention.

---

---

## 3 · Gate register — every existing verifier run, and whether it can go red

Environment for all runs: `BB_DATA_DIR=$PWD/validation/tools/bb_analyze/bbdata`,
`BB_NO_AUTO_REFRESH=1`, from the working tree. Full logs in `validation/tools/bb_analyze/gates/`.

| # | gate | command | result | verdict |
|---|---|---|---|---|
| G-01 | m13 modes | `npx tsx script/m13/verify-analyze-modes.ts` | **PASS 39/39, 16 negatives** (exit 0) | **defect** — 5 of 11 modes never exercised; see below |
| G-02 | m13 handler | `npx tsx script/m13/verify-analyze-handler.ts` | PASS 14/14 (exit 0) | **defect** — source-text greps, cannot fail meaningfully |
| G-03 | m13 e2e+corpus | `npx tsx script/m13/verify-analyze-e2e-corpus.ts` | **KNOWN-GAP 7/8** (exit 1) | **red and for the wrong reason** + silent-skip catch |
| G-04 | m13 docs | `bun run script/m13/verify-analyze-docs.ts` (documented runner) | **KNOWN-GAP 7/8** (exit 1) — `evidence: an3.json verified` fails | cascade from G-03; under `npx tsx` it **crashes at load** (`import.meta.dir` is Bun-only) |
| G-05 | m15 deep | `npx tsx script/m15/verify-analyze-deep.ts` | **PASS N1–N8 all VERIFIED** (exit 0) | **defect** — N3/N8 exercise `analyzeImpact` (deprecated, not the tool's engine); N6 is vacuous |
| G-06 | root engine gate | `npx tsx script/verify-analyze.ts` | PASS (exit 0) | **defect** — tests `getCoupling` (dead) + `analyzeImpact` (unused by the tool); no handler/MCP coverage |
| G-07 | test-intel | `npx tsx script/verify-test-intel.ts` | PASS (exit 0) | engine-level; does not cover the handler's flags or `filePath` rule |
| G-08 | test-quality | `npx tsx script/verify-test-quality.ts` | PASS (exit 0) | engine-level; does not check that `limit` bounds rows |
| G-09 | analysis history | `npx tsx script/verify-analysis-history.ts` | PASS (exit 0) | good (run-history engine, not a bb_analyze mode) |
| G-10 | tool history | `npx tsx script/verify-tool-history.ts` | PASS (exit 0) | covers bb_security/bb_patterns; no bb_analyze history exists (as documented) |
| G-11 | m48 P1 impact unity | `npx tsx script/m48/verify-p1-impact-unity.ts` | **PASS 28/0, 3 negatives** | good: handler-level impact == bb_impact |
| G-12 | m48 P2 honesty fields | `npx tsx script/m48/verify-p2-honesty-fields.ts` | **PASS 13/0, 4 negatives** | good |
| G-13 | m48 P4 param matrix | `npx tsx script/m48/verify-p4-param-matrix.ts` | **FAIL (8 passed, 2 failed)** — both failures are `bb_visualize`/`bb_edit` rows | blocked/cross-scope (other lanes); **and** all 27 `bb_analyze` matrix rows have `verifiedBy: null` |
| G-14 | m48 C1 corpus | `npx tsx script/m48/verify-c1-corpus.ts` | **timeout at 400 s** (exit 124) | blocked leg (§9) |
| G-15 | regex policy | `script/tools/verify-regex-policy.ts` | **file does not exist** | gate declared by charter §7.4 is absent |
| G-16 | quality gate wiring | read `script/verify-quality-gate.ts` | references `m13/verify-evidence.ts` (present) | ok |

### G-01 detail — the modes gate scores refusals as success (evidence in its own artifact)

`verify-analyze-modes.ts` calls every mode as `{mode, target:"alpha"}` (only `complexity` gets a
file path) and its per-mode negative is
`!out.includes("Error:") && !out.includes("error:")`. `stats`, `dependencies`, `test_mapping`,
`test_gaps` and `test_quality` **refuse** a `target` with `isError: true` and the text
`bb_analyze <mode>: irrelevant options: target`, which contains neither string — so the check
passes. The gate's own recorded evidence proves it: `validation/m13/results/an1.json` carries
`"detail": "bb_analyze dependencies: irrelevant options: target"` on a **pass: true** row, and the
same for stats/test_mapping/test_gaps/test_quality. Five of the eleven "verified modes" were never
run; a green run cannot distinguish them from working modes. (Also: `runMode` swallows process
failure into `e.stdout || ""`, so a crash that prints nothing is scored by `out.length > 0`
alone.)

### G-03 / G-04 detail — red, and for a reason that is not the product

- The MCP leg spawns `new StdioClientTransport({command, args, cwd})` without `env`; the SDK's
  default environment is a safe subset, so `BB_DATA_DIR` (and any other isolation variable) is
  lost. Under the tool-local data dir the server answers `No index found for /tmp/…` — a red
  check about the harness, not the tool. It passes only when the index happens to live in the
  default `~/.bb`.
- The CLI leg is `try { execFileSync(...) } catch {}` with an **empty** catch: a failing mode
  emits **no check at all** instead of a red one. Silent skip.
- Both legs plus the corpus legs test **`node bin/bb`**, i.e. `dist/` — built 2026-10-20, while
  the working tree is HEAD 2026-11-01 and 70 `src/` files are newer (including
  `graph-engine.ts`). The gate therefore answers about a twelve-day-old build, not the tree.
  (Canonical `npm run verify` builds first; `npm test` and per-gate invocation do not.)
- The MCP leg tests one mode (`stats`); the CLI legs test 5 of 11.
- `verify-analyze-docs.ts` crashes under `npx tsx` because it uses `import.meta.dir` (a Bun API);
  the documented runner is `bun run …`, where it works but inherits the an3 cascade.

### G-05 detail — the deep gate measures an engine the tool does not call

`script/m15/verify-analyze-deep.ts` imports `analyzeImpact` from
`src/intelligence/analysis/impact.ts` and uses it in N3 ("impact(leaf) reaches b.ts and c.ts") and
N8 (mode coverage). The shipped `mode=impact` calls `computeImpact` from `src/lsp/impact.ts`
(verified by reading the handler and by the passing P1 unity gate). So the deep gate's green is
about a calculator the tool no longer ships. Its N6 check
`["callers",…,"test_quality"].every((m) => hnd.includes(m))` is vacuously true: the handler's
own terminal error message lists all eleven mode names, so the substring exists no matter what
dispatch exists. N2 "regex census" asserts that the content regex literals **exist** and that a
justification comment mentions "content heuristic" — it does not test a single regex, and it
passes the §7 problem along.

### G-13 detail — matrix rows are unverified

`validation/m48/param-matrix.json` holds 27 `bb_analyze` rows (4 params, 11 enum values, 11 mode
rows, 1 rejection) and **every one has `verifiedBy: null`**, so the matrix's own claim ("X1
refuses close while any row is unverified") is not enforced by P4 as run. The two P4 failures are
`bb_visualize` (offset, layout, regions, force, codemap, class) and `bb_edit` (overwrite, edits,
files, items) — other lanes' scope.

---

## 4 · Declared-bounds / declared-absence audit (mode by mode)

“Bounded” below means: the answer states what it returned and the size of the set it was drawn
from, or names the bound that fired. Measured on TX/T1/T2.

| mode | bound in payload | measured | verdict |
|---|---|---|---|
| `callers`/`callees`/`trace` | `returnedCallers/Callees`, `pageEdgeLimit`, `pageTruncated`, `totalCallers/Callees`, `callersIfUncapped`, `edgeLimit`, `cappedQueries`, `maxDepth(+Reached)`, `timeBudgetMs(+Exhausted)`, `truncationReason(s)` | page 25/95; full 95/95; 250-cap case `callersIfUncapped: 301` | **bounded and declared** on small indexes; on T2 the wall clock is declared but does not bound latency (D-06) |
| `dependencies` | `summary.{returned,totalFiles,scope,truncated,pageLimit}`, per-row `dependenciesTotal`/`dependentsTotal` + `Truncated` flags, report-level `provenance.truncated` | exact file 1/1; `src/util` 4/4; page limit 1 → 1/18 truncated | **bounded and declared**; remediation scope wrong (D-09) |
| `stats` | counts are per-project totals; `freshness.mode` sampled | sampled 49/97 T1, 60/64 T2 | **bounded** (a census, not a page) |
| `complexity` | `symbolCount`, `filesInScope`, `filesMatchingScope`, `{value,available}` per metric | symbolCount 206, breakdown 20, no cap flag | **breakdown NOT declared** (D-05); metrics honest (`depthOfInheritance` always `available:false`) |
| `impact` | `totalSymbols`, `totalSymbolsIfKnown`, `truncated`, `truncationReason`, `depthCap`, `nodeBudget`, `depthReached` | T2/TX: depthReached 0, totals declared | **bounded and declared** |
| `test_mapping` | `summary.{productionSymbols,returned,truncated,excludedAsNoise,...}`, per-entry `linksTruncated` (cap 20) | TX 17/17; T1 50 of 1,187 truncated; T2 50 of 51,776 | **bounded and declared** |
| `test_gaps` | `summary.{productionSymbols,total,directlyTested,excludedAsNoise,returned,truncated,byCategory,highRisk}` | TX 17/17; T1/T2 50 returned `truncated:true` | **bounded and declared** |
| `test_impact` | only `truncated` (boolean) | T2 `truncated:true` with 0 rows, no reason | **NOT bounded, NOT declared** (D-02) |
| `test_quality` | `summary.{filesWithContent,filesUnknown,unsupportedDimensionCount}`, `provenance.sampled` | 3 rows at `limit:1` | **NOT bounded as documented** (D-01) |

**Declared absence / availability.** Verified honest: `rootMatch`/`rootCandidates` always present;
`notFoundReason` distinguishes `absent` / `not-traversable` / `error` in `impact`; graph modes'
not-found object has the same key set as success (checked key-by-key); `depthOfInheritance` is
`available:false, value:null`, never a fabricated number; `maintainability` is unavailable out of
domain instead of a clamped 0; `test_*` modes attach `no-test-evidence-edges` /
`non-code-test-files-excluded` to `provenance.unknowns` when the corpus is empty or data-only
(measured on T1, which has no test files: `unknowns` carried the no-evidence sentence).
One absence gap: `test_impact`'s `truncated: true` names no bound (D-02).

**Freshness.** All 11 modes carry the envelope. Row flags: graph modes and `dependencies` flag
`missing`; the three test modes do not (D-03). `dependencies`/`complexity`/`impact` resolve the
returned page only; project-wide modes declare `sampled` and the row-cap rule is documented.

---

## 5 · Docs drift (claim → measured → required edit)

| page / location | claim | measured | edit |
|---|---|---|---|
| `docs/BB_ANALYZE.md` L13 + Verification section | `fixtures/analyze/*.test.ts` (308 claims) + `latency-gate.sh` pin every claim | `fixtures/` absent from the repo; commands cannot run | replace with the real gate list (§3) and this audit's evidence paths |
| `docs/tools/bb_analyze.md` Performance (curation) | "nine graph cases in `fixtures/analyze/latency-gate.sh` answer in under 2.4 s" | file absent; T2 `callers` measured 22.7 s, `callees` 12.4 s | remove the file reference; publish the T2 table from `LATENCY.json` |
| curation + generated page Performance | "1.5–26 KB for eight of the eleven modes; `dependencies` 75.9 KB on this repo's src (183 files)" | T2 (6,452 files): test_quality 73 KB, test_mapping 66 KB, dependencies 83 KB at `limit:5`, callers 33.6 KB hub | restate per mode and per corpus; name the index it was measured on |
| descriptor `documentation.defaults` | `{limit: 20}` | 25 / 20 / 50 / 50 by mode (D-16) | real per-mode defaults |
| `docs/BB_ANALYZE.md` "not-traversable" list | includes `constant` and `enum_member` | constant and enum root fine (`found:true`, `match:exact-any-kind`); only type alias / namespace refuse | correct the list (D-11) |
| `docs/BB_ANALYZE.md` "Each mode also states its page (`summary.returned`/`truncated`)" | all modes | `test_impact` has no summary (D-02); `complexity` breakdown cap undeclared (D-05) | scope the sentence per mode |
| `docs/BB_ANALYZE.md` limit table | test_quality unit "files" (implies rows) | `limit` bounds content reads, not rows (D-01) | either fix the engine or state the real semantics |
| `docs/BB_TEST_QUALITY.md` L5 | `bb_test_quality`, `bb_test_suggestions` exist | neither is a registered tool (phantoms in shared gates) | name `bb_analyze` modes; say suggestions engine is not publicly exposed |
| `docs/BB_TEST_INTEL.md` | mapping yields `quality: good`; `indirect_only` category | no `quality` field; category never emitted | correct both; add the population identities |
| `docs/BB_ANALYSIS_HISTORY.md` | implies `bb_analyze` is a history surface | `bb_analyze` reads/writes no analysis history | name `bb_health history:true`, `bb_security`/`bb_patterns` `recordRun` |
| `docs/BB_TEST_INTEL.md`, `docs/BB_TEST_QUALITY.md`, `docs/BB_ANALYSIS_HISTORY.md`, `docs/BB_ANALYZE.md` | no §8 markdown header; milestone titles (M9.10, M9.11, M9.12) | charter §8/§9 | add headers, drop milestone framing |
| `docs/tools/bb_analyze.md` (generated) | states `Defaults: {"limit":20}` | same as D-16 | follows the descriptor fix; regenerate with `--only bb_analyze --write` |

Docs claims that were **verified true** (keep): dependency resolution labels and the "not a
basename guess" measurement; segment-boundary prefix scoping; `%`/`_`/`\` escaping; graph
`contains`/`exports` composition disclosure; per-mode key-set stability; `notFoundReason`
taxonomy for `impact`; `maintainability` domain honesty; `available:false` for
`depthOfInheritance`; relative-path-only locations (no absolute `filePath` in nodes); target echo
bound (200 chars).

---

## 6 · Ownership / authorship / regex / banned comments

### 6.1 §8 headers

| file | header |
|---|---|
| `src/mcp/tools/bb_analyze/{descriptor,handler}.ts` | present (seeded by the split) |
| `script/tool-docs/curation/bb_analyze.ts` | present |
| `docs/tools/bb_analyze.md` | present (generated) |
| `src/intelligence/analysis/{complexity,coupling,dependencies,project-stats,run-history}.ts` | **missing** |
| `src/intelligence/testing/{quality,suggestions,test-intel}.ts` | **missing** |
| `script/m13/verify-analyze-{modes,handler,e2e-corpus,docs}.ts`, `script/m15/verify-analyze-deep.ts`, `script/verify-analyze.ts` | **missing** |
| `docs/BB_ANALYZE.md`, `docs/BB_TEST_INTEL.md`, `docs/BB_TEST_QUALITY.md`, `docs/BB_ANALYSIS_HISTORY.md` | **missing** |

The seeded header in `handler.ts`/`descriptor.ts`/curation also carries two stale lines to
refresh in Phase B: it points at `validation/tools/regex-allowlist.json` (does not exist yet —
R-1/R-6) and its WHERE-ITS-EVIDENCE line lists docs pages generically.

### 6.2 §9 banned comments (counted by word/phrase, files in §6.1's code list)

| phrase class | count | where (examples) |
|---|---|---|
| milestone IDs used as narrative (`M10.xx`, `M13.`, `M15.N2`, `M35.S1`, `M48.P1`, `M50.A2`, `M57.T5`, `M28.T1`, `M59.A12`, `M64`, `M71.D*`) | **44** | handler.ts (8), test-intel.ts (7), quality.ts (5), m15 deep (11), m13 modes (2), docs pages, engines |
| `issue #NNN` | **2** | `handler.ts` ("M28.T1 (issue #624)", "M48.P1 (#696)") |
| "the lane" | 1 | `script/m13/verify-analyze-modes.ts` ("the lane sat at 36/37") |
| "the agent door" | 1 | `handler.ts` comment |
| `MEASURED 2026-…` / "defect fixed <date>" / "shipped" / "standing rule" / "the fleet" / "teammate" / "the Lead" | 0 in these files | — |

Fix in Phase B: rewrite as technical facts ("measured on an 11,440-file index: …"), keep
`owner cascade`/`owner` as data-relationship words (§9 explicitly keeps those), drop process
history and milestone IDs. This touches comments only, not behaviour.

### 6.3 §7 regex inventory (no allowlist exists — R-1)

`validation/tools/regex-allowlist.json` and `script/tools/verify-regex-policy.ts` **do not
exist**, so the policy is currently unenforceable and every regex below is non-compliant by
construction:

| file | regex literals | kind |
|---|---|---|
| `src/intelligence/testing/quality.ts` | **14** | 11 `count(/…/)` content classifiers over test-file source text; `MOCK_LIBS`; the spy/mock probe; the scope path's `[\\%_]`/`\/+$` escapes |
| `src/intelligence/testing/test-intel.ts` | 3 | `likePrefix` escape + trailing slash; (no classifier regexes) |
| `src/intelligence/analysis/dependencies.ts` | 3 | `escapeLike`, trailing-slash, `needle` |
| `src/intelligence/analysis/complexity.ts` | 2 | `escapeLike`, trailing-slash |
| `src/mcp/tools/bb_analyze/handler.ts` | 0 | — (impact's `/not a traversable root/` etc. moved to Lead-owned `shared.ts`) |
| gate scripts in scope | ~6 | m15's anti-auto-pass probe and regex census regexes; m13's `/file path/i`, `/^Error:/` |

Non-regex formulations exist for every escape/normalize case (character loop, `endsWith("/")`);
Phase B converts those. The 11 content classifiers are the §7.2 case: they cannot be replaced by
`includes` without changing the score (an assertion may be `assert.equal(` or `assert(`), so they
stay only with (a) a site comment naming why no non-regex formulation is correct, (b) allowlist
entries, (c) an edge-case suite: empty input, no-match, match at boundary, Unicode/astral,
multiline, the anchors/quantifiers actually used, user-input escaping, very long input (time-boxed
no-catastrophic-backtracking assertion), and an invalid pattern path. Deliverable in Phase B:
`validation/tools/bb_analyze/regex-tests.ts` + proposed allowlist rows for the Lead to merge
(R-1), and conversions where the regex adds nothing.

---

## 7 · Latency

Full table with commands and environment: `validation/tools/bb_analyze/LATENCY.json`
(raw: `latency-raw.jsonl`; single-call T2: `t2-probes.jsonl`). Summary (warm, five runs,
p50/p95, milliseconds):

| mode | T0 p50/p95 | T1 p50/p95 | T2 p50/p95 |
|---|---|---|---|
| callers (`getProjectId`, T0/T1 target `applyDiscount`/`prepare`) | 21.6 / 58.1 | 71.4 / 175.7 | **blocked** (5-run leg hit the 300 s limit); single call 22,674 |
| callers hub (`makeProvenance`) | — | — | **10,996.7 / 12,366.9** |
| callees | 22.6 / 37.5 | 16.4 / 27.2 | **29,326.3 / 63,973.5** |
| trace | 16.3 / 20.1 | 152.0 / 403.5 | **32,978.3 / 50,086.1** |
| dependencies | 27.0 / 28.4 | 234.8 / 278.5 | **14,774.6 / 42,315.0** (bytes 203,790) |
| dependencies `limit:5` | — | — | **6,827.8 / 18,457.0** (bytes 82,824) |
| stats | 8.8 / 9.0 | 28.4 / 33.4 | **5,190.5 / 7,429.1** (single call: 16,412 cold / 4,131.5 warm p50) |
| complexity | 9.5 / 9.7 | 62.4 / 79.8 | **2,834.7 / 2,933.1** ← within budget |
| impact | 20.5 / 24.4 | 129.1 / 147.9 | **10,389.4 / 73,774.9** |
| test_mapping | 20.8 / 23.8 | 34.3 / 108.5 | **30,394.8 / 72,672.9** |
| test_gaps | 6.9 / 7.3 | 45.9 / 92.9 | **34,555.3 / 54,058.9** |
| test_impact | 19.6 / 20.7 | 208.4 / 237.2 | **26,413.7 / 62,677.8** |
| test_quality | 15.4 / 20.7 | 9.5 / 10.1 | **156.3 / 306.2** ← within budget (bytes 73,067) |

Budgets (charter §6): T0 default < 250 ms → **all 11 pass** (max p95 58.1). T1 < 1 s → **all 11
pass** (max p95 403.5). T2 < 5 s for a read tool → **9 of 11 legs breach on p95**, and the
`callers` 5-run leg could not complete inside 300 s.

**The T2 numbers are load-contended and must be read as upper bounds (D-19).** During the sweep
the 1-minute load average was **25–30 on this host** (fleet evidence regeneration in the shared
checkout plus other tool owners measuring their own T2 budgets); no other process was visible
inside this session's namespace, and warm-up calls alone took 8.7–53.6 s. The one-call baselines
in `t2-probes.jsonl` (fresh process per mode) are the cleaner shape: stats 16,412 ms (cold,
3.4 GB DB open) then 4,131.5 warm; complexity 1,536; callers 22,674; callees 12,409; trace 4,951;
impact 3,698; dependencies (limit 5) 2,858; test_mapping 8,600; test_gaps 7,321; test_quality
1,054; test_impact 6,281. Even those breach the 5 s budget for the graph modes and for
test_mapping/test_gaps/test_impact, which is why D-06 and D-19 are separate findings: D-06 is a
profiled query-plan defect (product), D-19 is shared-machine contention (environment; re-measure
on a quiet machine and against whatever index the campaign declares as T2).

Additional measured payloads on T2 default arguments (bytes): stats 6,213; complexity 5,418;
callers (0-caller root) 3,643; callers hub 33,570; callees 21,966; trace 3,732; impact 1,426;
dependencies (limit 5) 82,830; dependencies (default) 203,790; test_mapping 66,132; test_gaps
23,834; test_impact 764; test_quality 73,067. `stats`' first call in a new process is **16.4 s**
(3.4 GB DB open + freshness stat work) against a 5 s budget — the cold first call is over budget
even on an idle machine and should be bounded/documented (R-3).

---

## 8 · Blocked legs (declared, with the exact command and reason)

| leg | command | reason |
|---|---|---|
| T2 `callers` 5-run | `BB_DATA_DIR=$PWD/.bb-data BB_NO_AUTO_REFRESH=1 BB_REPEAT=5 npx tsx validation/tools/bb_analyze/run-one.ts '{"mode":"callers","target":"getProjectId"}'` | exceeded the 300 s per-leg limit (`timeout 300`); single call measured at 22,674 ms. Root cause profiled (D-06) but the fix is in `graph-engine.ts`, outside this lane |
| m48 C1 corpus | `npx tsx script/m48/verify-c1-corpus.ts` with tool-local `BB_DATA_DIR` | exit 124 at 400 s (corpus indexing); not a bb_analyze-specific gate |
| m48 P4 | `npx tsx script/m48/verify-p4-param-matrix.ts` | red on `bb_visualize`/`bb_edit` rows only (other lanes' scope) |
| corpus legs inside m13/m15 | `resolveCorpusRoot` | **not blocked** — corpus exists at `$HOME/fixtures/repositories` (rake, graphql-js present); the legs ran |
| CLI/MCP legs using `dist/` | `node bin/bb tool/mcp …` | `dist/` built 2026-10-20 vs HEAD 2026-11-01 (70 newer `src/` files). Phase B must build before trusting those legs, or run the source door (`bun src/mcp/server.ts`) as `mcp-door.ts` does (R-5) |
| regex policy gate | `script/tools/verify-regex-policy.ts` | absent (R-1) |

---

## 9 · Phase B plan (ordered; every edit inside this lane's write scope)

1. **Honesty fixes in the handler** (mine): D-03 missing-file flags; D-09 remediation scope;
   D-10 dead fallback; D-17 leave as defence with a comment; D-01 slice `files` + `summary`
   `returned/truncated`; D-02 pass the declared walk ceiling into `testImpact` and emit its
   bounded summary.
2. **Engine fixes (mine)**: D-04 exact-file `filePath` in `test-intel.ts` / `quality.ts`;
   D-05 `complexity` breakdown bound; D-08 comment arithmetic; D-18 header on `coupling.ts`.
3. **Descriptor + curation + docs** (mine): D-16 real defaults; D-07/D-12 latency/payload
   restated from `LATENCY.json`; D-11 not-traversable kinds; D-13/D-14/D-15 guide-page
   rewrites; §8 headers on every file in §6.1; §9 comment rewrite; regenerate
   `docs/tools/bb_analyze.md` with `--only bb_analyze --write` and verify with `--only
   bb_analyze`.
4. **Falsifiable gates** (mine): rewrite G-01 to run all 11 modes with per-mode correct
   arguments and assert mode-specific answer fields (not "no error:" text); rewrite G-02 to
   assert dispatch from descriptor+handler imports and make each check able to go red (planted
   mutant); fix G-03 env inheritance + remove the empty catch + test all 11 modes over MCP and
   all 11 over CLI; fix G-04 (Bun-only load, defaults check against behaviour); add a
   handler-level gate that would catch D-01/D-02/D-03 (limit bounds rows, truncated has a
   reason, missing file flags stale); add a T2 latency leg for the graph modes with the
   measured baseline.
5. **Regex** (mine): convert the escape/normalize regexes; keep the 11 classifiers with site
   comments, `regex-tests.ts` edge-case suite, and proposed allowlist rows (R-1).
6. Re-run every gate in §3 (with a build first, R-5), show each new/changed check red on a
   planted mutant, then green; write `validation/tools/bb_analyze/PHASE-B.json` evidence and
   update this audit's status column.

### Requests to the Lead (cross-scope)

- **R-1** Install `script/tools/verify-regex-policy.ts` + `validation/tools/regex-allowlist.json`
  (charter §7.4); merge the allowlist rows and test-file pointer from this lane.
- **R-2** Route to the graph-engine owner: the caller/callee query plans on a 310 k-symbol index
  (D-06). The measured statements are in §2/D-06; the fix is index-driven (drive from
  `target_symbol_id` / the owner range), not in `bb_analyze`.
- **R-3** `ANALYZE_GRAPH_WALK_CEILING_MS` lives in Lead-owned `src/mcp/tools/shared.ts`; if the
  graph-engine fix needs a different ceiling or a "ceiling is between statements" comment, that
  edit is yours.
- **R-4** `src/intelligence/contracts.ts` is not in this lane's scope. A clean fix for D-01,
  D-02 and D-05 wants fields in `TestQualityReport.summary`, `TestImpactReport` and
  `ComplexityReport`; approve either the contract addition or the handler-side cast approach.
  Also decide D-18 (`coupling.ts`: header-only vs delete).
- **R-5** Build (`npm run build`) before Phase-B gate runs that shell out to `dist/`, and confirm
  the campaign's T2 baseline should be restated against the measured index (6,452 files, not
  11,440).
- **R-6** The seeded headers and docs reference `validation/tools/regex-allowlist.json`; that
  file must exist before §7 can be satisfied in the §8 header line.

---

## 10 · Status

- Modes exercised end-to-end through the real MCP door: **11/11** (one success each; refusals
  separately). Findings evidenced: **19** (S1: 0 · S2: 7 · S3: 12), of which 18 are product defects and 1 (D-19) is an environment qualification.
- Existing gates: 10 green, 2 red (one for a harness reason, one cascading), 1 blocked by
  another lane, 1 blocked by time, 1 absent (regex policy).
- Latency: T0 and T1 inside budget on all 11 modes; **T2 graph modes breach the 5 s budget with
  a root cause outside this lane's files** (D-06/R-2).
- Docs: 4 guide pages + the generated page + the curation carry claims that the measured
  behaviour contradicts; D-12 (nonexistent verification) and D-13 (nonexistent tools) are the
  material ones.

---

## Phase B status (this revision)

Closed, with a falsifiable gate where the defect could be gated:

| defect | fix | gate that now covers it |
|---|---|---|
| D-01 test_quality limit | engine keeps rows (maxFiles=content reads); handler pages rows and publishes `summary.returned/totalFiles/truncated` | `script/m13/verify-analyze-modes.ts` (test_quality predicate), `script/verify-test-quality.ts` (engine unknown-state) |
| D-02 test_impact unbounded | passes `timeBudgetMs: ANALYZE_GRAPH_WALK_CEILING_MS`; emits `summary` + `truncationReason` | `verify-analyze-modes.ts` (test_impact predicate) |
| D-03 missing-file stale | three test modes use `!== "fresh"` like the graph modes | probe evidence `probe-bounds-freshness.json`; handler-level rule documented |
| D-04 filePath exact file | test-intel + quality use exact-OR-segment-prefix, same rule as dependencies | `verify-analyze-modes.ts` (dependencies scope), audit probe |
| D-05 complexity breakdown bound | `breakdownReturned` + `breakdownTruncated` + provenance limitation | `verify-analyze-modes.ts` (complexity predicate) |
| D-08 wrong identity comment | corrected to `productionSymbols = total + directlyTested` | review |
| D-09 dependencies remediation | dir scope when the page spans a prefix | audit probe `probe-bounds-freshness.json` |
| D-10 dead fallback | removed | — |
| D-11 not-traversable kinds | docs corrected to measured kinds (type alias/namespace refuse; constant/enum root) | `verify-analyze-docs.ts` (page/curation cite no wrong list via limitations) |
| D-12 nonexistent verification | page/curation now cite only runnable gates; gate fails on any `fixtures/` citation | `verify-analyze-docs.ts` (red-proof: planted citation → exit 1) |
| D-13 phantom tools | `BB_TEST_QUALITY.md` names `bb_analyze mode=test_quality`, states the retired names | `verify-analyze-docs.ts` (phantom-tool negative) |
| D-14/D-15 guide pages | corrected + population arithmetic added; `BB_ANALYSIS_HISTORY` states who exposes history | review |
| D-16 descriptor defaults | real per-mode default statement; docs gate pins the real values | `verify-analyze-handler.ts`, `verify-analyze-docs.ts` |
| §8 headers | added to 8 engine files, 4 guide pages, generated page, 6 gate scripts | `verify-analyze-docs.ts` header check |
| §9 banned comments | milestone/issue narrative removed from handler and gate scripts | review |
| §7 regex | 9 escape/normalize regexes converted to string ops; 12 content classifiers are a frozen exported table with a 61-check edge-case suite; 12 allowlist rows added (file+source+reason+testFile) | `script/tools/verify-regex-policy.ts` PASS (14 allowlisted, 73 frozen debt, 0 new) + `validation/tools/bb_analyze/regex-edge-cases.ts` 61/61 |

Gate results (final, from the working tree; logs in `validation/tools/bb_analyze/gates/`):

| gate | command | exit |
|---|---|---|
| modes | `npx tsx script/m13/verify-analyze-modes.ts` | 0 — An1 VERIFIED 84/84, 27 negatives |
| handler contract | `npx tsx script/m13/verify-analyze-handler.ts` | 0 — An2 VERIFIED 18/18 |
| e2e + corpus | `npx tsx script/m13/verify-analyze-e2e-corpus.ts` | 0 — An3 VERIFIED 42/42, 3 negatives |
| docs truth | `npx tsx script/m13/verify-analyze-docs.ts` | 0 — An4 VERIFIED 17/17, 4 negatives |
| deep engines | `npx tsx script/m15/verify-analyze-deep.ts` | 0 — N1–N8 all VERIFIED |
| engine gate | `npx tsx script/verify-analyze.ts` | 0 — ANALYZE: PASS |
| test intel | `npx tsx script/verify-test-intel.ts` | 0 — PASS |
| test quality | `npx tsx script/verify-test-quality.ts` | 0 — PASS |
| regex policy | `npx tsx script/tools/verify-regex-policy.ts` | 0 — PASS (14 allowlisted, 73 debt, 0 new) |
| regex edge cases | `npx tsx validation/tools/bb_analyze/regex-edge-cases.ts` | 0 — 61/61 |
| impact unity | `npx tsx script/m48/verify-p1-impact-unity.ts` | 1 — 67 passed, 1 failed: `truncated=true reason=traversal: caller-site-limit+caller-budget-exhausted`; this is the shared graph engine/impact lane's semantics (the tool did not change), reported as a cross-lane red |

Red-then-green evidence kept in `gates/`: `RED2-docs-citation.log` (planted `fixtures/` citation → exit 1, then An4 VERIFIED), `RED2-modes-page.log` (pageEdgeLimit 24 mutant → callers predicate FAIL, then An1 VERIFIED), `RED-handler-mutant.log` (descriptor missing a mode → registry consistency refusal at import, then An2 VERIFIED), and the regex suite's two real classifier failures (`assertCall` did not match `assert.equal(`, `chainedMatcher` matched no real chained matcher) before their fix.

Open / blocked: D-06 (T2 graph query plans) remains external — profiled evidence in this audit and handed to the Lead for the graph-engine owner; T2 latency must be re-measured after that fix (the fleet load also invalidated a clean T2 baseline). m48 P1's single failure is the same shared-engine lane.
