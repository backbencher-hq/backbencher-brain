# GraphQL analyzer

## Language

- Analyzer: `src/ast/real-graphql-analyzer.ts`
- Parser: vendored `wasm/tree-sitter-graphql.wasm`, loaded as `tree-sitter-graphql`
- Detection: `.graphql`, `.graphqls`, and `.gql` → `graphql` in
  `src/ast/language-detection.ts`
- Wiring: `ASTEngine` → `RealGraphqlAnalyzer`

## Symbol contract

| Construct | Symbol kind | AST source | Identity |
| --- | --- | --- | --- |
| `schema` definition | `namespace` | `SchemaDefinition` | `schema` |
| root operation (`query`/`mutation`/`subscription`) | `property` | `OperationTypeDefinition` | `schema.<op>` |
| object type | `class` | `ObjectTypeDefinition` | type `Name` |
| interface | `interface` | `InterfaceTypeDefinition` | type `Name` |
| union | `type` | `UnionTypeDefinition` | type `Name` |
| enum | `enum` | `EnumTypeDefinition` | type `Name` |
| enum value | `enum_member` | `EnumValueDefinition` | `Enum.<value>` |
| scalar | `type` | `ScalarTypeDefinition` | type `Name` |
| input object | `class` | `InputObjectTypeDefinition` | type `Name` |
| directive definition | `function` | `DirectiveDefinition` | `@name` |
| field | `property` | `FieldDefinition` | `Type.field` |
| input field | `property` | `InputValueDefinition` (under `InputFieldsDefinition`) | `Input.field` |
| operation | `method` | `OperationDefinition` | name or `Anonymous_<op>_<line>` |
| fragment | `method` | `FragmentDefinition` | fragment name |
| variable | `variable` | `VariableDefinition` | `$name` (owned by the operation) |

Every emitted symbol carries an AST-derived range (1-based line, byte offsets),
`ownerName`/`ownerKind`, `returnType`/`parameters`, and `docstring` (unquoted
from the `Description → StringValue` leaf by string slicing). Type names are
resolved from the `NamedType → Name` path, descending through `NonNullType` and
`ListType`; the full raw type is kept in `metadata.rawType`.

## Relationship ontology

- `contains`: type → field, enum → value, input type → input field, and
  `schema` → root operation type (qualified identities).
- `implements`: object/interface → implemented interface.
- `uses`: type references — field → return type, field/input-field → argument
  type, and union → member type (all resolved to the base named type). Also
  executable references — operation/fragment → selected field, → fragment
  spread, and → inline-fragment type condition.

Field selections use the `Field` node's field `Name` (aliases are ignored so
the relationship targets the schema field, not the query-local alias). All
relationships use a `Set` key, so insertion and deduplication are O(1) per
emitted fact; the traversal is a single iterative DFS with no per-symbol scan.

## Supported constructs

- `schema`, object types, interfaces, unions, enums, scalars, input objects,
  and directive definitions with descriptions, arguments, `implements`,
  non-null and list types (`Schema.graphql`)
- Queries, mutations, subscriptions, fragments, variables, aliases, fragment
  spreads, inline fragments, and directives (`Query.graphql`)
- Syntax-error propagation through the engine (`Negative.graphql`)

## Unsupported / explicit boundaries

- Directive *usage* is not a declaration or type reference; it is observed by
  the grammar but not emitted as a symbol or relationship.
- `#import` is a non-standard comment convention, not GraphQL spec syntax; it
  is intentionally not parsed.
- Two kitchen-sink constructs are valid GraphQL the vendored grammar does not
  model (a directive on a variable definition and an escaped `\"""` in a block
  string); they surface as grammar-level ERROR nodes and are recorded in
  `graphql-corpus-errors.json`, never hidden.

## Regex inventory

The analyzer contains zero regular-expression literals or `RegExp` calls.
Descriptions are unquoted by `slice`, and type names are read from AST nodes.
The machine-checked census is `validation/m12/results/regex-census.json`.

## Complexity envelope

Measured in `validation/m12/results/graphql-corpus-complexity.json`:

- Corpus: the real GitHub public schema (`benchmark/github-schema.graphql`,
  20,367 lines) plus the kitchen-sink executable corpus.
- 3,251 symbols, 6,042 relationships, 1,237.59 ms wall time,
  1.62 files/s, 2,626.87 symbols/s, 4,882.06 relationships/s.
- Policy: single iterative DFS plus Set-backed relationship dedupe; no O(n²)
  or per-symbol scans.

## Differential ground truth

- Manual independent truth: `validation/m12/ground-truth/graphql.json`
- Differential: `validation/m12/results/graphql-differential.json`
- Fixtures: three positive/negative files under `validation/m12/fixtures/graphql`
- The verified result is 97/97 facts, precision 1.000, recall 1.000, with zero
  false positives, false negatives, or unknown facts.

## Evidence

- Contract: `graphql-contract.json` — 37/37 checks
- Shape safety: `graphql-shape-safety.json`
- Corpus errors: `graphql-corpus-errors.json`
- Complexity: `graphql-corpus-complexity.json`
- Manifest: `validation/m12/corpus-manifest.json`

## Issue

M12.38 / GitHub issue #177.
