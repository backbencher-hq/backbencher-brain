# bb_analyze reference

`bb_analyze` is one typed surface over five engines in `src/intelligence/`. It
has eleven modes, and every one of them is **bounded** and says so: what it
returned, what exists, and whether the answer is the whole set.

The generated per-tool page is [`docs/tools/bb_analyze.md`](tools/bb_analyze.md);
it is produced from the executable registry plus a curated block in
`script/verify-tool-docs.ts`, so the two cannot drift. This file is the prose
behind those fields: what each mode actually computes, and where its numbers
come from.

Every claim here is pinned by a corpus test in `fixtures/analyze/` (204 claims)
and every magnitude is measured on real code — `backbencher-brain/src` at
7,196 symbols and `node_modules/commander` — not on a fixture.

## Modes

| Mode | Engine | Returns |
| --- | --- | --- |
| `callers` / `callees` / `trace` | `graph/graph-engine.ts` | Relationship edges for one symbol, and the nodes they cite |
| `dependencies` | `analysis/dependencies.ts` | File→file edges, each labelled with how it was resolved |
| `stats` | `analysis/project-stats.ts` | Project counts, including a per-language breakdown |
| `complexity` | `analysis/complexity.ts` | Scope-correct metrics, each `{ value, available }` |
| `impact` | the canonical `src/lsp/impact.ts` walk, aggregated | Blast radius with a file-level risk rollup |
| `test_mapping` / `test_gaps` / `test_quality` / `test_impact` | `testing/test-intel.ts`, `testing/quality.ts` | Static test evidence, and its declared absence |

There is **no `coupling` mode.** `analysis/coupling.ts` exists and is exercised
by `script/verify-analyze.ts`, but the tool does not expose it: the registry
enum omits it and the handler has no branch, so `mode:"coupling"` is rejected.
An earlier revision of this file listed it as a mode. It is not.

## `limit` — one parameter, one meaning

`limit` is the most items the answer returns:

| mode | unit | default |
| --- | --- | --- |
| `callers` / `callees` / `trace` | **edges per direction** | 25 |
| `dependencies` | files | 20 |
| `test_mapping` / `test_gaps` | entries / rows | 50 |
| `test_quality` | files | 50 |

It is **refused**, not ignored, on the modes it does not apply to, and `limit: 0`
is refused because an empty page is indistinguishable from a real answer.

It used to be honoured in 2 of 9 collection modes and silently ignored in the
rest. Measured on `backbencher-brain/src`: `test_mapping` returned **375,270
bytes** with `limit: 2` — byte-for-byte the same as unlimited. A bound a caller
believes in and that does nothing is worse than a bound that refuses.

## Bounds, and why there are so many of them

A traversal is bounded by five things and each is declared where it fired:

| bound | field | note |
| --- | --- | --- |
| response page | `summary.returnedCallers` / `returnedCallees` / `pageEdgeLimit` / `pageTruncated` | the page, over what the walk found |
| depth | `summary.maxDepth` + `maxDepthReached` | reaching the cap with work queued is `truncated: true`, reason `…-depth-cap-reached` |
| per-node site limit | `summary.edgeLimit`, `cappedQueries`, `callersIfUncapped` | 200 sites for one symbol's query |
| fan-out budget | `summary.callerBudget` / `calleeBudget` + `…BudgetExhausted` | 50 symbols per direction |
| **wall clock** | `summary.timeBudgetMs` / `timeBudgetExhausted` | 2,000 ms; reason `walk-time-budget-exhausted` |

The last one exists because **a node is not a unit of work.** Measured on this
repository's own `src`:

- the caller query for `push` matches 2,436 stored rows and costs **85.8 ms of
  its 87.8 ms** on the `ORDER BY` that makes the answer reproducible — and
  SQLite sorts *before* it applies the `LIMIT`, so `edgeLimit: 200` cannot bound
  it;
