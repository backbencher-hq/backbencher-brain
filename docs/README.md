# Documentation index

`bb`'s documentation lives in the repository. This page is the map. The pages that ship with the npm package
are `README.md`, `EMBEDDINGS.md`, `CHANGELOG.md`, `docs/man/`, `docs/tools/`, `docs/indexing/` and
`docs/data/public-tools.json`; everything else is repository documentation and internal evidence.

## Repository map

Where things live, and what each top-level directory is for (this is the folder-level index — one map, kept
in one place, instead of a README in every directory that can drift from the code):

| Path | What it is |
| --- | --- |
| `src/` | The product source. `src/ast/` parses languages into evidence; `src/storage/` owns the SQLite layer; `src/intelligence/` contains the search/semantic/graph/analysis/pattern/security/doc/visualization/migration/edit/health engines; `src/mcp/` (registry, descriptors, handlers) and `src/cli/` are the adapters; `src/lsp/` is the language server; `src/setup/` and `src/config/` own setup, doctor and configuration. Module contracts: [`ARCHITECTURE.md`](./ARCHITECTURE.md). |
| `script/` | The verification machinery: top-level `script/verify-*.ts` gates for shipped surfaces, `script/mNN/` milestone gates and instruments, `script/m14/` the analyzer suite (specs, fixtures, lane instruments), `script/tool-docs/` the curation sources for the generated tool references, `script/perf/` measurement probes, `script/lib/` shared harness. What is a gate vs an instrument, and which runtime each needs: [`../script/README.md`](../script/README.md). |
| `validation/` | Evidence: gate results (JSON) and human-readable review/verification pages, organised by milestone (`validation/m14/`, `m25/`, …). Gate-produced, not hand-edited; provenance and re-run rules: [`../validation/README.md`](../validation/README.md). |
| `docs/` | This documentation tree (indexing, tools, analyzers, architecture and the historical milestone records). |
| `ide/` | Editor integrations: VS Code-family extension, Zed extension, LSP4IJ template for JetBrains IDEs, Helix config. Start at [`../ide/README.md`](../ide/README.md). |
| `grammars/` | Vendored/pinned Tree-sitter grammar sources and their `PIN.md`/`PROVENANCE.md` records; the pinned WASM binaries live in `wasm/`. |
| `wasm/` | The pinned Tree-sitter WASM artifacts the engine loads; digest pins live in `src/ast/engine.ts`. |
| `bin/` | The `bb` launcher; `dist/` is build output (ignored), and the compiled path is what npm/Node runs. |
| `test/` | Harness suites and fixtures that are not part of the gate suite (CLI surface, indexing lifecycle, demo fixtures): [`../test/README.md`](../test/README.md). |
| `plans/` | Small machine-readable plan inputs still read by milestone instruments (for example the M11 corpus plan). |

`node_modules/`, `dist/`, local worktrees and other
machine-local directories are ignored; they are not repository content.

## Start here

| If you want to… | Read |
| --- | --- |
| index a project, or understand what each flag actually does | [`indexing/README.md`](./indexing/README.md) |
| recover an interrupted index run | [`indexing/resume.md`](./indexing/resume.md) |
| understand why indexing is slow | [`indexing/performance.md`](./indexing/performance.md) |
| fix "the workers don't start" | [`indexing/troubleshooting.md`](./indexing/troubleshooting.md) |
| configure embeddings, `bb setup`, `bb doctor` | [`indexing/embeddings.md`](./indexing/embeddings.md) and [`../EMBEDDINGS.md`](../EMBEDDINGS.md) |
| see what discovery actually scans | [`indexing/discovery-matrix.md`](./indexing/discovery-matrix.md) |
| look up a tool | [`tools/`](./tools/) (one page per tool), or [`data/public-tools.json`](./data/public-tools.json) for machine-readable contracts |
| understand the module layout | [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`GRAPH_ENGINE.md`](./GRAPH_ENGINE.md) |
| read an analyzer's contract | [`analyzers/README.md`](./analyzers/README.md) — one canonical page per analyzer |
| use the IDE extension (VS Code, Cursor, Antigravity, Windsurf, Zed, Helix, JetBrains) | [`IDE-PROGRAM-STATUS.md`](./IDE-PROGRAM-STATUS.md) for the current evidence-backed state; [`IDE-LAUNCH-TEST-PLAN.md`](./IDE-LAUNCH-TEST-PLAN.md) for the gates and the human test pass |

## Indexing

`bb index` is the deepest surface here, and the one most likely to be wrong in a way that costs you time rather
than failing loudly. It has its own directory, and those pages are gated against the code
(`script/verify-docs-indexing.ts` asserts every env var, flag, default and quoted output line exists in `src/`):

