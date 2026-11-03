# Doc-truth emissions register

GENERATED FILE — do not hand-edit. Regenerate with `bun run script/m14/verify-doc-truth-emissions.ts`. The gate that writes it is `script/m14/verify-doc-truth-emissions.ts`; its header is the argument for every rule below.

## What is measured

For each `src/ast/real-<lang>-analyzer.ts` and `docs/analyzers/<lang>.md`: the analyzer's emitted surface over BOTH channels — the `ASTEngine.RelationshipType.*` references in code, and the import-site channel (`ImportInfo[]` returned as `imports`) — against the "Emitted?" cells of the doc's relationship-ontology table. Comments and string literals are stripped first, so only code is accused.

| Measure | Count | Fails the gate |
| --- | --- | --- |
| analyzers examined | 50 | — |
| analyzers with a canonical doc | 50 | — |
| FALSE_NEGATIVE — doc says "not emitted", analyzer emits it | 1 | **yes** |
| FALSE_POSITIVE — doc says "emitted", nothing emits it | 1 | **yes** |
| UNDOCUMENTED — live channel, no checkable claim | 37 | no (measured here) |
| MISSING_DOC — no canonical doc | 0 | no (owned by verify-analyzer-docs.ts) |
| NO_CLAIM_TABLE — no ontology table to compare | 15 | no |
| NON_ENGINE_KIND — row is not a RelationshipType alias | 27 | no |
| MIXED_ROW — engine and non-kind names share one cell | 1 | no |
| COMPOUND_ROW — verdict from a multi-name row | 0 | no |

The import-site: ImportInfo[] channel is live in **48 of 50** analyzers.
The export-site: ExportInfo[] channel is live in **41 of 50** analyzers.

## FALSE_NEGATIVE — the lies that block

| Analyzer | Doc row | Source | Doc line | Claim cell |
| --- | --- | --- | --- | --- |
| zig | `mixes_in (relationship)` | `src/ast/real-zig-analyzer.ts` | 66 | no |

## FALSE_POSITIVE — claims of a channel that is empty

| Analyzer | Doc row | Source | Doc line | Claim cell |
| --- | --- | --- | --- | --- |
| zig | `part_of (relationship)` | `src/ast/real-zig-analyzer.ts` | 67 | yes |

## UNDOCUMENTED — a live channel the table never claims anything about

This is the population the gate MEASURES rather than blocks. Each row is one analyzer's silence, listed so the next doc lane can pick it up without re-running anything.

| Analyzer | Live channel | Ontology table at |
| --- | --- | --- |
| bash | `part_of (relationship)` | line 175 |
| clojure | `renders (relationship)` | line 96 |
| csharp | `renders (relationship)` | line 51 |
| css | `part_of (relationship)` | line 770 |
| dart | `renders (relationship)` | line 89 |
| dart | `mixes_in (relationship)` | line 89 |
| dart | `part_of (relationship)` | line 89 |
| elixir | `imports (relationship)` | line 42 |
| elixir | `mixes_in (relationship)` | line 42 |
| elixir | `imports (import-site: ImportInfo[])` | line 42 |
| erlang | `imports (relationship)` | line 71 |
| erlang | `exports (relationship)` | line 71 |
| erlang | `imports (import-site: ImportInfo[])` | line 71 |
| erlang | `exports (export-site: ExportInfo[])` | line 71 |
| fsharp | `part_of (relationship)` | line 53 |
| go | `renders (relationship)` | line 724 |
| go | `mixes_in (relationship)` | line 724 |
| groovy | `decorates (relationship)` | line 136 |
| haskell | `decorates (relationship)` | line 56 |
| haskell | `part_of (relationship)` | line 56 |
| javascript | `mixes_in (relationship)` | line 56 |
| kotlin | `renders (relationship)` | line 48 |
| nim | `decorates (relationship)` | line 694 |
| nim | `part_of (relationship)` | line 694 |
| powershell | `part_of (relationship)` | line 266 |
| rust | `references (relationship)` | line 36 |
| rust | `decorates (relationship)` | line 36 |
| rust | `renders (relationship)` | line 36 |
| rust | `mixes_in (relationship)` | line 36 |
| rust | `part_of (relationship)` | line 36 |
| scala | `mixes_in (relationship)` | line 44 |
| swift | `renders (relationship)` | line 48 |
| typescript | `renders (relationship)` | line 81 |
| typescript | `mixes_in (relationship)` | line 81 |
| typescript | `part_of (relationship)` | line 81 |
| xml | `mixes_in (relationship)` | line 381 |
| xml | `part_of (relationship)` | line 381 |

