# Doc-truth emissions register

GENERATED FILE — do not hand-edit. Regenerate with `bun run script/m14/verify-doc-truth-emissions.ts`. The gate that writes it is `script/m14/verify-doc-truth-emissions.ts`; its header is the argument for every rule below.

## What is measured

For each `src/ast/real-<lang>-analyzer.ts` and `docs/analyzers/real-<lang>-analyzer.md`: the analyzer's emitted surface over BOTH channels — the `ASTEngine.RelationshipType.*` references in code, and the import-site channel (`ImportInfo[]` returned as `imports`) — against the "Emitted?" cells of the doc's relationship-ontology table. Comments and string literals are stripped first, so only code is accused.

| Measure | Count | Fails the gate |
| --- | --- | --- |
| analyzers examined | 48 | — |
| analyzers with a canonical doc | 47 | — |
| FALSE_NEGATIVE — doc says "not emitted", analyzer emits it | 0 | **yes** |
| FALSE_POSITIVE — doc says "emitted", nothing emits it | 0 | **yes** |
| UNDOCUMENTED — live channel, no checkable claim | 10 | no (measured here) |
| MISSING_DOC — no canonical doc | 1 | no (owned by verify-analyzer-docs.ts) |
| NO_CLAIM_TABLE — no ontology table to compare | 18 | no |
| NON_ENGINE_KIND — row is not a RelationshipType alias | 13 | no |
| MIXED_ROW — engine and non-kind names share one cell | 1 | no |
| COMPOUND_ROW — verdict from a multi-name row | 0 | no |

The import-site: ImportInfo[] channel is live in **47 of 48** analyzers.
The export-site: ExportInfo[] channel is live in **41 of 48** analyzers.

## FALSE_NEGATIVE — the lies that block

None. Every "not emitted" cell in every table agrees with the analyzer source.

## FALSE_POSITIVE — claims of a channel that is empty

None.

## UNDOCUMENTED — a live channel the table never claims anything about

This is the population the gate MEASURES rather than blocks. Each row is one analyzer's silence, listed so the next doc lane can pick it up without re-running anything.

| Analyzer | Live channel | Ontology table at |
| --- | --- | --- |
| c | `instantiates (relationship)` | line 409 |
| c | `overrides (relationship)` | line 409 |
| elixir | `imports (relationship)` | line 42 |
| elixir | `imports (import-site: ImportInfo[])` | line 42 |
| erlang | `exports (relationship)` | line 55 |
| erlang | `imports (relationship)` | line 55 |
| erlang | `imports (import-site: ImportInfo[])` | line 55 |
| erlang | `exports (export-site: ExportInfo[])` | line 55 |
| python | `implements (relationship)` | line 39 |
| rust | `references (relationship)` | line 36 |

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
| nim | all ten / one row each | MIXED_ROW — row mixes engine kinds with names that are not RelationshipType aliases, so one shared cell cannot be attributed per kind; excluded from comparison | 614 |
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
| bash | `calls contains exports overrides references uses imports` | import-site: ImportInfo[] | line 142, 10 rows |
| c | `calls contains exports instantiates overrides references uses imports` | import-site: ImportInfo[] | line 409, 6 rows |
| clean | `calls contains exports implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 430, 10 rows |
| clojure | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 96, 11 rows |
| cpp | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| csharp | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 51, 12 rows |
| css | `contains overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 770, 10 rows |
| dart | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 58, 10 rows |
| elixir | `calls contains exports implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 42, 8 rows |
| erlang | `calls contains exports implements instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 55, 6 rows |
| fsharp | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 53, 11 rows |
| go | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 724, 10 rows |
| graphql | `contains exports extends implements overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| groovy | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 134, 10 rows |
| haskell | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 56, 10 rows |
| hcl | `calls contains exports extends overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| html | `contains extends overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| java | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 57, 12 rows |
| javascript | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 46, 10 rows |
| json | `calls contains exports extends implements overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| julia | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 737, 10 rows |
| kotlin | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 46, 10 rows |
| lua | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 100, 10 rows |
| makefile | `calls contains exports overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| markdown | `contains references uses imports` | import-site: ImportInfo[] | absent |
| nim | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 612, 11 rows |
| objective-c | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 91, 10 rows |
| perl | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| php | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| powershell | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 213, 10 rows |
| protobuf | `contains exports overrides uses imports` | import-site: ImportInfo[] | line 360, 10 rows |
| python | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 39, 10 rows |
| r | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| ruby | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| rust | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 36, 9 rows |
| scala | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 44, 12 rows |
| scss | `calls exports extends overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| solidity | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| sql | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| svelte | `calls contains extends instantiates overrides uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| swift | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 48, 10 rows |
| toml | `contains exports references imports` | — | absent |
| typescript | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 81, 14 rows |
| vb | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[] | absent |
| vue | `contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| xml | `calls contains extends overrides references uses imports` | import-site: ImportInfo[] | line 381, 11 rows |
| yaml | `calls contains exports extends overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| zig | `calls contains exports instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 284, 10 rows |
