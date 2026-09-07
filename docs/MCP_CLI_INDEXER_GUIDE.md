# Backbencher Brain: MCP, CLI, and Indexer Guide

This document is the end-to-end operational reference for Backbencher Brain `0.3.0`.
It explains the shared index, how CLI and MCP use it, what happens during indexing,
how hosts launch the server, and the complete ten-tool surface. Analyzer, WASM,
Tree-sitter, and AST implementation internals are intentionally deferred to a later
document. This guide describes their boundary and outputs, not their algorithms.

## 1. Mental Model

Backbencher Brain has four operational pieces:

1. **Project**: the source directory being understood.
2. **Indexer**: the process that reads project files and stores structured evidence.
3. **Brain database**: a project-scoped SQLite database containing `brain_*` tables.
4. **Adapters**: the CLI and MCP server, which query or update the shared database.

The normal lifecycle is:

```text
source project
  -> bb index / indexProjectParallel
  -> ~/.bb/projects/<project-id>/brain.db
  -> CLI commands or MCP tools
  -> search, analysis, docs, visualization, migration, health, or edit results
```

The MCP server does not independently index source code during startup. It receives a
project directory, derives its project ID, opens the corresponding database, and serves
requests against that index. Indexing is explicit through `bb index`, `bb_health` refresh,
or `bb_edit`'s affected-file reindexing.

## 2. Entry Points

### Compiled Node executable

`bin/bb` is a Node launcher for `dist/cli/index.js`:

```bash
npm run build
node bin/bb --version
node bin/bb index /absolute/path/to/project
node bin/bb mcp --dir /absolute/path/to/project
```

The compiled distribution targets Node and uses `better-sqlite3`. A source checkout must
be built before using `node bin/bb`; source execution is the Bun path.

### Bun source executable

Bun runs the TypeScript entry points directly:

```bash
bun run src/cli/index.ts index /absolute/path/to/project
bun run src/cli/index.ts search "handleRequest" --dir /absolute/path/to/project
bun run src/mcp/server.ts --dir /absolute/path/to/project
```

Bun uses the `bun:sqlite` storage adapter. Do not run the compiled Node/better-sqlite3
fixture with Bun when the native driver is required.

### Library entry point

The package exports database, indexer, search, freshness, version, and registry surfaces
from `src/index.ts`. Library consumers can call `indexProjectParallel(projectId, path, options)`
and then use the intelligence/library APIs directly. MCP and CLI should be preferred when
a host needs a stable tool contract rather than a TypeScript library API.

## 3. Project Identity And Storage

`getProjectId(projectPath)` hashes `path.resolve(projectPath)` with SHA-1 and uses the
40-character hexadecimal digest. The default database path is:

```text
~/.bb/projects/<project-id>/brain.db
```

`BB_DATA_DIR` relocates the data root:

```bash
BB_DATA_DIR=/absolute/path/.bb-data node bin/bb index /absolute/path/project
BB_DATA_DIR=/absolute/path/.bb-data node bin/bb mcp --dir /absolute/path/project
```

The same project path and data directory must be used by indexing and MCP. Host examples
that use `${workspaceFolder}` should use that same resolved directory for both `--dir` and
any explicit CLI indexing command. A symlinked path can produce a different project ID
because identity is path-string-based rather than filesystem-realpath-based.

The database layer caches raw SQLite and Drizzle handles. It creates the project database
and schema when a writable operation opens a new path. The database may also be registered
at an explicit path for an adapter integration, but this is an integration boundary rather
than a normal CLI workflow.

## 4. What The Indexer Is

The indexer is the ingestion pipeline between source files and queryable evidence. It is
not the MCP server, not a language analyzer itself, and not a runtime execution engine.
It coordinates file discovery, parsing, persistence, relationship work, embeddings, and
post-index health work.

### Full index lifecycle

`indexProjectParallel(projectId, projectPath, options)` performs approximately these stages:

1. Publishes an indexing-start event and initializes counters.
2. Discovers candidate files beneath the project root.
3. Applies extension support, ignore files, built-in exclusions, and project skip rules.
4. Compares file metadata/hash state for incremental decisions when applicable.
5. Chooses a forked worker pool when available, otherwise an in-process fallback.
6. Parses files and extracts structured records.
7. Stores file, symbol, import, relationship-input, embedding, and taint-input data.
8. Retries or reports files that fail, time out, or are missed during batch storage.
9. Updates persisted index status and publishes progress/completion events.
10. For a full index, resolves cross-file relationships and enriches graph context.
11. Computes derived gravity/project-health/security information.
12. Runs lightweight integrity checks and reports warnings or errors.

The exact parser/analyzer/WASM pipeline is intentionally outside this guide. The important
contract is that downstream tools query persisted `brain_*` evidence and report limitations
when that evidence is stale, unavailable, truncated, or heuristic.

### Incremental indexing

Edits and targeted refreshes can reindex affected files. The incremental path removes old
rows for selected files, parses replacements, clears relevant query cache state, and stores
new rows. It is cheaper than a full index, but derived cross-file graph and taint enrichment
is not equivalent to a full rebuild in every path. Run a full refresh when relationship
completeness matters after broad changes.

### Force indexing

`bb index --force` wipes indexed project data in place and rebuilds. The database file is
kept at the same path to avoid stale open handles in long-lived processes. Keeping the file
inode stable is not an atomic snapshot guarantee: concurrent readers may observe an empty or
partially rebuilt database. Do not run overlapping full refreshes or edits against the same
project until lifecycle locking is added.

### Progress and logging

Indexer progress is published internally and CLI progress is printed for human users. MCP
uses stdio as its JSON-RPC transport, so ordinary logs must not be written to stdout while
an MCP server is connected. This is a known integration risk for refresh operations in the
current implementation; use status-only health and external CLI indexing until that stream
separation is corrected.

## 5. CLI

### Ergonomic commands

| Command | Purpose |
|---|---|
| `bb index <dir>` | Full/incremental project indexing |
| `bb index <dir> --force` | In-place wipe and full rebuild |
| `bb search <query>` | Symbol retrieval (default listing; `--mode symbols` equals the default), language and limit filters; auto-refreshes stale files within budget before answering and declares it |
| `bb search --no-auto-refresh <q>` | Answer from the existing index with the staleness footer instead of auto-refreshing (same decision as MCP `refresh=false`) |
| `bb search --mode content <q>` | Content/snippet retrieval (same handler as MCP `bb_search` mode=content) |
| `bb search --mode symbol <name>` | Exact-symbol source lookup (MCP mode=symbol parity) |
| `bb search --mode file <path>` | Print an indexed file with freshness status (MCP mode=file parity) |
| `bb health [dir]` | Unified health/freshness report |
| `bb health [dir] --refresh` | Refresh (incremental + bounded derived pass) then report health; output states `derived=` |
| `bb health [dir] --force` | Force full refresh then report health |
| `bb health [dir] --complete` | Check all files instead of a freshness sample |
| `bb health [dir] --integrity` | Run the index integrity checks |
| `bb mcp --dir <dir>` | Start MCP over stdio |
| `bb tool <name> --args <json>` | Invoke a public tool through shared handlers |
| `bb --version` | Print package version |

### Which status command when

All five read commands are intentional; they answer different questions.

| Question | Command | Reads |
|---|---|---|
| "Is an index running right now? What phase?" | `bb status` | Live run state + last-run phase timings |
| "How big is the index? How many symbols?" | `bb stats` | Committed DB counts (files/symbols/relationships/embeddings) |
| "Is the data trustworthy/current?" | `bb health` | Freshness envelope, embeddings coverage, integrity (opt-in) |
| "Is my setup broken? Can it be auto-repaired?" | `bb doctor` | Permissions, config, first-run checks (`--fix` applies) |
| "What exists on this machine? Reclaim space?" | `bb projects` | Registry of all indexed projects + `--remove` |

### CLI and MCP parity

`bb tool` and MCP share the registry and `createToolHandlers()` dispatch. This is the
preferred parity path:

