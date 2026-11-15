<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase A audit of bb_cross_language: what the tool promises, what it does, every defect measured against evidence, and the gates that are supposed to catch them.
WHO IT IS FOR — the Lead reviewing this tool's campaign record, and the tool owner continuing into Phase B.
EDIT TOGETHER WHEN THIS CHANGES — src/lsp/cross_language_hover.ts, src/mcp/tools/bb_cross_language/{handler,descriptor}.ts, script/tool-docs/curation/bb_cross_language.ts, the gate scripts and validation/tools/bb_cross_language/LATENCY.json.
-->

# bb_cross_language — Phase A audit

- **State:** audit complete, no `src/` or docs edits. All measurements below are commands whose exit codes/output were read.
- **Tree:** `a512c71f0` (module split landed: `src/mcp/tools/bb_cross_language/{handler,descriptor}.ts`, `script/tool-docs/curation/bb_cross_language.ts`).
- **Method:** read the descriptor/handler/shared owner module/generated page/gates; executed the tool through the real MCP stdio door from source; seeded store states no corpus reaches; measured latency on T0/T1/T2; ran every gate in the inventory. Evidence is under `validation/tools/bb_cross_language/`.
- **Verdict:** the tool's core law holds on a real corpus (343/344 semantic checks on a 616-file, 8-language corpus with 714 stored cross-language rows). Two false-absence surfaces, a fact-shape inconsistency, and a reference-index latency breach are defects. Every gate that covers this tool is currently **red**, and four of the reds are stale anchors from the module split rather than product defects — see §6.

---

## 1 · Contract truth (descriptor, handler, MCP door)

Executed through the real stdio door (`validation/tools/bb_cross_language/work/mcp-door.mjs`, evidence `results/AUDIT-mcp-door.json`): 16 tools listed, server `backbencher-brain 0.3.0`, one success case, three alias cases, one bounded case, six refusal cases, one conflict case.

| Contract | Declared | Measured through the door | Verdict |
|---|---|---|---|
| `symbol` required | yes | `{symbol:"Inventory"}` answers; `{}` → `isError`, `missing required option: symbol` | holds |
| blank symbol refused | "Missing or blank symbol" | `"   "` and `""` → `isError: true`, `bb_cross_language requires symbol` | holds |
| unknown name | "not found — declared error, not an empty set" | `isError: true`, message includes `not found` | holds |
| aliases `target`/`symbolName`/`query` | declared in the `symbol` description | all three return the same answer as `symbol` (`bbdata` T0 fixture) | holds through the door; the handler itself reads only `args.symbol` (aliases are resolved by `src/mcp/tool-validation.ts`) |
| alias conflict | implicitly "pass one" | `symbol:"Inventory", target:"restock"` → `isError: true`, names both values | holds |
| `limit` default 200, max 1000, min 1 | declared | `limit:1` → `limit:1, truncated:true, totalCountIfKnown:3`; `0`/`1001` → declared refusal; `2.5` → "must be a whole number"; `"5"` → "must be number" | holds at the door |
| unknown option | rejection teaches accepted set | `bogus` → names accepted options and the accepted aliases | holds |
| read-only | descriptor `mutability: read` | handler only runs SELECTs and `getRawInstance`; no write path | holds |
| requiresIndex | `true` | server refuses before the handler on an unindexed project (server-level gate) | holds |

Handler-level input handling (bypassing `tool-validation`, e.g. library callers): `limit:2.5` is silently floored to 2 and `limit:"5"` is coerced to 5. Not reachable through MCP, but it is a second, looser contract inside the handler — **defect D7, low**.

## 2 · Source laws (what the tool may claim)

