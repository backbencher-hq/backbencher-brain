# Documentation index

`bb`'s documentation lives in the repository. This page is the map. The pages that ship with the npm package
are `README.md`, `EMBEDDINGS.md`, `CHANGELOG.md`, `docs/man/`, `docs/tools/`, `docs/indexing/` and
`docs/data/public-tools.json`; everything else is repository documentation and internal evidence.

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

`npm run docs:verify` regenerates the artifact set and fails on drift. `man bb` ships with the package and
points at these directories, so an installed user has the same reference. There are no hidden tools or aliases:
the `0.3.0` release removed them, and `bb --help` lists exactly these sixteen.

## Analyzers

One canonical page per analyzer: [`analyzers/README.md`](./analyzers/README.md) indexes all fifty
(`docs/analyzers/<language>.md`). Those pages are measured by `script/m14/verify-analyzer-docs.ts` against
[`analyzers/TEMPLATE.md`](./analyzers/TEMPLATE.md) (eleven required sections, plus an explained
relationship-ontology table). Older lane journals that tracked code and validation evidence cite are kept under
[`analyzers/history/`](./analyzers/history/) rather than mixed into the canonical set.

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
- `reviews/` — per-lane review records and resolution evidence.
- `archive/` — recovered code from branches removed on 2026-11-01 (`archive/unmerged-pre-merge-2026-11-01/`),
  and pre-consolidation handoff/process pages (`archive/docs-pre-consolidation/`) that tracked evidence cites by path.

## Verifying a doc

If a doc tells you something and you have reason to doubt it, check rather than trust:

```bash
npx tsx script/verify-docs-indexing.ts          # indexing pages, against src/
npx tsx script/verify-tool-docs.ts              # regenerates and compares the tool references
npx tsx script/m14/verify-analyzer-docs.ts      # analyzer pages, sections and ontology cells
```

Docs that assert behaviour the code does not implement are worse than no docs: they cost time while looking
authoritative.
