<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the audit + verification record for the public MCP tool `bb_impact`:
declared-vs-measured contract, defects found and closed (or routed), the gate table with red-then-green
mutation evidence, latency per tier, and the blocked legs.
WHO IT IS FOR — the Lead reviewing bb_impact's evidence and the next owner continuing from measured
state instead of memory.
EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_impact/LATENCY.json, MUTANTS.json, the gate
scripts and probe scripts under validation/tools/bb_impact/work/, and the tool's docs.
-->

# bb_impact — audit and verification record

- Tree: per-tool module split landed. `src/lsp/impact.ts`, `src/lsp/impact_request.ts`,
  `src/intelligence/analysis/impact.ts`, `src/mcp/tools/bb_impact/{descriptor,handler}.ts`,
  `script/tool-docs/curation/bb_impact.ts` and the gates are this tool's ownership.
- `npx tsc --noEmit` → exit 0 on the final tree.
- Every measurement read ran with `BB_NO_AUTO_REFRESH=1`; the shared `.bb-data` index was opened
  byte-read-only for the reference-index tier and hashed before/after (`dbUnchanged: true`).
- No `src/intelligence/graph/` edit was made (the engine is the graph owner's; the one measurement
  correction involving a query form is recorded in §3 and was routed, not "fixed" here).

## 1 · What the tool is

`bb_impact` is the agent door to the editor's bounded reverse-dependency impact surface. The
calculator is ONE component, `src/lsp/impact.ts` (`computeImpact`), used by:

| door | path | same numbers? |
|---|---|---|
| MCP tool `bb_impact` | `src/mcp/tools/bb_impact/handler.ts` → `computeImpact` | yes (measured identical result) |
| LSP wire `bb/impact` | `src/lsp/impact_request.ts` → `computeImpact` | yes (byte-identical result JSON) |
| `bb_analyze` mode `impact` | `src/mcp/tools/shared.ts` → `computeImpact` | same walk; gate m48/P1 & P3 |
| `bb_graph` LSP panel | `script/m26/graph-core.ts` renderer over the same result | data identical; DOM separate |

`src/intelligence/analysis/impact.ts` (`analyzeImpact`) is DEPRECATED as a tool-surface calculator
and is not wired to any public tool; it remains exported for the legacy analysis gates and imports
the canonical dependency rule (`IMPACT_REL_TYPES`). Contract changes there were coordinated with the
bb_analyze owner through the Lead.

## 2 · Declared-vs-measured contract (final state)

Fixtures under `validation/tools/bb_impact/work/fixtures/`; probes `probe-phase-a.ts`,
`probe2-phase-a.ts`, `probe4-refresh.ts`, `probe8-file-hint.ts`, and the real stdio session
`probe7-mcp-door.ts`.