## MISSING_DOC

None.

## Docs with no ontology claim table (nothing was comparable)

`graphql`, `hcl`, `html`, `markdown`, `perl`, `php`, `r`, `scss`, `solidity`, `sql`, `svelte`, `toml`, `vb`, `vue`, `yaml`

## Docs with more than one ontology-shaped table (only the first is compared)

`c`, `clean`, `dart`, `erlang`, `fsharp`, `julia`, `lua`, `protobuf`, `swift`, `xml`, `zig`

## Informational rows excluded from comparison

| Analyzer | Row name | Why excluded | Doc line |
| --- | --- | --- | --- |
| clojure | <language-specific> | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 108 |
| csharp | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 61 |
| csharp | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 62 |
| fsharp | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 63 |
| java | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 69 |
| java | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 70 |
| lua | luarequire | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 128 |
| lua | luanameread | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 129 |
| lua | luamemberread | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 130 |
| lua | luamodulereturn | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 131 |
| lua | luametatable | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 132 |
| lua | luafactorysupertype | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 133 |
| lua | luaredefinition | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 134 |
| lua | luainheritedmember | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 135 |
| lua | luadecoratorapplication | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 136 |
| lua | externalclaim | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 137 |
| matlab | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 112 |
| matlab | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 113 |
| nim | all ten / one row each | MIXED_ROW — row mixes engine kinds with names that are not RelationshipType aliases, so one shared cell cannot be attributed per kind; excluded from comparison | 696 |
| protobuf | extension-membership (proto2 extend) | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 198 |
| protobuf | proto2 group | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 199 |
| ruby | partof (canonical) | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 108 |
| scala | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 56 |
| scala | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 57 |
| typescript | imports — type-only marker | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 89 |
| typescript | depends | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 95 |
| typescript | fieldaccess | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 96 |
| typescript | jsx element usage | NON_ENGINE_KIND — row name is not a RelationshipType alias in src/ast/types.ts, so its cell states no emission claim | 97 |

## Census — what each analyzer actually emits

