# Tool Registry Architecture

`src/mcp/tool-registry.ts` is the canonical source for public MCP tool metadata. The registry is importable without starting an MCP server and contains no runtime handlers.

## Descriptor Model

Each `ToolDescriptor` contains:

| Field | Purpose |
| --- | --- |
| `name` | Stable public MCP name |
| `description` | MCP-facing tool-selection description |
| `inputSchema` | JSON Schema exposed through `tools/list` |
| `mutability` | `read`, `index`, or `write` |
| `requiresIndex` | Whether the protocol adapter blocks calls without an index |
| `modes` | Supported behavior modes for this contract generation |
| `aliases` | Alternate public names; empty in the `0.3.0` public surface |
| `deprecated` | Whether clients should migrate away from the descriptor |
| `replacement` | Replacement tool and optional mode |
| `documentation` | Category, summary, defaults, and examples for generated references |

The registry validates itself when imported. Validation rejects empty or duplicate names, undeclared required fields, duplicate modes or aliases, and deprecated tools without replacements.

## Runtime Attachment

`src/mcp/tool-handlers.ts` owns the current behavior implementations. `createToolHandlers()` verifies a one-to-one mapping:

- Every registered descriptor has a handler.
- No handler exists without a public descriptor.

`src/mcp/server.ts` is now a protocol adapter. It:

1. Lists tools derived from `toMcpToolList()`.
2. Resolves the matching descriptor and handler.
3. Applies the descriptor's `requiresIndex` policy.
4. Invokes the handler and normalizes uncaught failures.

The server does not maintain a second registry or a name-based conditional dispatch chain.

## Serializable Metadata

`serializeToolMetadata()` returns registry metadata as JSON without importing handler code or MCP transport state. `TOOL_DESCRIPTORS` and the serializer are exported from the package root.

This is the initial source for future generated documentation. The website at `$HOME/mcp/website` must not import `src/mcp/server.ts`; it can later consume a generated JSON artifact based on the serializer. M9.19 defines the final artifact and website integration contract.

## Version Source

`src/version.ts` reads the package version once and exports `BACKBENCHER_BRAIN_VERSION`. The CLI, MCP server, and package root use this value. Version changes therefore begin in `package.json` rather than separate CLI and server literals.

## Compatibility Boundary

Version `0.3.0` exposes exactly ten descriptors. The compatibility aliases from
`0.2.x` were removed after the migration window and are preserved only in the
historical migration guide and changelog.

## Internal Engine Extraction

M9.03 establishes the first strict internal modules under `src/intelligence/`:

| Module | Current responsibility | Public adapters |
| --- | --- | --- |
| `contracts.ts` | Shared source, search, graph, and statistics DTOs | `BrainTools` result types remain compatible |
| `source-utils.ts` | Safe snippet and JSON-field helpers | Search and future documentation engines |
| `search/symbol-search.ts` | Current-schema symbol search and freshness flags | `BrainTools.searchCode`, CLI, `bb_search` |
| `analysis/project-stats.ts` | Typed current-schema project aggregates | `BrainTools.getStats` |

These modules are strict and use the active `brain_*` schema. The adapters are deliberately lazy-loaded so the existing namespace remains available while extraction proceeds.

The following areas are intentionally not moved as if they were established:

- Graph traversal remains in `tools.ts` until M9.06 repairs its semantics.
- Pattern orchestration remains until M9.08 consolidates detectors and orphan rules.
- Semantic retrieval remains until M9.05 repairs model identity and fallback behavior.
- Test Intelligence remains quarantined until M9.10 replaces its obsolete schema queries.
- Patrol, flow explanation, test generation, and architecture prototypes remain quarantined until their dedicated issues establish them.