| declared claim | measured | verdict |
|---|---|---|
| node budget 200 caps the returned set | hub fixture with ~233 distinct dependents: `shownCount=200`, `truncated=true`, `totalCountIfKnown=233` (measured walk) | honoured; the budget is the binding bound in the gate fixture |
| depth cap 5 | 7-hop chain: `depthReached=4`; direct dependents are `depth:0`; a deeper chain keeps `caller-depth-cap-reached` | honoured as an EXPANSION cap; documented (deepest reported depth = maxDepth-1) |
| `rule.relationshipTypes` = the measured rule | default echo `[calls, instantiates, extends, implements]` matches the walk; an empty list is REFUSED (component and door) | honoured |
| owner-cascade dependents included and attributed | class with method caller: `via:"member"`, `viaMember` names the member, `cascade.member=1`, composition sums to `shownCount` | honoured |
| measured total is the size of the prefix | >200 case: total 233 > shown 200; complete case: total == shown | honoured |
| `truncated` ⟺ a bound cut the SET | 200 distinct dependents over 201 caller rows (engine row cap drops a duplicate call site): `truncated=false`, `countVerification.complete=true`, engine bound kept in `traversal.engineTruncated`; 233-dependent case: `truncated=true`, `complete=false` | fixed (was falsely true when total==shown) |
| `countVerification` three-state | `ran`/`timedOut`/`boundarySuspect`/`complete` published; `complete:null` = complete-by-construction, `true` = measured agreement, `false` = prefix/unknown | added |
| `refresh:false` opts out; default repairs and re-runs | `probe4-refresh.ts`: default repaired a touched file (`auto-refreshed 1 file …`) and re-ran (shown 2→3); `refresh:false` answered from the stale index with `freshness.stale=1`; the next default call repaired (3→4) | honoured |
| unknown symbol is a loud declared error | real MCP door: `isError:true`, `bb_impact: symbol '…' not found — no impact set exists …` | honoured (single prefix after fix) |
| alias spellings accepted | real MCP door: `{target:"leaf"}` == `{symbol:"leaf"}` (resolved by the shared validator) | honoured |
| empty `relationshipTypes` refused | door: `error: bb_impact relationshipTypes must name at least one relationship kind`; component: same refusal (not a silent re-read of the engine default) | fixed (component half was latent) |
| unknown options refused with teaching | door: `… unknown or irrelevant options: maxDepth — accepted options: symbol, relationshipTypes, file, refresh (aliases accepted: …)` | honoured |
| optional `file` hint resolves ambiguity and refuses when it cannot help | ambiguous `constructor` + `file:"src/two.ts"` → `resolution:{through:"owning-declaration", ownerName:"DerivedB", memberFile:"src/two.ts"}`; `file:"src/nope.ts"` → `bb_impact: symbol '…' resolves to 'src/one.ts' but the supplied file hint 'src/nope.ts' does not identify it — refusing to answer about a different copy …` | added (schema, handler, component messages, docs) |
| read tool does not mutate the index by asking | handler opens `getRawInstance(projectId,{readonly:true})`; T2 index files hashed before/after: identical | fixed |
| a default answer is BOUNDED IN WALL TIME, declared when the bound fires | hub `getRawInstance` (Lead's T2 baseline): p50 2 805 / p95 3 148 ms under the baseline protocol, p95 3 029 ms over 8 warm runs; the answer declares `truncated:true`, `walkTimeExhausted:true`, `walkTimeBudgetMs`, `totalCountIfKnown` (406, or null with `skipped:true` when the walk spent the call deadline) and `reproducible:false` | fixed (was 6 337/6 539 ms OVER budget) |
| twin `bb/impact` identical totals + truncation | `computeImpact` result JSON == `handleImpactRequest` result for leaf/Service/b1; MCP payload matches | honoured |
| deterministic identical calls | identical payload bytes for repeated calls on fixture graphs (the one machine-dependent bound is declared via `reproducible`) | honoured |
| freshness per dependent + root | tri-state per-dependent `stale`, `rootStale`, envelope, declared `autoRefresh` | honoured |

## 3 · Defects found, and their disposition

Severity is about what a caller could be told wrongly.

1. **D2 (MEDIUM, FIXED) — `truncated:true` while the tool's own measurement proved the set
   complete.** Fixture: 200 distinct dependents over 201 caller rows; the engine's per-query row cap
   dropped a duplicate call site, which is a collapsed ROW, never a truncated SET. The component kept
   the engine's reason and published a prefix claim against `total == shown`. Fixed in
   `src/lsp/impact.ts`: after the completeness measurement, a clean measurement whose total equals the
   returned set CLEARS the prefix claim (engine-bound state stays in
   `traversal.engineTruncated`/`engineTruncationReason`); a depth cap is exempt because the counting
   walk shares it. P1 asserts the biconditional in both directions.
2. **D3 (MEDIUM, FIXED) — the component accepted `relationshipTypes: []` and measured two different
   rules.** The graph engine substitutes its DEFAULT kind list for an empty list, while the counting
   walk used the literal empty list; measured: 6 default dependents vs 7 with `[]` (byte-identical to
   the explicit all-kinds list), and with the count walk forced: `totalCountIfKnown:0`,
   `directCount:0` while `shownCount:5`. Fixed: `computeImpact` refuses an empty list with a named
   error; `countImpactDependents` gained a `failed` flag so a refused query yields BOTH counts null
   and a declared "measurement unavailable" clause instead of a measured zero.
3. **D4 (MEDIUM, FIXED) — docs said an ambiguous requested NAME is a declared error.** Measured: an
   ambiguous traversable name IS answered (engine gravity pick, `rootMatch.nameMatches` discloses the
   ambiguity); only ambiguous MEMBER names without a usable hint are refused. The tool also had no way
   to disambiguate the way the editor twin does. Fixed: curated text states the real behaviour; an
   optional `file` property was added, wired to `computeImpact`'s member-identity hint, and refuses an
   unusable hint (unknown path, wrong copy) with teaching text.
4. **D5 (LOW, FIXED) — docs: "declared-absent result" for unknown symbols.** Actual is a loud
   `isError:true` declared error; the Returns bullet was corrected.
5. **D6 (LOW, FIXED) — self-contradicting `reproducible` documentation and stale engine-budget
   comments.** The page said the engine still had a 2 000 ms default budget while its own Limitations
   bullet said it has none; `src/lsp/impact.ts` comments narrated the retired budget. The engine
   default is `DEFAULT_WALK_TIME_BUDGET_MS = 0`, and this tool passes no clock to the walk; only the
   counting walk's 4 000 ms breaker can make an answer unreproducible. Comments and page corrected.
6. **D7 (LOW, FIXED in docs) — "depth (5)" read as maximum reported depth.** It is an EXPANSION cap:
   direct dependents are `depth:0`, so the deepest reported dependent is `maxDepth-1` (4), and the
   completeness measurement shares the cap. Schema, rule, both doc sections now say this.
7. **D8 (LOW, FIXED) — doubled error prefix.** `bb_impact: bb/impact: symbol …` is now a single
   `bb_impact:` prefix; the LSP twin's `bb/impact:` machine contract is untouched.
8. **D9 (LOW, DOCUMENTED) — `relationshipTypes` is not validated against the stored-kind vocabulary.**
   A misspelled kind is measured as an empty set with `truncated:false`; the rule echo makes the typo
   auditable rather than disguised as "no dependents". Documented as a limitation instead of inventing
   a second validator that could disagree with the store.
9. **D-P2 (HIGH for the campaign, FIXED) — the m48/P2 honesty-field scanner could never go red after
   the module split, and even before it could not fire on ordinary code.** Two independent causes:
   (a) `BUILDER_FILES` listed the old aggregate handler file (now a 53-line assembler with zero
   builder fields) and no `src/mcp/tools/**/handler.ts`, so the audit scanned an empty coverage set;
   (b) the dynamic-assignment regex used a lookahead that BACKTRACKED into the whitespace after `:`, so
   every spaced `key: value` counted as dynamic and only the unspaced `key:false` shape could be
   flagged. Fixed in `script/m48/verify-p2-honesty-fields.ts`: builders are DISCOVERED from the split
   layout (16 handlers) plus the shared builder modules, a non-empty-coverage predicate and a
   watchlist-assignment witness are asserted, the scanner is a pure function over source text, and a
   planted hollow field is the gate's own negative case. Final: 21 checks, 7 negatives, audited 35
   files / 16 handlers.
10. **D-P4 (cross-scope, Lead-owned) — m48/P4 registry scrape broke at the split** (`registry surface
    yields exactly 16 tools — 0`). Lead repaired the registry-surface half; the remaining red is the
    parameter matrix being stale mid-integration (`matrix covers every registry row`), which the Lead
    regenerates at integration. Not edited here.
11. **D-D1 (cross-scope, accepted) — three generated artifacts stale post-split**
    (`docs/data/public-tools.json`, `docs/tools/bb_cross_language.md`,
    `website/src/data/tools.generated.ts`). Expected mid-flight; the per-tool page
    (`--only bb_impact`) is current. Not chased.
12. **D-P3 (cross-scope gate assumption, fixed in this gate) — P3 compared truncation flags across two
    different default depths.** `bb_graph` defaults to `maxDepth:5`, `bb_analyze` caller modes run at
    `maxDepth:3` with their own clock ceiling; the flags disagreed with identical `totalCallers`
    (graph `false`, analyze `true` `caller-depth-cap-reached`). Fixed the gate to ask the SAME question
    (`direction:"callers", maxDepth:3`) for that predicate; the impact half of P3 was green
    throughout.

13. **D14 (HIGH, FIXED) — a real hub breached the tool's 5 000 ms T2 budget.** The Lead's common T2
    harness measured default `bb_impact {symbol:"getRawInstance"}` at p50 6 337 / p95 6 539 ms on the
    shared reference index. Reproduction and breakdown showed the cost was NOT the walk (2.0–2.5 s) and
    not serialisation (171 KB in 1 ms): the completeness walk's LEVEL query was
    `target_symbol_id IN (SELECT m.id … WHERE m.id IN (batch) OR owner-range predicates)`, and with the
    OR'd range predicates inside the subquery SQLite abandoned the target index. ONE level-1 batch of
    200 measured 4 349.5 ms; the same 137 rows via a flat, target-indexed id list measured 4.1 ms.
    Two changes fixed it: (a) the level query is now a flat target-id list — cascade-range members are
    resolved first through `brain_symbol_project_owner_idx`, then the relationship query is driven by
    `brain_rel_proj_type_target_idx` and chunked so the clock can stop between statements; (b) the
    component now declares two wall-clock deadlines — `IMPACT_WALK_TIME_CEILING_MS` (1 500 ms) passed
    to the engine walk and `IMPACT_CALL_DEADLINE_MS` (3 000 ms) for the component's own work — published
    in `budget`, with `traversal.walkTimeExhausted`/`walkTimeBudgetMs`, `countVerification.skipped`, and
    `reproducible:false` when either fires. Nothing about the budget was widened and no incomplete
    answer is unlabelled: the hub answer is a declared prefix with a MEASURED total when the measurement
    fits, and a declared skip when it does not. Before: p50 6 337 / p95 6 539 ms. After (baseline
    protocol: one warm-up + three measured runs): p50 2 805 / p95 3 148 ms; 8 warm runs p95 3 029 ms;
    index files byte-identical after the run (`dbUnchanged:true`). Gate coverage: P1 asserts the declared
    deadlines and the ran/skipped declaration on every root, and mutant M-T1 proves dropping the walk
    deadline turns P1 red.

**Measurement correction (important).** An early Phase-A pass measured T2 through READ-WRITE opens on
a pre-fix index/planner state and recorded 13.7–359.5 s per default call; a hand-built comparison
attributed that to the graph engine's owner-cascade JOIN form (10 351 ms vs 12.5 ms flat, "830×").
After the owner-range index landed on disk (`brain_symbol_project_owner_idx (project_id,
owner_symbol_id)` → planned with `brain_rel_proj_type_target_idx`), the same JOIN form answers in
1.1–1.2 ms and the whole walk in 40–63 ms; the full handler tier is p95 153.6–327.7 ms. The earlier
numbers are retained in `latency-t2.json` / `latency-t2-query-cost.json` as the evidence for why the
owner-range index exists, NOT as a current product metric. This correction was routed to the
Lead/graph owner.

## 4 · Gates — final table (serial runs, commands and exits)

| gate | command | exit | result |
|---|---|---|---|
| typecheck | `npx tsc --noEmit` | 0 | clean |
| m48 P1 impact unity | `npx tsx script/m48/verify-p1-impact-unity.ts` | 0 | PASS 80/0/6, evidence `validation/m48/results/P1.json` (`verified`) |
| m48 P2 honesty fields | `npx tsx script/m48/verify-p2-honesty-fields.ts` | 0 | PASS 21/0/7, evidence `P2.json` (`verified`), 35 builders / 16 handlers |
| m48 P3 agreement | `npx tsx script/m48/verify-p3-agreement.ts` | 0 | PASS 30/0/5, evidence `P3.json` (`verified`) |
| m48 P4 param matrix (Lead's) | `BB_M48_READ_ONLY=1 npx tsx script/m48/verify-p4-param-matrix.ts` | 1 | registry surface now 16 ✓; red only on stale parameter matrix (Lead regenerates at integration) |
| m48 C2 edge mutations | `BB_M48_READ_ONLY=1 npx tsx script/m48/verify-c2-edge-mutations.ts` | 0 | PASS 73/0/3 |
| m48 H1 ghosts | `BB_M48_READ_ONLY=1 npx tsx script/m48/verify-h1-ghosts.ts` | 0 | PASS 741/0/5 |
| m48 D1 doc truth | `BB_M48_READ_ONLY=1 npx tsx script/m48/verify-d1-doc-truth.ts` | 1 | red only on the three Lead-owned generated artifacts; `docs/tools/bb_impact.md` current |
| m44 U5 impact resolution | `npx tsx script/m44/verify-impact-resolution.ts` | 0 | VERIFIED 33/33, 5/5 mutants (evidence restored byte-exactly) |
| m28 T1 MCP tools | `npx tsx script/m28/verify-mcp-tools.ts` | 0 | VERIFIED 26/26, 2/2 mutants (evidence restored) |
| m26 W5 impact mode | `npx tsx script/m26/verify-impact-mode.ts` | 0 | VERIFIED 29/29, 20/20 mutants (evidence restored) |
| regex policy | `npx tsx script/tools/verify-regex-policy.ts` | 0 | PASS — no owned-file regex; allowlist empty |
| docs (scoped) | `npx tsx script/verify-tool-docs.ts --only bb_impact` | 0 | page current |
| MCP stdio door | `npx tsx validation/tools/bb_impact/work/probe7-mcp-door.ts` | 0 | 16 tools; params `symbol, relationshipTypes, file, refresh`; success/alias/refusals/unknown-symbol/hint-mismatch all as declared |
| m48 C1 corpus | not re-run | — | blocked leg: indexes 5 real repositories and writes shared evidence; committed `C1-bb_impact` evidence is `verified` (5 corpora `ok`, 4/4 cross-checks) |
| m48 L1 / X1 | not run | — | L1 needs smoke evidence at HEAD; X1 re-runs the chain and is blocked by the stale P4 matrix |
| m55 V1 live surface | not run | — | blocked leg: `rigPreflight()` missing `Xvfb`, `xdotool`, `import` and the declared external fixture `/home/ishaq2321/bb-demo-hub`; running it would also rebuild the shared `dist/` and write shared m55 evidence (proof `work/m55-preflight.log`) |

## 5 · Planted mutants — every one red on the expected assertion, then green on restore

`validation/tools/bb_impact/MUTANTS.json` + runner `validation/tools/bb_impact/work/run-mutants.ts`.
Each mutant is written into the real source, its gate is run with `BB_M48_READ_ONLY=1`, the file is
restored byte-exactly (sha256 checked), and the final run proves both gates green on the restored
tree. Final suite: **13/13 mutants red on the expected assertion, all restored exactly, baseline P1
exit 0 / P2 exit 0.**

| mutant | defect planted | gate | expected red assertion |
|---|---|---|---|
| M-B1 | node budget widened (`maxNodes + 1000`) | P1 | "a >200-dependent hub is capped at the declared node budget" — shown=233 budget=200 |
| M-B2 | total inferred from the returned set (`total = impact.length`) | P1 | "measured a larger total" |
| M-B3 | prefix declared complete (`truncated=false` on the shorter-set branch) | P1 | "truncated:true" |
| M-B4 | scan ceiling ignored (`total = found.size`) | P1 | "declared unknown past its scan ceiling" |
| M-C1 | `via` collapsed to `"exact"` (owner-cascade attribution dropped) | P1 | "attributed through the owner cascade" |
| M-C2 | cascade composition fabricated (`{exact: impact.length, member: 0, rangeFolded: 0}`) | P1 | "attributed through the owner cascade" (composition sum no longer matches) |
| M-H1 | empty `relationshipTypes` accepted (component) | P1 | "REFUSES an empty relationshipTypes list" |
| M-H2 | completeness clearing removed (stale prefix claim) | P1 | "a row cap that hid no dependent is NOT a set truncation" |
| M-H3 | `countVerification.complete` hardcoded true | P1 | "completeness measurement disagrees with a capped set" |
| M-H4 | refused counting rule reported as `failed:false` | P1 | "marks a refused rule as failed, not as zero" |
| M-H5 | `file` hint silently dropped in the handler | P1 | "the hint resolves the member through its owning declaration" |
| M-T1 | the declared walk deadline is dropped (`timeBudgetMs` removed) | P1 | "traversal declares the walk deadline it applied" |
| M-P2 | a builder publishes `{truncated:false, declaredAbsent:false}` | P2 | "no hollow completeness field in any tool output builder" |

Note on the first red run of the node-budget mutant: it initially could NOT go red because the
fixture's dependents were capped by the engine's per-query row limit, so the tool's own budget never
bound. A wide-hub fixture (199 direct callers + two indirect callers for 50 of them, ~233 distinct
dependents) was added to P1 so the 200-node budget — not an engine row cap — is the bound the mutant
violates. That is the difference between a gate that exists and one that can fail.

## 6 · Latency (charter §6 — warm, 5 runs; full data in LATENCY.json)

| tier | subject | p50 | p95 | budget | verdict |
|---|---|---|---|---|---|
| T0 | `test/fixtures/polyglot/ts-js` | 83.8 ms | 100.8 ms | 250 ms | inside |
| T1 | `.perf-fixtures/bb-scale/n100` (100 files) | 176.5 ms | 243.5 ms | 1 000 ms | inside |
| T2 | workspace reference index (11,440 files, ~3.4 GB), BYTE-READ-ONLY | worst 284.2 ms | worst 327.7 ms | 5 000 ms | inside; `dbUnchanged:true` (all three index files byte-identical before/after) |
| T2-hub | same index, Lead's baseline case `{symbol:"getRawInstance"}` (default args), baseline protocol | 2 805 ms | 3 148 ms | 5 000 ms | inside; 8-run series p50 2 923 / p95 3 029 ms; BEFORE the fix: p50 6 337 / p95 6 539 ms |

The hub case is the one that breached the budget and the one whose numbers are the regression baseline
for the fix: the answer is a DECLARED prefix (`shownCount=174`, `totalCountIfKnown=406` when the
measurement ran, `truncated=true`, `walkTimeExhausted=true`, `reproducible=false`), which is the
contract for a bounded default — not an unlabelled sample. Commands:
`BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/t2-hub-lead-protocol.ts`
(and `t2-hub-final.ts` for the 8-run series; breakdown in `t2-hub-breakdown.ts` / `t2-count-form.ts`).

T2 per symbol: `join` p50/p95 284.2/327.7 ms, `named` 185.2/321.2 ms, `refReachable` 62.6/236.0 ms,
`computeImpact` 42.9/153.6 ms. The walk's per-symbol caller query is planned through
`brain_symbol_project_owner_idx` for the owner range and `brain_rel_proj_type_target_idx` for the
relationship filter (plan captured in `latency-t2-final.json`). Commands:

```
BB_DATA_DIR=validation/tools/bb_impact/bbdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-local.ts
BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-t2-final.ts
BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-t2-query-cost-readonly.ts
```

## 7 · Blocked legs (authorized, with the exact command and why)

1. **m48 C1 corpus** — `npx tsx script/m48/verify-c1-corpus.ts`. Not re-run: it indexes five real
   repositories and writes shared evidence; the committed `C1-bb_impact` evidence is `verified`
   (5 repositories, 4/4 cross-checks). Blocked on a quiet integration window.
2. **m55 V1 live surface** — `npx tsx script/m55/verify-live-surface.ts`. Blocked: the gate's own
   `rigPreflight()` reports missing `Xvfb`, `xdotool`, `import` and the declared external fixture
   `/home/ishaq2321/bb-demo-hub` (PIL and `code` are present). Running it would also call
   `ensureServerBuilt()` against a stale shared `dist/` and write shared m55 evidence. Proof:
   `validation/tools/bb_impact/work/m55-preflight.log`.
3. **m48 P4 parameter matrix** — Lead-owned; registry-surface half repaired, matrix regeneration at
   integration.
4. **m48 D1** — Lead-owned generated artifacts; accepted as mid-flight.

## 8 · Authorship, regex, and comment contract (§7/§8/§9)

- **§8 headers** added to `src/lsp/impact.ts`, `src/lsp/impact_request.ts`,
  `src/intelligence/analysis/impact.ts`; already present on the split handler/descriptor/curation and
  the generated page.
- **§9 narrative removed** from every owned file: `src/lsp/impact.ts` went from 65 lines of
  milestone/issue/lane narrative to 0; handler, descriptor, curation, `impact_request.ts` and
  `analysis/impact.ts` are clean. The technical facts and every `owner` term were kept.
- **Regex: none owned.** No regex literal and no `new RegExp` in the tool's sources; SQL uses bound
  parameters and text operations are string methods. The empty allowlist is correct, and
  `script/tools/verify-regex-policy.ts` passes (0 new regex).

## 9 · Commits and evidence map

Commits carrying this tool's work (owner-authored, no agent trailers; blob paths and per-lane indexes
are gitignored): the component/gate/curation bulk landed through the campaign's integration commits,
with the Phase-B tail committed from this lane (the commit hash is reported to the Lead with this
record).

| file | what it is |
|---|---|
| `validation/tools/bb_impact/AUDIT.md` | this record |
| `validation/tools/bb_impact/LATENCY.json` | T0/T1/T2, warm, 5 runs, p50/p95, commands, index-hash proof, measurement correction |
| `validation/tools/bb_impact/MUTANTS.json` | 12 planted mutants: red run, expected assertion, restore hash, final green baseline |
| `validation/tools/bb_impact/latency-local.json`, `latency-t2-final.json`, `latency-t2-query-cost-readonly.json`, `latency-t2.json`, `latency-t2-breakdown.json`, `latency-t2-pinpoint.json`, `latency-t2-query-cost.json` | raw latency evidence (current + the historical pre-fix pass) |
| `validation/tools/bb_impact/work/*` | probes, gate logs, mutant runner, fixtures |
