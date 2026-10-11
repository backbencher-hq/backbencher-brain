# Doc-truth emissions register

GENERATED FILE — do not hand-edit. Regenerate with `bun run script/m14/verify-doc-truth-emissions.ts`. The gate that writes it is `script/m14/verify-doc-truth-emissions.ts`; its header is the argument for every rule below.

## What is measured

For each `src/ast/real-<lang>-analyzer.ts` and `docs/analyzers/real-<lang>-analyzer.md`: the analyzer's emitted surface over BOTH channels — the `ASTEngine.RelationshipType.*` references in code, and the import-site channel (`ImportInfo[]` returned as `imports`) — against the "Emitted?" cells of the doc's relationship-ontology table. Comments and string literals are stripped first, so only code is accused.

| Measure | Count | Fails the gate |
| --- | --- | --- |
| analyzers examined | 48 | — |
| analyzers with a canonical doc | 47 | — |
| FALSE_NEGATIVE — doc says "not emitted", analyzer emits it | 7 | **yes** |
| FALSE_POSITIVE — doc says "emitted", nothing emits it | 0 | **yes** |
| UNDOCUMENTED — live channel, no checkable claim | 34 | no (measured here) |
| MISSING_DOC — no canonical doc | 1 | no (owned by verify-analyzer-docs.ts) |
| NO_CLAIM_TABLE — no ontology table to compare | 18 | no |
| NON_ENGINE_KIND — row is not a RelationshipType alias | 13 | no |
| MIXED_ROW — engine and non-kind names share one cell | 0 | no |
| COMPOUND_ROW — verdict from a multi-name row | 0 | no |

The import-site: ImportInfo[] channel is live in **47 of 48** analyzers.
The export-site: ExportInfo[] channel is live in **41 of 48** analyzers.

## FALSE_NEGATIVE — the lies that block

| Analyzer | Doc row | Source | Doc line | Claim cell |
| --- | --- | --- | --- | --- |
| clojure | `overrides (relationship)` | `src/ast/real-clojure-analyzer.ts` | 105 | ❌ (N/A) |
| csharp | `uses (relationship)` | `src/ast/real-csharp-analyzer.ts` | 58 | ❌ (not emitted) — **STALE, see CS-R1** |
| csharp | `imports (import-site: ImportInfo[])` | `src/ast/real-csharp-analyzer.ts` | 64 | ➖ **separate channel, not a relationship** |
| css | `exports (export-site: ExportInfo[])` | `src/ast/real-css-analyzer.ts` | 780 | no — RULED |
| elixir | `overrides (relationship)` | `src/ast/real-elixir-analyzer.ts` | 51 | ⚠ GAP-in-the-language, DOES NOT FIRE on this corpus |
| java | `imports (relationship + import-site: ImportInfo[])` | `src/ast/real-java-analyzer.ts` | 68 | ❌ **not emitted** |
| scala | `uses (relationship)` | `src/ast/real-scala-analyzer.ts` | 50 | ❌ (not emitted) |

## FALSE_POSITIVE — claims of a channel that is empty

None.

## UNDOCUMENTED — a live channel the table never claims anything about

This is the population the gate MEASURES rather than blocks. Each row is one analyzer's silence, listed so the next doc lane can pick it up without re-running anything.

| Analyzer | Live channel | Ontology table at |
| --- | --- | --- |
| bash | `calls (relationship)` | line 142 |
| c | `contains (relationship)` | line 409 |
| c | `instantiates (relationship)` | line 409 |
| c | `overrides (relationship)` | line 409 |
| clojure | `calls (relationship)` | line 96 |
| csharp | `calls (relationship)` | line 51 |
| css | `contains (relationship)` | line 770 |
| dart | `calls (relationship)` | line 58 |
| elixir | `contains (relationship)` | line 42 |
| elixir | `imports (import-site: ImportInfo[])` | line 42 |
| erlang | `contains (relationship)` | line 55 |
| erlang | `exports (relationship)` | line 55 |
| erlang | `imports (relationship)` | line 55 |
| erlang | `imports (import-site: ImportInfo[])` | line 55 |
| erlang | `exports (export-site: ExportInfo[])` | line 55 |
| fsharp | `calls (relationship)` | line 53 |
| go | `contains (relationship)` | line 724 |
| groovy | `calls (relationship)` | line 134 |
| haskell | `contains (relationship)` | line 56 |
| java | `calls (relationship)` | line 57 |
| javascript | `calls (relationship)` | line 46 |
| julia | `calls (relationship)` | line 737 |
| kotlin | `calls (relationship)` | line 46 |
| objective-c | `contains (relationship)` | line 61 |
| objective-c | `overrides (relationship)` | line 61 |
| powershell | `calls (relationship)` | line 213 |
| python | `calls (relationship)` | line 39 |
| python | `implements (relationship)` | line 39 |
| rust | `contains (relationship)` | line 36 |
| rust | `references (relationship)` | line 36 |
| scala | `calls (relationship)` | line 44 |
| swift | `contains (relationship)` | line 48 |
| typescript | `calls (relationship)` | line 81 |
| xml | `contains (relationship)` | line 381 |