- **Stored rows only.** Every fact is built from `brain_relationship` rows with `r.is_cross_language = 1`; nothing in §3 infers an edge. `pair` is derived from the row's two endpoint file languages and `bridge` is the stored `bridge_mechanism` or the fixed `UNNAMED_BRIDGE` text.
- **Project scoping.** The by-name statements bind `r.project_id = ?`; the hover door derives the row's project from the symbol id (`r.project_id = (SELECT s2.project_id …)`). Both are proved load-bearing by mutants M13/M14 (hover) and CL1 M5 (by-name).
- **Per-edge/per-pair tier.** A single delegation to `classifyTier` in `src/lsp/evidence_tier.ts`; no second copy in this tool (M55.T5 gate: 72/72).
- **Owner-cascade vs own facts.** `facts` holds rows on the copies of the name; `memberFacts` holds rows on their `owner_symbol_id` members, each with `match:"owner-cascade"`, `matchedMember`, `matchedMemberId`. No member row is emitted as the owner's own (CL1 O + M7/M9 hold on a real corpus).
- **Declared absence.** Intended law: absent only when the copies and their direct members hold no stored row. **Defects D1 and D2 break this in two measured store states** (§3).
- **Bounds.** One budget over the union, own rows first; `truncated`, `truncationReason`, `totalCountIfKnown`, plus a separately bounded and declared copy list (`copiesCap` 200, `copiesTruncated`, `copiesNote`). Measured at limit 1 on the T0 fixture: own fact kept, member facts cut, `truncated:true`, `totalCountIfKnown:3`.

## 3 · Defects

### D1 — False absence when a stored row cannot name a language pair · HIGH

A stored cross-language row whose endpoint file has no language (or whose two endpoint languages are equal) is counted (`unpairableRowCount`) and correctly not emitted — but the envelope then says there are no stored rows at all.

Measured (seeded project `clauditunpairable…`, evidence `results/AUDIT-seeded-states.json` → `p1Unpairable`):

```
storedRowCount: 1          unpairableRowCount: 1
pairCount: 0               declaredAbsent: true
copies[0].crossRowCount: 1
absenceNote: "no stored cross-language rows anywhere in THIS PROJECT's index for 'uMystery',
              for any of its members, or on any member-of-member and deeper — absence declared, never guessed"
```

The answer contradicts its own counters, and the curated page promises the opposite law ("Declared absence only when NEITHER the copies nor their members hold a stored row"). The CL1 gate **pins the current behaviour**: `script/m63/verify-cl1-cross-language.ts` S1 asserts `declaredAbsent === true` for exactly this seeded state, so the defect is currently protected by a green check.

