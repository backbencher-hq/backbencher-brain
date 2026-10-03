# Doc-truth emissions register

GENERATED FILE — do not hand-edit. Regenerate with `bun run script/m14/verify-doc-truth-emissions.ts`. The gate that writes it is `script/m14/verify-doc-truth-emissions.ts`; its header is the argument for every rule below.

## What is measured

For each `src/ast/real-<lang>-analyzer.ts` and `docs/analyzers/real-<lang>-analyzer.md`: the analyzer's emitted surface over BOTH channels — the `ASTEngine.RelationshipType.*` references in code, and the import-site channel (`ImportInfo[]` returned as `imports`) — against the "Emitted?" cells of the doc's relationship-ontology table. Comments and string literals are stripped first, so only code is accused.

| Measure | Count | Fails the gate |
| --- | --- | --- |
| analyzers examined | 48 | — |
| analyzers with a canonical doc | 47 | — |
| FALSE_NEGATIVE — doc says "not emitted", analyzer emits it | 8 | **yes** |
| FALSE_POSITIVE — doc says "emitted", nothing emits it | 0 | **yes** |
| UNDOCUMENTED — live channel, no checkable claim | 44 | no (measured here) |
| MISSING_DOC — no canonical doc | 1 | no (owned by verify-analyzer-docs.ts) |
| NO_CLAIM_TABLE — no ontology table to compare | 21 | no |
| NON_ENGINE_KIND — row is not a RelationshipType alias | 26 | no |
| MIXED_ROW — engine and non-kind names share one cell | 1 | no |
| COMPOUND_ROW — verdict from a multi-name row | 3 | no |

The import-site: ImportInfo[] channel is live in **47 of 48** analyzers.
The export-site: ExportInfo[] channel is live in **40 of 48** analyzers.

## FALSE_NEGATIVE — the lies that block

| Analyzer | Doc row | Source | Doc line | Claim cell |
| --- | --- | --- | --- | --- |
| cpp | `imports (import-site: ImportInfo[])` | `src/ast/real-cpp-analyzer.ts` | 269 | ❌ **never as a relationship** |
| cpp | `exports (export-site: ExportInfo[])` | `src/ast/real-cpp-analyzer.ts` | 270 | ❌ **never as a relationship** |
| csharp | `uses (relationship)` | `src/ast/real-csharp-analyzer.ts` | 51 | ❌ (not emitted) |
| go | `exports (export-site: ExportInfo[])` | `src/ast/real-go-analyzer.ts` | 68 | ❌ not emitted |
| java | `imports (import-site: ImportInfo[])` | `src/ast/real-java-analyzer.ts` | 68 | ❌ **not emitted** |
| scala | `uses (relationship)` | `src/ast/real-scala-analyzer.ts` | 50 | ❌ (not emitted) |
| yaml | `uses (relationship)` | `src/ast/real-yaml-analyzer.ts` | 38 | no |
| yaml | `exports (relationship + export-site: ExportInfo[])` | `src/ast/real-yaml-analyzer.ts` | 40 | no |

## FALSE_POSITIVE — claims of a channel that is empty

None.

## UNDOCUMENTED — a live channel the table never claims anything about

This is the population the gate MEASURES rather than blocks. Each row is one analyzer's silence, listed so the next doc lane can pick it up without re-running anything.

| Analyzer | Live channel | Ontology table at |
| --- | --- | --- |
| c | `calls (relationship)` | line 51 |
| clojure | `calls (relationship)` | line 96 |
| cpp | `contains (relationship)` | line 259 |
| csharp | `calls (relationship)` | line 44 |
| csharp | `imports (import-site: ImportInfo[])` | line 44 |
| csharp | `exports (export-site: ExportInfo[])` | line 44 |
| css | `contains (relationship)` | line 36 |
| dart | `calls (relationship)` | line 34 |
| elixir | `contains (relationship)` | line 42 |
| elixir | `imports (import-site: ImportInfo[])` | line 42 |
| elixir | `exports (export-site: ExportInfo[])` | line 42 |
| erlang | `contains (relationship)` | line 55 |
| erlang | `exports (relationship)` | line 55 |
| erlang | `imports (relationship)` | line 55 |
| erlang | `imports (import-site: ImportInfo[])` | line 55 |
| erlang | `exports (export-site: ExportInfo[])` | line 55 |
| fsharp | `calls (relationship)` | line 53 |
| fsharp | `imports (import-site: ImportInfo[])` | line 53 |
| fsharp | `exports (export-site: ExportInfo[])` | line 53 |
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
| scss | `references (relationship)` | line 91 |
| scss | `uses (relationship)` | line 91 |
| scss | `imports (import-site: ImportInfo[])` | line 91 |
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

