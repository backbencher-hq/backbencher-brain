# Backbencher Brain (`bb`)

**Evidence is the answer.** `bb` is local-first, runtime-agnostic code intelligence: it indexes a repository with
**50 Tree-sitter language analyzers**, stores the result in a per-project SQLite database, and answers
questions about it from a CLI, an **MCP server** for agent hosts, or a library. Node **and** Bun are
supported. No telemetry, no server, no account required.

```
source ──▶ AST index (SQLite) ──▶ graph / search / evidence ──▶ bb CLI · MCP · library
```

The index stores symbols, relationships (including cross-language edges), complexity, framework and
security-flow inputs, and optional embeddings. Every answer declares whether it is fresh or stale; a
missing answer is reported as missing rather than guessed. Embeddings are model-labeled per row, and
`bb_ask` never compares across vector spaces: rows written by a different model are not searched
until `bb index --force` re-embeds them, and the answer says so instead of returning a mixed index
as if it were one space.

- **Docs index:** [`docs/README.md`](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/README.md)
- **Indexing guide:** [`docs/indexing/README.md`](docs/indexing/README.md)
- **Analyzers:** one canonical page per language — [`docs/analyzers/README.md`](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/analyzers/README.md)
- **Tools:** [`docs/tools/`](docs/tools/) (generated from the tool registry)

---

## Install

Backbencher ships as an npm package. Node.js 18 or newer is the only requirement.

```bash
npm install -g backbencher-brain
bb --version
```

The package is the primary and version-exact path — it is what `bb upgrade` reports as the install command.

### Installer scripts (alternative)

On Linux, macOS and Windows the `install.sh` / `install.ps1` installers are also available. They **prefer
npm** and only fall back to a checksum-verified GitHub release binary when npm is not available.

**Linux and macOS**

```bash
curl -fsSL https://backbencher.cc/install.sh | bash
```

**Windows PowerShell**

```powershell
irm https://backbencher.cc/install.ps1 | iex
```

When the scripts fall back to a release binary they install it to `~/.local/bin` (`%USERPROFILE%\.local\bin`
on Windows); add that directory to your `PATH`.

### Pin a release

```bash
npm install -g backbencher-brain@0.1.0
# or with the installer scripts:
VERSION=0.1.0 curl -fsSL https://backbencher.cc/install.sh | bash
```

### From source (contributors)

The compiled `dist/` path runs under Node (better-sqlite3); the source path runs under Bun (`bun:sqlite`)
and is what the analyzer gates use:

```bash
git clone https://github.com/backbencher-hq/backbencher-brain.git
cd backbencher-brain
npm ci
npm run build
node bin/bb --help
# or, without a build, under Bun:
bun src/cli/index.ts --help
```

### Requirements

