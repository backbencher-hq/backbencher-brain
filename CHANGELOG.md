# Changelog

All notable changes to Backbencher Brain.

## [0.1.0] — 2026-06-11

### Added
- Initial release
- **40 language analyzers** ported from backbencher with import adapter pattern
- **15 MCP tools**: brain_search, brain_select, brain_relationships, brain_ask, brain_health, brain_security, brain_patterns, brain_visualize, brain_refresh, brain_update, brain_insert, brain_delete, brain_refactor, brain_write, brain_undo
- **Parallel indexer** with worker pool, batch storage, relationship resolution, gravity scores, taint analysis
- **Byte-precise surgical patcher** with auto-indent, auto-format, undo backups
- **Import injector + pruner** for 40 languages (AST-aware for TS/JS, regex fallback for others)
- **SQLite database** with WAL mode, FTS5, schema migrations
- **WASM infrastructure** with three-tier loading, LRU parser cache
- **CLI** with progress bars, status dashboard, colored output
- **MCP server** over stdio with caching and rate limiting
- **Analyzer sync script** for upstream updates
- Comprehensive README with MCP host config examples
- CONTRIBUTING.md with sync workflow documentation
