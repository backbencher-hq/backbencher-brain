# real-vb-analyzer.md

## Language

- Analyzer file: `src/ast/real-vb-analyzer.ts`
- Parser: `tree-sitter-vbnet` — a **vendored and patched** grammar (18 repairs over `govindbanura/tree-sitter-vbnet`, which publishes no release). WASM in `wasm/tree-sitter-vbnet.wasm`; the `~/.bb/wasm` mirror is byte-identical and is the second copy the pin verifies.
- Language detection: extension `.vb` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealVbAnalyzer`; the wasm path is a second `case "vb"` in `getParser` (the engine has two language switches, and changing only `SUPPORTED_LANGUAGES` leaves every `.vb` file throwing "parser not yet implemented" — that was measured, not guessed).
- Pin: `validation/m14/grammar-pins.json` → `lanes.vb`; grammar doc `grammars/tree-sitter-vbnet/PIN.md`; lane review `reviews/vb/master-review.md`

### Grammar (M60 VB wave)

The vendored grammar arrived parsing **38.67 %** of Microsoft's own
`Microsoft.VisualBasic.Core` cleanly. It now parses **90.89 %** over four
independent corpora (1185 files, 0 crash files). The repairs, each with a
minimal repro under `fixtures/grammar-repro/cases/`:

1. `repeat` instead of `optional` on `attribute_list` in 14 member positions — consecutive attribute lists are the standard pattern and upstream allowed one. (49.33 % → 62.67 % on the authoritative corpus.)
2. File-scoped `Namespace N` (VB 15+), as a second alternative **pinned to the file's last position** rather than an optional `End Namespace` — the optional form also "succeeds" for a file that *has* one, leaving it dangling and hoisting the classes after the early reduction to file scope.
3. `&H`/`&O`/`&B` literals with per-radix digit classes and the `% & ! D F R I L S US UI UL` type characters.
4. `!`, `#` and `@` on `floating_point_literal` — `!` is Single (85.7 % of one corpus's failures); `#`/`@` are VB6's legacy Double/Decimal, and an earlier revision of the grammar *ruled them out* until Microsoft's own `Financial.vb` (`Period - 1.0#`) contradicted it.
5. `As New T [args] [With { … }]` moved into the shared `as_clause`, so a property or field may carry it.
6. `Declare … Lib "dll" Alias "e" [params] [As T]` — the P/Invoke member, which had **no rule at all** upstream.
7. Bare `{…}` array initializer, reachable as a `_literal` so it nests and is legal in an assignment.
8. `:` as a clause-head terminator (`_clause_terminator`) for `Case` / `Case Else` / `Else`.
9. `named_argument` (`b:=`) at invocation precedence, with `array_access_expression` indices built from `$._argument`.
10. Unicode identifiers (`\p{L}` / `\p{Nd}`) in `_identifier_token`.
11. `character_literal` as **one token**, so `"x"c` beats `string_literal`.
12. Class / structure / interface **header** heritage: `Class C : Inherits B, Implements I` and the keyword-less `Interface I : IDisposable`.
13. `Generic.Name(Of T)` — a qualified name whose last segment is generic.
14. VB **statement lambdas**: optional parameter list, `As T` return clause, and a required `End Sub`/`End Function` that does **not** eat the enclosing statement's newline.
15. `Global.` reachable from `_type`.
16. `ReDim` target widened from `identifier` to an expression.
17. `generic_name` admitted to `_name_reference`, so `Implements IComparable(Of C)` parses.
18. Four GLR conflicts plus right-associativity and dynamic rank on `as_clause`, each named at its declaration.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `childForFieldName("name")` → `namingToken()` (descends to the last segment's leaf); fallback to the first `identifier`/`simple_name` child |
| kind | ✅ | `namespace_declaration`→Namespace, `class_declaration`→Class, `structure_declaration`→Struct, `interface_declaration`→Interface, `module_declaration`→Module, `enum_declaration`→Enum (+`enum_member_declaration`→EnumMember), `delegate_declaration`→Type, `method_declaration`→Method, `constructor_declaration`→Constructor, `property_declaration`→Property, `event_declaration`→Event, `operator_declaration`→Method (`Operator +`), `declare_statement`→Method (P/Invoke), `field_declaration`→Variable/`Constant` |
| owner | ✅ | the declaration stack (`ownerStack`); namespaces and types both push |
| visibility | ✅ | the `modifiers` field's `member_modifier` list, resolved in VB's own precedence order: `Private` → `Protected` → `Friend`(internal) → `Public`; default `internal` |
| isStatic | ✅ | `Shared` |
| isAbstract | ✅ | `Abstract` or `MustInherit` |
| parameters | ✅ | `parameter_list` → `parameter`; `ByVal`/`ByRef` recorded as `passingMode` (VB's default is `ByRef`, so it is stated explicitly rather than left implicit) |
| returnType | ✅ | `as_clause` → `declared_type` |
| range | ✅ | 1-based `startLine`/`endLine` + byte `startIndex`/`endIndex` |

`metadata` carries the grammar node name, `NotInheritable`/`NotOverridable` as
`sealed`, `Partial`, `ReadOnly`, `WriteOnly`, `Default`, `Shared`, `WithEvents`,
`autoImplemented` for a property with no accessor block, and the P/Invoke
`library`/`entryPoint`/`kind`.

## Relationship contract

| Type | Source → Target | Confidence | Line stamped on |
| --- | --- | --- | --- |
| `contains` | owner → member | 1.0 | the member's name node |
| `calls` | enclosing method/property/field-init → callee | 1.0 in-file, 0.6 not | the **callee name leaf** |
| `extends` | type → base type | 1.0 in-file, 0.7 not | the base name leaf |
| `implements` | type/member → interface | 1.0 in-file, 0.7 not | the interface name leaf |
| `imports` | `root` → namespace | 1.0 | the imported name leaf; carries `isImport` + `include_dependency` |
| `references` | declaration → a type it names | 0.6 | the type name leaf |
| `overrides` | member → itself (base member unknown) | 0.6 | the member's name node |

**Every relationship carries `line_number`** (M59.A7), 1-based, on the node that
*names* the thing, per site rather than per set. Measured: **0 of 33,910 edges**
without one, over 435 real files. `namingToken()` is what makes a wrapped
qualified name stamp the line of its last segment's leaf rather than the line the
name starts on — a three-line chained call gets one site line per call.

`imports` carries `isImport` and `include_dependency` because the family contract
(C# and C publish import dependencies that way) is what the completeness
section-B pin and the tier classifier read.

## Complexity

- `cyclomaticComplexity` — counted off AST decision nodes (`if_statement`,
  `while_statement`, `do_statement`, `for_statement`, `for_each_statement`,
  `case_clause`, `case_else_clause`, `else_clause`, `catch_clause`,
  `catch_block`, `catch_filter_clause`, `when_clause`), starting at 1. The set is
  named rather than pattern-matched, so a grammar change that adds a branching
  rule shows up as a number that moved.
- `complexity` — total AST node count.

## Rules this analyzer holds itself to

1. **AST only, zero regex.** Every classification is a node-type test, a field
   read, or a character-code scan with the equivalence argued inline. The file
   contains no regex literal; the M49.R2 census confirms 0 usages.
2. **No unknown symbols.** A symbol with no readable name is **counted**
   (`vbGaps["declaration-without-name"]`) rather than emitted with an invented
   one.
3. **The grammar's real vocabulary.** Node types and field names were read out of
   the pinned wasm's enumerable surface (449 ids / 165 named / 54 fields). The
   first version of this file named three node types that do not exist
   (`blank_line`, `name_reference`, `namespace_name`) — dead branches, the LUA-00
   defect class. M14.0.F1 caught them; all three are fixed and the audit is green.
4. **Gaps are disclosed, not silent.** `metadata.vbGaps` counts what the grammar
   could not express, so a consumer can see the boundary instead of inferring
   completeness from silence.

## Measured state

Over 435 real `.vb` files through `ASTEngine.parseFile`:

| | |
|---|---:|
| symbols | 12,834 |
| relationships | 35,442 |
| imports | 1,157 |
| crash files | 0 |
| empty names / unknown kinds | 0 / 0 |
| relationships without a line | 0 |
| members without `ownerName` | 423 — **all** in grammar-errored files, 0 in clean ones |

Kinds: 5456 variable, 4370 method, 913 enum_member, 725 property, 481 class,
**285 constructor**, 166 namespace, 137 interface, 118 enum, 99 struct, 63 module,
11 type, 10 event.
Edges: 14410 references, 11973 contains, 7581 calls, 1157 imports, 265 extends,
56 implements.

M14.0.F1: **PASS**, 27 references, 0 unknown node types, 0 unknown fields.

M14.0.F5: **100 % edge for edge, on a 120-file draw** — `P3D-Legacy` 60 of 1,880
files, 627/627 truth edges covered; `DISMTools` 60 of 483, 1,966/1,966; **0
missing, 0 unexplained, 0 heuristic** on each, with `analyzer-edges` equal to
`tree-truth` exactly. Audited labels: `calls`, `contains`, `imports`, `extends`,
`implements`; `references` is deliberately excluded because the oracle does not
derive it. **That is 4.5 % of the corpus**, drawn by a rotation that prefers
never-sampled files, and 48 % of the corpus carries a syntax error the
differential has never been run against — so this is not a whole-corpus claim
and the full sweep is the outstanding measurement.

The differential is what found the three defects a corpus-wide count could not,
because in each case the count stayed healthy while a class of output was missing
or wrong:

- **a construction with arguments was not a call** — `New Box(1, 2)` is an
  `array_creation_expression` with a `type` field and no `function` field, so
  reading the callee from `function` dropped 15,577 call edges across 1,718 of
  2,660 files. Found NOT by the differential, which read 100 % with the defect
  live because the oracle made the same assumption; found by writing the fixture.
- **constructors were absent entirely** — `Public Sub New()` has no `name` field
  (`New` is an anonymous token), so the "declaration without a name" guard
  returned *before* the naming contract was reached. 12,549 symbols contained
  zero constructors; there are 285 now. Any check that can reject a declaration
  has to be evaluated against the contract, not in front of it.
- **callee targets were expression text** — `New AnimatedBlock()` is
  `(object_creation_expression type: (simple_name (identifier)))`, the type is in
  a `type` field, and the naming helper only followed `name`, so it published the
  literal string `"New AnimatedBlock"`. 31 in one method.
- **nested types had an `ownerName` and no edge** — containment was emitted per
  visitor, and a nested type's visitor did not emit one, so containment
  navigation stopped at the enclosing class. It is emitted once in `pushSymbol`
  now, which is the form that cannot recur.

**Not closed.** No fixtures, no mutants, no F8 spec, no F10 floor, and no
committed `M14.0.F5` artifact — the canonical artifact belongs to the full
60-file, 30-language sweep, and a scoped `--lang vb` run refuses to write it
rather than replace a bigger claim with a smaller one. See `docs/vb.md` and
`reviews/vb/master-review.md`.
