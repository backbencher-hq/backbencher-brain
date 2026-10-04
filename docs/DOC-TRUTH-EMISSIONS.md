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
| UNDOCUMENTED — live channel, no checkable claim | 40 | no (measured here) |
| MISSING_DOC — no canonical doc | 1 | no (owned by verify-analyzer-docs.ts) |
| NO_CLAIM_TABLE — no ontology table to compare | 19 | no |
| NON_ENGINE_KIND — row is not a RelationshipType alias | 19 | no |
| MIXED_ROW — engine and non-kind names share one cell | 1 | no |
| COMPOUND_ROW — verdict from a multi-name row | 3 | no |

The import-site: ImportInfo[] channel is live in **47 of 48** analyzers.
The export-site: ExportInfo[] channel is live in **41 of 48** analyzers.

## FALSE_NEGATIVE — the lies that block

| Analyzer | Doc row | Source | Doc line | Claim cell |
| --- | --- | --- | --- | --- |
| cpp | `imports (import-site: ImportInfo[])` | `src/ast/real-cpp-analyzer.ts` | 269 | ❌ **never as a relationship** |
| cpp | `exports (export-site: ExportInfo[])` | `src/ast/real-cpp-analyzer.ts` | 270 | ❌ **never as a relationship** |
| csharp | `uses (relationship)` | `src/ast/real-csharp-analyzer.ts` | 51 | ❌ (not emitted) |
| css | `exports (export-site: ExportInfo[])` | `src/ast/real-css-analyzer.ts` | 52 | no — RULED |
| go | `exports (export-site: ExportInfo[])` | `src/ast/real-go-analyzer.ts` | 68 | ❌ not emitted |
| java | `imports (import-site: ImportInfo[])` | `src/ast/real-java-analyzer.ts` | 68 | ❌ **not emitted** |
| scala | `uses (relationship)` | `src/ast/real-scala-analyzer.ts` | 50 | ❌ (not emitted) |

## FALSE_POSITIVE — claims of a channel that is empty

None.

## UNDOCUMENTED — a live channel the table never claims anything about

This is the population the gate MEASURES rather than blocks. Each row is one analyzer's silence, listed so the next doc lane can pick it up without re-running anything.

| Analyzer | Live channel | Ontology table at |
| --- | --- | --- |
| bash | `calls (relationship)` | line 56 |
| c | `calls (relationship)` | line 51 |
| clojure | `calls (relationship)` | line 96 |
| cpp | `contains (relationship)` | line 259 |
| csharp | `calls (relationship)` | line 44 |
| csharp | `imports (import-site: ImportInfo[])` | line 44 |
| csharp | `exports (export-site: ExportInfo[])` | line 44 |
| css | `contains (relationship)` | line 42 |
| dart | `calls (relationship)` | line 52 |
| elixir | `contains (relationship)` | line 42 |
| elixir | `imports (import-site: ImportInfo[])` | line 42 |
| elixir | `exports (export-site: ExportInfo[])` | line 42 |
| erlang | `contains (relationship)` | line 55 |
| erlang | `exports (relationship)` | line 55 |
| erlang | `imports (relationship)` | line 55 |
| erlang | `imports (import-site: ImportInfo[])` | line 55 |
| erlang | `exports (export-site: ExportInfo[])` | line 55 |
| fsharp | `calls (relationship)` | line 53 |
| go | `contains (relationship)` | line 58 |
| groovy | `calls (relationship)` | line 118 |
| groovy | `imports (import-site: ImportInfo[])` | line 118 |
| groovy | `exports (export-site: ExportInfo[])` | line 118 |
| haskell | `contains (relationship)` | line 48 |
| java | `calls (relationship)` | line 57 |
| javascript | `calls (relationship)` | line 29 |
| julia | `calls (relationship)` | line 42 |
| kotlin | `calls (relationship)` | line 30 |
| objective-c | `contains (relationship)` | line 61 |
| objective-c | `overrides (relationship)` | line 61 |
| python | `calls (relationship)` | line 39 |
| python | `references (relationship)` | line 39 |
| rust | `contains (relationship)` | line 36 |
| rust | `references (relationship)` | line 36 |
| scala | `calls (relationship)` | line 44 |
| svelte | `calls (relationship)` | line 39 |
| svelte | `uses (relationship)` | line 39 |
| swift | `contains (relationship)` | line 36 |
| swift | `imports (import-site: ImportInfo[])` | line 36 |
| swift | `exports (export-site: ExportInfo[])` | line 36 |
| typescript | `calls (relationship)` | line 29 |

