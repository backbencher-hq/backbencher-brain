# backbencher-brain-core — universal code intelligence

Standalone, runtime-agnostic (Bun **and** Node) code intelligence core:
index any project with 40+ Tree-sitter language analyzers, then query it
from a CLI, an MCP server, or a library.

## Quick start

```bash
# index a project (Bun)
bun run bin/bb index ~/my-project

# or with Node
npx tsx bin/bb index ~/my-project

# search the index
bun run bin/bb search "calculateTotal" --dir ~/my-project
bun run bin/bb health ~/my-project
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
# run once per project; then point any MCP host at it
bun run bin/bb mcp --dir ~/my-project
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bb-brain": {
      "command": "bun",
      "args": ["run", "bin/bb", "mcp", "--dir", "/abs/path/to/project"]
    }
  }
}
```

Exposed tools (read-only for now — MCP has no permission system):

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
bun run script/verify-mcp.ts && npx tsx script/verify-mcp.ts       # MCP server
```

## Roadmap

- `bb update` / `bb delete` (mutation tools — opt-in under MCP)
- `bb select` (byte-precise symbol extraction)
- publish as npm package (compiled dist for plain Node)
- opencode adapter: the 12 opencode tools become thin wrappers over this core
