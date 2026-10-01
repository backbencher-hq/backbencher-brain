# Backbencher Brain — Tools Overview

> Generated sections are gated by `script/m31/verify-tools-overview.ts` against the live tool registry (`src/mcp/tool-registry.ts`) and the database schema (`src/brain/database.ts`). **verified-at-commit: HEAD (see `validation/m31/results/D3.json`)**

This document explains what each tool is, what it reads and writes, and how the tools connect to each other and to the system spine. It is the single narrative source for the website; the per-tool reference pages live in [`docs/tools/`](tools/bb_search.md).

## The system spine

```
source files ──bb_index (CLI) / bb_index (MCP)──▶ brain DB (SQLite)
                                                      │
                    ┌─────────────────────────────────┤
                    ▼                                 ▼
              read tools (search/ask/patterns/     write tools (bb_edit,
              security/visualize/migrate/          bb_index refresh data;
              analyze/doc/health-read)             bb_health refresh re-indexes)
```

1. **Indexing** builds the `brain DB` — a per-project SQLite database under the user data directory. Every tool with `requiresIndex: true` refuses to answer without it.
2. **The brain DB** stores files, symbols, relationships, embeddings, analysis runs, findings and taint flows (see the table list below).
3. **Surfaces**: the same handlers are exposed through MCP (`bb_*` tools) and the CLI (`bb` command). There are no other surfaces.
4. **Write tools**: only `bb_edit` and `bb_index` mutate the index or source; every other tool is read-only. `bb_health` re-indexes only on its `refresh` mode.

### Where things live in the DB

| Concern | Where it lives |
|---|---|
| Files, hashes, freshness | `brain_file` |
| Symbols | `brain_symbol` |
| Relationships (calls, imports, inheritance, …) | `brain_relationship` |
| Semantic embeddings | `brain_semantic_embedding` |
| Analysis runs, findings, occurrences | `brain_analysis_run`, `brain_analysis_finding`, `brain_analysis_occurrence` |
| Taint flows | `brain_taint_flow` |
| Project health snapshot | `brain_project_health` |
| Index status | `brain_index_status` |
| Query cache | `brain_query_cache` |
| Imports | `brain_import` |
| Schema version | `brain_schema_version` |

### Staleness semantics

