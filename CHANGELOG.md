# Changelog

## Unreleased

### A `callers` count was not a count of calls

The graph engine's default covers every relationship kind the index stores — documented, and
deliberate, because `contains` is the parent→member edge and excluding it stops a traversal rooted
at a class from reaching that class's own methods. Three consumers in `src/` read that set while
making a claim about one kind:

- `testImpact` published a depth-0 row from a test file as a DIRECT test without asking what kind
  of row it was, so a test class that *contains* the symbol under test answered as a test that
  depends on it — and `testSuggestions` stamped that `direct_call` at 0.85 confidence.
- `testSuggestions`'s `blastRadius`, labelled "caller closure", counted containment and lexical
  rows, and it feeds `priorityFor`, so structure inflated a priority.
- the deprecated `analyzeImpact` (not reachable from any tool since M48) fitted every kind into
  `directSymbols` / `affectedFiles`.

Measured on a fixture whose store holds, from the real analyzer, `realTest --calls--> nested` and
`TestHost --contains--> nested`: the unscoped walk returns both callers, the scoped walk returns
one, and the tool now reports `directTests: [{ testSymbol: "realTest", relationshipType: "calls",
evidence: "direct_call" }]`. `TestImpactReport.directTests` / `indirectTests` and
`AffectedTestEntry` now carry `relationshipType` and `evidence`, so "directly a test" is never
published as "directly calls". `testSuggestions` walks `bb_impact`'s declared dependency rule
(`IMPACT_REL_TYPES`, one list, imported from its owner) instead of every kind.

`bb_analyze`'s page said nothing about the kind set its `callers`/`callees`/`trace` modes walk; it
does now, including that mode `impact` walks the declared dependency rule instead — so a `callers`
count and an `impact` count about the same symbol are not the same question, and both name the rule.
Pinned by `script/m65/verify-edge-kind-scoping.ts`: an inventory of every graph call site in `src/`
(an unscoped one must be a declared all-kinds door), a fixture differential against the store, two
mutations, and source guards so a reverted filter fails the gate.

### The public surface grew from ten to sixteen

The 0.3.0 section below describes that release's surface, and it was accurate when it
was written (2026-08-09). Six tools have been added since, so the live surface is
sixteen — the number is now read from `docs/data/public-tools.json` wherever it is
needed instead of being restated:

- `bb_index` — reindex a file or directory so the index reflects edits immediately,
  plus `mode=post` to re-run derived phases without re-parsing.
- `bb_graph` — per-symbol callers/callees at a declared depth, with per-edge evidence
  tier and confidence from the canonical graph engine.
- `bb_impact` — bounded reverse-dependency impact with a declared node budget and an
  echoed relationship-type rule.
- `bb_cross_language` — stored cross-language facts for one symbol, with absence
  declared rather than inferred when the store holds none.
- `bb_annotate` — write an agent-authored note with `author_class` enforced at the
  schema level, never spoofable.
- `bb_annotations` — read notes back with full provenance and a declared bound.

Same release window, same defect class: `README.md` and both MCP acceptance harnesses
(`script/verify-mcp.ts`, `script/verify-mcp-e2e.ts`) had kept the old count in prose and
in an assertion. The stale assertion failed at command 125 of 358 in `npm run verify`,
which made the 233 commands after it unreachable — so nothing downstream could notice.
Both harnesses now derive the expected surface from the contract file, cover all sixteen
tools (five had no MCP-level test at all, and `bb_index` had never been called as a tool),
and fail with a named missing/undeclared list rather than a bare number.

## 0.3.0

### Intelligence Tools Rebuild

- Published the final ten-tool MCP surface: `bb_search`, `bb_ask`, `bb_analyze`,
  `bb_patterns`, `bb_security`, `bb_doc`, `bb_visualize`, `bb_migrate`, `bb_edit`,
  and `bb_health`.
- Removed compatibility aliases after the announced breaking-release window:
  `bb_select`, `bb_relationships`, `bb_refresh`, `bb_write`, `bb_update`,
  `bb_insert`, `bb_delete`, `bb_refactor`, `bb_test_quality`, and
  `bb_test_suggestions`.
- Replacements are `bb_search mode=symbol`; `bb_analyze` callers/callees/trace and
  test modes; `bb_health refresh=true`; and `bb_edit` write/update/insert/delete/
  refactor modes.
- Removed alias-only stale-index mutation exceptions. Canonical symbol mutations
  require current indexed AST bounds.
- Preserved internal indexing, semantic, graph, analysis, test, edit, health,
  documentation, visualization, and migration engines. They are implementation
  layers, not separately advertised MCP tools.

Historical migration details remain in `docs/MCP_TOOL_MIGRATION.md`.