- [`indexing/README.md`](./indexing/README.md) — the legal flag combinations, and how to read a run's report on itself
- [`indexing/resume.md`](./indexing/resume.md) — what survives Ctrl-C, and the `skipped-unchanged` trap
- [`indexing/performance.md`](./indexing/performance.md) — measured timings, each citing an evidence file, plus what has *not* been measured
- [`indexing/troubleshooting.md`](./indexing/troubleshooting.md) — the worker pool: causes, env vars and which are test-only
- [`indexing/embeddings.md`](./indexing/embeddings.md) — provider precedence, every `BB_EMBEDDING_*` variable, retries
- [`indexing/environment-variables.md`](./indexing/environment-variables.md) — every `BB_*` variable and whether it is a user knob
- [`indexing/discovery-matrix.md`](./indexing/discovery-matrix.md) — what is scanned and what is not, case by case, verified by its gate
- [`indexing/PERFORMANCE-FINDINGS.md`](./indexing/PERFORMANCE-FINDINGS.md) — local measurements with no evidence file; read its provenance warning first

## Per-tool references

The sixteen public tools are documented individually and generated from the tool registry so the two cannot
drift (`script/verify-tool-docs.ts` writes [`data/public-tools.json`](./data/public-tools.json) and
[`tools/`](./tools/)):

| Tool | Documentation | | Tool | Documentation |
| --- | --- | --- | --- | --- |
| `bb_analyze` | [`tools/bb_analyze.md`](./tools/bb_analyze.md) | | | `bb_annotate` | [`tools/bb_annotate.md`](./tools/bb_annotate.md) |
| `bb_annotations` | [`tools/bb_annotations.md`](./tools/bb_annotations.md) | | | `bb_ask` | [`tools/bb_ask.md`](./tools/bb_ask.md) |
| `bb_cross_language` | [`tools/bb_cross_language.md`](./tools/bb_cross_language.md) | | | `bb_doc` | [`tools/bb_doc.md`](./tools/bb_doc.md) |
| `bb_edit` | [`tools/bb_edit.md`](./tools/bb_edit.md) | | | `bb_graph` | [`tools/bb_graph.md`](./tools/bb_graph.md) |
| `bb_health` | [`tools/bb_health.md`](./tools/bb_health.md) | | | `bb_impact` | [`tools/bb_impact.md`](./tools/bb_impact.md) |
| `bb_index` | [`tools/bb_index.md`](./tools/bb_index.md) | | | `bb_migrate` | [`tools/bb_migrate.md`](./tools/bb_migrate.md) |
| `bb_patterns` | [`tools/bb_patterns.md`](./tools/bb_patterns.md) | | | `bb_search` | [`tools/bb_search.md`](./tools/bb_search.md) |
| `bb_security` | [`tools/bb_security.md`](./tools/bb_security.md) | | | `bb_visualize` | [`tools/bb_visualize.md`](./tools/bb_visualize.md) |

The public surface is **exactly these sixteen tools**. Test intelligence is not a separate
tool: it is the `test_mapping`, `test_gaps`, `test_impact` and `test_quality` modes of
`bb_analyze` (deep guides: [`BB_TEST_INTEL.md`](./BB_TEST_INTEL.md),
[`BB_TEST_QUALITY.md`](./BB_TEST_QUALITY.md)). The per-mode names retired before 0.3.0
(`bb_select`, `bb_write`, `bb_test_quality`, …) are not callable; they are listed only in the
retired-name tables of [`TOOL-REGISTRY.md`](./TOOL-REGISTRY.md) and
the tool pages under [`docs/tools/`](./tools/) so readers can migrate off them.

`npm run docs:verify` regenerates the artifact set and fails on drift. `man bb` ships with the package and
points at these directories, so an installed user has the same reference. There are no hidden tools or aliases:
the `0.3.0` release removed them, and `bb --help` lists exactly these sixteen.

Ownership and scope for future changes is tracked in the private ownership ledger; the public
contract for each tool is its page under `docs/tools/`.

### Deep guides

Each generated reference page links its hand-written deep guides under **Deep guides**; they carry the
operational detail the generated contract does not: worked runs, measured costs, refusal behaviour and the
limits a caller must carry forward.

