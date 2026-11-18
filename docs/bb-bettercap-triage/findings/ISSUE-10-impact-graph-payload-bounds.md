# ISSUE-10 — Impact/graph payload bounds: bloat, units, and bounds-after-data

Lane: `payload-honesty`. Issue 10 of 12. Date: 2026-11-18 (UTC).
Product: repo `/home/ishaq2321/mcp/backbencher-brain`, HEAD `be4c0ef25`, `node bin/bb --version` = `0.1.6`.
Specimen: bettercap index projectId `4c7590f1cba319aac298a50453c0ec440f2dc857` (1973 files, 55,785 symbols).
Raw evidence: `docs/bb-bettercap-triage/evidence/payload-honesty/` (index below).
Read-only: no product source edited, bettercap not reindexed, no writes to bettercap.

## Verdict

**REAL-BUT-MISDESCRIBED** (composite), severity **medium** — high for hub symbols whose payload
crosses a host's cap. Confidence **high**.

The *class* is real and reproduced at HEAD: graph payloads reach **1,087,986 bytes (>1 MB)** on a
hub symbol, all bounds/totals sit at **99.5–99.9% of the payload**, and many hosts cap or truncate
tool results — so the answer's own truncation declaration is the first thing lost. But the report's
two headline *mechanisms* are misdescribed, and adjudicating them as a budget violation would buy
the wrong fix:

| # | Sub-claim (report) | Verdict | What is actually true |
|---|---|---|---|
| a | “Impact returned `returnedCallers: 345` against a declared `maxNodes: 200`” (i.e. budget violated) | **REAL-BUT-MISDESCRIBED** | Two different quantities in one payload, and the node budget **is** enforced. `345` is `traversal.returnedCallers` = the graph engine's caller **ROW** (call-site) count; `budget.maxNodes: 200` bounds the **dependent NODES** in `impact[]`. On the exact payload: `shownCount: 200` = `budget.maxNodes: 200`, `truncated: true`, `truncationReason: "impact-node-budget-exhausted"`. Also, `maxNodes` is not a caller input at all (see refusal below); it is a fixed component budget echoed in the payload. |
| b | “Impact returned ~137 KB” | **PARTIAL** | Size class reproduces; the exact byte count does not. HEAD: `New` = **107,538 B**, `Session` = **188,433 B**, `LoadModules` = 3,858 B. 137 KB lies between New and Session (different symbol or build drift). |
| c | “Graph returned ~962 KB before host truncation” | **REAL (class), number drifted** | HEAD: `bb_graph New` = **547,273 B**; `bb_graph Session` = **1,087,986 B** (~1.04 MiB — *larger* than the report's ~962 KB, so the direction is understated, not over). `bb` itself has no output cap (no truncation limit in `bin/bb`/`src/cli`); the cap is the consuming host's. |
| d | “A summary at the top is still missing — the bounds are only visible after the data, so truncation hides them.” | **PARTIAL → REAL for the decisive fields** | For `bb_graph`: fully true — `summary` (the only place `totalCallers/truncated/truncationReason/edgeLimit/maxEdges/callerBudget` live) is at byte **1,084,878 of 1,087,986 (99.71%)**. For `bb_impact`: `budget`, `traversal`, `countVerification` *do* precede the data (1,009–1,224 B, ~1%); but the decisive top-level fields `shownCount/directCount/totalCountIfKnown/truncated/truncationReason` are at **99.73–99.81%**, after the `impact[]` array. A host cut at 150,000 B of the 188,433 B Session answer contains **zero** occurrences of `"truncated"`, `"shownCount"`, `"totalCountIfKnown"` (evidence `TRUNCATION-HIDES-BOUNDS.txt`). |

**Net adjudication:** not a budget violation and not evidence that a bound is being exceeded —
`shownCount <= budget.maxNodes` holds on every capture. The real defects are (1) **units are
unlabelled** so two legitimate counts read as a contradiction (`returnedCallers` vs `maxNodes`),
(2) **payloads are too large** for many hosts, and (3) **the honesty block is ordered after the
bulk data** so it is precisely what a host cap removes. All three are contract-shaped defects
against a tool whose own documentation sells “declared bounds / truncation as a first-class field”.

## Reproduce

```bash
cd /home/ishaq2321/mcp/backbencher-brain
E=docs/bb-bettercap-triage/evidence/payload-honesty
# impact: default, three symbols
node bin/bb tool bb_impact --dir /home/ishaq2321/bettercap --args '{"symbol":"New"}'        > $E/impact-New-default.json
node bin/bb tool bb_impact --dir /home/ishaq2321/bettercap --args '{"symbol":"Session"}'    > $E/impact-Session-default.json
node bin/bb tool bb_impact --dir /home/ishaq2321/bettercap --args '{"symbol":"LoadModules"}'> $E/impact-LoadModules-default.json
# is maxNodes a caller input? (it is not)
node bin/bb tool bb_impact --dir /home/ishaq2321/bettercap --args '{"symbol":"New","maxNodes":5}'   # exit 1
node bin/bb tool bb_impact --dir /home/ishaq2321/bettercap --args '{"symbol":"New","maxNodes":50}'  # exit 1
# graph: default + explicit small bounds
node bin/bb tool bb_graph --dir /home/ishaq2321/bettercap --args '{"symbol":"New"}'   > $E/graph-New-default.json
node bin/bb tool bb_graph --dir /home/ishaq2321/bettercap --args '{"symbol":"Session"}' > $E/graph-Session-default.json
node bin/bb tool bb_graph --dir /home/ishaq2321/bettercap --args '{"symbol":"New","edgeLimit":5,"maxEdges":50}' > $E/graph-New-small-bounds.json
# where do bounds sit? (byte offsets)
python3 - <<'PY'   # full script output: $E/BYTE-OFFSETS.txt
import re
for f in ['impact-New-default.json','impact-Session-default.json','graph-New-default.json','graph-Session-default.json']:
    b=open('docs/bb-bettercap-triage/evidence/payload-honesty/'+f,'rb').read()
    print(f,len(b))
    for n in [b'"impact"',b'"shownCount"',b'"summary"',b'"truncated"',b'"truncationReason"']:
        i=b.find(n); print('  ',n,i, f'{100.0*i/len(b):.2f}%' if i>=0 else '')
PY
# does a host-style cut keep the declaration?
head -c 150000 $E/impact-Session-default.json | grep -c '"truncated"'      # 0
head -c 900000 $E/graph-Session-default.json  | grep -c '"summary"'        # 0
```

The `maxNodes` refusal (both runs, exit 1, 167 B on stderr):

```text
error: bb_impact: unknown or irrelevant options: maxNodes — accepted options: symbol, relationshipTypes, file, refresh (aliases accepted: target, symbolName, query)
```

## Observed (bounded raw output, HEAD)

`bb_impact` top-level key order — every capture has this exact order:

```text
symbol, root, rootStale, rootMatch, resolution, rule, budget, traversal, cascade,
countVerification, reproducible, impact[array], shownCount, directCount,
totalCountIfKnown, truncated, truncationReason, freshness
```

| capture | bytes | shownCount | directCount | totalCountIfKnown | truncated / reason | traversal.returnedCallers | budget.maxNodes |
|---|---|---|---|---|---|---|---|
| impact New | 107,538 | 117 | 89 | 337 | true / `traversal: caller-budget-exhausted` | 117 | 200 |
| impact Session | 188,433 | **200** | 177 | 1046 | true / `impact-node-budget-exhausted` | **345** | 200 |
| impact LoadModules | 3,858 | 2 | 2 | 2 | false / null | 2 | 200 |

`impact Session` `traversal` (verbatim): `{"depthReached":3,"engineTruncated":true,
"engineTruncationReason":"caller-site-limit+caller-depth-cap-reached+caller-budget-exhausted",
"edgeLimit":200,"cappedQueries":1,"callersIfUncapped":335,"returnedCallers":345,...}`.
So the report's `345` and `200` coexist on one answer: `shownCount` is exactly at the node budget,
`returnedCallers` is an engine row count above the per-query `edgeLimit:200` + depth cap. Neither
number is a bound violation; the units are simply not stated next to the numbers.

`bb_graph` top-level key order — every capture:

```text
symbol, root, callers[array], callees[array], summary, provenance
```

| capture | bytes | callers | callees | `summary` byte offset | `summary.truncated` | bounds declared only in summary |
|---|---|---|---|---|---|---|
| graph New | 547,273 | 144 | 285 | 544,319 (**99.46%**) | true / `caller-budget-exhausted+callee-depth-cap-reached+callee-budget-exhausted` | `totalCallers/totalCallees/edgeLimit:200/maxEdges:1000/callerBudget:50/maxDepth:5/maxDepthReached:4` |
| graph Session | **1,087,986** | 466 | 377 | 1,084,878 (**99.71%**) | true / 6 reasons incl. `caller-budget-exhausted` | `callersIfUncapped:650/calleesIfUncapped:217/edgesInBothDirections:4` |
| graph New `{edgeLimit:5,maxEdges:50}` | 41,718 | 8 | 24 | 38,823 (93.06%) | true / `caller-site-limit+callee-site-limit-at-depth` | `callersIfUncapped:91` |
| graph axios `dispatchRequest` (JS) | 486,771 | 127 | 215 | 482,723 (**99.17%**) | true / `caller-depth-cap-reached+…` | same fields |

Note the small-bounds case: raising/lowering declared bounds works (`edgeLimit`/`maxEdges` honored),
and `maxEdges:5000` on New returns the *same* 547,273 B because the per-direction `callerBudget:50`
/ `calleeBudget:50` fan-out bound is what bit, not `maxEdges` — a second units question the payload
only answers inside the late `summary`.

## Expected vs observed

- **Expected (documented):** `docs/tools/bb_impact.md:56-57` — “truncation as a first-class field
  with reason”; the declared limits “from the component that owns them: `budget` (node budget 200 …)
  and `traversal` (…)”; and explicitly: “The engine's row bounds are **not truncations of the
  DEPENDENT set** … its per-query site limit, its capped-query count, its **returned caller rows**”.
  `docs/BB_IMPACT.md:40-44` — “The declared budget (`budget`): node budget 200 …”; `:63-66` —
  “`directCount` (depth-0 dependents) and `totalCountIfKnown` (the transitive total under the same
  rule)”; `:103-105` — engine row bounds are not truncations. `docs/tools/bb_graph.md:90-101` —
  `summary.maxEdges`/`totalEdgeLimitReached`/`truncated`/`callerBudget` are the declared bound fields.
  **No document states a position/ordering contract for the summary block**, and no document calls
  `returnedCallers` a bound on dependent nodes.
- **Observed:** bounds are declared (correctly) but the fields a caller must read first are last;
  hub graph payloads exceed 1 MB; `traversal.returnedCallers` sits next to `budget.maxNodes` with no
  unit marker, and the tool has no `maxNodes` input at all.
- **Root of the report's reading:** `impact Session` shows `maxNodes: 200` (budget) and
  `returnedCallers: 345` (traversal) in the same JSON object; read as one unit, that looks like a
  345-node set against a 200-node budget. It is not: `impact.length == 200 == budget.maxNodes`
  and `truncated` names the node-budget break. Verdict on that sub-claim: **REAL-BUT-MISDESCRIBED**,
  and the report's suggested cause (“budget violated”) is **FALSE**.

## Root cause (file:line, quoted)

1. **The node budget is real and enforced — so 345>200 is not a violation.**
   `src/lsp/impact.ts:120-125`:

   ```ts
   export const IMPACT_BUDGET = {
     /** maximum reverse-dependency nodes in one impact set */
     maxNodes: 200,
     /** traversal depth cap (mirrors the engine's own hard cap of 10) */
     maxDepth: 5,
   } as const
   ```

   `src/lsp/impact.ts:1081-1085` (loop over distinct caller nodes):

   ```ts
   if (impact.length >= IMPACT_BUDGET.maxNodes) {
     truncated = true
     truncationReason = "impact-node-budget-exhausted"
     break
   }
   ```

   `src/lsp/impact.ts:1436` (`shownCount: impact.length,`), and `:1455`
   (`returnedCallers: summary?.totalCallers ?? null,`) with the field documented at `:216-218` as
   “The engine's root caller rows RETURNED before any pump truncation dropped duplicates — the count
   behind the returned prefix.” `budget.maxNodes` is echoed from the component at
   `src/lsp/impact.ts:1438-1446`.

2. **No `maxNodes` input on bb_impact** (this is why the report's “declared maxNodes” cannot be
   caller-adjusted): `src/mcp/tools/bb_impact/descriptor.ts:20-29` declares only
   `symbol`, `relationshipTypes`, `file`, `refresh`; the shared validator rejects anything else —
   observed above as `unknown or irrelevant options: maxNodes — accepted options: symbol,
   relationshipTypes, file, refresh`.

3. **Bounds-after-data is a hand-ordered JSON literal, not a shared envelope.**
   `src/mcp/tools/bb_impact/handler.ts:160-192` builds the result inline and puts the dependent
   array *before* every summary count:

   ```ts
   return textResult(
     JSON.stringify(
       {
         symbol,
         root: impact.root,
         ...
         budget: impact.budget,          // line 169
         traversal: impact.traversal,    // line 170
         ...
         impact: dependents.map(...),    // line 181  <-- bulk data first
         shownCount: impact.shownCount,  // line 182
         directCount: impact.directCount,// line 183
         totalCountIfKnown: impact.totalCountIfKnown, // 184
         truncated: impact.truncated,    // line 185
         truncationReason: impact.truncationReason,   // 186
         freshness: ...                  // line 187
       }, null, 2))
   ```

   `src/mcp/tools/bb_graph/handler.ts:199-287` does the same, with `summary` after BOTH edge arrays:

   ```ts
   callers: edgesOf(result.callers as any[], "caller"),   // line 216
   callees: edgesOf(result.callees as any[], "callee"),   // line 217
   summary: { ... }                                        // line 218 (all bounds live here)
   ```

4. **Why graph payloads are ~0.5–1.1 MB: per-edge endpoint duplication, not bound breach.**
   `src/mcp/tools/bb_graph/handler.ts:161-197` emits, for every edge, a full inline `from`/`to`
   object (`id,name,symbolType,file,line,isExternal`), plus `rowId`, `callSite`, tier/confidence,
   enrichment. 843 edges on Session = 822,916 B of edge JSON; there is no shared node table, so the
   same symbol object is repeated once per incident edge. The bounds that fire are
   `src/intelligence/graph/graph-engine.ts:100` `const DEFAULT_BUDGET = 50` (per-direction fan-out)
   and `:258` `const DEFAULT_MAX_TOTAL_EDGES = 1000` (default `maxEdges`), applied at `:1021`
   (`let callerBudget = options.callerBudget ?? DEFAULT_BUDGET`), `:1209` (callee) and `:801`
   (`maxEdges`). `summary.totalCallers` is `callers.length` (returned edges) at `:1715`;
   `callersIfUncapped` is the engine's own count at `:1757`.

5. **No shared envelope exists to fix this in one place; four tools each hand-order their payload.**
   `bb_impact` (above), `bb_graph` (above), `bb_visualize` json — `src/intelligence/visualization/
   visualization-engine.ts:910` returns `{ scope, target, format, view, layout, nodes, links,
   excluded, …, considered, truncation, freshness }` so `truncation` is at **99.92%** of the 479,011 B
   module answer; and `bb_analyze` mode=impact — `src/mcp/tools/shared.ts:382-470`
   (`canonicalImpactReport`) emits `truncated/truncationReason/depthCap/nodeBudget` *after*
   `affectedFiles`. Same class in the whole graph family; no serializer owns it.

6. **`bb` has no host cap of its own**, so the “host truncation” is external: no response-size or
   truncation cap exists in `bin/bb` / `src/cli/index.ts` (grep). That is why the fix belongs on the
   payload (summary-first + byte budget), not on the transport.

## Contract question (the central design question)

- **Is `maxNodes: 200` a contract that bounds RETURNED nodes?** Yes: `IMPACT_BUDGET.maxNodes` is
  documented as “maximum reverse-dependency nodes in one impact set” (`src/lsp/impact.ts:121`),
  enforced against `impact.length` (`:1081`), and the payload's `shownCount` is that length
  (`:1436`). `docs/BB_IMPACT.md:40-41` calls it the “node budget 200”. It does **not** bound the
  engine's caller rows: `docs/tools/bb_impact.md:84` says so explicitly (engine row caps “are not
  truncations of the DEPENDENT set”), and `returnedCallers` is documented as a row count
  (`src/lsp/impact.ts:216-218`). Therefore **345-vs-200 is a semantics mismatch (returned caller
  rows vs dependent nodes), not a budget violation.**
