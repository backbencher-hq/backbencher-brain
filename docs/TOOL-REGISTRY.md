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
| `aliases` | Alternate public names, currently empty until compatibility migration |
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

Issue M9.02 changes ownership and dispatch architecture only. All 15 existing names, schemas, defaults, text outputs, index gates, and side effects remain protected by `script/verify-contracts.ts` and MCP E2E verification.

The target ten-tool contracts remain in `src/contracts/tool-contracts.ts`. They are not registered by this issue. Compatibility aliases and deprecations are activated in M9.18 after the replacement engines are complete.
