# M48 ↔ M47 (LSP/hub) coordination log

Rule: the LSP/hub lane (GitHub milestone 47, "The Understandable Hub (IDE
v7)", actively developed by another agent) must never break because of M48.
When a change touches a **shared component** — graph engine
(`src/intelligence/graph/`), impact calculator (`src/lsp/impact.ts`),
cross-language reader (`src/lsp/cross_language_hover.ts`), annotation store —
M48 announces it here **before/with** the change: what, why, how verified.
L1 (#704) enforces that a shared-file diff without a matching entry fails the
gate.

## Shared-component inventory (baseline, no M48 changes yet)

| Shared component | Owned by | Used by MCP tools | Used by LSP/hub |
|---|---|---|---|
| `src/intelligence/graph/graph-engine.ts` | shared | bb_analyze callers/callees/trace, bb_graph, bb_impact | bb/graph, bb/impact, graph panel |
| `src/lsp/impact.ts` (computeImpact) | LSP lane | bb_impact (imports it) | bb/impact, editor impact mode |
| `src/intelligence/analysis/impact.ts` (analyzeImpact) | MCP lane | bb_analyze impact only | — (not used by LSP) |
| `src/lsp/cross_language_hover.ts` | LSP lane | bb_cross_language (imports it) | hover cross-language section |
| annotation store (brain_annotation) | shared | bb_annotate, bb_annotations | hover section + graph badge |

## Entries

### 2026-09-07 — C1 (#699): graph-engine root resolution changed

- **What**: `src/intelligence/graph/graph-engine.ts` — `resolveGraphRoot` now
  prefers exact-name symbol matches of ANY kind over fuzzy substring matches
  (previously only structural kinds were considered exact, so a Makefile
  target merely *containing* the query string beat the real `#define`).
- **Why**: found by the C1 corpus — bb_graph and bb_analyze answered the same
  root question differently on real repos (P3 disagreement class).
- **How verified**: C1 corpus cross-checks (50/50 after fix, hermetic runner);
  M24 LSP harness re-run below proves `bb/graph` (the hub's graph panel path)
  still answers through the same engine.
- **Risk to hub**: behavior change is strictly toward *more* correct root
  selection; hub callers asking for an exact symbol name now get it. Fuzzy
  fallback remains for non-exact queries.
- **Commit**: ad39d78a (logged retroactively at L1 verification time — the
  touch predates this log's enforcement gate; L1's guard now makes a future
  unlogged shared diff fail before it can land).

### 2026-09-08 — post-closure truth fix: attribution semantics disclosed

- **What**: `src/intelligence/graph/graph-engine.ts` — **comment-only change**
  at the owner-cascade source of truth (callers + callees). No executable
  statement was altered; the fix is disclosure, not behavior.
- **Why**: live accuracy probe showed the class-member attribution rule
  (a call to any class member is also attributed to the class) was
  row-traceable and intentional but documented nowhere — an agent reading
  bb_graph could not know depth>1 results include family attribution.
- **How verified**: D1 now enforces the disclosure text across all five
  surfaces (128 checks, 4 negatives — gate fails if the text vanishes);
  P3 agreement re-run 28/28; full M48 gate set re-run green at the fix HEAD.
- **Risk to hub**: none — zero behavioral delta; hub's `bb/graph` wire smoke
  re-run verified (leg A 24/24, leg B 5/5) at the same HEAD.
- **Commit**: 1bbbd932.
