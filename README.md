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
| `bb setup` | Interactive embedding provider setup — key validated before save, config written 0600 |
| `bb setup show` | Show the effective embedding config — key as last-4 fingerprint only, never the full key |
| `bb doctor [--dir] [--fix]` | Diagnose embedding setup/index consistency; `--fix` repairs file permissions to 0600 only |
| `bb -v` / `bb version` | Print the version (same as `bb --version`) |

Indexes live at `~/.bb/projects/<sha1-of-dir>/brain.db` — no opencode, no
global config required.

### Indexing guides

Longer guides, for the questions the one-line table above cannot answer:

| Guide | Covers |
|---|---|
| [Indexing guide](docs/indexing/README.md) | Every `bb index` mode and flag, and what each does **not** do |
| [Resume](docs/indexing/resume.md) | Interrupting safely, what a checkpoint holds, how to verify a resume |
| [Performance](docs/indexing/performance.md) | What to expect, why a big repo takes time, how to speed it up |
| [Troubleshooting](docs/indexing/troubleshooting.md) | "Workers don't start", and every other common failure |
| [Embeddings](docs/indexing/embeddings.md) | Configuring the embedding provider; env vars and fallbacks |

### Help and manual

Every command documents itself: `bb --help` lists all commands, and
`bb <command> --help` (or `bb help <command>`) shows the options of that
command. `bb -v`, `bb version`, and `bb --version` all print the version.
A mistyped command suggests the closest real one (`bb docter` suggests
`doctor`) and points to `bb --help`. After `npm install -g`, the full
manual is available as `man bb`.

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

The MCP server advertises exactly ten public tools: `bb_search`, `bb_ask`,
`bb_analyze`, `bb_patterns`, `bb_security`, `bb_doc`, `bb_visualize`,
`bb_migrate`, `bb_edit`, and `bb_health`. Removed pre-`0.3.0` aliases are documented
in the migration guide and changelog. See the generated
[canonical tool metadata](./docs/data/public-tools.json) and [tool references](./docs/tools/).

For the complete operational lifecycle, including CLI/MCP parity, project identity,
database storage, indexing stages, host setup, every public tool, evidence semantics,
and known integration risks, see [MCP, CLI, and Indexer Guide](./docs/MCP_CLI_INDEXER_GUIDE.md).

Future intelligence decisions are governed by
[M10: Intelligence Consolidation and Evidence Governance](./docs/M10-EVIDENCE-GOVERNANCE.md),
which defines the evidence taxonomy, disposition rules, issue order, and proof required
before capabilities can be kept, migrated, improved, quarantined, removed, or declared complete.

## Semantic embeddings

See [EMBEDDINGS.md](./EMBEDDINGS.md). Real vector embeddings are generated
when an OpenAI-compatible embeddings API is configured; otherwise a local
word-vector fallback (`local-word-vectors`) is used — declared weaker, not
"the same offline". Both are stored separately, labeled by producing model,
and the vector search never compares across vector spaces.

The easiest first step is `bb setup`: it offers prefilled free providers
(OpenRouter free, NVIDIA NIM free), hides the key while you type, validates
it with one live `/embeddings` call before saving (bad keys are never saved),
and writes `~/.bb/config.json` with mode 0600. The first `bb index` run
without any key shows a one-line honest notice and proceeds with local word
vectors; add a real model later and re-embed with `bb index --force`.
The wizard prompts only once — an explicit skip is remembered.

To inspect what is configured, `bb setup show` prints every precedence tier
(env / global / project), the winning tier, and the key as a last-4
fingerprint only — never the full key. To diagnose degraded semantic search,
`bb doctor` reads real local state (config, permissions, stored embedding
models) and names the exact fix command for each finding; its exit code is 1
when a hard finding exists. `bb doctor --fix` mutates exactly one thing —
config file permissions, repaired to 0600 — printing every change and
refusing everything else. See EMBEDDINGS.md for details.

For manual configuration:

Google Gemini (OpenAI-compatible endpoint) — the fastest way to turn on
real embeddings:

```bash
export BB_EMBEDDING_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
export BB_EMBEDDING_API_KEY="<your gemini api key>"
export BB_EMBEDDING_MODEL="gemini-embedding-001"   # 3072-dim
bb index --force <project>                          # re-embed everything
```

**Free option — OpenRouter** (`:free` models, $0, rate-limited but plenty
for moderate projects; fully verified end-to-end):

```bash
export BB_EMBEDDING_BASE_URL="https://openrouter.ai/api/v1"
export BB_EMBEDDING_API_KEY="sk-or-v1-..."           # your openrouter key
export BB_EMBEDDING_MODEL="nvidia/nemotron-3-embed-1b:free"   # 2048-dim
```

Or put the same keys in `~/.bb/config.json`:

```json
{
  "embedding_base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
  "embedding_api_key": "<key>",
  "embedding_model": "gemini-embedding-001"
}
```

Note: the free tier is quota-limited (roughly one 100-doc batch before HTTP
429) — a paid key is needed for real projects. A 429 or provider blip degrades
one batch to the local fallback with a bounded backoff; it does not silently
poison the rest of the run. Vectors are labeled by the model that produced
them (`gemini-embedding-001` vs `local-word-vectors`), and
`BB_EMBEDDING_BATCH_LIMIT` controls the max symbols per index batch (default
50000). Changing model or dimension requires `bb index --force`; vectors from
different spaces are never mixed.

## Architecture and verification

Tree-sitter analyzers and the SQLite index provide the evidence substrate;
`src/intelligence/` contains strict domain engines; the MCP server and CLI are
thin adapters over the shared registry and handlers. Read-only tools never
refresh implicitly. Mutation goes through `bb_edit`, which protects project-root
paths, validates ASTs, writes atomically, and reindexes affected files. See the
[tool registry](./docs/TOOL-REGISTRY.md), [MCP migration](./docs/MCP_TOOL_MIGRATION.md),
and [canonical documentation](./docs/data/public-tools.json).

Run `npm run docs:verify` to detect registry, schema, default, example, or
curated-reference drift. Embedding setup and evidence limitations are documented
in [EMBEDDINGS.md](./EMBEDDINGS.md).

## Verification

Every suite runs under Bun and Node:

```bash
bun run script/verify-core.ts && npx tsx script/verify-core.ts   # DB layer
bun run script/verify-engine.ts && npx tsx script/verify-engine.ts # parser
bun run script/verify-index.ts && npx tsx script/verify-index.ts   # indexer
bun run script/verify-embed.ts && npx tsx script/verify-embed.ts   # embeddings
bun run script/verify-freshness.ts && npx tsx script/verify-freshness.ts # reads
bun run script/verify-mcp.ts && npx tsx script/verify-mcp.ts       # MCP handshake + core tools
bun run script/verify-mcp-e2e.ts && npx tsx script/verify-mcp-e2e.ts # public tools plus compatibility calls
```

Note: `verify-mcp-e2e.ts` spawns the real runtime entry — `node bin/bb mcp`
(compiled dist) under Node and `bun src/mcp/server.ts` (source, bun:sqlite)
under Bun, exercising the ten advertised tools and hidden compatibility calls.

## Public API lifecycle

Version `0.3.0` exposes the ten-tool MCP surface above. Removed aliases and their
replacements are listed in [MCP_TOOL_MIGRATION.md](./docs/MCP_TOOL_MIGRATION.md) and
[CHANGELOG.md](./CHANGELOG.md).
The machine-readable artifact is standalone JSON, so website and host integrations
do not need to import server runtime code or parse prose.
