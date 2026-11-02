<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — a one-page reference for `bb_doc`: modes, options, the result block, refusals and the read-only boundary, matching measured behaviour.
WHO IT IS FOR — callers who need the shape without reading the full design specification.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_doc/descriptor.ts, src/mcp/tools/bb_doc/handler.ts, docs/BB_DOC.md, docs/BB_DOC_EXAMPLES.md.
-->

# `bb_doc` reference

`bb_doc` generates cited Markdown or JSON documentation from indexed source and relationships.
Read-only, requires an index, seven modes.

## Modes

| Mode | Target | What it documents |
|---|---|---|
| `symbol` | name, qualified name, or its last `.`/`::` segment | signature and bounds, docstring, inbound/outbound edges, imports, test evidence |
| `file` | exact repo-relative path, absolute path, directory prefix, or bare file name with/without extension | file row, public symbols, dependencies, risks |
| `module` | repository-relative directory the index holds (unmatched → refused, forms named) | files, entry points, public surface, internal graph |
| `feature` | feature name (lexical; semantic only with `detail: "deep"`) | candidates, flow between them, components, test coverage |
| `api` | optional path/contract | endpoints from contract paths, route/endpoint/controller types, and callables in HTTP-framework files; errors and examples are declared unmeasurable |
| `project` | optional (metadata only — does not scope) | totals, language mix, entry points, open risks, documentation map |
| `coverage` | optional path/module | documented, undocumented (as `unknown`), stale, and unsupported-for-this-reader verdicts |

## Options

| Option | Accepted | Default | Notes |
|---|---|---|---|
| `mode` | one of the seven | required | |
| `target` | string | required for symbol/file/module/feature | aliases `symbol`, `symbolName`, `query` map to `target`; conflicting aliases are refused |
| `format` | `markdown` \| `json` | `markdown` | JSON carries the freshness envelope and `autoRefresh` too |
| `audience` | `developer` \| `maintainer` \| `user` \| `website` | `developer` | selects OPTIONAL sections only; required sections are never dropped |
| `detail` | `brief` \| `standard` \| `deep` | `standard` | 5 / `limit` / 3×`limit` facts per section; `deep` also enables semantic expansion for `feature` |
| `includeExamples` | boolean | `false` | no example is emitted; a `not-observed` unknown is recorded |
| `includeDiagrams` | boolean | `false` | no diagram is emitted; `reference.diagrams` is always empty |
| `includeTests` | boolean | mode default | `symbol`/`feature` only; the other modes refuse it |
| `limit` | 1–100 | 20 | out-of-range refused, not clamped |
| `maxTokens` | 1–16000 | 8000 | enforced on the emitted payload; out-of-range refused. 8000 clears the measured minimum honest rendering on the reference index (~6,700) |
| `refresh` | boolean | `true` | `false` declines the inline repair; the decline is declared |

## Result

- `sections[]` — the mode's declared set; each fact is classified `extracted` / `inferred` /
  `generated` / `unknown` with `confidence` and `citationIds`.
- `citations[]` — only the citations a fact refers to; each carries `id`, `kind`, `path` (when
  file-backed), line span, `freshness` and `confidence`. Markdown links them in `## Sources`;
  index-scoped evidence is listed in `## Index`.
- `unknowns[]` — every declared gap, each with `reason` and the rendered section it affects.
- `quality` — `passed`, `factuality`, `references` (emitted counts plus `collectedStale` /
  `collectedMissing`), `completeness`, `freshness`, `budget` (payload-measured), `bounds` (per
  section: `available`, `capped`, `droppedForBudget`, `emitted`), `warnings`.
- `freshness` (JSON) — `{ fresh, stale, missing, staleRatio, mode, remediation, passed }` over the cited files;
  `passed` is the machine-readable verdict.
- `reference` — stable website keys and an empty `diagrams` array.

`quality.passed` is the conjunction of four measured terms: factuality (every claim cited AND the
result has evidence), references (no broken/missing emitted citations), budget (payload within
`maxTokens`), completeness (all required sections present). Stale evidence is a warning and is
reported by `freshness.passed`.

## Measured cost

Warm default calls on the reference index are 0.07–1.97 s (p50), p95 ≤ 3.65 s; a cold first call in
a fresh process is 3.9 s on a cold page cache and the read-only DB open is 2 ms. `detail: "deep"`
feature is an opt-in 18 s / 926 MB semantic pass and is the only shape that can approach a client
timeout. Full table: `validation/tools/bb_doc/LATENCY.json`.

## Read-only boundary

`bb_doc` never writes source, never creates a file and never calls `bb_edit`. Its only write is the
bounded inline repair: when cited files are stale it reindexes exactly those files (max 25 files /
2 MiB) and regenerates, declaring the decision. `refresh: false` or `BB_NO_AUTO_REFRESH=1` opts out.

## Refusals

Named errors with `isError: true`: missing mode or target; `limit`/`maxTokens` out of range;
`includeTests` on a mode without test evidence; `module` target matching no indexed file; invalid
enum values (rejected by the registry validator with the accepted set named).

## Verification

`bun run script/m20/verify-doc-modes.ts`, `bun run script/m20/verify-doc-truth.ts`,
`bun run script/m20/verify-doc-citations.ts`, `bun run script/m20/verify-doc-examples-diagrams.ts`,
`bun run script/m13/verify-doc-*.ts`, `bun run script/m15/verify-doc-deep.ts`,
`bun run script/verify-doc.ts`, `bun run script/verify-doc-design.ts`.
