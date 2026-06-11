# Backbencher Brain — Universal MCP Code Intelligence Server

**Index any project. Query with AI. 40 languages. 14 tools. One command.**

[![npm version](https://img.shields.io/badge/npm-v0.1.0-blue)](https://npmjs.com/package/backbencher-brain)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## What is this?

Backbencher Brain is a standalone MCP (Model Context Protocol) server that indexes your project's source code using Tree-sitter AST parsers and exposes **14 code intelligence tools** to any AI assistant.

**It gives LLMs surgical vision into your codebase.**

Instead of the AI reading entire files to find one function, the brain returns exact byte-precise code with call graphs, security vulnerabilities, and cross-language relationships.

## Quick Start

```bash
npm install -g backbencher-brain

cd your-project
bb start
```

That's it. The brain indexes your project and starts an MCP server over stdio.

## Connect to Your AI Tool

Add to your MCP host config:

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "brain": {
      "command": "bb",
      "args": ["start"]
    }
  }
}
```

### OpenCode (`opencode.json`)
```json
{
  "mcpServers": {
    "brain": {
      "command": "npx",
      "args": ["backbencher-brain", "start"]
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "brain": {
      "command": "bb",
      "args": ["start", "${workspaceFolder}"]
    }
  }
}
```

## CLI Commands

| Command | Description |
|---|---|
| `bb start [path]` | Start MCP server (auto-indexes) |
| `bb index [path]` | Index project only |
| `bb status [path]` | Show index health dashboard |
| `bb list` | List all indexed projects |
| `bb clean [path]` | Remove project index |

## 14 MCP Tools

### Read Tools
| Tool | Description |
|---|---|
| `brain_search` | Search symbols by name with FTS5 content fallback |
| `brain_select` | Byte-precise symbol/file reading with callers/callees |
| `brain_relationships` | Callers, callees, recursive trace, imports, exports, coupling |
| `brain_ask` | Quick answers about codebase statistics and concepts |
| `brain_health` | File/symbol/relationship counts, language breakdown |
| `brain_security` | Cross-language vulnerability scanning (SQLi, XSS, RCE) |
| `brain_patterns` | Orphaned code, complexity analysis, violations |
| `brain_visualize` | Interactive D3.js dependency graphs (HTML/JSON) |
| `brain_refresh` | Trigger project reindexing |

### Write Tools
| Tool | Description |
|---|---|
| `brain_update` | Byte-precise code replacement with cascade protection |
| `brain_insert` | Insert code with auto-import injection |
| `brain_delete` | Delete symbols with cascade check + import pruning |
| `brain_refactor` | Rename symbols across all call sites |
| `brain_write` | Create files with auto-wiring + syntax validation |

## Supported Languages (40)

TypeScript, JavaScript, Python, Java, Go, Rust, C, C++, C#, F#, Ruby, PHP, Swift, Kotlin, Scala, Dart, Lua, Perl, Elixir, Erlang, Haskell, Clojure, R, SQL, Bash, PowerShell, Groovy, Zig, Objective-C, GraphQL, HTML, CSS, JSON, YAML, Vue, Svelte, HCL, Clean

## Architecture

```
┌──────────────┐    stdio JSON-RPC    ┌──────────────┐
│  AI Assistant │ ◄──────────────────► │  bb MCP      │
│  (Claude etc) │                      │  Server      │
└──────────────┘                      └──────┬───────┘
                                             │
                                    ┌────────▼───────┐
                                    │  Query Layer   │
                                    │  15 SQL fns    │
                                    └────────┬───────┘
                                             │
                              ┌──────────────▼──────────────┐
                              │  SQLite DB                  │
                              │  files · symbols · rels     │
                              │  imports · taints · FTS5   │
                              └─────────────────────────────┘
                                             ▲
                              ┌──────────────┴──────────────┐
                              │  Parallel Indexer           │
                              │  40 analyzers · worker pool │
                              └─────────────────────────────┘
```

## How It Works

1. **Index** — Walks project directory, respects `.gitignore`/`.bbignore`, parses every source file with Tree-sitter WASM parsers, extracts symbols/relationships/imports/taints, stores in SQLite
2. **Serve** — Starts MCP server over stdin/stdout. AI tools call `brain_search`, `brain_select`, etc.
3. **Edit** — Write tools use byte-precise surgical patching to modify code safely with undo backups

## Development

```bash
git clone https://github.com/backbencher-hq/backbencher-brain
cd backbencher-brain
npm install
npm run dev          # Run in development mode
npm run build        # Compile TypeScript
npm run typecheck    # Strict type checking
npm test             # Run tests
```

### Syncing Analyzers from Upstream

When analyzers are updated in the main backbencher repo:

```bash
./scripts/sync-analyzers.sh /path/to/backbencher
```

This copies all `real-*-analyzer.ts` files, replaces imports, and preserves structural identity.

## License

MIT
