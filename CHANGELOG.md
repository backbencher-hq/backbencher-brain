# Changelog

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