- **Is summary-first ordering a contract requirement?** No — it is undocumented; the docs promise the
  fields exist, never where they appear. So the ordering defect is a **contract gap** (undocumented
  payload shape) whose user-visible failure is real the moment a host caps the answer. Fixing it
  needs a documented envelope, then a gate (below), not a reinterpretation of the budget.

## Generality table

| language | project / scope | fixture / repro | same class? | evidence |
|---|---|---|---|---|
| Go | bettercap (specimen) | `bb_impact New/Session/LoadModules`, `bb_graph New/Session` | **yes** — identical key order; graph `summary` 99.46–99.71%; `Session` graph 1,087,986 B | `impact-New-default.json`, `impact-Session-default.json`, `graph-New-default.json`, `graph-Session-default.json` |
| JavaScript | workspace index (`1d3d5710…`), `.corpus/axios` symbol `dispatchRequest` | `bb_impact`/`bb_graph` via CLI `--dir` workspace | **yes** — impact order identical (counts at 88.9–91.8%); graph 486,771 B, `summary` 99.17% | `impact-axios-dispatchRequest.out`, `graph-axios-dispatchRequest.out` |
| tool-wide (Go) | bettercap, `bb_visualize format=json` scope=module session | `bb_visualize` json | **yes, adjacent tool** — `nodes/links` first, `truncation` at 99.92% of 479,011 B | `viz-module-session-json.out`, `BYTE-OFFSETS.txt` |
| tool-wide (JS) | workspace, `bb_analyze mode=impact dispatchRequest` | `bb_analyze` | **yes, milder** — `affectedFiles` precedes `truncated/nodeBudget` | `analyze-impact-axios.out` |
| Go, older index | `bb_tests/repositories/gql-gqlgen/graphql` (index dated 2026-10-17) | `bb_impact`/`bb_graph` | **CANNOT-VERIFY (blocked by schema drift)** — both die `no such column: r.target_basis` before payload; see UNLOCKED entry | `impact-gql-graphql-default.out`, `graph-gql-graphql-default.out` |