| Analyzer | Relationship kinds in code | Payload channels live | Claim table |
| --- | --- | --- | --- |
| bash | `calls uses imports exports contains references overrides part_of` | import-site: ImportInfo[] | line 175, 10 rows |
| c | `calls uses imports exports contains references overrides instantiates part_of` | import-site: ImportInfo[] | line 469, 14 rows |
| clean | `calls implements uses imports exports contains references overrides instantiates` | import-site: ImportInfo[], export-site: ExportInfo[] | line 513, 14 rows |
| clojure | `calls extends implements uses imports exports contains references overrides instantiates renders` | import-site: ImportInfo[], export-site: ExportInfo[] | line 96, 11 rows |
| cpp | `calls extends implements uses imports exports contains references overrides instantiates part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 265, 14 rows |
| csharp | `calls extends implements uses imports exports contains references overrides instantiates renders` | import-site: ImportInfo[], export-site: ExportInfo[] | line 51, 12 rows |
| css | `calls uses imports exports contains references overrides part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 770, 10 rows |
| dart | `calls extends implements uses imports exports contains references overrides instantiates renders mixes_in part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 89, 10 rows |
| elixir | `calls implements uses imports exports contains references overrides instantiates mixes_in` | import-site: ImportInfo[], export-site: ExportInfo[] | line 42, 8 rows |
| erlang | `calls implements uses imports exports contains references instantiates part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 71, 7 rows |
| fsharp | `calls extends implements uses imports exports contains references overrides instantiates part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 53, 11 rows |
| go | `calls extends implements uses imports exports contains references overrides instantiates renders mixes_in` | import-site: ImportInfo[], export-site: ExportInfo[] | line 724, 10 rows |
| graphql | `extends implements uses imports exports contains references overrides` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| groovy | `calls extends implements uses imports exports contains references overrides instantiates decorates` | import-site: ImportInfo[], export-site: ExportInfo[] | line 136, 10 rows |
| haskell | `calls extends implements uses imports exports contains references overrides instantiates decorates part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 56, 12 rows |
| hcl | `calls extends uses imports exports contains references overrides instantiates part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| html | `extends uses imports contains references overrides` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| java | `calls extends implements uses imports exports contains references overrides instantiates` | import-site: ImportInfo[], export-site: ExportInfo[] | line 57, 12 rows |
| javascript | `calls extends uses imports exports contains references overrides instantiates decorates renders mixes_in` | import-site: ImportInfo[], export-site: ExportInfo[] | line 56, 12 rows |
| json | `calls extends implements uses imports exports contains references overrides` | import-site: ImportInfo[], export-site: ExportInfo[] | line 70, 10 rows |
| julia | `calls extends uses imports exports contains references overrides instantiates decorates part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 52, 14 rows |
| kotlin | `calls extends implements uses imports exports contains references overrides instantiates renders` | import-site: ImportInfo[], export-site: ExportInfo[] | line 48, 10 rows |
| lua | `calls extends uses imports exports contains references overrides instantiates decorates` | import-site: ImportInfo[], export-site: ExportInfo[] | line 112, 24 rows |
| makefile | `calls uses imports exports contains references overrides part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 57, 14 rows |
| markdown | `uses imports contains references part_of` | import-site: ImportInfo[] | absent |
| matlab | `calls extends implements uses imports exports contains references overrides instantiates part_of` | — | line 96, 16 rows |
| nim | `calls extends implements uses imports exports contains references overrides instantiates decorates part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 694, 11 rows |
| objective-c | `calls extends implements uses imports exports contains references overrides instantiates part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 91, 11 rows |
| perl | `calls extends implements uses imports exports contains references overrides instantiates mixes_in` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| php | `calls extends implements uses imports exports contains references overrides instantiates mixes_in part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| powershell | `calls extends implements uses imports exports contains references overrides instantiates part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 266, 12 rows |
| protobuf | `imports exports contains references overrides` | import-site: ImportInfo[] | line 182, 16 rows |
| python | `calls extends implements uses imports exports contains references overrides instantiates decorates` | import-site: ImportInfo[], export-site: ExportInfo[] | line 44, 14 rows |
| r | `calls extends implements uses imports exports contains references overrides instantiates mixes_in` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| ruby | `calls extends uses imports exports contains references overrides instantiates mixes_in` | import-site: ImportInfo[], export-site: ExportInfo[] | line 95, 14 rows |
| rust | `calls extends implements uses imports exports contains references overrides instantiates decorates renders mixes_in part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 36, 9 rows |
| scala | `calls extends implements uses imports exports contains references overrides instantiates mixes_in` | import-site: ImportInfo[], export-site: ExportInfo[] | line 44, 12 rows |
| scss | `calls extends uses imports exports references overrides mixes_in part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| solidity | `calls extends implements uses imports exports contains references overrides instantiates decorates` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| sql | `calls extends implements uses imports exports contains references overrides instantiates` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| svelte | `calls extends uses imports contains overrides renders` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| swift | `calls extends implements uses imports exports contains references overrides instantiates renders` | import-site: ImportInfo[], export-site: ExportInfo[] | line 48, 10 rows |
| toml | `imports exports contains references` | — | absent |
| typescript | `calls extends implements uses imports exports contains references overrides instantiates decorates renders mixes_in part_of` | import-site: ImportInfo[], export-site: ExportInfo[] | line 81, 15 rows |
| vb | `calls extends implements uses imports exports contains references overrides instantiates decorates` | import-site: ImportInfo[] | absent |
| vba | `calls implements uses imports exports contains references instantiates decorates` | import-site: ImportInfo[] | line 100, 14 rows |
| vue | `extends uses imports exports contains references overrides renders` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| xml | `calls extends uses imports contains references overrides mixes_in part_of` | import-site: ImportInfo[] | line 381, 11 rows |
| yaml | `calls extends uses imports exports contains references overrides` | import-site: ImportInfo[], export-site: ExportInfo[] | absent |
| zig | `calls uses imports exports contains references instantiates mixes_in` | import-site: ImportInfo[], export-site: ExportInfo[] | line 54, 14 rows |