## MISSING_DOC

| Analyzer | Doc |
| --- | --- |
| real-makefile-analyzer.ts | no `docs/analyzers/real-makefile-analyzer.md` |

## Docs with no ontology claim table (nothing was comparable)

`cpp`, `graphql`, `hcl`, `html`, `json`, `markdown`, `perl`, `php`, `r`, `ruby`, `scss`, `solidity`, `sql`, `svelte`, `toml`, `vb`, `vue`, `yaml`

## Docs with more than one ontology-shaped table (only the first is compared)

`c`, `dart`, `erlang`, `fsharp`, `swift`, `xml`

## Informational rows excluded from comparison

| Analyzer | Row name | Why excluded | Doc line |
| --- | --- | --- | --- |
| clojure | <language-specific> | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 108 |
| csharp | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 61 |
| csharp | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 62 |
| fsharp | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 63 |
| java | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 69 |
| java | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 70 |
| python | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 50 |
| scala | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 56 |
| scala | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 57 |
| typescript | imports — type-only marker | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 89 |
| typescript | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 94 |
| typescript | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 95 |
| typescript | jsx element usage | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 96 |

## Census — what each analyzer actually emits

| Analyzer | Relationship kinds in code | Payload channels live | Claim table |
| --- | --- | --- | --- |
| bash | `calls contains exports overrides references uses imports` | import-site: ImportInfo[] | line 142, 9 rows |
| c | `calls contains exports instantiates overrides references uses imports` | import-site: ImportInfo[] | line 409, 5 rows |
| clean | `calls contains exports implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 430, 9 rows |
| clojure | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 96, 10 rows |
| cpp | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| csharp | `calls contains exports extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 51, 11 rows |
| css | `contains overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 770, 9 rows |
| dart | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 58, 9 rows |
| elixir | `calls contains exports implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 42, 7 rows |
| erlang | `calls contains exports implements instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 55, 5 rows |
| fsharp | `calls contains extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 53, 10 rows |
| go | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 724, 9 rows |
| graphql | `contains exports extends implements overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| groovy | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 134, 9 rows |
| haskell | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 56, 9 rows |
| hcl | `calls contains exports overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| html | `contains references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| java | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 57, 11 rows |
| javascript | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 46, 9 rows |
| json | `calls contains exports extends implements overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| julia | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 737, 9 rows |
| kotlin | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 46, 9 rows |
| lua | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 100, 9 rows |
| makefile | `calls contains exports references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| markdown | `contains references uses imports` | import-site: ImportInfo[] | absent |
| nim | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 612, 10 rows |
| objective-c | `calls contains exports extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 61, 9 rows |
| perl | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| php | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| powershell | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 213, 9 rows |
| protobuf | `contains exports overrides uses imports` | import-site: ImportInfo[] | line 360, 9 rows |
| python | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 39, 9 rows |
| r | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| ruby | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| rust | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 36, 8 rows |
| scala | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 44, 11 rows |
| scss | `calls exports extends overrides references` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| solidity | `calls contains exports extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| sql | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| svelte | `calls contains instantiates uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| swift | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 48, 9 rows |
| toml | `contains references` | — | absent |
| typescript | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 81, 13 rows |
| vb | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[] | absent |
| vue | `contains exports extends instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| xml | `calls contains extends overrides references imports` | import-site: ImportInfo[] | line 381, 10 rows |
| yaml | `calls contains exports extends overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| zig | `calls contains exports instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 284, 9 rows |