So: **not analyzer-specific and not bettercap-specific** — it is a tool-family payload-envelope
defect reproducible on Go and JS indexes and on two sibling tools; the only blocked cell is an
unrelated old-index schema incompatibility.

## Fix sketch (implementation-ready)

1. **Introduce one shared envelope in `src/mcp/tools/shared.ts`** and use it from `bb_impact`,
   `bb_graph`, `bb_visualize` (json) and `bb_analyze` mode=impact:

   ```ts
   export function boundedResult<T>(summary: Record<string, unknown>, data: T) {
     return textResult(JSON.stringify({ summary, data }, null, 2))
   }
   ```

   `summary` is ALWAYS the first top-level key and carries, in this order: `truncated`,
   `truncationReason`, `truncationReasons`, then the tool's counts/budget
   (`shownCount/directCount/totalCountIfKnown/budget/traversal/countVerification` for impact;
   `totalCallers/totalCallees/edgeLimit/maxEdges/callerBudget/…` for graph), then
   `payloadBytes`, `payloadBudgetBytes`, `reproducible`, `freshness`. `data` holds only the bulk
   rows (`impact[]`, `callers/callees`, `nodes/links`, `affectedFiles`).

2. **Byte budget + declared truncation** (kills the >1 MB case): a graph-family payload budget
   (proposal: 256 KB default, env-overridable). If the serialized `data` exceeds it, drop rows from
   the tail of the largest array, set `summary.truncated: true`,
   `truncationReason: "payload-byte-budget-exhausted"`, `payloadBytes`, and
   `dropped: { callers: n, callees: m }`. Bounds keep their meaning: the budget is a *transport*
   bound, declared in the same summary block.