`bash`, `clean`, `graphql`, `hcl`, `html`, `json`, `lua`, `markdown`, `nim`, `perl`, `php`, `powershell`, `protobuf`, `r`, `ruby`, `solidity`, `sql`, `toml`, `vb`, `xml`, `zig`

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
| yaml | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 44 |
| yaml | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 45 |
| yaml | yamlmerge | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 46 |
| yaml | yamltaginclude | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 47 |
| yaml | yamlkeywordinclude | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 48 |
| yaml | yamlactionuse | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 49 |
| yaml | yamlactionuseunverified | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 50 |

## Census — what each analyzer actually emits

| Analyzer | Relationship kinds in code | Payload channels live | Claim table |
| --- | --- | --- | --- |
| bash | `calls contains exports overrides references uses imports` | import-site: ImportInfo[] | absent |
| c | `calls contains exports instantiates references uses imports` | import-site: ImportInfo[] | line 51, 7 rows |
| clean | `calls contains exports implements instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| clojure | `calls contains extends implements instantiates references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 96, 10 rows |
| cpp | `calls contains extends instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 259, 9 rows |
| csharp | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 44, 9 rows |
| css | `contains references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 36, 6 rows |
| dart | `calls contains exports extends implements instantiates overrides uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 34, 9 rows |
| elixir | `calls contains implements instantiates references` | import-site: ImportInfo[], export-site: ExportInfo[] | line 42, 5 rows |
| erlang | `calls contains exports implements instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 55, 5 rows |
| fsharp | `calls contains extends implements instantiates overrides references` | import-site: ImportInfo[], export-site: ExportInfo[] | line 53, 8 rows |
| go | `calls contains extends implements instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 58, 9 rows |
| graphql | `contains implements uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| groovy | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 118, 9 rows |
| haskell | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 48, 9 rows |
| hcl | `contains exports references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| html | `contains uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| java | `calls contains exports extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 57, 11 rows |
| javascript | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 29, 9 rows |
| json | `contains exports extends references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| julia | `calls contains extends instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 42, 9 rows |
| kotlin | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 30, 11 rows |
| lua | `calls contains extends instantiates imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| makefile | `calls contains exports references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| markdown | `contains uses` | import-site: ImportInfo[] | absent |
| nim | `calls contains extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| objective-c | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 61, 9 rows |
| perl | `calls contains extends implements instantiates overrides` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| php | `calls contains extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| powershell | `calls contains exports extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| protobuf | `contains uses` | import-site: ImportInfo[] | absent |
| python | `calls contains exports extends instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 39, 9 rows |
| r | `calls contains exports extends implements instantiates overrides references imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| ruby | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| rust | `calls contains exports extends implements instantiates references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 36, 8 rows |
| scala | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 44, 11 rows |
| scss | `references uses` | import-site: ImportInfo[] | line 91, 3 rows |
| solidity | `calls contains exports extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| sql | `calls contains references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| svelte | `calls contains instantiates uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 39, 9 rows |
| swift | `calls contains extends implements instantiates overrides references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 36, 7 rows |
| toml | `contains` | — | absent |
| typescript | `calls contains exports extends implements instantiates overrides references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 29, 12 rows |
| vb | `calls contains extends implements overrides references imports` | import-site: ImportInfo[] | absent |
| vue | `contains exports extends instantiates references uses` | import-site: ImportInfo[], export-site: ExportInfo[] | line 56, 9 rows |
| xml | `contains references imports` | import-site: ImportInfo[] | absent |
| yaml | `contains exports extends references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | line 32, 16 rows |
| zig | `calls contains exports instantiates references uses imports` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
