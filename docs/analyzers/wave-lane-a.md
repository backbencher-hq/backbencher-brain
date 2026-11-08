# Wave lane A — web, data & query languages (13)

Task: `task-7` (wave onboarding A). Pipeline read: `docs/m29/WAVE-PROTOCOL.md`,
`script/m29/wave-protocol.ts`, `script/m29/wave-execute.ts`,
`script/m29/verify-wave-execution.ts`, plus the sealed shape of
`validation/m29/results/wave-java.json` and `wave-editor-java.json`, and the
sibling lane report `docs/analyzers/wave-lane-c.md`.

Languages: tsx, html, css, scss, sass, json, yaml, toml, markdown, xml,
graphql, protobuf, sql.

Method: for each language one fixture pack was authored at
`script/m29/wave-fixtures/<lang>/` (`main.<ext>` + `expectations.json`) and the
real execution engine was run:

```
npx tsx script/m29/wave-execute.ts --languages <lang>
```

Every leg below was produced by that command against the REAL compiled indexer
(`dist/index.js`) and the REAL `bb_lsp` server over stdio, sealed at commit
`fced0a148b06053fce72d82c8fdeae030bfdb192`. `expectations.json` symbol names,
hover lines and document-symbol roots were taken from the measured
`brain_symbol` rows (real index build) before the run — not guessed. No
expectation had to be corrected after a run; no source fixture was reshaped to
force a check. The one failing language (sass) is reported as it measured.

Verdict vocabulary used here (same as lane C, so the two reports compare):

- **PASS** — the S5 leg sealed `verified`, 0 failed checks, and the assertions
  are semantically appropriate for the hovered declaration.
- **BLOCKED** — the S5 leg sealed `failed`; the failing checks are named with the
  evidence path.
- **NOT-LSP-APPROPRIATE** — the S5 leg is mechanically green but a leg assertion
  is semantically wrong for the language; the reason and the exact assertion are
  stated.

## Verdicts

