# M12.45 Tools And Analyzers Working Together Across All Languages

Issue: [#184](https://github.com/backbencher-hq/backbencher-brain/issues/184)

Date: 2026-08-20

## Objective

Confirm that every intelligence tool (search, graph, impact, complexity,
patterns, security, test intelligence, documentation, migration, health,
analyze, visualize) consumes the per-language symbol and relationship facts
correctly for all 41 analyzers — with language-specific symbol kinds resolving
in tool queries and no tool silently dropping language-specific facts.

## Read-Surface Defects Found And Fixed

The tools×analyzers audit (`script/m12/verify-m12-tools.ts`) surfaced two
genuine read-surface defects where verified analyzer facts were invisible to
every tool:

### 1. Dotted-chain noise rule hid dotted identifiers

`isNoiseSymbolName`'s property-access rule (`/^[a-z_$][\w$]*(\.[\w$]+)+$/`)
was meant to block `host.createProgram`-style noise, but it also hid **verified
dotted identifiers**:
- Clojure namespaces: `com.example.clojure.service` (module)
- HCL resources: `aws_security_group.web`, `aws_instance.web`, `backend.s3`
- Markdown fenced-block names: `code_block.python`, `code_block.sql`
- Make targets: `util.o`, `main.o`

The rule cannot distinguish property access from identifier chains without
context, and the store layer already excludes property-access noise — so the
rule was removed from the read surface.

### 2. Blanket `.json` file exclusion hid the entire JSON analyzer contract

`NOISE_FILE_PATTERNS` contained `/.json$/` (and the SQL mirror `%.json`),
treating **every JSON file** as hard noise on the read side. The JSON analyzer
is a verified contract (M12.34, P/R 1.000) whose module/class/property symbols
persist (M12.44, 0 drops) — yet search, graph, patterns, and test intelligence
all filtered them out. The genuinely noisy JSON files (`package-lock.json`,
`openapi.json`, `swagger.json`, `schema.json`, `*.min.json`, `Az.*.json`,
DataLake/PowerBI/Sftp artifacts) are already excluded at **index time** by
`ParallelIndexerConfig.skipPatterns`, so the read-side blanket exclusion was
redundant for noise and harmful for verified facts. The `.json` patterns were
removed from the read surface.

## Evidence — `script/m12/verify-m12-tools.ts` (committed)

A 41-language corpus (all positive fixtures, 97 files) is indexed through the
production pipeline, then every tool is exercised through the **real MCP
handlers** (`createToolHandlers`) and the **compiled CLI** (`node bin/bb`):

| Check | Result |
| --- | --- |
| Per-language search sweep: every language's ground-truth symbols resolve via `bb_search` with the correct language label | **122/122 probes** across all 41 languages |
| Language-specific kinds resolve: F# modules, Rust structs/traits, SQL indexes, Markdown headings, CSS selectors, YAML merge keys, JSON modules/classes, Clojure namespaces, enum members, constants, interfaces, HCL resources, Make targets | 122/122 |
| `bb_search` content mode | PASS |
| `bb_health`: files=97, symbols=1213, relationships=1695, no unknown-language rows | PASS |
| `bb_analyze` stats / complexity (java file) / callers | PASS |
| `bb_patterns` orphaned: 100 orphan findings | PASS |
| `bb_security` | PASS |
| `bb_visualize` project graph: 800 nodes **across all 41 languages** | PASS |
| `bb_doc` symbol (cited docs for a Rust symbol) | PASS |
| `bb_migrate` (Java symbol → Rust plan) | PASS |
| `bb_edit` dry-run refactor (java class) | PASS |
| **CLI/MCP parity**: `node bin/bb tool bb_search` / `bb_health` output matches the shared handler output byte-for-byte (runtime line normalized: compiled CLI runs Node, handler runs Bun — documented) | PASS |

## Regression Safety

- Store layer unchanged from M12.44: `verify-m12-pipeline.ts` still PASS.
- Differentials unaffected (they test the analyzer path, not read-side).
- `npm run typecheck`, `npm run build` PASS.
- Targeted gates PASS: search-modes, graph, patterns, test-intel, contracts,
  tool-registry, public-surface.
- Full `npm run verify` (proxy-unset env): **PASS** (exit 0), MCP E2E 10 tools
  PASS, EMBED VERIFY ALL PASS; the only ❌ lines are the pre-existing
  background-embedding health warnings (24, unchanged from M12.44).