3. **Kill the units ambiguity:**
   - `bb_impact`: rename `traversal.returnedCallers` → `traversal.engineCallerRows` (keep the old key
     one release with both populated, deprecated in docs), and add to `budget` a
     `nodeBudgetMeans: "bounds the dependent nodes in impact[] — NOT the engine's caller rows"`.
   - `bb_graph`: add `summary.returnedEdges = callers.length + callees.length` beside
     `totalCallers/totalCallees` (already returned-edge counts) and state in the schema that
     `maxEdges`/`edgeLimit`/`callerBudget` bound EDGES, never symbols.
   - Consider `bb_graph` node dedupe (a `nodes` map + edges referencing ids) if the byte budget fix
     alone is not enough — it cuts the duplicated endpoint objects without changing any declaration.

4. **Docs**: `docs/tools/bb_impact.md` and `docs/tools/bb_graph.md` gain a “Payload shape” section
   promising summary-first ordering and the byte budget; regenerate with
   `npx tsx script/verify-tool-docs.ts --only <tool> --write`.

## Gate proposal (would have caught it)

1. **Ordering gate (new, e.g. `script/m66/verify-payload-envelope.ts`)**: for each graph-family tool,
   run a fixture-index call and assert (a) the first top-level key is `summary` (regex
   `/^\{\s*"summary"\s*:/` on the raw text), (b) `truncated`/`truncationReason`/`shownCount` (or
   `totalCallers`/`maxEdges`) all occur before the first byte of the first data array, and
   (c) `head -c 4096` of the payload already contains `"truncated"`. Negative control: the current
   handlers must fail (a) and (c).