| language | verdict | fixture | failing check | next action |
|---|---|---|---|---|
| tsx | **PASS** — S5 verified (12/12) | `script/m29/wave-fixtures/tsx/main.tsx` | — | S1 ledger entry missing (below); re-run after commit |
| html | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/html/main.html` | none failed; `L5` returned a `CallHierarchyItem` for a non-callable element id (`email`) | make `prepareCallHierarchy` declare absence for non-callable kinds (Lead / lsp-graph), then make L5 kind-aware |
| css | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/css/main.css` | `L5` item is `variable --brand-color` (a declaration, has no calls) | same shared `call_hierarchy.ts` fix |
| scss | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/scss/main.scss` | `L5` item is `variable $brand-color` | same |
| sass | **BLOCKED** — S5 failed (9/12) | `script/m29/wave-fixtures/sass/main.sass` | `L2: hover renders the symbol`; `L4: workspace symbol finds it`; `L5: call hierarchy prepares` — measured record `validation/m29/results/wave-sass.json` | vendor a tree-sitter-sass grammar + analyzer and route `.sass` to it, then re-run (below) |
| json | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/json/main.json` | `L5` item is `class User` (JSON-Schema definition, not callable). References are real: 2 `$ref` rows target `User` | shared `call_hierarchy.ts` fix |
| yaml | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/yaml/main.yaml` | `L5` item is `constant service` (anchor declaration). References are real: 2 `extends` merge rows target it | shared `call_hierarchy.ts` fix |
| toml | **NOT-LSP-APPROPRIATE** for call hierarchy **and references** — S5 verified (12/12) | `script/m29/wave-fixtures/toml/main.toml` | `L5` item is `namespace versions`; `L3: references non-empty` measured **got 1 = the declaration only** (no usage row targets a hoverable TOML symbol — below) | shared fix + a references assertion that excludes the declaration, if a references claim is wanted |
| markdown | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/markdown/main.md` | `L5` item is `type Configure` (a heading). References are real: the internal anchor link produces 1 `references` row | shared `call_hierarchy.ts` fix |
| xml | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/xml/main.xml` | `L5` item is `class catalog` (XSD element). References are real: the `ref="wave:catalog"` attribute produces 1 `references` row | shared `call_hierarchy.ts` fix |
| graphql | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/graphql/main.graphql` | `L5` item is `class User`; the analyzer rules `calls` grammar-absence (documented in `docs/analyzers/graphql.md`). References are real: declared-type edges (3 usage rows) | shared `call_hierarchy.ts` fix |
| protobuf | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/protobuf/main.proto` | `L5` item is `class User` (message). References are real: field/rpc type edges (2 usage rows) | shared `call_hierarchy.ts` fix |
| sql | **NOT-LSP-APPROPRIATE** for call hierarchy — S5 verified (12/12) | `script/m29/wave-fixtures/sql/main.sql` | `L5` item is `class users` (table). References are real: the foreign key produces 1 `references` row | shared `call_hierarchy.ts` fix |

Counts: **1 PASS**, **11 NOT-LSP-APPROPRIATE (call hierarchy)**, **1 BLOCKED**.
All 13 languages have a real S5 record; 12 of them sealed `verified`.

The NOT-LSP-APPROPRIATE verdict is scoped to the **call-hierarchy feature
claim**, exactly as lane C scoped hcl/terraform: hover, definition, references,
document symbols and workspace symbols are verified for every one of them, and
the packs exercise real per-format reference semantics (`$ref`, YAML merge,
markdown anchors, XSD `ref`, idrefs, CSS `var()`, Sass variables, GraphQL
declared types, protobuf field types, SQL foreign keys, TS/JSX components). The
single wrong assertion is `L5: call hierarchy prepares`, which only asserts
`item.name === symbol` and therefore accepts a non-callable declaration as a
`CallHierarchyItem`. That is the same surface defect lane C reported.

## Measured S5 legs

Every verified leg also passed `§3: warm p95 within budgets` (0 budget
violations; worst measured p95 was hover 12.7 ms, prepareCallHierarchy 16.5 ms,
against 50 ms / 100 ms budgets).

| language | status | index counts (files/symbols/relationships) | leg record |
|---|---|---|---|
| tsx | verified | 2 / 23 / 49 | `validation/m29/results/wave-tsx.json` |
| html | verified | 2 / 23 / 41 | `validation/m29/results/wave-html.json` |
| css | verified | 2 / 26 / 41 | `validation/m29/results/wave-css.json` |
| scss | verified | 2 / 24 / 42 | `validation/m29/results/wave-scss.json` |
| sass | failed (3 checks) | 2 / 19 / 34 | `validation/m29/results/wave-sass.json` |
| json | verified | 2 / 43 / 85 | `validation/m29/results/wave-json.json` |
| yaml | verified | 2 / 30 / 59 | `validation/m29/results/wave-yaml.json` |
| toml | verified | 2 / 27 / 52 | `validation/m29/results/wave-toml.json` |
| markdown | verified | 2 / 23 / 39 | `validation/m29/results/wave-markdown.json` |
| xml | verified | 2 / 42 / 71 | `validation/m29/results/wave-xml.json` |
| graphql | verified | 2 / 41 / 92 | `validation/m29/results/wave-graphql.json` |
| protobuf | verified | 2 / 39 / 80 | `validation/m29/results/wave-protobuf.json` |
| sql | verified | 2 / 31 / 53 | `validation/m29/results/wave-sql.json` |

`files=2` in every row is `main.<ext>` plus `expectations.json` (the pack
directory is the project; the expectations record is itself indexed as JSON).
Per-language hover/definition/references `detail` payloads are in the sealed
records; the hovered declarations measured were: `function Greeting`
(tsx), `class email` (html), `variable --brand-color` (css), `variable
$brand-color` (scss), `class User` (json), `constant service` (yaml),
`namespace versions` (toml), `type Configure` (markdown), `class catalog`
(xml), `class User` (graphql), `class User` (protobuf), `class users` (sql).

## sass — BLOCKED, with the exact evidence

`validation/m29/results/wave-sass.json`, `status: "failed"`, failed steps:

```
L2: hover renders the symbol          — hover rendered "public module main.sass", not $brand-color
L4: workspace symbol finds it         — []
L5: call hierarchy prepares           — [{"name":"main.sass","kind":2,...}]
```

The other nine checks pass in the same record, including `S4-real-index`
(`files=2 symbols=19 rels=34`), `L1: capabilities advertised` and
`§3: warm p95 within budgets` — so this is not a server or wiring failure.

Root cause, measured:

- the fixture is REAL indented Sass (no braces, `$brand-color`, `=card-surface`
  mixin, `+card-surface(...)` include) — the language's own syntax;
- `src/ast/engine.ts:2366-2368` routes language `sass` to `RealCssAnalyzer`
  (`case "css": case "sass":`), and `src/ast/language-detection.ts:66-78`
  records the consequence: there is no tree-sitter-sass here, the CSS grammar
  cannot represent indented syntax, so a real `.sass` file parses with ERROR
  nodes;
- measured on `main.sass` alone (real index build): **1 symbol — the file
  module `main.sass` — and 0 relationships**. The pack's `symbols=19` in the
  S4 step is the pack's `expectations.json` counted as JSON; it does NOT show
  that Sass was analyzed. `$brand-color` is not in the index at all.

So the three failures are all the same fact: the Sass declaration is not a
symbol, and the only indexed symbol in the file is the module, which is what
hover/workspace-symbol/call-hierarchy answer. This is an **analyzer/grammar
gap**, not a semantics question: Sass has variables and mixins, so hover /
definition / references / document symbols are the right features for it.

The fixture was not rewritten in CSS-compatible syntax to route around the
grammar — that would exercise CSS, not Sass. Until a Sass grammar is vendored:

- keep `wave-sass.json` as the honest failed record;
- keep `sass` out of the launch claim (the R2 verifier's per-language check
  `R2: sass S5 status verified` will otherwise be red), or remove it from the
  wave-3 approval record + `LAUNCH_LANGUAGES` + the `.sass` path map for this
  wave.

## toml — the one non-green-looking assertion that still sealed

`wave-toml.json` step `L3: references non-empty` reports `got 1`. That one
location is the **declaration** — `textDocument/references` was called with
`includeDeclaration: true` (`script/m29/wave-execute.ts:173`), so a symbol with
zero usage rows still yields 1. The TOML fixture does carry two REAL
`references` edges (Gradle version-catalogue `version.ref = "groovy"` /
`"junit"`), but their targets are the fully-qualified key symbols
`versions.groovy` / `versions.junit`; TOML symbol names are full dotted paths
and never appear literally on one line, so no usage row can target the
hoverable symbol `versions`. The fixture is genuine TOML (a version catalogue is
TOML's one reference construct, and the index stores the edges); only the
assertion is insensitive. A references claim for a config format needs a
usage-row assertion (declaration excluded), not just this check.

## call-hierarchy caveat (shared with lane C)

`L5: call hierarchy prepares` asserts only `item.name === symbol`
(`script/m29/wave-execute.ts:189-191`). `prepareCallHierarchy` returns an item
for ANY symbol, including variables, config attributes, headings, markup
elements and data keys (`src/lsp/call_hierarchy.ts:960-1060`; the item `kind`
map is at `:215-235`). LSP call hierarchy is defined over callables, so for
these languages the check is mechanically green while the claim it appears to
support is semantically void. Lane C reached the same conclusion for hcl and
terraform and proposed the shared fix: `prepareCallHierarchy` should declare
absence for non-callable symbol kinds, after which the L5 check must become
language/kind-aware (or the feature declared absent in the launch record for
these languages). This lane's 11 NOT-LSP-APPROPRIATE verdicts are that same
finding, scoped to the call-hierarchy feature.

Note the languages where a callable target was available and used: none in this
lane. `tsx` hovers `function Greeting` (callable, verified PASS in the strict
sense). Sass mixins are callable (`@include`) but the sass leg is blocked before
that distinction matters.

## S1 (#419 SPEC ledger) status — caps six languages at I0

`S1-analyzer-conformance` reads `validation/m14/results/M14.0.SPEC.json`
(committed M14 evidence, not editable by this lane). Measured today:

| language | S1 today |
|---|---|
| html, css, scss, yaml, toml, markdown, xml | 8/8 sections pass |
| tsx, json, graphql, protobuf, sql | **absent from the ledger** → S1 fail → IDE cap I0 |
| sass | **absent from the ledger** (and the S5 leg failed anyway) |

So the verified S5 legs for tsx, json, graphql, protobuf and sql are not yet
usable for an I1+ claim: `computeCap` returns I0 when S1 fails. That gap is an
M14 ledger entry, not a wave-leg defect.

## What the Lead must integrate

1. **Re-run the 13 legs after the commit that lands these packs.** A leg is
   fresh only while `git diff <leg.commit> HEAD -- <its inputs>` is empty
   (`script/m29/verify-wave-execution.ts:151-160`), and the inputs include
   `script/m29/wave-fixtures/<lang>` plus the shared LSP/server sources
   (`staleRelevantPaths`, `script/m29/wave-execute.ts:235-246`). The packs and
   the integration edits are currently untracked/uncommitted, so the commit
   advances HEAD and stales every leg sealed at `fced0a14`. Correct sequence:
   commit code+fixtures, then `npx tsx script/m29/wave-execute.ts --languages
   tsx,html,css,scss,sass,json,yaml,toml,markdown,xml,graphql,protobuf,sql`,
   then commit the sealed records.
2. **sass decision.** `wave-sass.json` is sealed `failed`; the R2 verifier checks
   `R2: sass S5 status verified` for every approved language. Either remove
   `sass` from `wave-3-approval.json`, `LAUNCH_LANGUAGES` and the `.sass` path
   map for this wave, or keep it and record the failed leg as a declared
   blocker (wave-protocol will cap it at I1, R2 will be red). Fixing it needs a
   Sass parser: vendor a tree-sitter-sass grammar + analyzer and route `.sass`
   to it.
3. **S1 ledger entries.** Add `tsx`, `json`, `graphql`, `protobuf`, `sql` (and
   `sass` if kept) to the #419 SPEC ledger, or accept the I0 cap. This is the
   one item that blocks a real cap above I0 for five verified languages.
4. **Call-hierarchy scoping (shared with lane C).** `prepareCallHierarchy` in
   `src/lsp/call_hierarchy.ts` should return a declared absence for non-callable
   symbol kinds; then make the S5 `L5` check language/kind-aware, or mark the
   feature absent for the 11 formats in the launch record. Until then the
   verified legs prove hover/definition/references/documentSymbols/workspace
   symbols, not call hierarchy, for those formats.
5. **S6 (I3) is not produced by this lane.** No `wave-editor-<lang>.json` exists
   for these 13. The S5 records above can support I2 (once S1 is satisfied); I3
   needs the in-editor leg the Lead / editor lane owns.
6. **S2/S3 and the wave-protocol runner were not run by this lane** — they spawn
   the expensive gates; no claim about them is made here.
7. **Freshness relevance gap for aliased analyzers.** `staleRelevantPaths("tsx")`
   and `staleRelevantPaths("sass")` name `src/ast/real-tsx-analyzer.ts` /
   `src/ast/real-sass-analyzer.ts`, which do not exist: tsx is served by
   `real-typescript-analyzer.ts` and sass by `real-css-analyzer.ts`, so a change
   to those real analyzers would NOT stale the tsx/sass legs. Minor, but it is
   a real hole in the per-language relevance rule (wave-2 rule) for aliased
   languages.
8. **No fixture edits are needed for the 12 verified languages** — their launch
   set entries can stay as the Lead added them.

## Files created

- `script/m29/wave-fixtures/{tsx,html,css,scss,sass,json,yaml,toml,markdown,xml,graphql,protobuf,sql}/main.<ext>`
  and `expectations.json` (13 packs, 26 files).
- `validation/m29/results/wave-<lang>.json` for all 13 languages (sealed S5
  records; 12 `verified`, `sass` `failed`).
- `docs/analyzers/wave-lane-a.md` (this report).

No shared file was edited by this lane; `script/m29/wave-protocol.ts`,
`src/lsp/launch_languages.ts`, the approval records and other lanes' packs were
left untouched.