| | |
| --- | --- |
| OS / arch | Linux x64 & arm64, macOS x64 & arm64, Windows x64 & arm64 (WSL: use the Linux path) |
| npm install | Node.js **>= 18** (better-sqlite3 native module; prebuilt binaries are used automatically) |
| Installer scripts | npm on `PATH`, or a published release binary whose sha256 verifies against the release's `checksums.txt` |
| Build from source | Node >= 18, `npm ci`, `npm run build`; Bun optional for the source/dev path |
| Network | none for indexing; only the embedding provider you configure and the `bb upgrade` check |
| Disk | one SQLite database per project under `~/.bb` (see [Linux notes](#linux-notes) and [performance](docs/indexing/performance.md)) |

`bb` is a foreground CLI and a stdio MCP server. There is no daemon, no systemd unit and no background
service to install.

---

## Quick start

```bash
# 1. Index a project (runs in parallel; safe to re-run — only changed files are parsed)
bb index ~/my-project

# 2. Search the index
bb search "calculateTotal" --dir ~/my-project

# 3. Index counts, health and freshness
bb stats ~/my-project
bb health ~/my-project

# 4. Optional: semantic retrieval over the index (local fallback works without a key)
bb setup
bb tool bb_ask --dir ~/my-project --args '{"query":"how does request authentication flow?"}' 
```

`bb index` reports what it actually did — files parsed, skipped and unchanged, symbols and relationships,
how long each phase took, and the final index health. The first run on a large repository takes minutes;
later runs only parse changed files. `bb index --force` rebuilds from scratch, and `bb index --changed`
does an incremental pass. The complete mode/flag matrix and every failure mode are in the
[indexing guide](docs/indexing/README.md).

---

## Linux notes

Linux-specific operational details, because this is the platform most installs run on:

- **Where data lives.** `~/.bb/projects/<sha1-of-realpath>/brain.db` (one database per indexed project),
  with the WASM parser cache under `~/.bb/wasm`. `bb projects` lists every project with its database path,
  size, counts and last index time; `bb projects --remove <id>` deletes one (`--force` skips the
  confirmation).
- **Read-only home, containers, CI.** `BB_DATA_DIR` relocates the whole data directory, which is the
  supported way to run where `$HOME` is read-only or where you want the index next to the repo:

  ```bash
  BB_DATA_DIR=/abs/project/.bb-data bb index /abs/project
  BB_DATA_DIR=/abs/project/.bb-data bb mcp --dir /abs/project
  ```

- **No root, no service.** Everything runs as your user. Config written by `bb setup` is `0600`; API keys
  are never printed in full (`bb setup show` shows a truncated fingerprint). There is no daemon to start —
  the MCP server runs over stdio for as long as the host keeps it open.
- **WAL needs a writable filesystem.** The database uses SQLite WAL mode; it needs a filesystem where
  `brain.db` and its `-wal`/`-shm` files can be created and renamed. Network filesystems with broken POSIX
  locking are not a supported data directory.
- **Headless and SSH.** Indexing and the CLI work without a display or TTY. Live progress is a redrawing
  line on a TTY and rate-limited milestone lines in a pipe/log (with ETA), so `ssh host bb index … | tee`
  stays readable.
- **CPU and memory.** The parse pool uses `min(cpus - 1, 12)` workers; one run per project is enough.
  `bb index --concurrency <n>` (1–64) or `BB_INDEX_CONCURRENCY` pins the worker count for a machine where
  you want to leave headroom. Memory scales with the worker count and file size; very large files are
  capped by the discovery rules described in [`docs/indexing/discovery-matrix.md`](docs/indexing/discovery-matrix.md).
- **Updating and removing.**
  - npm install: `npm install -g backbencher-brain@latest`; `bb upgrade` tells you whether a newer release
    exists and prints the exact command, but deliberately does not replace its own files;
  - installer scripts: re-run the installer (or prefix `VERSION=…` to pin);
  - remove the program with `npm rm -g backbencher-brain` (or delete the release binary); remove `~/.bb`
    (or your `BB_DATA_DIR`) to delete every index and the embedding config.
- **WSL.** Use the Linux installer inside the WSL distribution; the index lives on the Linux filesystem, so
  index projects from inside the distro rather than across `/mnt/c` when you care about speed.

---

## CLI

```bash
bb --help                 # every command
bb <command> --help       # per-command options
bb help <command>         # same, via the help command
```

| Command | Purpose |
| --- | --- |
| `bb index [dir]` | Build/refresh the index (modes: full, `--changed`, `--resume`, `--post`, `--skip-post-processing`, `--file`, `--exclude`, `--concurrency`, `--force`) |
| `bb search [query]` | Search the index: modes `symbols` (default), `content`, `symbol`, `file` |
| `bb stats [dir]` | Counts only (files/symbols/relationships/embeddings) and the database path |
| `bb status [dir]` | In-flight/last-run state and per-phase timings (discovery, parse, db flush) |
| `bb health [dir]` | Index health and file freshness |
| `bb projects` | Every indexed project: DB path, size, counts, last index (`--remove <id>`, `--force`) |
| `bb setup` | Interactive embedding-provider setup (key validated before saving, written `0600`) |
| `bb setup show` | Print effective embedding config (key as truncated fingerprint only, never the full key) |
| `bb doctor [--dir] [--fix]` | Read-only diagnosis of embedding setup and index consistency (`--fix` repairs config permissions only) |
| `bb upgrade` | Report whether a newer `bb` is published and print the install command |
| `bb onboard [dir]` | Write the generated bb-tools section into `<dir>/AGENTS.md` |
| `bb tool <name> --args '<json>'` | Run one public tool with JSON arguments (the MCP surface, scriptable) |
| `bb mcp [--dir]` | Start the MCP server over stdio |
| `bb version` | Print the version (same as `bb -v` / `bb --version`) |
| `bb -v` / `bb version` | Print the version (same as `bb --version`) |

Global flags: `--verbose` (debug logs, per-file worker/WASM lines), `--quiet` (warnings/errors only).
A mistyped command suggests the closest real one and points to `bb --help`. `bb <command> --help` is
authoritative for that command's options; `bb help <command>` is the same. `bb docter` suggests `doctor`).
The full manual ships with npm installs and is available as `man bb` after `npm install -g backbencher-brain`.

Example outputs are honest by construction: `bb status` shows the actual per-phase timings, `bb health`
reports a *sample* for freshness (and says so), and a run that stored fewer files than it discovered
reports the index as incomplete rather than exit 0 in silence.

### Help and manual

`bb <command> --help` shows that command's options. `bb help <command>` is the same.
The full manual ships with npm installs and is available as `man bb` after `npm install -g backbencher-brain`.

### Fingerprint-only and permissions-only claims (M32)

`bb setup show` prints the key as its last-4 fingerprint only, never the full key.
`bb doctor --fix` mutates exactly one thing: file permissions of embedding config files to `0600`.

key as last-4 fingerprint only, never the full key

---

## MCP server and agent hosts

Start the server for a project:

```bash
bb mcp --dir /abs/path/to/project
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bb-brain": {
      "command": "bb",
      "args": ["mcp", "--dir", "/abs/path/to/project"]
    }
  }
}
```

VS Code workspace (`<project>/.vscode/mcp.json`):

```json
{
  "servers": {
    "bb-brain": {
      "type": "stdio",
      "command": "bb",
      "cwd": "${workspaceFolder}",
      "args": ["mcp", "--dir", "${workspaceFolder}"],
      "env": { "BB_DATA_DIR": "${workspaceFolder}/.bb-data" }
    }
  }
}
```

When the CLI is installed globally, `command` is just `bb`. From a source checkout, use the absolute path
to `bin/bb` (Node) or `bun run src/mcp/server.ts` (Bun) — see the
[MCP, CLI and Indexer Guide](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/MCP_CLI_INDEXER_GUIDE.md) for host setup for Claude Code, Cursor, Zed and
opencode, plus the stdout-safety and stdio lifecycle rules.

`bb onboard <project>` writes a generated “use the bb tools” section into that project's `AGENTS.md` so an
agent host discovers the tools without being told. The section is generated from the registry (it cannot
name a tool that does not exist) and is idempotent.

### The sixteen public tools

`bb_search`, `bb_ask`, `bb_analyze`, `bb_patterns`, `bb_security`, `bb_doc`, `bb_visualize`, `bb_migrate`,
`bb_edit`, `bb_health`, `bb_index`, `bb_graph`, `bb_impact`, `bb_cross_language`, `bb_annotate`,
`bb_annotations`.

Read tools answer from the index and declare staleness; `bb_edit` is the only advertised mutation surface
and confines itself to the project, validates ASTs, writes atomically and reindexes. Key
[`docs/data/public-tools.json`](docs/data/public-tools.json) is the machine-readable contract (schemas,
defaults, examples, returns, errors, limitations, performance, safety and evidence guidance); the generated
human reference is [`docs/tools/`](docs/tools/). `bb --help` lists exactly these sixteen; the legacy tool
names retired before the first public release are documented in
[MCP_TOOL_MIGRATION.md](https://github.com/backbencher-hq/backbencher-brain/blob/main/archive/docs-pre-consolidation/MCP_TOOL_MIGRATION.md).

---

## Embedding providers (optional)

`bb` indexes without any provider; embeddings only power `bb_ask` / `bb_search` semantic ranking.
When you want them:

- **`bb setup`** opens an interactive wizard: it validates the key against the provider, then writes
  the config with mode `0600`. The wizard prompts only once per provider and can be re-run any time.
- **`bb setup show`** prints the effective configuration and where each value came from, with the key
reduced to its last-4
fingerprint only — never the full key.
- **`bb doctor`** is read-only diagnosis of the embedding setup and index consistency; `bb doctor --fix`
  mutates exactly one thing: config file permissions back to `0600`.

Vectors are model-labeled and the ask path never compares across vector spaces: after adding a model,
run `bb index --force` to re-embed, or those rows are reported as not searchable instead of being
silently mixed. See EMBEDDINGS.md for the full provider list, precedence rules (env > `~/.bb/config.json`
> `bb.json`) and the `--force` behaviour.

## Language support

**50 languages**, all first-class in discovery, parsing, relationship extraction and the
cross-language graph:

Bash, C, C#, C++, Clean, Clojure, CSS, Dart, Elixir, Erlang, F#, Go, GraphQL, Groovy, Haskell, HCL, HTML,
Java, JavaScript, JSON, Julia, Kotlin, Lua, Make, Markdown, MATLAB, Nim, Objective-C, Perl, PHP, PowerShell,
Protobuf, Python, R, Ruby, Rust, Scala, SCSS, Solidity, SQL, Svelte, Swift, TOML, TypeScript, VB, VBA,
Vue, XML, YAML, Zig.

Each **analyzer** has exactly one canonical documentation page —
[`docs/analyzers/README.md`](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/analyzers/README.md) indexes all fifty —
covering its symbol contract, relationship ontology, supported/unsupported constructs, regex inventory,
complexity envelope, differential ground truth, corpus validation, mutation evidence and declared
limitations. That page is measured by `script/m14/verify-analyzer-docs.ts`; the implementation for
`<name>` is `src/ast/real-<name>-analyzer.ts` (`make` lives in `real-makefile-analyzer.ts`).

Three request IDs ride an existing analyzer rather than adding a language: **TSX** is served by the
TypeScript analyzer, **Sass** by the CSS analyzer, and **Terraform** by the HCL analyzer. The editor lane
cannot exceed the analyzers — it is the same set, minus Objective-C: `bb_lsp` serves **49 languages** in
the editor (Objective-C is excluded because `.m` is shared with MATLAB and cannot be disambiguated by
extension), and **48** of those carry recorded in-editor evidence. MATLAB and Sass are sealed terminal
dispositions and are never counted as verified. See
[`docs/m24/TOOL-DOC.md`](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/m24/TOOL-DOC.md)
for the per-request-ID claim levels.

---

## Embeddings (optional)

The `bb_ask` tool (and semantic search) uses embeddings. Without a configured provider, `bb` falls back to local word
vectors — weaker by design, and labelled as such. `bb setup` offers prefilled free providers (OpenRouter,
NVIDIA NIM), validates the key with one `/embeddings` call before saving, and writes the config `0600`.
Changing the model or dimension requires `bb index --force`; vectors from different models or dimensions
are never compared. The full guide, precedence rules and every `BB_EMBEDDING_*` variable are in
[EMBEDDINGS.md](EMBEDDINGS.md) and [`docs/indexing/embeddings.md`](docs/indexing/embeddings.md).

The only network calls the product makes are the embedding provider you configure and the update check in
`bb upgrade`. Your source code is never uploaded, and there is no telemetry.

---

## Documentation map

| Document | Read it for |
| --- | --- |
| [`docs/README.md`](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/README.md) | the documentation index (start here if not sure) |
| [`docs/indexing/README.md`](docs/indexing/README.md) | the flag matrix, what each indexing mode does, how to read a run's report |
| [`docs/indexing/resume.md`](docs/indexing/resume.md) | interrupt/checkpoint/resume and the `skipped-unchanged` trap |
| [`docs/indexing/performance.md`](docs/indexing/performance.md) | measured timings, why a big repo takes time, what is **not** measured |
| [`docs/indexing/troubleshooting.md`](docs/indexing/troubleshooting.md) | worker-pool failures and other common errors |
| [`docs/indexing/environment-variables.md`](docs/indexing/environment-variables.md) | every `BB_*` variable and whether it is a user knob |
| [`docs/indexing/discovery-matrix.md`](docs/indexing/discovery-matrix.md) | exactly what is scanned (and what is not), case by case |
| [`docs/ARCHITECTURE.md`](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/ARCHITECTURE.md) | module layout, evidence and mutation contracts |
| [`docs/GRAPH_ENGINE.md`](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/GRAPH_ENGINE.md) | what each relationship edge means and how it is resolved |
| [`docs/tools/`](docs/tools/) | the generated per-tool reference (schemas, examples, errors, limits) |
| [`docs/analyzers/README.md`](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/analyzers/README.md) | the 50 analyzer pages |
| [`docs/MCP_CLI_INDEXER_GUIDE.md`](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/MCP_CLI_INDEXER_GUIDE.md) | the end-to-end operational lifecycle (CLI/MCP parity, host setup, evidence semantics) |
| [`EMBEDDINGS.md`](EMBEDDINGS.md) | the shipped embedding setup guide |
| [`CHANGELOG.md`](CHANGELOG.md) | release history and removed aliases |
| `man bb` | the CLI manual, installed with the npm package |

---

## Architecture and verification

`src/ast/` parses languages into the evidence substrate; `src/storage/` persists canonical `brain_*` tables
in a per-project SQLite database; `src/intelligence/` contains the search, semantic, graph, analysis,
pattern, security, documentation, visualization, migration, edit and health engines; `src/mcp/` and
`src/cli/` are thin adapters over the same registry and handlers. Read-only tools never refresh implicitly.
`bb_edit` is the only advertised mutation surface. See [ARCHITECTURE.md](https://github.com/backbencher-hq/backbencher-brain/blob/main/docs/ARCHITECTURE.md).

The engine and indexer suites run under both runtimes — Node (compiled `dist/`, better-sqlite3) and Bun
(`src/`, `bun:sqlite`):

```bash
npm run build
npx tsx script/verify-engine.ts       # parser surface
npx tsx script/verify-index.ts        # indexer, store, resume, health
npx tsx script/verify-embed.ts        # embeddings
npx tsx script/verify-cli-surface.ts  # CLI surface
npm test                              # engine + schema + tool registry + public surface
npm run docs:verify                   # generated tool docs and documentation truth
```

Documentation numbers are enforced rather than remembered: the indexing pages are gated against `src/`,
the per-tool references are generated from the registry, each analyzer page is measured against its
template, and `script/m14/verify-doc-truth-emissions.ts` fails when an analyzer page contradicts the
analyzer's emitted relationships.

---

MIT licensed. Repository: [github.com/backbencher-hq/backbencher-brain](https://github.com/backbencher-hq/backbencher-brain).
