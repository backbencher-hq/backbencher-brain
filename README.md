# backbencher-brain-core — universal code intelligence

Standalone, runtime-agnostic (Bun **and** Node) code intelligence core:
index any project with 40+ Tree-sitter language analyzers, then query it
from a CLI, an MCP server, or a library.

## Quick start

```bash
# Node (compiled dist, better-sqlite3) — the primary path:
node bin/bb index ~/my-project
node bin/bb search "calculateTotal" --dir ~/my-project
node bin/bb health ~/my-project

# Bun (from source, bun:sqlite — the compiled dist is Node-only by design):
bun run src/cli/index.ts index ~/my-project
bun run src/cli/index.ts search "calculateTotal" --dir ~/my-project
```

## CLI commands

| Command | Purpose |
|---|---|
| `bb index <dir>` | Build the AST index (parallel, all languages) |
| `bb index <dir> --force` | Wipe and rebuild |
| `bb search <query> [--dir] [--limit N] [--language LANG]` | Symbol search with freshness flags |
| `bb health [dir]` | Index stats + file freshness sample |
| `bb mcp [--dir DIR]` | Start the MCP server over stdio |

Indexes live at `~/.bb/projects/<sha1-of-dir>/brain.db` — no opencode, no
global config required.

## MCP server (Claude Code, Cursor, VS Code, opencode, …)

```bash
# Node (compiled dist, better-sqlite3) — the primary path:
node bin/bb mcp --dir ~/my-project

# Bun (from source, bun:sqlite — the compiled dist is Node-only by design):
bun run src/mcp/server.ts --dir ~/my-project
```

Claude Desktop (`claude_desktop_config.json`) — Node:

```json
{
  "mcpServers": {
    "bb-brain": {
      "command": "node",
      "args": ["/abs/path/to/backbencher-brain/bin/bb", "mcp", "--dir", "/abs/path/to/project"]
    }
  }
}
```

Claude Desktop — Bun (from source):

```json
{
  "mcpServers": {
    "bb-brain": {
      "command": "bun",
      "args": ["run", "/abs/path/to/backbencher-brain/src/mcp/server.ts", "--dir", "/abs/path/to/project"]
    }
  }
}
```

### Data directory (`BB_DATA_DIR`)

Indexes live under `~/.bb/projects/<sha1-of-dir>/brain.db` (WASM cache at
`~/.bb/wasm`) by default. Set `BB_DATA_DIR` to relocate both — useful in
sandboxes/CI or to keep an index inside the repo:

```bash
BB_DATA_DIR=/abs/path/to/project/.bb-data node bin/bb index /abs/path/to/project
BB_DATA_DIR=/abs/path/to/project/.bb-data node bin/bb mcp --dir /abs/path/to/project
```

VS Code workspace MCP (`<project>/.vscode/mcp.json`):

```json
{
  "servers": {
    "bb-brain": {
      "type": "stdio",
      "command": "node",
      "cwd": "${workspaceFolder}",
      "args": ["/abs/path/to/backbencher-brain/bin/bb", "mcp", "--dir", "${workspaceFolder}"],
      "env": { "BB_DATA_DIR": "${workspaceFolder}/.bb-data" }
    }
  }
}
```

Exposed tools:

- `bb_search` — AST symbol search; results carry a `[STALE]` flag when the
  file changed since indexing
- `bb_health` — index counts + freshness sample

## Semantic embeddings

See [EMBEDDINGS.md](./EMBEDDINGS.md) — 3 env vars turn on real embeddings
(Google / NVIDIA NIM / OpenAI / self-hosted), with offline word-vector
fallback when unconfigured.

## Verification

Every suite runs under Bun and Node:

```bash
bun run script/verify-core.ts && npx tsx script/verify-core.ts   # DB layer
bun run script/verify-engine.ts && npx tsx script/verify-engine.ts # parser
bun run script/verify-index.ts && npx tsx script/verify-index.ts   # indexer
bun run script/verify-embed.ts && npx tsx script/verify-embed.ts   # embeddings
bun run script/verify-freshness.ts && npx tsx script/verify-freshness.ts # reads
bun run script/verify-mcp.ts && npx tsx script/verify-mcp.ts       # MCP handshake + core tools
bun run script/verify-mcp-e2e.ts && npx tsx script/verify-mcp-e2e.ts # all 15 MCP tools end-to-end
```

Note: `verify-mcp-e2e.ts` spawns the real runtime entry — `node bin/bb mcp`
(compiled dist) under Node and `bun src/mcp/server.ts` (source, bun:sqlite)
under Bun — and exercises all 15 tools including the mutations.

## Roadmap

- `bb update` / `bb delete` (mutation tools — opt-in under MCP)
- `bb select` (byte-precise symbol extraction)
- publish as npm package (compiled dist for plain Node)
- opencode adapter: the 12 opencode tools become thin wrappers over this core