| Tool | Deep guide(s) |
| --- | --- |
| `bb_analyze` | [`BB_ANALYZE.md`](./BB_ANALYZE.md), [`BB_TEST_INTEL.md`](./BB_TEST_INTEL.md), [`BB_TEST_QUALITY.md`](./BB_TEST_QUALITY.md), [`BB_ANALYSIS_HISTORY.md`](./BB_ANALYSIS_HISTORY.md) |
| `bb_annotate` | [`BB_ANNOTATE.md`](./BB_ANNOTATE.md) |
| `bb_annotations` | [`BB_ANNOTATIONS.md`](./BB_ANNOTATIONS.md) |
| `bb_ask` | [`BB_ASK.md`](./BB_ASK.md) |
| `bb_cross_language` | [`BB_CROSS_LANGUAGE.md`](./BB_CROSS_LANGUAGE.md) |
| `bb_doc` | [`BB_DOC.md`](./BB_DOC.md), [`BB_DOC_REFERENCE.md`](./BB_DOC_REFERENCE.md), [`BB_DOC_EXAMPLES.md`](./BB_DOC_EXAMPLES.md) |
| `bb_edit` | [`BB_EDIT.md`](./BB_EDIT.md) |
| `bb_graph` | [`GRAPH_ENGINE.md`](./GRAPH_ENGINE.md) — the graph model rather than a per-tool guide |
| `bb_health` | [`BB_HEALTH.md`](./BB_HEALTH.md) |
| `bb_impact` | [`BB_IMPACT.md`](./BB_IMPACT.md) |
| `bb_index` | [`indexing/README.md`](./indexing/README.md) — flags, resume, performance, troubleshooting |
| `bb_migrate` | [`BB_MIGRATE.md`](./BB_MIGRATE.md) |
| `bb_patterns` | [`BB_PATTERNS.md`](./BB_PATTERNS.md) |
| `bb_search` | [`BB_SEARCH.md`](./BB_SEARCH.md) |
| `bb_security` | [`BB_SECURITY.md`](./BB_SECURITY.md) |
| `bb_visualize` | [`BB_VISUALIZE.md`](./BB_VISUALIZE.md) |

The deep-guide set is itself gated: `script/m31/verify-bb-docs-truth.ts` extracts every testable claim from
these pages (JSON invocations validated against the live registry, mode lists, parameter tables, output
fields against the behavioural corpus, mutability claims) and records the claims it cannot verify as declared
unverifiable in `validation/m31/results/D2.json`.

### Historical documents at this level

Milestone records are evidence of what was checked when, not current behaviour. That applies to `docs/m*/`
directories and equally to the legacy milestone records kept directly under `docs/` (`M10-*`, `M13-*`,
`M14-*`, `M26-*`, `M55-*`, `MCP_*`). They are not contracts and should not be read as current tool
documentation; the per-tool pages and deep guides above are. Older plans and migration guides that no longer
describe the shipped surface are kept in the private release archive rather than mixed into the
live set.

## Analyzers

One canonical page per analyzer: [`analyzers/README.md`](./analyzers/README.md) indexes all fifty
(`docs/analyzers/<language>.md`). Those pages are measured by `script/m14/verify-analyzer-docs.ts` against
[`analyzers/TEMPLATE.md`](./analyzers/TEMPLATE.md) (eight measured sections, plus an explained
relationship-ontology table; the measured worklist is on the analyzer index). Older analyzer journals
that tracked code and validation evidence are kept in the private archive rather than
mixed into the canonical set.

## Architecture and programs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module layout, evidence and mutation contracts
- [`GRAPH_ENGINE.md`](./GRAPH_ENGINE.md) — the relationship graph: what each edge means and how it is resolved
- [`../EMBEDDINGS.md`](../EMBEDDINGS.md) — the shipped embeddings guide (vector spaces, coverage, retrieval)
- [`IDE-HONESTY-CONTRACT.md`](./IDE-HONESTY-CONTRACT.md) — what the IDE integration promises and does not
- [`TOOL-REGISTRY.md`](./TOOL-REGISTRY.md) and [`TOOLS_OVERVIEW.md`](./TOOLS_OVERVIEW.md) — registry and surface overview

## Records and evidence

- `docs/m*/` — milestone records (M10–M63) and their audits. They are evidence of what was checked when, not
  current behaviour; prefer the per-topic pages above.
- `validation/` — gate results and measurement evidence (JSON and markdown). Tracked evidence is referenced by
  gates; `script/m14/verify-self-contained.ts` checks the parts the machinery actually reads.
- [`validation/languages/results/tool-matrix.json`](../validation/languages/results/tool-matrix.json) — the language × tool
  matrix evidence: every analyzer language indexed from a real fixture and exercised through the public tools.
  Contract and extension steps: [`LANGUAGE-TOOL-MATRIX.md`](./LANGUAGE-TOOL-MATRIX.md).

### Superseded copies

A page may keep its previous revision as `<name>.superseded-<commit>.md` next to it. That is allowed only
while tracked evidence still cites the old content; the copy is evidence, not documentation, and it is
removed from the live set once no gate or ledger references it. The current revision is always the unsuffixed
file. Do not treat a superseded copy as the contract when both exist.

## Verifying a doc

If a doc tells you something and you have reason to doubt it, check rather than trust:

```bash
npx tsx script/verify-docs-indexing.ts          # indexing pages, against src/
npx tsx script/verify-tool-docs.ts              # regenerates and compares the tool references
npx tsx script/m14/verify-analyzer-docs.ts      # analyzer pages, sections and ontology cells
npm run verify:language-matrix                  # every analyzer language × the public tool layer
```

The matrix's contract page ([LANGUAGE-TOOL-MATRIX.md](./LANGUAGE-TOOL-MATRIX.md)) also explains how to add a
language or a new tool check without rewriting the gate.

Docs that assert behaviour the code does not implement are worse than no docs: they cost time while looking
authoritative.
