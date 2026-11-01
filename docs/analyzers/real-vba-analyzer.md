# Visual Basic for Applications — `vba`

## Status

VBA is a dedicated analyzer. `.bas`, `.cls`, and `.frm` files route to the
MIT-licensed `tree-sitter-vba` grammar in
[`grammars/tree-sitter-vba/`]($HOME/mcp/backbencher-brain/grammars/tree-sitter-vba/);
the released ABI-15 WASM is pinned at
[`wasm/tree-sitter-vba.wasm`]($HOME/mcp/backbencher-brain/wasm/tree-sitter-vba.wasm).

The analyzer is [`real-vba-analyzer.ts`]($HOME/mcp/backbencher-brain/src/ast/real-vba-analyzer.ts).
The engine has three required surfaces: `SUPPORTED_LANGUAGES.vba`, the `getParser`
WASM arm, and `getAnalyzer` dispatch. The extension router and parallel indexer
also admit all three VBA module extensions.

## Actual coverage

This is an AST extractor, not a complete VBA semantic model. It does not use
regular expressions or parse source text to discover declarations. The only
source-text operation is line counting; syntax and names come from named
Tree-sitter nodes and fields.

The current declaration coverage is:

| VBA construct | Symbol kind |
|---|---|
| `Sub` | method |
| `Function` | function |
| `Declare Sub` | method |
| `Property Get/Let/Set` | property |
| `Type` | type |
| `Enum` / enum member | enum / enum_member |
| `Const` / variable declaration | constant / variable |
| `Declare Function` / `Declare PtrSafe Function` | function |
| `Event` | event |

Names, parameters, return types, visibility, source ranges, and grammar node
metadata are read from named AST fields. VBA's case-insensitivity is handled
only in the local resolution key; source spelling is preserved in output.

The current syntax traversal recognizes module attributes, `Option`
statements, preprocessor-wrapped declarations, assignments, `Set`, calls,
`Call`, `New`, `RaiseEvent`, qualified member expressions, type clauses,
parameters, loop binders/collections, `Select Case` values, member receivers,
implicit `With` receivers, identifier reads, and `Implements`.

The following grammar constructs are currently parsed by Tree-sitter but do
not have dedicated semantic handlers: `With`, `For`/`For Each`, `If`,
`Select`, `Do`, `While`, `On Error`, `GoTo`, labels, file I/O statements,
`ReDim`, `Erase`, `TypeOf`, `AddressOf`, `Def<Type>` statements, form-control
property blocks, and conditional declaration variants. Their nested
identifiers may still be observed as generic `uses` edges, but that is not
equivalent to construct-aware analysis. `WithEvents`, COM references,
conditional compilation state, cross-module resolution, default members,
overloads, and runtime dispatch are not currently modeled.

## Relationship contract

| Relationship | Meaning |
|---|---|
| `contains` | A procedure or type owns a declaration in its body |
| `imports` | An import/use node names an imported module or library |
| `references` | A declaration names a type in an `As` clause |
| `calls` | A `Call` statement or call expression names a callee |
| `uses` | A body expression reads an identifier |
| `implements` | An `Implements` statement names an interface |
| `instantiates` | A `New` expression names a constructed type |
| `exports` | A public top-level declaration is published by the module |
| `decorates` | A VBA attribute statement is attached to the module/declaration surface |

Every emitted edge carries a 1-based `line_number`, a confidence, and an
`evidenceClass`. Same-file declaration targets are structural/resolved; names
not declared in the file remain explicitly inferred or usage-contextual.

There are important intentional limits: the selected VBA grammar has no import
or use declaration node, so `imports` is currently empty; ordinary VBA project
references are not resolved. `exports` is based on explicit `Public` visibility, not host-level
VBA exposure. `Property Get`/`Let`/`Set` accessors currently share the same
source name because this analyzer does not add an accessor discriminator.

`extends`, `overrides`, `renders`, `mixes_in`, and `part_of` are disclosed as
ruled gaps in `metadata.vbaGaps`: VBA has no class inheritance or override
modifier, and the grammar has no component, mixin, or partial-declaration
construct. They are not silently omitted.

## Validation

The focused lane check is
[`script/m14/vba-differential.ts`]($HOME/mcp/backbencher-brain/script/m14/vba-differential.ts).
It exercises the production parser/analyzer on the committed fixture and fails
on unknown symbol kinds, empty names, unlined relationships, or relationship
types outside the declared contract. The fixture is
[`validation/m14/fixtures/vba/representative.bas`]($HOME/mcp/backbencher-brain/validation/m14/fixtures/vba/representative.bas).

The grammar provenance and SHA-256 are recorded in
[`validation/m14/vba-grammar-pin.json`]($HOME/mcp/backbencher-brain/validation/m14/vba-grammar-pin.json).

The canonical M14 fixture lane is registered as `vba` in
[`script/m14/run-fixtures.ts`]($HOME/mcp/backbencher-brain/script/m14/run-fixtures.ts)
and is pinned by
[`representative.expectation.json`]($HOME/mcp/backbencher-brain/validation/m14/fixtures/vba/representative.expectation.json).
The mutation lane is registered in
[`vba-mutants.ts`]($HOME/mcp/backbencher-brain/script/m14/vba-mutants.ts);
its five relationship-removal mutants are all caught by the VBA fixture suite.

The committed fixture corpus currently covers nine files (`.bas`, `.cls`, and
`.frm`), with 30 symbols, 93 relationships, zero parse errors, and zero
crashes. The corpus measurement entry point is
[`vba-corpus-measure.ts`]($HOME/mcp/backbencher-brain/script/m12/vba-corpus-measure.ts).
The grammar-conformance auditor includes VBA in
[`audit-analyzer-grammar.ts`]($HOME/mcp/backbencher-brain/script/m14/audit-analyzer-grammar.ts).
