# bb_analyze reference

`bb_analyze` is one typed surface over five engines in `src/intelligence/`. It
has eleven modes, and every one of them is **bounded** and says so: what it
returned, what exists, and whether the answer is the whole set.

The generated per-tool page is [`docs/tools/bb_analyze.md`](tools/bb_analyze.md);
it is produced from the executable registry plus a curated block in
`script/verify-tool-docs.ts`, so the two cannot drift. This file is the prose
behind those fields: what each mode actually computes, and where its numbers
come from.

Every claim here is pinned by a corpus test in `fixtures/analyze/` (308 claims)
and every magnitude is measured on real code — `backbencher-brain/src` at
8,565 symbols and 52,597 relationships, and `node_modules/commander` — not on a
fixture.

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

## Which symbol did you actually get?

Every mode that takes a `target` resolves the name in three steps, and **which
step won is declared in `rootMatch`**:

| value | the step | what it means |
| --- | --- | --- |
| `exact` | a structural symbol of that name | you got the symbol you named |
| `exact-any-kind` | a symbol of that name the graph cannot traverse — a constant, a type alias | you got the symbol, and it is not walkable as a root |
| `containment` | the documented near-miss fallback | **the answer is about a symbol whose name CONTAINS what you asked for** |

`found: true` on its own means *a root was found*, which is a weaker claim than
a reader assumes. Measured on this repository's own `src`:

| you asked | you got | `found` | said nothing about |
|---|---|---|---|
| `"us"` | `analyzeCSharpBareIdentifierUses` | `true` | that `us` is not a symbol |
| `"_"` | `build_registry` | `true` | that **no** symbol is named `_` |
| `"HUB"` | `hub` | `true` | that the match was case-folded |

The third row is the same mechanism and is not a near miss at all: the exact
step is `name = ?` (case-sensitive) while the fallback is `LIKE '%…%'`, and
SQLite's `LIKE` is case-insensitive for ASCII. So a case difference is resolved
by the *weaker* step, and `rootMatch: "containment"` is how you learn that.