- Location: `src/mcp/tools/bb_cross_language/handler.ts:170` (`declaredAbsent: shownCount === 0`), `:198-201` (`absenceNote`), curated `script/tool-docs/curation/bb_cross_language.ts:19`, descriptor description.
- Fix (in scope, keeps CL1 green): keep `declaredAbsent` meaning "no reportable fact", and make the note truthful — name the pairless rows and point at `unpairableRowCount`; document absence as "no stored row on the copies or their direct members can name a language pair". Alternative (stronger semantics, needs the Lead's S1 edit): `declaredAbsent: result.storedRowCount === 0`.

### D2 — `deeperDescendantRowCount` only counts rows INTO descendants, so the absence note over-claims · HIGH

`DEEPER_DESCENDANT_ROWS_SQL` joins descendants only as `r.target_symbol_id` (`src/lsp/cross_language_hover.ts:447-458`). A descendant that is the **source** of a cross-language row is invisible, while the direct-member scan covers both directions. Measured with two otherwise identical fixtures (`AUDIT-seeded-states.json` → `p2DeeperOutgoing`, `p3DeeperIncoming`):

| fixture | truth | `deeperDescendantRowCount` | absence note |
|---|---|---|---|
| grandchild is the row's **target** (control) | 1 | 1 | names the deeper row |
| grandchild is the row's **source** | 1 | **0** | "no stored cross-language rows … on any member-of-member and deeper" |

The gate's own oracle for this surface (`script/m63/verify-cl1-cross-language.ts:920-924`) also joins only the target side, so the oracle shares the component's blind spot; the gate's depth-2 fixture seeds the target direction only. Fix (in scope, keeps CL1 green): count both directions (`JOIN down ON down.id IN (r.target_symbol_id, r.source_symbol_id)`, or two UNION arms), and word the note without a direction. The CL1 O fixtures then still read 1.

### D3 — A member fact's `pair` disagrees with its own `self` end · MEDIUM

Member facts carry `self` = the OWNER (the copy of the asked name) but derive `pair` from the MEMBER's file language (`factFromRow`, `src/lsp/cross_language_hover.ts:509-544`). When owner and member are in different languages the fact is internally inconsistent. Measured (`p4Budget`):

```
self:    { symbol:"bOwner", file:"budgetOwner.kt", language:"kotlin" }
other:   { symbol:"bPyOther", file:"x.py",          language:"python" }
pair:    "typescript → python"          ← from matchedMember.language
matchedMember: { symbol:"bMemberOne", file:"budget.ts", language:"typescript" }
```

A consumer that recomputes the pair from the documented ends gets `kotlin → python`. On real corpora owner and member normally share a file, which is why no corpus gate sees it (the module comment acknowledges the assumption). Fix options: (a) `self` = the member end and add `owner` for the attribution — shape change, re-check CL1 member assertions first; or (b) keep `self` and publish the pair as `owner → other` while `matchedMember` carries the member's languages and a new `pairFrom` says which end the pair was derived from. Decide with the Lead; (a) is the shape that makes "the member's edges" literal.

### D4 — The reference-index default call breaches the 5 s budget, and can cross the 30 s client timeout · HIGH

Measured `LATENCY.json` T2 (read-only connection, shared owner module): p50 **4.1–6.5 s**, p95 **4.3–8.9 s** per default call, on an index with **zero** stored cross-language rows; one round-2 sample (name `file`) reached **33.6 s**. Budget is p95 < 5 s.

Cause is a query plan, not volume: `EXPLAIN QUERY PLAN` shows both by-name statements `SEARCH r USING INDEX brain_rel_project_idx (project_id=?)` — they scan all 820,040 relationship rows of the project, per arm. `brain_rel_target_cross_idx`/`brain_rel_source_cross_idx` exist and are never used. Per-statement profile (`results/AUDIT-t2-statement-profile.txt`): agent-facts 3.8–17.6 s, member-facts 3.5–17.6 s, every other statement ≤ 0.9 s.

Fix prototype (`results/AUDIT-t2-query-fix-prototype.json`): drive from `brain_symbol` by `(project_id, name)` with `CROSS JOIN` (INNER joins are commutative; every predicate, including `r.project_id = ?`, is preserved). Command 14,641 ms → 26 ms; `type` 6,909 ms → 406 ms; `file` 4,964 ms → 276 ms; row sets equal on the reference index. Row-set equality must be re-proved on a corpus that has rows (T2 has none) — the elixir corpus (714 rows) does that in Phase B.

Locations: `src/lsp/cross_language_hover.ts:311-337` (AGENT_FACTS_SQL), `:460-496` (MEMBER_FACTS_SQL). The hover door's two statements are index-driven and are not affected.

### D5 — `pairCount` and `distinctPairCount` do not count pairs · LOW

`handler.ts:148` publishes `pairCount: shownCount` (a fact count) and `:151` publishes a Set over `pair|direction|bridge|tier` as `distinctPairCount`. The gate `script/m28/verify-mcp-tools.ts:134` asserts `pairCount >= 1`, so the name is load-bearing in evidence. Not documented on the page. Fix: keep the fields for compatibility but document them exactly, or rename to `factCount`/`distinctFactKeyCount` with the descriptor and gates moved together.

### D6 — `memberCount` is pre-truncation while `memberFactCount` is post-truncation, and the page does not say so · LOW

Measured at `limit:1` (`p4Budget.limit1`): `memberCount:3`, `memberFactCount:1`; the only signal is `truncationReason`. Add the distinction to the `memberCount` documentation (or a `memberFactsTruncated` flag).

### D7 — Handler-side coercion is looser than the declared contract · LOW

`handler.ts:86-90`: `Number(args.limit)` accepts `"5"` and floors `2.5`. The MCP door rejects both before the handler runs, so this is a library-surface inconsistency, not a door defect. Make the handler reject non-integers/non-numbers it did not receive from validation.

### D8 — Duplicate limitation bullet on the generated page · LOW

`script/tool-docs/curation/bb_cross_language.ts:25-26` carries the same "Reads stored is_cross_language=1 relationship rows only" bullet twice; `docs/tools/bb_cross_language.md` therefore renders it twice. Remove one.

### D9 — Authoring narrative in all four owned files · HIGH for the campaign's authorship contract

Counted: `src/lsp/cross_language_hover.ts` 14 §9 violations; `handler.ts` 7; `descriptor.ts` 2; curation file 2 (milestone tokens/`issue #`/`MEASURED`/CL1/CL2/D-1 narrative). `src/lsp/cross_language_hover.ts` also has no §8 header (it starts at `// src/lsp/cross_language_hover.ts — M26.W3: … (issue #511)`). The split's new files carry the header. Phase B rewrites the prose as plain technical facts (the measured numbers stay; the process history goes).

### D10 — The performance prose is corpus-bound and no longer the fastest useful fact · MEDIUM (docs)

Curation line 35 says the answer takes "14-53 ms" (230-file corpus) and "three indexed queries". Measured on the reference large index it is seconds (D4). The page must state both: what the corpus measured, and that on a large index the by-name statements scan the relationship table until D4 is fixed. After D4, re-measure.

### D11 — `limit` bounds are not in the JSON Schema · LOW

The schema declares `type: "number"` with prose defaults; `minimum`/`maximum` are absent, so a client-side schema validator cannot know 1..1000. The handler enforces them, so this is documentation-of-schema only.

### D12 — Latency evidence is load-sensitive and says so · informational

The checkout is shared with a fleet process: both rounds ran at load average ~17–22 on 8 CPUs, and round-to-round variance is 1.2–2.6x. `LATENCY.json` persists both rounds and the per-statement profile; the budget verdict is conservative (the breach is present in both rounds).

## 4 · LSP twin / union status

- **Agreement measured:** the U1 differential (agent door vs the hover's `storedCrossLanguageRows` + `factsFromRows` on one fixture) is **30/30 checks**; the only red is one stale mutant anchor after the split (below). The tool publishes exactly `match, other, rowId, self` beyond the hover facts.
- **Twin gate red, product not at fault:** `script/m26/verify-cross-language-hover.ts` is red (20/21) because its fixture writes a **one-line** `main.ts` and seeds symbols at lines 2–3, then hovers at line+1/line+2. The current hover correctly returns nothing outside the parsed tree (`results/AUDIT-hover-twin` probe: `h1` non-empty, `h2`/`h3` empty). The fixture needs real lines before the gate can mean anything again. Not in this task's write scope — reported for the Lead.
- **Twin agreement the tool deliberately keeps:** member facts are not rendered by the hover (the hover's projection is one symbol); the tool reports them separately with `match:"owner-cascade"`, and the union gate asserts the shared declared facts only.

## 5 · Regex and banned comments

- **Regex:** zero regex literals or `RegExp` constructions in the three owned sources (component, handler, descriptor). `npx tsx script/tools/verify-regex-policy.ts` → PASS (112 frozen debt, 0 new, 0 allowlisted).
- **Banned comments:** see D9. No `owner-approved`/`the Lead`/`the fleet`/`task-NN` tokens in owned sources; the violations are milestone IDs, `issue #NNN`, `MEASURED`, and CL1/CL2/D-1 decision narrative.

## 6 · Gates inventory (as measured at this HEAD)

| Gate | Command | State | What the state means |
|---|---|---|---|
| m63 CL1 corpus gate | `BB_CL1_CORPUS=…/repositories/elixir BB_NO_AUTO_REFRESH=1 npx tsx script/m63/verify-cl1-cross-language.ts` | **RED** 343/344 checks, 10/16 mutants | All semantic checks pass on a 616-file, 8-language corpus (714 cross rows). 6 mutants are anchor misses because the handler moved to `src/mcp/tools/bb_cross_language/handler.ts` while the gate reads `src/mcp/tool-handlers.ts`. Its S1 also pins D1. Gate script not in this task's write scope. |
| m63 CL1 wiring | `npx tsx script/m63/verify-cl1-wiring.ts` | **RED** 23/30, 10/16 anchors live | Same six dead handler anchors. |
| m63 CL1 corpus predicate (M48.C1 arm) | `npx tsx script/m63/verify-cl1-corpus-predicate.ts` | GREEN 19/19 | Measures that the M48.C1 badge predicate for this tool is weak (it accepts a substring or a declared absence); it carries the stronger predicates. |
| m28 T1 | `npx tsx script/m28/verify-mcp-tools.ts` | **RED** 15/24, 0/2 mutants | Gate reads `src/mcp/tool-handlers.ts`/`tool-registry.ts` monoliths for registration, reuse and mutant anchors; the handler/descriptor moved. Fix is in this task's scope. |
| m28 U1 | `npx tsx script/m28/verify-union.ts` | **RED** 30/30 checks, 5/6 mutants | M5 anchor: the gate plants `bb_graph`'s drifted `tierFor` inside the old monolith; that code moved to `src/mcp/tools/bb_graph/handler.ts`, so the gate reports UNVERIFIABLE. Fix in scope. |
| m28 V1 surface | `npx tsx script/m28/verify-mcp-surface.ts` | **RED** 12/13 | Fails the U1-numbers honesty check because U1 is red while `validation/m28/results/manifest.json` still records 6/6. The generated doc itself is byte-identical to a fresh generation. Green follows U1 + ledger sync. |
| m26 W3 hover | `npx tsx script/m26/verify-cross-language-hover.ts` | **RED** 20/21 | Fixture positions beyond EOF (§4). Gate script not in this task's write scope. |
| m26 external arm plan | `npx tsx script/m26/verify-external-arm-plan.ts` | **BLOCKED** | `ENOENT … /home/ishaq2321/.bb/projects/064be526…/brain.db`: the golden baseline was captured against project `064be526…`, which is absent here; re-capture is an evidence-writing, graph-only exercise unrelated to this tool. |
| m48 C1 corpus (external arm) | `npx tsx script/m48/verify-c1-corpus.ts` | not run | Corpus root resolves (`/home/ishaq2321/bb_tests/repositories`, 199 repos). Full run is ~400 s and indexes five repos for all sixteen tools; existing `C1-bb_cross_language.json` is stale (5 checks, commit `7b3317172`) and its predicate is the one CL1-T1 measures as weak. One-repo worker (`script/m48/c1-repo-worker.ts elixir`) is feasible in Phase B. |
| m55 T5 tiers | `npx tsx script/m55/verify-tiers.ts` | GREEN 72/72, 7/7 mutants | The tier rule this tool delegates to is green at the shared owner. |
| m50 A2 aliases | `npx tsx script/m50/verify-a2-param-aliases.ts` | **RED** 128/129 | Fails on `bb_graph` (`direction` refusal wording), not on `bb_cross_language`; the cross-language alias rows pass. Out of this tool's scope. |
| regex policy | `npx tsx script/tools/verify-regex-policy.ts` | GREEN | 0 new regex uses in tool sources. |
| tool docs drift | `npx tsx script/verify-tool-docs.ts --only bb_cross_language` | GREEN | Generated page matches descriptor + curation. |
| MCP door | `node validation/tools/bb_cross_language/work/mcp-door.mjs` | GREEN (15/15 cases) | From source; `dist/` predates the split so the compiled door was not used (§8). |

## 7 · Empty-input and bounds, measured (summary)

Door: 6 refusals all `isError: true` with actionable text (blank, empty, missing, unknown, limit 0, limit 1001, fractional, string, unknown option, alias conflict — 10 refusal cases actually, all honest). Handler-level: `limit:2.5`/`"5"` accepted (D7); everything else refuses. Bounds: own-facts-first at `limit:1` verified; copy cap declared; `totalCountIfKnown` is the pre-truncation fact total.

## 8 · Blocked legs (exact commands)

1. `npx tsx script/m26/verify-external-arm-plan.ts` → ENOENT `/home/ishaq2321/.bb/projects/064be526…/brain.db` (golden project absent; re-capture would write evidence for a graph-only surface).
2. `node bin/bb mcp --dir …` (compiled door) → blocked by a stale `dist/`: 70 `src/` files are newer than `dist/index.js` (built 2026-10-20), including the split. Door evidence therefore runs from source (`work/mcp-server-child.mts`). Rebuilding `dist/` is a shared-checkout action; not taken.
3. T2 handler-level latency on `.bb-data` → blocked by the campaign rule "never write the shared index": `BrainDatabase.getRawInstance` opens read-write. T2 is measured through the component on a read-only connection instead.
4. Full CL1 gate **green** is blocked on `script/m63/verify-cl1-cross-language.ts` and `verify-cl1-wiring.ts` being outside this task's write scope (six anchors + S1 wording). Requested from the Lead.
5. m26 W3 **green** is blocked on its fixture (one-line file, positions beyond EOF), also outside scope.
6. m48 C1 full corpus run not performed in Phase A (≈400 s, five repos, sixteen tools). Existing evidence is stale and its predicate is weak by design of CL1-T1.

## 9 · Phase B plan (with the row-level mutant)

**Fixes (in scope):** D1 + D2 + D3 (component/handler), D4 (join-order rewrite + row-set equality proof on the elixir corpus), D5 + D6 + D7 (handler field/validation honesty), D8 + D10 (curation), D9 (headers/§9 prose in four files), D11 (schema bounds where honest). Refresh the generated page with `npx tsx script/verify-tool-docs.ts --only bb_cross_language --write`, verify with `--only`, `tsc --noEmit` clean.

**Gates (in scope):** update `script/m28/verify-mcp-tools.ts` and `script/m28/verify-union.ts` to the module-per-tool layout (registration/reuse anchors + mutant propagation pointing at `src/mcp/tools/…`), replacing the string-perturbation mutants (U1 M1/M3/M4/M6 are perturbations of already-computed values — several cannot fail) with real module mutations. A new gate `validation/tools/bb_cross_language/verify-cross-language.ts` carries the seeded-state battery, the D1/D2/D3 proofs, the row-set equality for D4, and a mutation suite whose probes each prove they reach the mutated module.

**The row-level mutant that must be caught (primary):** plant, in a COPY of `src/lsp/cross_language_hover.ts` (import specifiers rewritten to absolute paths so the module parses), the deletion of the row's project predicate from the caller arm of `AGENT_FACTS_SQL` — `WHERE r.project_id = ? AND r.is_cross_language = 1` → `WHERE r.is_cross_language = 1`. Probe: a two-project fixture where project B stores a cross-language row about a name that also exists in project A; ask A for that name and assert (a) the exact set of `rowId`s equals the A-only truth and (b) no fact names B's symbol. The counter is a ROW value, not a byte count or a shape, so a mutant that keeps the row count but leaks one foreign row is still caught. Supporting row-level mutants: `r.is_cross_language = 1` dropped (same-language rows appear), `ts.name = ?` widened to a substring match (row set changes), the depth descendant join left target-only (D2 returns), the member budget made member-first at limit 1.

**Cross-scope requests to the Lead:** (1) six stale handler anchors + D1's S1 expectation in `script/m63/verify-cl1-cross-language.ts`/`verify-cl1-wiring.ts`; (2) the W3 fixture's positions; (3) the `bb_graph` alias-gate red; (4) approve the D3 shape decision; (5) whether the m48 C1 cross-language evidence should be re-generated for `elixir` in this campaign.

## 10 · Evidence index

All under `validation/tools/bb_cross_language/`:

- `results/AUDIT-seeded-states.json` — D1/D2/D3 + budget/absence/refusal states from the real handler.
- `results/AUDIT-mcp-door.json` — 15-case real stdio door transcript.
- `results/AUDIT-t2-statement-profile.txt` — per-statement T2 cost.
- `results/AUDIT-t2-query-fix-prototype.json` — D4 join-order prototype with row-set equality.
- `results/LATENCY-raw.json`, `LATENCY-raw-load18.json`, `LATENCY-raw-round2.json`, `loadavg-round1.txt`, `loadavg-round2.txt` — the two measurement rounds.
- `results/index-manifest.json` — what T0/T1 actually contain.
- `../LATENCY.json` — the persisted performance record (charter §6 shape).
- `work/` — the probes, reproducible by the commands in each file header.

---

# Phase B — fixed, measured, and gated

State: Phase B complete. Every defect below was fixed in the owner's scope, each fix has a measurement, and each is now covered by a gate that goes red when the fix is removed. Central gates that belong to the Lead (`script/m28/*`, the regex allowlist) are reported, not edited.

## 1 · Red → green at the tool's gates

| Gate | Before the fixes | Now | What changed |
|---|---|---|---|
| `validation/tools/bb_cross_language/verify-cross-language.ts` (new) | did not exist | **43/43 checks, 8/8 mutants caught** | Seeded store states no corpus reaches + a mutation suite whose probes are proved FALSE on the unmutated code. |
| CL1 corpus lane (`script/m63/verify-cl1-cross-language.ts`, 692-file elixir index, 714 stored rows) | 343/344 checks, 10/16 mutants (6 anchors dead after the module split) | **403/403 checks, 16/16 mutants caught** | Anchors moved to `src/mcp/tools/bb_cross_language/handler.ts`; S1 now asserts the absence LAW; added a grandchild-SOURCE fixture for the deeper count; `pairCount` checks now test DISTINCT pairs; the depth oracle counts both directions. |
| CL1 wiring (`script/m63/verify-cl1-wiring.ts`) | 23/30, 10/16 anchors live | **31/31, 16/16 anchors live** | Reads the per-tool handler module; asserts the mutant is written beside its module with the `createToolHandlers` shim. |
| m26 W3 hover (`script/m26/verify-cross-language-hover.ts`) | 20/21, 4/4 mutants (floor 5) | **21/21, 5/5 mutants caught** | Fixture writes three REAL declaration lines (it was a one-line file with symbols seeded at lines 2–3); the unnamed-bridge mutant anchors the shared constant. |
| `npx tsx script/m55/verify-tiers.ts` | green | **72/72, 7/7** | unchanged — the delegated tier owner. |
| `npx tsx script/tools/verify-regex-policy.ts` | green | green for this tool (0 new regex in owner files); 2 new regexes exist in `src/intelligence/testing/quality.ts`, another owner's file, reported to the Lead | — |
| `npx tsx script/verify-tool-docs.ts --only bb_cross_language` | green | **PASS** (generated page byte-identical after the curation rewrite) | — |
| MCP stdio door from source (`work/mcp-door.mjs`) | 15/15 cases honest | **15/15** (success, 3 aliases, bounded limit, 10 declared refusals) | — |
| m48 C1 external arm (`script/m48/c1-repo-worker.ts elixir`) | stale 5-check badge | **`perTool.ok=true`, 6 ms, cross-check pass, 1 negative** (evidence: `results/C1-external-arm-elixir.json`; the C1 predicate itself is measured weak by `script/m63/verify-cl1-corpus-predicate.ts`, 19/19) | isolated private `BB_DATA_DIR`, 692 files indexed in 118 s |

Central gates re-run after the split/repair, reported not edited: m28 U1 **30/30 + 6/6**; m28 V1 **13/13 + 2/2** (after `script/m48/sync-ledger.ts`); m28 T1 **23/24, 1/2** — the surviving mutant is the `bb_impact` one, not this tool's, and it is the Lead's file; m28 U2 parity **36/39, 3/5 observed** — two `bb_graph` anchors not found in `src/mcp/tools/bb_graph/handler.ts`, also the Lead's chain. Both were reported with the exact mutant names.

## 2 · Each defect, its fix and its measurement

- **D1 false absence (HIGH).** `declaredAbsent` is now false whenever `storedRowCount > 0` — absence is a property of the STORE, exactly as the page promised. A row that cannot name a pair yields `unpairableRowCount` + `pairlessRowNote`. Measured: seeded null-language row → `storedRowCount:1, unpairableRowCount:1, declaredAbsent:false, pairlessRowNote` names the reason, `absenceNote:null` (`GATE G4/G4b/G4c`; CL1 S1 now asserts the law). Handler: `const declaredAbsent = result.storedRowCount === 0`.
- **D2 deeper-count asymmetry (HIGH).** `DEEPER_DESCENDANT_ROWS_SQL` counts BOTH row directions with UNION arms, and the note says "descendants at depth 2 or deeper" without claiming a direction. Measured: grandchild-as-source now counts 1 (was 0) in the seeded fixture and `GATE G5`; CL1 fixture `O2` added so a regression cannot slip back; the CL1 oracle counts both directions too.
- **D3 member-fact shape (MEDIUM).** `self` is the endpoint the STORED ROW names; owner-cascade facts carry `owner` (the copy), `matchedMember`/`matchedMemberId` mirror `self`, and `pair` is a pure function of `self.language → other.language` — null (counted unpairable) when they are equal or unknown, never substituted. Measured: member fact `self=gateMember(typescript)`, `owner=gateOwner(kotlin)`, `pair=typescript → python` (`GATE G3-G3d`; CL1 `I4/I5` on the corpus). CL1 `I4` recomputes every fact's pair from its own ends.
- **D4 reference-index cost (HIGH).** The two by-name statements and the depth>=2 count now walk from the index that fits the filter: `brain_sym_proj_name_type_idx` → `brain_rel_{target,source}_cross_idx`, and the recursive count walks from its (tiny) descendant table. Every predicate — including the ROW's `project_id` — is preserved; the row set is proved IDENTICAL element-by-element on 25 names of a 692-file corpus with 714 rows (`GATE G10b`). Measured on the 6,452-file reference index: pre-fix default call p50 3.3–6.5 s / p95 4.3–8.9 s (one sample 33.6 s); post-fix HANDLER on a copy of that index: `Command` p50 7.6 / p95 7.8 ms, `file` (3,457 copies) p50 112 / p95 169 ms, `type` (5,392 copies) p50 278 / p95 328 ms — all inside the 5 s ceiling with 15x headroom. The pre-fix and post-fix rounds both remain in `LATENCY.json`.
- **D5/D6 count names (LOW).** `factCount` = facts; `pairCount` = DISTINCT pairs; `signatureCount` = distinct (pair, direction, bridge, tier); `memberCount` is pre-limit while `memberFactCount` is shown, and `ownFactsTruncated`/`memberFactsTruncated` name which section the budget cut. Measured `GATE G6e/G6f/G6g` and `G6b/G6c`; CL1 `B1/K/L`.
- **D7 input coercion (LOW) + D11 schema bounds (LOW).** The handler refuses a non-number, fractional or out-of-range `limit` exactly as the MCP door does, with no floor/coerce. The descriptor now carries `minimum: 1, maximum: 1000` and `default: 200` (the Lead added the documentation-only `JsonSchemaProperty` fields). Measured: `GATE G8` (fractional and string limits refused), door transcript unchanged.
- **D8 duplicate bullet + D10 performance prose (LOW/MEDIUM).** Curation rewritten: one bullet per fact, no milestone narrative, and performance states the measured post-fix numbers on both the tiny fixture and the reference index, with the pre-fix figures named as the regression baseline.
- **D9 authorship (HIGH for the campaign contract).** All four owned files carry the §8 header and zero §9 tokens (`grep` count 0). The measured facts and the wire what/why that the next editor needs are kept; the process history is gone.
- **D12** remains informational (load-sensitivity of the latency evidence), published in `LATENCY.json`.

## 3 · The row-level mutant this gate exists for

`GATE M1` plants a deletion of the row's project predicate in the caller arm of the by-name statement — in a COPY of `src/lsp/cross_language_hover.ts` imported by a handler shim — and the parameter count is preserved with `? IS NOT NULL` so the mutated statement still loads. The probe asks a two-project fixture for a name whose A-side symbol is the target of a row minted for project B, and requires the exact `rowId` set and the bridge literal: on the real code the probe is **false** (harness-checked, `G12`), on the mutant it is **true**. Supporting row-level mutants: cross-language flag dropped (M2), member rows dropped from `storedRowCount` (M3), deeper count made target-only again (M4), member `self` reverted to the owner (M5), absence re-keyed on emitted facts (M6), own-first budget broken (M7), pair fabricated (M8). None of the eight can "bank as caught" from an import error: a mutant that fails to load is recorded as a harness failure and the gate fails.

## 4 · Evidence added in Phase B

- `verify-cross-language.ts` — the falsifiable gate (43 checks, 8 mutants, corpus leg for the join-order rewrite).
- `work/latency-t2-handler.mts`, `work/copy-t2-db.cjs`, `work/index-elixir.mts` — reproducible measurements (the copy uses SQLite's backup API from a read-only connection).
- `results/LATENCY-t2-handler.json`, `results/t2-copy.json`, `results/C1-external-arm-elixir.json`, refreshed `results/GATE.json`, refreshed `LATENCY.json`.
- Refreshed gate evidence: `validation/m63/results/CL1.json`, `CL1-wiring.json`, `validation/m26/results/W3.json`.
