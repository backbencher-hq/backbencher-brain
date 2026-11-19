# payload-honesty — P1-4 (one bounded response envelope) + P2-5 (claim/label honesty)

Lane: `payload-honesty`. Task: `task-13`. Fix campaign charter: `docs/bb-bettercap-fix/FIX-CHARTER.md`.
Date: 2026-11-18 (UTC). Base: HEAD `75448b029` (product `be4c0ef25`, bb 0.1.6) + this lane's working-tree change.
Triage specification: `docs/bb-bettercap-triage/findings/ISSUE-10-impact-graph-payload-bounds.md`,
`ISSUE-12-output-contradictions.md`, `PLAN.md` §7/§8 (P1-4, P2-5).

## State: GREEN

| item | status | evidence |
|---|---|---|
| RED gate on pre-fix code | **RED 14/62 (48 fails)** | `evidence/payload-honesty/m73-red-run.txt`, `m73-gate-red.json` |
| GREEN gate after fix | **GREEN 78/78** | `evidence/payload-honesty/m73-gate-green-final.txt` (+ `m73-run4.txt` first 73/73 green) |
| `npx tsc --noEmit` | **exit 0, no errors** (whole repo, not only touched files) | `evidence/payload-honesty/tsc-final.txt` |
| CP1 regressed gates (4) | **all PASS** | `cp1-verify-graph.txt` = `GRAPH: PASS`; `cp1-graph-blindspots.txt` = all checks passed; `cp1-analyze-modes.txt` = `An1: VERIFIED (84/84 passed, 27 negatives)`; `cp1-visualize-views.txt` = `V7: VERIFIED (79/79 passed, 10 negatives)` |
| previously-green legacy gates | m28 `T1: VERIFIED (26/26, 2/2 mutants)`; m48 `79 passed, 1 failed` = **pre-existing at pristine HEAD** (see Residual) | `m28-mcp-tools-final.txt`, `m48-impact-unity-final.txt`, `m48-baseline-head.txt` |
| tool docs truth gates | `verify-tool-docs --only bb_{impact,graph,visualize,security}` all PASS after regeneration | `tool-docs-*.txt` |

## Fix 1 — ONE bounded response envelope (P1-4)

`src/mcp/tools/shared.ts` now exports `boundedResult(summary, data)` + `PAYLOAD_BUDGET_BYTES = 256 KiB`
(overridable by `BB_PAYLOAD_BUDGET_BYTES` for tests/ops) + `payloadBudgetBytes()`. Every answer is
`{ "summary": {…}, "data": {…} }` — **summary is the first top-level key**, so `head -c 4096` carries
the entire declaration even when a host caps the body.

Summary field order per surface:

| surface | summary (first) | data (second) |
|---|---|---|
| `bb_impact` | `truncated`, `truncationReason`, `truncationReasons`, `symbol`, `shownCount`, `directCount`, `totalCountIfKnown`, `budget` (+ `nodeBudgetMeans`), `traversal` (+ **`engineCallerRows`**), `cascade`, `countVerification`, `reproducible`, `freshness`, `payloadBytes`, `payloadBudgetBytes`, `droppedRows`, `droppedByArray`, `byteBudgetRule`, `byteBudgetExhausted` | `root`, `rootStale`, `rootMatch`, `resolution`, `rule`, `impact[]` |
| `bb_graph` | `truncated`, `truncationReason(s)`, all bound/count fields (incl. `totalCallers`, `totalCallees`, `returnedEdges`, `nodes`, `edgeLimit`, `maxEdges`, `callerBudget`, `calleeBudget`, `maxDepth`), `payloadBytes`, `payloadBudgetBytes`, byte-budget declarations | `root`, `nodes` (node table), `callers[]`, `callees[]`, `provenance` |
| `bb_visualize` (json) | `truncated`, `truncationReason(s)`, `scope`, `target`, `view`, `layout`, `declaredAbsent`, `totalNodesAvailable`, `originalNodes/Links`, `returnedNodes/Links`, `maxNodes/maxLinks`, `offset`, `nextOffset`, `page`, `freshness`, `payloadBytes`, `payloadBudgetBytes`, byte-budget declarations | `nodes[]`, `links[]`, `excluded`, `considered`, `truncation`, `provenance`, `freshness` |
| `bb_analyze` mode=impact | `truncated`, `truncationReason(s)`, `target`, `found`, `depthCap`, `nodeBudget`, `depthReached`, `totalSymbols`, `totalSymbolsIfKnown`, `directSymbols`, `transitiveFiles`, `crossLanguageFiles`, `unresolvedEdges`, `riskLevel`, `freshness`, `payloadBytes`, `payloadBudgetBytes`, byte-budget declarations | legacy flat report (`affectedFiles[]`, `root`, `source`, `provenance`, …) |