```bash
node bin/bb tool bb_search --dir . --args '{"query":"handleRequest"}'
node bin/bb tool bb_analyze --dir . --args '{"mode":"stats"}'
node bin/bb tool bb_doc --dir . --args '{"mode":"symbol","target":"handleRequest","format":"json"}'
```

Ergonomic `index`, `search`, and `health` commands are thin convenience adapters over the
same provider options. `bb search --mode content|symbol|file` dispatches through the REAL
`bb_search` MCP handler — identical result sets and freshness envelopes on both surfaces
(proven e2e by `script/m40/verify-a7-cli-parity.ts`). `bb search` with `--mode` omitted (the
default symbols listing) renders the same rows as MCP symbols mode with a stale-count footer.

### Freshness automation knobs (M43)

Read paths auto-refresh stale files within budget before answering and declare it
(`auto-refreshed N files in Xms` on MCP answers, a trailing line on CLI answers). The
budget applies to the files each read actually touched: at most
`BB_AUTO_REFRESH_MAX_FILES` files (default 25) and `BB_AUTO_REFRESH_MAX_BYTES` bytes of
modified content (default 2 MiB). Out of budget, disabled, or while another indexer holds
the single-flight index lock, the read answers from existing data with the staleness block
and an honest decline. Disable entirely with `BB_NO_AUTO_REFRESH=1` or per call with MCP
`refresh=false` / CLI `--no-auto-refresh`. Only `BB_NO_AUTO_REFRESH=1` disables; other
values leave auto-refresh enabled. Test-only hooks (`BB_TEST_INDEX_LOCK_OFF`, …) do
nothing unless `BB_TEST_HOOKS=1` is set.

## 6. MCP Server Lifecycle

Starting MCP does the following:

1. Resolves the requested project directory.
2. Builds a `ToolContext` containing `projectPath` and `projectId`.
3. Creates an MCP `Server` with the package version.
4. Registers `tools/list` to expose the exact ten public descriptors.
5. Registers `tools/call` to resolve descriptors and handlers.
6. Rejects unknown/undeclared option names.
7. Blocks index-required tools when the requested project has no indexed files.
8. Invokes the shared handler and returns text content or structured JSON encoded as text.
9. Normalizes thrown errors into MCP error responses.
10. Connects `StdioServerTransport`.

MCP stdout is a protocol channel, not a human log channel. Host integrations must launch
one long-lived process and communicate through stdin/stdout JSON-RPC. Diagnostics belong on
stderr. The current indexer still has ordinary progress writes in full post-processing;
this is a known high-severity issue for MCP refresh calls.

## 7. Host Setup

Use absolute executable and project paths whenever possible. Ensure indexing and MCP use the
same project directory and `BB_DATA_DIR`.

### Claude Desktop

```json
{
  "mcpServers": {
    "bb-brain": {
      "command": "node",
      "args": ["/abs/backbencher-brain/bin/bb", "mcp", "--dir", "/abs/project"]
    }
  }
}
```

### Claude Code

Use the host's project or user MCP configuration with the same stdio command:

```json
{
  "mcpServers": {
    "bb-brain": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/backbencher-brain/bin/bb", "mcp", "--dir", "/abs/project"]
    }
  }
}
```

The exact Claude Code registration command/config location depends on the installed host
version; the executable contract is the same.

### VS Code

```json
{
  "servers": {
    "bb-brain": {
      "type": "stdio",
      "command": "node",
      "cwd": "${workspaceFolder}",
      "args": ["/abs/backbencher-brain/bin/bb", "mcp", "--dir", "${workspaceFolder}"],
      "env": { "BB_DATA_DIR": "${workspaceFolder}/.bb-data" }
    }
  }
}
```

### Cursor

A conventional `.cursor/mcp.json` configuration is:

```json
{
  "mcpServers": {
    "bb-brain": {
      "command": "node",
      "args": ["/abs/backbencher-brain/bin/bb", "mcp", "--dir", "/abs/project"]
    }
  }
}
```

Confirm variable interpolation and environment syntax against the installed Cursor version.

### opencode

