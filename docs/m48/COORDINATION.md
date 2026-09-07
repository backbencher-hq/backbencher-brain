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

_(none yet — first shared-file touch will be logged here before landing.)_