The escaping itself was always right (`likeContains` neutralises `%`, `_` and
`\` by value). The defect was never that the tool matched too much — it was
that a match it invented was indistinguishable from a match you asked for.

`mode:"impact"` reports the same thing, and now also names the symbol at all:
`impact.root` is `{ name, symbolType, file, line, candidates, match }`. It used
to have **no** `root` field, so a blast radius could be published against a
symbol the answer never named.

## `limit` — one parameter, one meaning

`limit` is the most items the answer returns:

| mode | unit | default |
| --- | --- | --- |
| `callers` / `callees` / `trace` | **edges per direction** | 25 |
| `dependencies` | files | 20 |
| `test_mapping` / `test_gaps` | entries / rows | 50 |
| `test_quality` | files | 50 |

It is **refused**, not ignored, on the modes it does not apply to. It has **two
refused ends**:

- `limit: 0` — an empty page is indistinguishable from a real answer.
- above the ceiling (**5,000** graph modes, **2,000** the rest) — a page that
  cannot be read is not an answer. `limit: 2147483648` used to be accepted and
  answered with the whole corpus.

Refused, not clamped. Clamping returns a page that looks like the request was
honoured, which is the whole failure this parameter exists to prevent.

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
`mode:"callers" target:"push"` was measured at **613 seconds** for `trace`.

**A bound that is declared but does not bound is the defect**, so there is now a
wall-clock budget. It preserves every current answer exactly: a bound that fires
*with work left* is declared through `timeBudgetExhausted` and
`truncationReason: "walk-time-budget-exhausted"`.

It is also not sufficient, and finding out why is the more useful part. A
wall-clock budget is checked **between** nodes, and a single SQL statement is
not interruptible. One took **28,864 ms**:

```sql
LEFT JOIN brain_symbol s ON 0
LEFT JOIN brain_file f ON 0
```

The callee query is a `UNION ALL`. Its second arm reports relationships whose
`target_symbol_id` is NULL — the store saying it could not resolve the target.
There is no target symbol, so its nine target columns are constants, and `ON 0`
produced them while keeping the compound's column shape aligned. SQLite cannot
flatten a compound arm containing a join it cannot eliminate, so the arm lost
the index it was eligible for and read **every relationship row in the project**.
Emitting the same nine `NULL`s as literals took the statement to **828 ms**.

| | before | after |
|---|---|---|
| one callee statement | 28,864 ms | **828 ms** |
| `mode:"callees" target:"push"` | no answer in 30 s | 1,675 ms |
| `mode:"callees" target:"getProjectStats"` | no answer in 45 s | 2,105 ms |
| all nine gate cases | four did not answer | **all ≤ 2,328 ms** |

The query belongs to the graph engine, so `bb_graph` and `bb_impact` were on the
same 29-second floor. `fixtures/analyze/latency-gate.sh` gates it.

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

The scope is normalized in exactly **one** place and exported
(`normalizeScopePath`), and the page's denominator is computed by the engine
that produced the rows (`scopeFileCount`). It used to be normalized in two
places with two rules — the engine stripped trailing slashes, the handler's
count did not — and the disagreement produced the worst answer this tool can
give:

| `filePath` | returned | `totalFiles` | `truncated` |
|---|---|---|---|
| `src/wide` | 20 of 68 | 68 | `true` |
| `src/wide/` | 20 of 68 | **0** | **`false`** |

Nothing was capped. The answer *lied*: 48 files hidden behind a flag saying
there was nothing to see.

`score` counts resolved internal edges and dependents only: a dependency on
`node:fs` is a constant of the ecosystem, not coupling to this project.

Neither list on a row carries `fileId`. A file id is
`<40-hex project id>:<relative path>`, so it repeated the path printed next to
it — 506 edges carried 506 copies, 56,540 of 121,340 bytes on a default page.
The **path is the locator**; the row above still carries the id for the file the
row is about, and the freshness flag is resolved from the path. What survives is
`resolution`, because that is the part a path cannot tell you.

Provenance is on the **report**, not repeated on every row. It is one engine and
one set of limitations; at 20 rows the repetition was about a third of the
payload.

This is the largest answer the tool produces — **75,911 bytes (~21k tokens)** for
a default 20-file page of a 183-file project, which is 506 internal edges that
genuinely exist between those files. `limit` is honoured and declared; a caller
who wants less says so rather than paying for a page they will not read.

## `complexity` (`analyzeComplexity`)

Every metric is `{ value, available }`. Unavailable means `value: null,
available: false` — never a substituted number.

**The scope is resolved, not guessed.** `target` is a file path: an exact
`brain_file.relative_path` first, then a directory prefix on a segment boundary
**at any depth, including a top-level directory**. Anything else is **refused**,
naming the mistake and pointing at `mode:"callers"`.

The prefix branch used to require a `/` in the target, so **every top-level
directory was an invalid scope on every project**: `target: "ast"` was refused
as "no indexed file matches" with 84 indexed files under it, `"intelligence"`
with 33, `"mcp"` with 4 — while `ast/real-nim-analyzer.ts` answered perfectly.
The guard could not have been protecting anything, because a bare name that is
not a path matches no directory either and falls through to the same refusal. It
only removed the working cases.

`scopeMatch` says which of the two shapes resolved — `exact-file` or
`directory-prefix` — because `scope` reads `"file"` for both, which reads as one
file. And both file counts are published: `filesMatchingScope` is how many files
the scope *names*, `filesInScope` is how many hold a symbol the metrics are
*over* (83 of 84 on `ast`, measured), and `linesOfCode` covers the second.
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

**The two modes now state the same population under the same name, and their
arithmetic closes in public.** They used not to, and nothing said how they
related:

- `test_mapping.summary.productionSymbols` — the population scanned.
- `test_gaps.summary.productionSymbols` — **the same number** (it was `total`,
  which is the population *minus* the directly-tested, and the two modes
  answered 169 and 163 under names that read as one question).
- `excludedAsNoise` in both — symbols the population filter dropped, so
  `productionSymbols + excludedAsNoise` is the store's population under the
  mode's own filter (169 + 2 = 171, measured).
- `directlyTested` — the gap between the population and the gaps, so
  `productionSymbols = gaps + directlyTested`.

An agent can now check every number against the store instead of taking it on
trust. That is the whole point of publishing the denominators.

## What the payload does not contain

- **Absolute paths.** `nodes[].filePath` is not emitted; `nodes[].file` is the
  project-relative path. The same question therefore returns the same bytes on
  any machine, and two answers can be diffed or cached.
- **Undocumented edge decoration.** Every edge carried a
  `metadata.enrichment` block (`role`, `layerFlow`, `criticality`, `frequency`)
  that no tool page documented and no caller could cite — 64 of 64 edges, and the
  bulk of the payload. `metadata.evidenceClass` **is** documented, so it stays.
- **A per-row copy of report-level provenance** (dependencies; above).
- **An unbounded echo of the target.** The name is echoed into `target` and
  `reason`, so a 4,000-character target produced a 9,409-byte "not found" —
  ~2.6k tokens for two words of information. It is bounded at 200 characters with
  the full length stated. The bound is on the **echo only**: the search always
  uses the whole string, because cutting it would search for a different symbol.

## Verification

- `fixtures/analyze/analyze.test.ts` — 101 claims, the first review: honest
  bounds, targets as values, right answers, one not-found contract, `limit`,
  the regressions.
- `fixtures/analyze/round2.test.ts` — 114 claims, the second review: the answer
  fits in a context window, the answer contains nothing unasked for, metrics out
  of domain, `stats`, hostile parameters, provenance, the wall-clock bound, the
  unresolved-target arm, and the per-entry identity.
- `fixtures/analyze/round3.test.ts` — 92 claims, the third review: does a claim
  *tell the truth*, tested by making it lie. `found: true` for a symbol nobody
  named; a `truncated: false` over a cut set; a `stale` flag driven by editing
  the file on disk and requiring it to rise and then fall; two modes disagreeing
  about one population; byte-identical answers across repeated calls.
- `fixtures/analyze/latency-gate.sh` — the wall-clock half of the latency
  finding, on the real corpus.
- `script/verify-analyze.ts` — the in-repo engine gate (coupling, dependencies,
  complexity, impact), which exercises the engines directly rather than through
  the tool.