The repository has an explicit database-path registration capability for adapters, but it
does not define a version-stable opencode configuration schema. Configure opencode's local
stdio MCP server using its installed host documentation and the same `node bin/bb mcp` argv.
Do not import the MCP server runtime into website or host documentation generation.

## 8. Public Tool Reference

All ten tools are read or explicitly bounded mutation surfaces. Generated per-tool pages
under `docs/tools/` and `docs/data/public-tools.json` are the contract source for schemas,
defaults, examples, returns, errors, limitations, performance, safety, and evidence.

### `bb_search`

Modes: `symbols`, `content`, `symbol`, `file`. Retrieves indexed names/content/exact source
or file results. Read-only. Use `query` for lexical retrieval, `symbolName` for exact source,
and `filePath` for file targeting. Results may carry stale evidence.

```json
{"query":"handleRequest","limit":10}
```

### `bb_ask`

Natural-language semantic codebase retrieval. Requires `query`; `limit` defaults to 5.
Semantic matches discover evidence candidates but do not independently prove claims.

```json
{"query":"How does request authentication work?"}
```

### `bb_analyze`

Modes: `callers`, `callees`, `trace`, `dependencies`, `stats`, `complexity`, `impact`,
`test_mapping`, `test_gaps`, `test_impact`, `test_quality`. Use `target` or `filePath`
only where the selected mode permits it. Results are static indexed analysis.

```json
{"mode":"impact","target":"handleRequest"}
```

### `bb_patterns`

Scopes: `orphaned` and `all`. Reports confidence-qualified orphan/framework/anti-pattern
findings. `recordRun` explicitly persists analysis history; status is otherwise read-only.

```json
{"scope":"all","limit":20,"confidenceThreshold":0.6}
```

### `bb_security`

Current public mode is `findings`. Reports source/sink taint evidence, normalized labels,
confidence, mitigations, and limitations. It is static analysis, not penetration testing.

```json
{"recordRun":true,"limit":20}
```

### `bb_doc`

Modes: `symbol`, `file`, `module`, `feature`, `api`, `project`, `coverage`. Produces cited
Markdown or JSON. Evidence is classified and unknown facts remain explicit.

```json
{"mode":"symbol","target":"handleRequest","format":"json","includeTests":true}
```

### `bb_visualize`

Scopes: `project`, `file`, `module`, `symbol`, `feature`; formats: `text`, `json`, `html`.
Returns bounded canonical graph data with provenance and truncation metadata.

```json
{"scope":"symbol","target":"handleRequest","format":"json","maxNodes":100}
```

### `bb_migrate`

Read-only migration planning for one or many symbols. Requires `targetLanguage`; plans are
estimates and dependency ordered, not translated source.

```json
{"symbolNames":["parse","handle"],"targetLanguage":"rust","format":"json"}
```

### `bb_edit`

Modes: `write`, `update`, `insert`, `delete`, `refactor`. This is the only public source
mutation tool. Use `dryRun` first. It enforces project-root containment, AST bounds, caller
protection, validation, atomic writes, rollback, formatting, and reindexing.

```json
{"mode":"update","symbolName":"helper","newContent":"return 2","dryRun":true}
```

### `bb_index`

Modes: `auto`, `file`, `dir`. This is the agent-fresh reindex tool: after writing or
editing a file, call it to make that file (or an incremental directory set) visible in
the index immediately instead of waiting for a full index run. A file reindex updates
only that file's evidence; cross-file relationships refresh on the next incremental
dir index. Write-capable against index data only; it never modifies source files.

```json
{"path":"src/new-file.ts"}
```

### `bb_health`

Reports counts, schema, freshness, embeddings, runtime, integrity, and optional analysis
history. `refresh=true` explicitly indexes; `force=true` also requests a full rebuild. With
`wait=false`, refresh starts in the background and the current snapshot is returned immediately.
Refreshes are serialized per project so concurrent callers cannot overlap a wipe/index cycle.
`freshness=complete` checks every indexed file. Status-only calls are read-only.

```json
{"freshness":"complete","integrity":true,"includeAnalysisRuns":true}
```