- the callee query's external branch (`target_symbol_id IS NULL AND
  target_external IS NOT NULL`, joined on name) costs **179 ms against the
  internal branch's 10 ms** for the same symbol, to contribute 15 of 21 rows.

At a 50-node budget that is seconds per target, and the recursion multiplies it:
`mode:"callers" target:"push"` was measured at **613 seconds** for `trace`. The
budget does not raise the quality of a deep answer; it converts a ten-minute
wait into a declared partial one.

## Not-found is four answers, not one

| situation | response |
| --- | --- |
| target resolved | `found: true` |
| target is in the index but the graph cannot root at it (a `namespace`, `constant`, type alias or `enum_member`) | `found: false`, `notFoundReason: "not-traversable"`, and the calculator's own message naming the type |
| target is not in the index | `found: false`, `notFoundReason: "absent"` |
| the calculation itself failed | `found: false`, `notFoundReason: "error"`, with the failure verbatim |

This distinction was the most consequential defect in the tool's history. The
wrapper caught *every* error and reported `found: false` with the limitation
**"Target not found in the indexed graph"** — a false statement — for symbols
that are indexed and that `mode:"callers"` answers for. On this repository's
`src` that was **78 of 140 distinct symbol names** (98% of constants, 92% of
type aliases, 83% of namespaces), including `ASTEngine` with **390 caller
edges**, answered `found: false, riskLevel: "low", directSymbols: 0`.

`mode:"impact"` is also the one mode that will tell you this, which is why a
"not found" from it must be read before it is believed.

## `stats` (`getProjectStats`)

Files, non-blank lines, symbols, relationships, and now a per-language
breakdown — because "what is this project written in?" is the first question
asked of a code index over a polyglot repository, and the answer used to be
unrepresentable. A file with no recorded language is reported as `unknown`
rather than dropped, so the counts always sum to `files`.

Three numbers here are deliberately separated because they used to be conflated:

- `relationships` — every stored row, whatever its type.
- `callEdges` — only the types in `couplingRelationshipTypes` (`calls`,
  `instantiates`, `references`, `uses`, `imports`, `extends`, `implements`).
  `exports` and `contains` are index bookkeeping, and counting them inflated the
  coupling figure by **1.20×** on `src` and **1.29×** on commander.
- `avgComplexity` with `symbolsWithComplexity` — a SQL `AVG` skips nulls, so its
  denominator is the symbols that carry a measurement, not `symbols`. The
  denominator is published because the two differ the moment any symbol is
  unmeasured, and `mode:"complexity"` reports the other one.

`avgFileSizeUnit` states the unit. `linesOfCode` sums `brain_file.line_count`,
which is non-blank lines — not physical lines.

## `dependencies` (`getFileDependencies`)

A file→file edge, plus its **dependents**, plus how each was resolved.

Resolution is a real filesystem resolution, not a basename match:

1. a **relative** specifier (`./x`, `../y/z`) is resolved against the importing
   file's own directory, trying an ordered extension list and `/index`;
2. a **directory-anchored suffix match** (`util/format` → `src/util/format.ts`)
   is next, and is labelled `suffix-match`;
3. anything else is reported with the specifier the caller wrote, `fileId`
   absent, `resolution: "unresolved"`.

Two files named `format.ts` is not an edge case — it is `index.ts` and
`types.ts` in every real codebase. The previous implementation keyed on the
filename with its extension stripped, last writer wins over an unordered
`SELECT`: on the corpus, `src/core/engine.ts` (which imports `./plugin`,
`../util/format` **and** `../vendor/format`) was reported as importing
`src/util/format.ts` **twice**, and `src/vendor/format.ts` was reported with no
dependents at all. One edge invented, one lost.

The document previously said the `imports` relationship graph was the primary
resolver and that the basename match was the rare fallback. **Measured, that is
backwards**: on this repository's `src`, 74 of 906 `imports` relationships carry
both a source and a target symbol, and `brain_import.resolved_symbol_id` is set
on **zero** of 803 rows. Specifier resolution is the primary path; the
relationship graph is a 9% bonus.

`filePath` scopes by path **PREFIX** on a whole segment boundary, so `src/util`
does not match `src/utilities`. It was a substring `includes()`, which made
`filePath:"util"` and `filePath:"src/util"` the same question.

`score` counts resolved internal edges and dependents only: a dependency on
`node:fs` is a constant of the ecosystem, not coupling to this project.

Provenance is on the **report**, not repeated on every row. It is one engine and
one set of limitations; at 20 rows the repetition was about a third of the
payload.

## `complexity` (`analyzeComplexity`)

Every metric is `{ value, available }`. Unavailable means `value: null,
available: false` — never a substituted number.

**The scope is resolved, not guessed.** `target` is a file path: an exact
`brain_file.relative_path` first, then a directory prefix on a segment boundary.
Anything else is **refused**, naming the mistake and pointing at `mode:"callers"`.
It used to be `LIKE '%target%'` matched anywhere, so `target:"e"` scoped 190 of
198 symbols across 90 files and `target:"hub"` — a *function name* — was silently
reinterpreted as a path filter, both while still reporting `"scope":"file"`.
`%`, `_` and `\` are escaped: a target is a value, never a pattern.

Each metric covers the **whole scope**, and the report says how wide it is:

- `filesInScope` — a file scope can match many files, and without this a
  one-file answer and an eighty-file answer look identical.
- `linesOfCode` — the sum over the scope's files. It used to read
  `symbols[0]`'s file, so `target:"src"` reported 163 symbols with
  `linesOfCode: 2`, and `maintainability` was derived from that (149.57 on a
  0–171 scale, i.e. "excellent" for a scope spanning 83 files).
- `couplingEdges` — the declared relationship types only (above), and
  `couplingRelationshipTypes` says which.
- `maintainability` — `171 − 5.2·ln(avg+1) − 16.2·ln(loc+1)`. It is calibrated
  for a single unit, so it is **negative** for any scope above roughly 3·10⁴
  lines. The old code clamped that to 0 with `available: true`, and this
  repository's own `src` (165,567 non-blank lines) answered
  `maintainability: 0` — the clamp, presented as a measurement. It is now
  unavailable out of domain, and a real 0 is still reported as a real 0.
- `depthOfInheritance` — **always unavailable.** Hierarchy analysis is not
  implemented and is not fabricated.

## `impact`

Change blast radius over the **canonical** `src/lsp/impact.ts` walk, so the
numbers are identical to `bb_impact` by gate. The aggregation adds only what the
report needs — a file-level rollup, a risk level, cross-language and
unresolved-edge counts — all from the SAME traversal.

- `directSymbols` — symbols referencing the target directly.
- `affectedFiles` — `{ file, via, depth, crossLanguage, stale }`, deduped to
  the shallowest depth.
- `riskLevel` — `critical` (≥20 affected files or any cross-language), `high`
  (≥8), `medium` (≥3), else `low`.
- `totalSymbols` is **X**, and `totalSymbolsIfKnown` is **Y** when a bounded
  count could be taken — "showing X of Y". The calculator always computed Y; the
  report used to drop it, so a truncated set could only be read as the whole
  set.
- `depthCap` / `depthReached` state how far the walk actually went, and a
  depth-capped walk is `truncated: true`.

Impact makes **no test-coverage claims.** For the test surface, use
`mode:"test_impact"`, which declares the absence of evidence when there is none.

`scope` is always `"transitive"`. The depth is bounded by `depthCap` and stated
beside `depthReached`; `scope` names the direction, not the depth.

## Test intelligence

`test_mapping`, `test_gaps`, `test_quality` and `test_impact` all report the
**declared absence** when the corpus produced nothing, rather than an
authoritative-looking zero:

> `no-test-evidence-edges`: no calls/references/imports relationship originates
> from a code test file, so every production symbol is reported untested — this
> is an absence of evidence, not evidence of absence.

This matters because of an indexer defect this tool depends on. `test/` and
`vendor/` were in the indexer's skip list, and `test/` is where most of the
world keeps its test suite. The differential is unambiguous: on a corpus
holding one file of each shape, `spec/format.spec.ts` and `tests/engine.test.ts`
are indexed and flagged `is_test_file`, and `test/…` is absent from the index
entirely. Before that was fixed, all four modes reported **every** production
symbol untested on such a project.

Each mode also states its page (`summary.returned` / `truncated`), and a mapping
entry carries at most 20 links with `linksTruncated` saying when more exist —
the ranking and the summary counts still use the complete set.

## What the payload does not contain

- **Absolute paths.** `nodes[].filePath` is not emitted; `nodes[].file` is the
  project-relative path. The same question therefore returns the same bytes on
  any machine, and two answers can be diffed or cached.
- **Undocumented edge decoration.** Every edge carried a
  `metadata.enrichment` block (`role`, `layerFlow`, `criticality`, `frequency`)
  that no tool page documented and no caller could cite — 64 of 64 edges, and the
  bulk of the payload. `metadata.evidenceClass` **is** documented, so it stays.
- **A per-row copy of report-level provenance** (dependencies; above).

## Verification

- `fixtures/analyze/analyze.test.ts` — 101 claims, the first review: honest
  bounds, targets as values, right answers, one not-found contract, `limit`,
  the regressions.
- `fixtures/analyze/round2.test.ts` — 103 claims, the second review: the answer
  fits in a context window, the answer contains nothing unasked for, metrics out
  of domain, `stats`, hostile parameters, provenance, the wall-clock bound.
- `fixtures/analyze/latency-gate.sh` — the wall-clock half of the latency
  finding, on the real corpus.
- `script/verify-analyze.ts` — the in-repo engine gate (coupling, dependencies,
  complexity, impact), which exercises the engines directly rather than through
  the tool.