## MISSING_DOC

| Analyzer | Doc |
| --- | --- |
| real-makefile-analyzer.ts | no `docs/analyzers/real-makefile-analyzer.md` |

## Docs with no ontology claim table (nothing was comparable)

`graphql`, `hcl`, `html`, `json`, `markdown`, `nim`, `perl`, `php`, `powershell`, `protobuf`, `r`, `ruby`, `scss`, `solidity`, `sql`, `toml`, `vb`, `xml`, `yaml`

## Docs with more than one ontology-shaped table (only the first is compared)

`c`, `erlang`

## Informational rows excluded from comparison

| Analyzer | Row name | Why excluded | Doc line |
| --- | --- | --- | --- |
| c | extends | COMPOUND_ROW — kind claimed by a multi-name row; the cell is shared, so this verdict came from a compound claim | 60 |
| c | implements | COMPOUND_ROW — kind claimed by a multi-name row; the cell is shared, so this verdict came from a compound claim | 60 |
| c | overrides | COMPOUND_ROW — kind claimed by a multi-name row; the cell is shared, so this verdict came from a compound claim | 60 |
| clojure | <language-specific> | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 108 |
| csharp | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 54 |
| csharp | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 55 |
| fsharp | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 63 |
| go | implements / instantiates / contains / extends / uses / overrides / depends / fieldaccess | MIXED_ROW — row mixes engine kinds with names that are not RelationshipType aliases, so one shared cell cannot be attributed per kind; excluded from comparison | 69 |
| groovy | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 128 |
| groovy | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 129 |
| java | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 69 |
| java | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 70 |
| javascript | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 40 |
| kotlin | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 42 |
| kotlin | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 43 |
| python | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 50 |
| scala | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 56 |
| scala | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 57 |
| svelte | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 50 |
| typescript | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 41 |
| typescript | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 42 |
| typescript | jsx element usage | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 43 |
| vue | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 67 |

## Census — what each analyzer actually emits

| Analyzer | Relationship kinds in code | Payload channels live | Claim table |
| --- | --- | --- | --- |
| bash | `calls contains exports overrides references uses imports` | import-site: ImportInfo[] | line 56, 9 rows |
| c | `calls contains exports instantiates references uses imports` | import-site: ImportInfo[] | line 51, 7 rows |
| clean | `calls contains exports implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 375, 9 rows |
| clojure | `calls contains extends implements instantiates references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 96, 10 rows |
| cpp | `calls contains extends instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 259, 9 rows |
| csharp | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 44, 9 rows |
| css | `contains overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 42, 9 rows |
| dart | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 52, 9 rows |
| elixir | `calls contains implements instantiates references` | import-site: ImportInfo[], export-site: ExportInfo[] | line 42, 5 rows |
| erlang | `calls contains exports implements instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 55, 5 rows |
| fsharp | `calls contains extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 53, 10 rows |
| go | `calls contains extends implements instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 58, 9 rows |
| graphql | `contains exports extends implements overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| groovy | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 118, 9 rows |
| haskell | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 48, 9 rows |
| hcl | `calls contains exports overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| html | `contains uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| java | `calls contains exports extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 57, 11 rows |
| javascript | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 29, 9 rows |
| json | `calls contains exports extends overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| julia | `calls contains extends instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 42, 9 rows |
| kotlin | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 30, 11 rows |
| lua | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 75, 9 rows |
| makefile | `calls contains exports references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| markdown | `contains uses` | import-site: ImportInfo[] | absent |
| nim | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| objective-c | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 61, 9 rows |
| perl | `calls contains extends implements instantiates overrides` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| php | `calls contains extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| powershell | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| protobuf | `contains uses` | import-site: ImportInfo[] | absent |
| python | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 39, 9 rows |
| r | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| ruby | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| rust | `calls contains exports extends implements instantiates references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 36, 8 rows |
| scala | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 44, 11 rows |
| scss | `exports overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| solidity | `calls contains exports extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| sql | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| svelte | `calls contains instantiates uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 39, 9 rows |
| swift | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 36, 7 rows |
| toml | `contains` | — | absent |
| typescript | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 29, 12 rows |
| vb | `calls contains extends implements overrides references imports` | import-site: ImportInfo[] | absent |
| vue | `contains exports extends instantiates references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 56, 9 rows |
| xml | `calls contains extends references imports` | import-site: ImportInfo[] | absent |
| yaml | `calls contains exports extends overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| zig | `calls contains exports instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 269, 9 rows |