### `bb_graph`

Per-symbol dependency graph: callers, callees, per-edge evidence tier and confidence.
`maxDepth` defaults to 3 (max 10); truncated traversals are declared with a reason.
Read-only; same engine and tier rules as the editor graph panel.

```json
{"symbol":"handleRequest","maxDepth":3}
```

### `bb_impact`

Downstream dependents of one symbol with per-edge evidence tiers, from the same engine as
`bb_analyze` impact. Unknown symbols are declared absent, never guessed. Read-only.

```json
{"symbol":"handleRequest"}
```

### `bb_cross_language`

Cross-language facts for one symbol from stored `is_cross_language = 1` relationship rows
only: per-pair bridge mechanism and evidence tier. Pairs with no stored rows are declared
absent — it never infers. Read-only.

```json
{"symbol":"handleRequest"}
```

### `bb_annotate`

Write a typed, provenance-carrying agent annotation onto a symbol. Empty or over-limit
(2000 chars) bodies are declared refusals, not silent no-ops. Writes annotation-store data
only; never source files. Store semantics are owned by the M28 workstream.

```json
{"symbol":"handleRequest","body":"auth entry point"}
```

### `bb_annotations`

Read annotations for a symbol (or all, up to `limit`, cap 200) with full provenance.
Absence is declared, never an error. Read-only.

```json
{"symbol":"handleRequest"}
```

## 9. Evidence Semantics

The database is an evidence cache, not a runtime execution trace. Source paths, line ranges,
AST symbols, imports, relationships, hashes, and stored vectors are primary indexed evidence.
Semantic similarity is candidate discovery. Static pattern/security findings are heuristic and
confidence-qualified. Documentation preserves citations and unknown states. A stale flag means
source changed relative to indexed metadata; it does not automatically mean every result is false.

## 10. Integration Guarantees And Risks

- **MCP stdio safety:** indexer progress is routed through an injected logger during MCP health
  refreshes, so stdout remains reserved for JSON-RPC messages.
- **Background refresh:** `wait=false` returns the current snapshot without awaiting the indexer;
  refresh failures are handled by the background task and reported by a later health call.
- **Refresh serialization:** refreshes are serialized per project, including force rebuilds. The
  current in-place model can still expose partial data to readers while one refresh is active.
- **Runtime validation:** MCP and the `bb tool` gateway enforce declared fields, required fields,
  primitive types, enums, and supported numeric bounds before handlers run.
- **Project identity aliases:** lexical resolved paths and symlinks can create separate IDs.
- **Runtime/storage differences:** Node and Bun adapters differ in WAL, readonly, and result-value
  semantics; the package root directly exports the Bun adapter.
- **Version/reproducibility:** package declares Node `>=18` while building for Node 20, and no
  committed dependency lockfile is visible.
- **Secret hygiene:** local `bb.json` is ignored but contains a credential-like embedding key;
  rotate it if real and do not package or commit it.
- **Historical docs:** migration/registry/health/graph pages contain references to removed aliases
  or old tool counts and should be labeled historical or corrected.

Until these are addressed, use status-only MCP health, perform refreshes from the CLI with the
MCP server stopped, and keep CLI/MCP project paths and `BB_DATA_DIR` identical.

## 11. Verification

```bash
npm run typecheck
npm run build
npm run docs:verify
npm run verify
```

The aggregate gate covers core storage, parsing/indexing, embeddings, freshness, schemas, public
registry, search modes, semantic retrieval, graph, analysis, patterns, security, test intelligence,
history, editing, health, documentation, visualization/migration, CLI surface, MCP handshake,
contracts, and MCP E2E. The gate is broad but does not yet cover concurrent refresh, clean stdio
under refresh, complete runtime schema rejection, symlink project identity, or lockfile-based
installation reproducibility.

## 12. Deferred Analyzer Internals

A later document will explain supported language analyzers, WASM asset resolution, Tree-sitter
parsing, AST extraction, relationship resolution, embeddings, taint analysis, and analyzer-specific
performance. This operational guide intentionally stops at their indexer boundary.