Byte budget behaviour: over budget, the data's top-level arrays are cut proportionally
(binary-searched keep ratio); the cut is DECLARED in the summary —
`truncated: true`, `truncationReason` gains `payload-byte-budget-exhausted`,
`truncationReasons` includes it, `droppedRows` / `droppedByArray` count the cut; the vocabulary
(`byteBudgetRule: "payload-byte-budget-exhausted"`, `byteBudgetExhausted`) is present on **every**
answer, truncated or not. A surface can restate its own counts after the cut (`onTruncate` may return
`{ data, summary }`): `bb_graph` uses this so `totalCallers/totalCallees/returnedEdges/nodes` equal the
rows actually returned (gate B2).

Unit rename: `bb_impact.traversal.returnedCallers` → **`traversal.engineCallerRows`** (units in the
name; docs'd in `docs/BB_IMPACT.md`, `docs/tools/bb_impact.md`) and
`budget.nodeBudgetMeans` states that `maxNodes` bounds the dependent NODES, not the engine's caller
rows. This closes triage issue-10's 345-vs-200 reading as a units mismatch, not a budget breach.

Node-table dedupe: `bb_graph` edges now carry `from`/`to` endpoint **ids** into one `data.nodes`
table instead of a full `{id,name,symbolType,file,line,isExternal}` object on both ends of every edge.
Edge SET and order are unchanged — gate A2 asserts the handler's caller/callee counts equal the
engine's own `graphTraversal` counts, every endpoint resolves in the node table, and
`summary.totalCallers/totalCallees/returnedEdges === returned rows`.

### Payload size, bettercap (handler-level, read-only; `before-after-payloads.txt`)

| surface | symbol/scope | before | after | change | declared |
|---|---|---|---|---|---|
| `bb_impact` | `New` | 107,538 B | **113,779 B** | +6 KB envelope (summary first) | not byte-truncated |
| `bb_impact` | `Session` | 188,433 B | **199,516 B** | +11 KB envelope | not byte-truncated |
| `bb_graph` | `New` | 547,273 B | **240,224 B** | −56.1% | dedupe + 218 rows cut, `payload-byte-budget-exhausted` |
| `bb_graph` | `Session` | 1,087,986 B | **180,823 B** | −83.4% | dedupe + 689 rows cut, declared |
| `bb_visualize` json | module `session` | 479,011 B | **261,620 B** | −45.4% | 346 rows cut, declared |

Before the fix the bounds sat at 99.46–99.92% of the payload (triage measurements); after it, the
first key is `summary` for all four surfaces and every bound key appears within the first 4 KB
(gate A1/A2/A3/A4 + B2 on a forced-4096-byte budget).

## Fix 2 — security tier label (P2-5)

`src/intelligence/security/rebuild/registry.ts` `formatSecurityTierDeclaration()` now prints:
`tiers (analyzer registry census, project-independent): 0 scan / 39 lead-tier analyzers / 14 unsupported (of 53 analyzer specs) — …` — the count is labelled as the registry census it is, and the
**only** "leads" number is the stored-lead body line (`security leads: N stored lead(s)`). The three
literal examples in `docs/BB_SECURITY.md` were replaced, and the contract paragraph now states the
unit and why the old label read as a contradiction. Positive control: `securityTierCounts()` still
computes `total 53 / scan 0 / leads 39 / unsupported 14`.

## Fix 3 — visualize completeness claim (P2-5)

`src/intelligence/visualization/visualization-engine.ts` no longer prints `"this graph is the whole
project"` unconditionally. The claim is gated on
`scope === "project" && truncation.truncated === false && truncation.offset === 0 && excluded.symbols === 0`;
every other answer (scoped/truncated/paged/absent) prints
`completeness: this <scope> page holds N of M matching symbol(s) — not the whole project`. The
`excluded:` line now describes the noise filter only (`no symbol was filtered as build/VCS noise`).
Positive control: a complete project-scope first-page answer may still say "this graph is the whole
project" (gate D2).

## Legacy gates changed — ACCESS PATH ONLY (no assertion added, removed or relaxed)

| gate | change | assertions |
|---|---|---|
| `script/m28/verify-mcp-tools.ts` | `parse()` flattens `{summary,data}` back to the legacy flat view (keeps `summary`/`data` nested too) | 26/26 + 2/2 mutants — identical predicate text |
| `script/m48/verify-p1-impact-unity.ts` | same flatten at the handler-call helper | 79 passed / 1 pre-existing fail (see Residual); pre-fix text had the same 1 failure |
| `script/verify-graph.ts` (CP1) | `door()` parses `flattenEnvelope(JSON.parse(text))` | 46 checks, `GRAPH: PASS` |
| `script/m65/verify-graph-blindspots.ts` (CP1) | `callGraph()` flattens the envelope | all checks pass (15 ok-lines) |
| `script/m13/verify-analyze-modes.ts` (CP1) | `call()` flattens the envelope | 84/84 + 27 negatives |
| `script/m13/verify-visualize-views.ts` (CP1) | one flatten at the view parse + two at the layout json parses | 79/79 + 10 negatives |

The flatten helper is local to each gate and documented as access-path-only; the predicate bodies are
byte-identical to their pre-envelope form.

## Gates added

`script/m73/verify-payload-envelope.ts` — 78 checks: envelope order/bounds on the four real handler
surfaces over a real indexed fixture; byte-budget mechanism (synthetic oversized payload) and a
REAL-surface forced-4096-byte truncation (declared counts equal returned rows, node table pruned,
dropped > 0); `shownCount <= budget.maxNodes`; `engineCallerRows` units; graph edge-set preservation
vs `graphTraversal`; security unit label + doc literal; visualize claim matrix
(scope × truncated × absent × offset). RED 14/62 before the fix; GREEN 78/78 after.

## Changed files

- `src/mcp/tools/shared.ts` — `boundedResult`, `PAYLOAD_BUDGET_BYTES`, `payloadBudgetBytes`, byte-budget
  declaration, `onTruncate` restatement hook.
- `src/mcp/tools/bb_impact/handler.ts` — envelope + `engineCallerRows` + `nodeBudgetMeans`.
- `src/mcp/tools/bb_graph/handler.ts` — envelope + node-table dedupe + post-cut count restatement.
- `src/mcp/tools/bb_visualize/handler.ts` — json envelope.
- `src/mcp/tools/bb_analyze/handler.ts` — mode=impact envelope.
- `src/intelligence/visualization/visualization-engine.ts` — gated completeness claim.
- `src/intelligence/security/rebuild/registry.ts` — corrected tier label.
- `script/m73/verify-payload-envelope.ts` (new gate); legacy gate access-path edits listed above.
- `script/tool-docs/curation/bb_impact.ts`, `bb_graph.ts`, `bb_visualize.ts` + regenerated
  `docs/tools/bb_{impact,graph,visualize,security}.md`.
- `docs/BB_IMPACT.md`, `docs/BB_VISUALIZE.md`, `docs/BB_SECURITY.md` — envelope/units/claim contracts.

## Residual notes

1. **m48 one failing check is PRE-EXISTING at pristine HEAD.** `m48-baseline-head.txt` is a run of the
   same gate in an isolated `git worktree add --detach HEAD` checkout (`75448b029`, product
   `be4c0ef25`): same single failure, same `79 passed, 1 failed` —
   `P1: a hint that cannot identify the symbol is refused, not ignored … "symbol 'constructor' not
   found"`. That check asserts a pre-success error-message path the envelope never reaches; the
   access-path flatten does not touch it. The verifier's "pre-fix PASS" for m48 could not be
   reproduced at HEAD and is reported rather than papered over.
2. `script/m13/verify-visualize-honesty.ts` is reported by the verifier as pre-existing FAIL both
   sides; not touched by this lane.
3. The compiled `dist/` was **not** rebuilt by this lane (charter: only the build coordinator runs
   `npm run build`); all verification above is source-level through the real handlers/gates.
4. The transport budget is a per-call property of the caller, hence the `BB_PAYLOAD_BUDGET_BYTES`
   override; the gate exercises both the default and a forced 4096-byte budget.

## Evidence index (`docs/bb-bettercap-fix/evidence/payload-honesty/`)

`m73-red-run.txt`, `m73-gate-red.json`, `m73-run4.txt`, `m73-gate-green-final.txt`,
`before-after-payloads.txt`, `tsc-final.txt`, `m28-mcp-tools-final.txt`,
`m48-impact-unity-final.txt`, `m48-baseline-head.txt`, `cp1-verify-graph.txt`,
`cp1-graph-blindspots.txt`, `cp1-analyze-modes.txt`, `cp1-visualize-views.txt`,
`tool-docs-*.txt`.

## CP1-B follow-up window — 4 more legacy gates (gate-side only, product src untouched)

The verifier's extended CP1 sweep found four more gates reading the old flat payload paths. Same
access-path-only method (one local `flattenEnvelope` per gate; predicate text byte-identical). No
product source was touched in this window.

| gate | runner | BEFORE (pre-patch) | AFTER |
|---|---|---|---|
| `script/m13/verify-visualize-owner-fold.ts` | `bun run` (uses `import.meta.dir`) | `TypeError: Cannot read properties of undefined (reading 'map')` | `V8: VERIFIED (29/29 passed, 8 negatives)` |
| `script/m13/verify-visualize-target-literals.ts` | `npx tsx` | `TypeError: Cannot read properties of undefined (reading 'length')` | `V6: VERIFIED (21/21 passed, 5 negatives)` |
| `script/m35/verify-s3-graph-migrate.ts` | `npx tsx` | `FAIL: viz: freshness block with exact registered keys` (+ `TypeError … staleRatio`) | `M35 S3 GRAPH+MIGRATE: PASS (23/23, negatives=4)` |
| `script/m48/verify-p3-agreement.ts` | `npx tsx` | `FAIL: P3: caller set identical (leaf/Service/c1)` + `FAIL: bb_graph resolves the same root` | `M48 P3 AGREEMENT: PASS (30 passed, 0 failed, 5 negatives)` |

All run with an isolated `BB_DATA_DIR` (the sandbox cannot mkdir `~/.bb/projects/<hash>`); owner-fold
is a `bun run` gate. One nuance recorded for p3: `bb_graph.summary.nodes` is a COUNT while
`data.nodes` is the node TABLE, so that gate's flatten spreads `summary` first and `data` second
(data wins) — its `nameOf()` already handled id-endpoints via the node table once the envelope was
unwrapped, so no comparison logic changed. Confirmation after the window: `npx tsc --noEmit` exit 0
and `script/m73/verify-payload-envelope.ts` GREEN 78/78. Evidence:
`evidence/payload-honesty/cp1b-*` + `cp1b-summary.txt`.