Read tools resolve freshness against the live working tree, not just the index. The shared envelope is `{ fresh, stale, missing, staleRatio, mode, remediation }`; rows (search matches, graph nodes/links, analyze report rows, migration plans) carry `stale` flags where their underlying file changed after indexing; text modes surface `[stale]` markers and counts footers. When a read finds stale/missing files within budget, the search-family handlers auto-refresh exactly those files inline before answering and declare it on the answer (an `autoRefresh` field / trailing line); out of budget, disabled, or while another indexer holds the single-flight lock, the read answers from existing data with the honest staleness block. Remediation always names the registered reindex interfaces — project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope: `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence. Per-tool details live in each reference page's **Staleness** section (`docs/tools/*.md`, generated from the registry).

## Per-tool reference

Each section below states registry-true facts: category (`search`/`analysis`/`operations`/`lifecycle`), mutability (`read`/`write`), whether it requires an index, and its executable modes. Facts are checked mechanically by the overview gate.

### bb_search

Read-only unified retrieval over the index: symbol lists, file content, exact symbol source, or file content by path. **Category:** search. **Mutability:** read. **Requires index:** yes. **Modes:** `symbols`, `content`, `symbol`, `file`. It is retrieval, not natural-language explanation — for that, use `bb_ask`.

### bb_ask

Natural-language question answering over the index. **Category:** search. **Mutability:** read. **Requires index:** yes. **Modes:** `answer`. It combines lexical and semantic retrieval (semantic candidates come from embeddings, so a project that has never had the embedding step run gets lexical answers only — this is stated in the output provenance, not hidden). Read-only.

### bb_health

Index lifecycle and health: status, freshness, embeddings coverage, integrity, analysis history. **Category:** lifecycle. **Mutability:** read. **Requires index:** no (it reports on the index itself). **Modes:** `status`, `refresh`. `refresh` triggers re-indexing work, so it is the one read-mutability exception to watch: its *descriptor* is read-mutability because it does not edit source files, but `refresh` does write index state. Read-only over source files.

### bb_patterns

Pattern and orphan detection over the indexed graph. **Category:** analysis. **Mutability:** read. **Requires index:** yes. **Modes:** `orphaned`, `all`. With `recordRun: true` it persists a run into `brain_analysis_run` / `brain_analysis_finding` / `brain_analysis_occurrence` so later `history: true` calls can read it back.

### bb_security

Static security findings over the index, driven by `brain_taint_flow`. **Category:** analysis. **Mutability:** read. **Requires index:** yes. **Modes:** `findings` (the only executable mode; `flow`, `summary` and `hotspots` are roadmap). A flow is a *finding* only when **both** endpoints resolve to indexed symbols; one-sided flows are reported separately as unvalidated observations and are never persisted. Every response carries a `[scan: …]` census line so a capped scan is distinguishable from a complete one. With `recordRun: true` it persists the **full** analysed finding set (never the display window) into `brain_analysis_run` / `brain_analysis_finding` / `brain_analysis_occurrence`, with evidence and calibrated confidence, for later `history: true` retrieval. The finding shape is shared with `bb_patterns` (see [Relations](#how-the-tools-relate)).

Not detected: hardcoded secrets (no such finding type is emitted — that rule belongs to `bb_patterns`); genuine cross-*language* taint (the `crossLanguage` flag means "stitched across symbols", not "languages differ"); standalone weak-crypto use (emitted as a sink with no co-located source, so it stays an observation). See `docs/BB_SECURITY.md` § "What the tool does NOT detect".

### bb_visualize

Scoped canonical dependency graphs with explicit truncation and provenance. **Category:** analysis. **Mutability:** read. **Requires index:** yes. **Modes:** `project`, `file`, `module`, `symbol`, `feature`. Scoped modes (`module`, `symbol`, `feature`) require a `target` — the validation layer rejects a missing target for a scoped graph with a structured error rather than silently falling back to a project graph. Read-only.

### bb_migrate

Cross-language migration planning with dependency ordering, methodology, and explicit unsupported mappings. **Category:** analysis. **Mutability:** read. **Requires index:** yes. **Modes:** `plan`. The plan's dependency order comes from the same dependency graph model `bb_analyze` traverses. Read-only.

### bb_analyze

Structured program analysis: callers, callees, trace, dependencies, stats, complexity, impact, and test intelligence (mapping, gaps, impact, quality). **Category:** analysis. **Mutability:** read. **Requires index:** yes. **Modes:** `callers`, `callees`, `trace`, `dependencies`, `stats`, `complexity`, `impact`, `test_mapping`, `test_gaps`, `test_impact`, `test_quality`. Read-only.

### bb_doc

Read-only, evidence-backed documentation generation with resolvable citations. **Category:** analysis. **Mutability:** read. **Requires index:** yes. **Modes:** `symbol`, `file`, `module`, `feature`, `api`, `project`, `coverage`. It reads the same indexed evidence `bb_ask` interprets, but returns cited documentation instead of natural-language answers.

### bb_edit

Unified safe source editing: write, update, insert, delete, refactor with preview, validation, rollback, and reindex. **Category:** operations. **Mutability:** write. **Requires index:** yes. **Modes:** `write`, `update`, `insert`, `delete`, `refactor`. It refuses to act on stale index bounds and re-indexes the files it touched on success.

### bb_index

Agent-facing fresh indexing: reindex a single file or run an incremental directory index so newly written code is visible to tools immediately. **Category:** operations. **Mutability:** write. **Requires index:** no (it can create one). **Modes:** `auto`, `file`, `dir`, `post`. `mode=file` re-indexes exactly one file; `mode=dir` parses only changed files; `mode=auto` picks by path kind; `mode=post` re-runs the heavy derived-data phases (relationships, enrichment, gravity, taints, health) without re-parsing — the agent-facing twin of the CLI `bb index --post`.

### bb_graph

Per-symbol dependency graph over the canonical graph engine: callers, callees, per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred), confidence, and cross-language edge count. Same engine and tier rules the editor graph panel uses. **Category:** graph. **Mutability:** read. **Requires index:** yes. **Modes:** `graph`. Truncated traversals are declared with a reason, never silent. Read-only.

### bb_impact

Impact analysis for one symbol over the same canonical graph engine `bb_analyze` traverses: downstream dependents with per-edge evidence tiers and confidence. **Category:** graph. **Mutability:** read. **Requires index:** yes. **Modes:** `impact`. Declared-absent results (symbol not found) are stated, never inferred. Read-only.

### bb_cross_language

Cross-language facts for one symbol from stored `brain_relationship` rows only (`is_cross_language = 1`), per-pair with bridge mechanism and evidence tier — identical semantics to the editor's cross-language hover section. **Category:** graph. **Mutability:** read. **Requires index:** yes. **Modes:** `cross-language`. Pairs with no stored rows are declared absent — this tool never infers, guesses, or aspires. Read-only.

### bb_annotate

Write a typed, provenance-carrying agent annotation onto a symbol (body limit 2000 chars; empty body is a declared refusal, not a silent no-op). Non-mutating over source files: annotations live in the typed annotation store, never in index truth. **Category:** annotations. **Mutability:** write. **Requires index:** no. **Modes:** `annotate`. The annotation store is owned by the M28 workstream; what is stable today is the MCP write path with declared refusals.

### bb_annotations

Read back typed agent annotations for a symbol from the annotation store, with provenance (tool identity, time). **Category:** annotations. **Mutability:** read. **Requires index:** no. **Modes:** `annotate`. Read-only over the annotation store; absent annotations are declared absent. The store itself is owned by the M28 workstream.

## How the tools relate

- **search → ask**: `bb_search` is lexical/structural retrieval; `bb_ask` adds semantic (embedding) retrieval and interpretation. `bb_ask` uses `bb_search`-class data (the same `brain_symbol`/`brain_relationship` rows) as its sources.
- **analyze → visualize**: both operate on the same canonical dependency graph model; `bb_visualize` renders scopes of the graph `bb_analyze` traverses.
- **edit → health**: `bb_edit` mutates source and re-indexes touched files; `bb_health status` verifies index freshness afterward. `bb_edit` refuses edits on stale bounds, so health drift turns into an edit refusal, not silent corruption.
- **security → patterns**: both produce findings with the same persisted shape (`brain_analysis_finding` rows from `recordRun: true` runs), so history retrieval is uniform across the two.
- **doc → ask**: both read the same indexed evidence. `bb_doc` returns cited documentation; `bb_ask` returns interpreted answers. `bb_doc` cites; `bb_ask` explains.
- **migrate → analyze**: the migration plan's dependency ordering derives from the same graph model `bb_analyze` exposes.
- **graph → analyze/visualize**: `bb_graph`, `bb_impact`, and `bb_visualize` all traverse the same canonical dependency graph engine, with per-edge evidence tiers; `bb_analyze` exposes it as structured analysis modes, `bb_visualize` as scoped renderings, `bb_graph`/`bb_impact` as the agent-facing editor-panel view.
- **cross_language → graph**: `bb_cross_language` reads the cross-language subset of the same stored relationship rows `bb_graph` traverses, filtered to `is_cross_language = 1`.
- **annotate → annotations**: `bb_annotate` writes typed annotations to the annotation store; `bb_annotations` reads them back with provenance. The store is owned by the M28 workstream and is never index truth.

## Evidence semantics (shared across tools)

All tools share one evidence vocabulary — `EvidenceClass` in `src/intelligence/evidence.ts`:

| Class | Meaning |
|---|---|
| `indexed` | Read directly from the index at query time. |
| `inferred` | Derived by an analysis engine from indexed facts. |
| `semantic_candidate` | Retrieved by embedding similarity — a candidate, not a proof. |
| `static_finding` | Produced by static analysis (patterns, security). |
| `runtime_artifact` | Produced by a runtime measurement, not static analysis. |
| `unknown` | The engine cannot attribute the evidence. |
| `stale` | The underlying file changed after the index was built. |

Provenance is explicit: every evidence-bearing result carries `evidenceClass`, `engine`, `engineVersion`, `limitations`, `truncated`, `sampled`, and `unknowns`. Tools surface staleness rather than hiding it (e.g. `bb_search content` reports `staleCount`; `bb_edit` refuses stale bounds).

## Cross-link map

Machine-readable: the overview gate parses this table and checks every row against the live registry. Columns: tool → reads (DB artifacts) → writes (DB artifacts) → related tools.

| tool | reads | writes | related |
|---|---|---|---|
| bb_search | brain_file, brain_symbol | — | bb_ask |
| bb_ask | brain_symbol, brain_relationship, brain_semantic_embedding | — | bb_search |
| bb_health | brain_index_status, brain_file, brain_project_health | brain_project_health (refresh) | bb_edit |
| bb_patterns | brain_symbol, brain_relationship | brain_analysis_run, brain_analysis_finding, brain_analysis_occurrence (recordRun) | bb_security |
| bb_security | brain_taint_flow (primary), brain_symbol, brain_file | brain_analysis_run, brain_analysis_finding, brain_analysis_occurrence (recordRun) | bb_patterns |
| bb_visualize | brain_symbol, brain_relationship | — | bb_analyze |
| bb_migrate | brain_symbol, brain_relationship | — | bb_analyze |
| bb_analyze | brain_symbol, brain_relationship, brain_file | — | bb_visualize |
| bb_doc | brain_symbol, brain_relationship, brain_file | — | bb_ask |
| bb_edit | brain_file, brain_symbol (bounds) | brain_file, brain_symbol, brain_relationship (reindex) | bb_health |
| bb_index | — (discovers from disk) | brain_file, brain_symbol, brain_relationship | bb_health |
| bb_graph | brain_symbol, brain_relationship | — | bb_analyze |
| bb_impact | brain_symbol, brain_relationship | — | bb_analyze |
| bb_cross_language | brain_relationship (cross-language subset) | — | bb_graph |
| bb_annotate | brain_symbol (target check) | brain_annotation | bb_annotations |
| bb_annotations | brain_annotation | — | bb_annotate |

## Honesty notes

- Facts in the per-tool sections (category, mutability, requiresIndex, modes) are registry-checked mechanically; a doc that advertises a mode the registry cannot execute fails the gate.
- The evidence table above mirrors `EvidenceClass` exactly — there is no extra "always right" class; static analysis produces findings, not proofs.
- `bb_health`'s mutability nuance is stated in its section rather than glossed over.
- No tool is documented that is not in the registry; the gate fails on phantom tools.