2. **Unit gate**: assert `impact.length === summary.shownCount <= summary.budget.maxNodes` and that
   the payload contains no key named `returnedCallers` without a units note / renamed field; and
   `docs/tools/bb_impact.md` documents which field is caller rows vs dependent nodes (doc-content
   assertion already possible through `verify-tool-docs`).
3. **Byte gate**: hub fixture call (`Session`-class symbol on a shipped fixture index) must produce a
   payload ≤ 256 KB, or carry `truncationReason` naming `payload-byte-budget-exhausted`; run in the
   existing graph-family perf/gate scripts. This makes the report's “~962 KB/1 MB” case a test
   failure instead of a field report.

## Evidence index (`docs/bb-bettercap-triage/evidence/payload-honesty/`)

`impact-New-default.json` (107,538 B), `impact-Session-default.json` (188,433 B),
`impact-LoadModules-default.json`, `impact-New-maxNodes5.err` + `impact-New-maxNodes50.err`
(refusal), `graph-New-default.json` (547,273 B), `graph-Session-default.json` (1,087,986 B),
`graph-LoadModules-default.json`, `graph-New-small-bounds.json`, `graph-New-maxDepth2.json`,
`graph-New-maxEdges5000.json`, `graph-New-direction-callers.json`, `graph-main-default.json`,
`impact-axios-dispatchRequest.out`, `graph-axios-dispatchRequest.out`,
`viz-module-session-json.out`, `analyze-impact-axios.out`, `BYTE-OFFSETS.txt`,
`ORDERING-ANALYSIS.txt`, `TRUNCATION-HIDES-BOUNDS.txt`.

Cross-reference: Lead corroboration `evidence/lead/issue10-graph-new.json` (547,273 B) matches this
lane's `graph-New-default.json` byte-for-byte.

## Open / CANNOT-VERIFY

- The report's exact `~137 KB` (impact) and `~962 KB` (graph) byte counts: **CANNOT-VERIFY which
  symbol/args/build produced them** — HEAD reproduces the same *class* with 107,538/188,433 B and
  547,273/1,087,986 B. Recorded as drift, not contradiction.
- Cross-project Go generality on the older `bb_tests` indexes: **CANNOT-VERIFY** (blocked by
  `no such column: r.target_basis`, see UNLOCKED). A fresh tiny fixture could not be indexed in this
  sandbox (`bb index` cannot mkdir under `~/.bb/projects`), so the JS row above stands in for
  cross-language generality.
- Host-side cap value: **CANNOT-VERIFY** (external consumer's limit; `bb` has no cap). The fix is
  payload-side regardless of the exact cap.
