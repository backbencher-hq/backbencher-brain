# Changelog

## Unreleased

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
