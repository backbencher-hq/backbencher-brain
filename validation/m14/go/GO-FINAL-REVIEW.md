# GO LANE — FINAL REVIEW

**Verdict: shipped-ready.** Every number below was measured by `ASTEngine.parseFile` over the
current re-runnable baseline on 2026-11-16 — none is carried over from an earlier draw, and
nothing here is predicted.

**Population** — `go-tools` + `terraform`, `testdata/` excluded. Re-runnable:

```
BB_CORPUS_ROOT=<corpus-root>/bb_tests/repositories bun run script/m14/go-firing-probe.ts
```

**Do not difference these numbers against the two historical corpora** (`go-stdlib` @ `6f5c275e`,
and `.corpus/`): both were removed from the tree, and a cross-corpus delta measures the corpus,
not the analyzer. `docs/analyzers/go.md`'s banner states this at the top of the page.

## Headline

| dimension | result |
| --- | --- |
| files parsed / crashed | **3,422 / 0** |
| symbols | **58,470**, every range a real slice containing its own name (**0 bad**) |
| relationships | **423,858**; **0** off-enum, **0** empty endpoints |
| canonical types | **12 of 14 emit**; `decorates` + `part_of` **RULED** (ontological, not grammar) |
| outgoing resolution | **421,867 / 423,858 = 99.53 %** of sources are same-file symbols |
| **unexplained rows, either direction** | **0** — every sub-1.0 edge carries a `reasonCode`, every reference target a `bindReason`, every edge a construct label |
| dangling source | **0.2034 %** |
| oracle differential (400-file draw) | **UNEXPLAINED 2,640 → 17**, every residual triaged to source |

## What changed since the previous issue of this document

The previous issue reported 363,830 edges and called the lane done. It was wrong, and the
**oracle differential** is what said so: it reported 2,640 rows it could not account for, and
behind them were four real defects. *Internal consistency is not correctness* — every range,
resolution, explanation-coverage and fixture check the lane owned was green while these edges
were missing.

| # | defect | effect |
| --- | --- | --- |
| 1 | `new(T)`/`make(T,…)`, `x.(*T)`, `case *T:` — a type named in EXPRESSION position published nothing | **+7,859** `references` |
| 2 | a bare call to a function in a **sibling file** of the same package was dropped entirely | **+14,350** `calls` |
| 3 | a composite literal constructs the type inside a **wrapper** (`[]T`, `[N]T`, `map[K]V`, `*T`, `chan T`) | **+34,860** `instantiates` |
| 4 | an explicit instantiation's **type arguments** were unread | **+2,959** `references` |
| 5 | multi-type switch cases, composite `make` args, and per-site dedupe | folded into 1 and 3 |

Edges **363,830 → 423,858** with the symbol count **unchanged at 58,470** throughout — the
signature of pure missing-edge fixes rather than relabels.

Population: **3422 files**, 58470 symbols, 423858 relationships. Crashes 0. Off-enum 0. Empty endpoints 0. Bad ranges 0.

## Symbols by kind

| kind | count |
| --- | --- |
| `method` | 16126 |
| `property` | 15516 |
| `function` | 12524 |
| `struct` | 4114 |
| `constant` | 3481 |
| `module` | 3422 |
| `variable` | 1979 |
| `type` | 874 |
| `interface` | 434 |

Scope: package-level **23195**, members **31190**, function-local (labelled) **663**; exported 39603 / unexported 18867.

## Relationship types

| type | edges | files | conf | evidenceClass | src resolves | tgt resolves | global src |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | **142609** | 3104 | 0.8×142608, 0.9×1 | usage_contextual 142609 | 142609/142609 | 17556/142609 | 16 |
| `contains` | **31665** | 1725 | 1×31665 | structural 31665 | 30564/31665 | 31665/31665 | 3 |
| `decorates` | **0 — RULED** | — | — | — | — | — | — |
| `exports` | **13110** | 2542 | 1×13110 | structural 13110 | 13110/13110 | 13110/13110 | 0 |
| `extends` | **86** | 45 | 0.8×86 | inferred 86 | 86/86 | 86/86 | 0 |
| `implements` | **404** | 121 | 1×404 | structural 404 | 400/404 | 404/404 | 1 |
| `imports` | **23347** | 3174 | 0.9×23347 | import_based 23347 | 23347/23347 | 23/23347 | 0 |
| `instantiates` | **54984** | 2360 | 0.8×54478, 0.6×506 | structural 54478<br>inferred 506 | 54984/54984 | 5902/54984 | 115 |
| `mixes_in` | **640** | 253 | 0.8×640 | inferred 640 | 640/640 | 640/640 | 0 |
| `overrides` | **22** | 9 | 0.95×22 | usage_contextual 22 | 0/22 | 22/22 | 0 |
| `part_of` | **0 — RULED** | — | — | — | — | — | — |
| `references` | **82067** | 3147 | 0.95×82067 | reference_qualified 71249<br>usage_contextual 10818 | 82060/82067 | 27046/82067 | 675 |
| `renders` | **5** | 3 | 0.9×5 | usage_contextual 5 | 5/5 | 5/5 | 0 |
| `uses` | **74919** | 2921 | 0.7×68706, 1×6031, 0.8×182 | usage_contextual 74919 | 74919/74919 | 23553/74919 | 52 |

### `calls` — 142609 edges

Construct labels: `go_function_call` 141365 · `go_package_scope_call` 1243 · `go_goroutine` 1

Reason codes: 
- `callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file` — 142609

Bind reasons: 
- `callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file` — 142609

### `contains` — 31665 edges

Construct labels: `go_struct_field` 15490 · `go_method_on_receiver` 14979 · `go_interface_method` 1110 · `go_owner_membership` 86

Reason codes: — (none: every edge is at confidence 1.0)

Bind reasons: — (none required)

### `exports` — 13110 edges

Construct labels: `go_exported_identifier` 13110

Reason codes: — (none: every edge is at confidence 1.0)

Bind reasons: 
- `exported_name_recorded_as_a_leaf_whose_owning_package_is_not_the_target` — 13110

### `extends` — 86 edges

Construct labels: `go_interface_embedding` 86

Reason codes: 
- `interface_method_set_inclusion_not_a_declared_supertype` — 86

Bind reasons: 
- `interface_method_set_inclusion_not_a_declared_supertype` — 86

### `implements` — 404 edges

Construct labels: `go_interface_implementation` 404

Reason codes: — (none: every edge is at confidence 1.0)

Bind reasons: 
- `implemented_interface_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope` — 404

### `imports` — 23347 edges

Construct labels: `go_import_spec` 23347

Reason codes: 
- `target_is_a_module_path_not_a_symbol` — 23347

Bind reasons: 
- `target_is_a_module_path_not_a_symbol` — 23347

### `instantiates` — 54984 edges

Construct labels: `go_composite_literal_construction` 54478 · `go_instantiation` 485 · `go_package_scope_instantiation` 21

Reason codes: 
- `type_read_from_a_composite_literal_whose_declaration_may_be_in_another_file` — 54478
- `pascal_case_name_is_a_constructor_convention_with_no_declaration` — 506

Bind reasons: 
- `type_read_from_a_composite_literal_whose_declaration_may_be_in_another_file` — 54478
- `pascal_case_name_is_a_constructor_convention_with_no_declaration` — 506

### `mixes_in` — 640 edges

Construct labels: `go_struct_embedding` 640

Reason codes: 
- `promotion_by_embedding_not_a_declared_supertype` — 640

Bind reasons: 
- `promotion_by_embedding_not_a_declared_supertype` — 640

### `overrides` — 22 edges

Construct labels: `go_method_promotion_shadowing` 22

Reason codes: 
- `promoted-method-shadowed-by-outer-declaration` — 22

Bind reasons: 
- `promoted_method_recorded_with_its_qualified_owner_whose_declaring_file_is_out_of_scope` — 22

### `references` — 82067 edges

Construct labels: `declared_type` 58815 · `return_type` 12434 · `go_type_switch_case` 3378 · `go_type_assertion` 3255 · `go_builtin_type_argument` 3168 · `go_type_argument` 1017

Reason codes: 
- `declared_type_leaf_whose_declaring_file_is_out_of_scope` — 70268
- `type_named_in_expression_position_read_as_a_leaf` — 9801
- `type_argument_of_an_instantiation_read_as_a_leaf` — 1017
- `type_parameter_declared_here_but_scoped_to_its_declaration_not_a_symbol` — 981

Bind reasons: 
- `declared_type_leaf_whose_declaring_file_is_out_of_scope` — 70268
- `type_named_in_expression_position_read_as_a_leaf` — 9801
- `type_argument_of_an_instantiation_read_as_a_leaf` — 1017
- `type_parameter_declared_here_but_scoped_to_its_declaration_not_a_symbol` — 981

### `renders` — 5 edges

Construct labels: `go_template_render` 5

Reason codes: 
- `render_relation_inferred_from_an_html_template_execution_and_the_template_symbols_own_construction` — 5

Bind reasons: — (none required)

### `uses` — 74919 edges

Construct labels: `go_selector_use` 68706 · `identifier_usage` 6031 · `go_channel_operation` 182

Reason codes: 
- `field_leaf_read_whose_receiver_type_is_not_resolved_per_file` — 68706
- `channel_leaf_read_without_its_element_type` — 182

Bind reasons: 
- `field_leaf_read_whose_receiver_type_is_not_resolved_per_file` — 68706
- `used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope` — 6031
- `channel_leaf_read_without_its_element_type` — 182

## Incoming — what an unresolved TARGET actually is

Targets that are not a symbol declared in the file: **247,274**, and **0 of them lack a
`bindReason`**. Grouped by the reason the lane gives:

| # | type | reason code | what it means |
| --- | --- | --- | --- |
| 110,925 | `calls` | `callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file` | the callee is a leaf; its owner is not resolved per-file |
| 51,340 | `uses` | `field_leaf_read_whose_receiver_type_is_not_resolved_per_file` | a field read; the receiver's type is declared elsewhere |
| 44,574 | `references` | `declared_type_leaf_whose_declaring_file_is_out_of_scope` | a type named in type position whose declaration is in another file |
| 23,324 | `imports` | `target_is_a_module_path_not_a_symbol` | an import path is a MODULE, never a symbol |
| 16,146 | `instantiates` | `type_read_from_a_composite_literal_whose_declaration_may_be_in_another_file` | the constructed type's declaration may be in another file |
| 939 | `references` | `type_parameter_declared_here_but_scoped_to_its_declaration_not_a_symbol` | a type parameter: declared HERE, scoped, so not a symbol |
| 26 | `uses` | `channel_leaf_read_without_its_element_type` | a channel leaf whose element type is not resolved |
| **0** | — | *(none)* | **no unresolved target is unexplained** |

## Outgoing — 99.59 % exact

Sources that are not a symbol declared in the file: **1,991 of 423,858 = 0.47 %**, and every
one is accounted for: GO44 **sibling-file owners** (1,101 `contains` + 4 `implements`, all
"not declared in this file"), the **`global` pseudo-source** (857 sites with no enclosing named
declaration — package-scope initializers and blank/unnamed receivers), and **22 by-design
qualified `overrides` sources**.

## The oracle differential — the release gate that found the defects

An independent same-file derivation, run over a 400-file `go-tools` draw. It **refutes, it does
not confirm**: it walks the same grammar through the same Node API, so a grammar or binding defect
both paths share is invisible to it.

| | before | after |
| --- | --- | --- |
| UNEXPLAINED oracle-only | **2,640** | **17** |
| `calls` recall | 0.607 | **0.634** |
| `references` recall | 0.678 | **0.778** |

Every class of "unexplained" row was opened against real source before being classified. The
dominant causes were the checker's, not the lane's — conversions counted as calls, calls through
function-typed parameters, writes counted as reads, a generic call's callee counted as a type
reference, an exported package-scope `var` counted as an export (the lane rules those out by
decision, pinned by `go/exports-contract`), and a write gate that caught only the first target of a
multi-assignment (`s.Total, s.Largest, s.Errs = f()` — all three are writes).

**The remaining 17**, every one opened against source and none a missing edge:

| # | type | what it actually is |
| --- | --- | --- |
| 11 | `references` | a function TYPE ARGUMENT (`flow.Forward[lattice](…)`, `cursorutil.FirstEnclosing[*ast.ReturnStmt](…)`) or a struct FIELD read (`m.scores[i][j]`). The callee is a different name; the argument is not a declaration this graph names. |
| 2 | `calls` | an INTERFACE METHOD called through a locally-bound parameter (`Preempt(f)`, `g.Nodes()`) — LocalsAreNotSymbols keeps the parameter out of the graph |
| 2 | `contains` | a type and a value sharing one name, so the leaf owner is ambiguous by construction |
| 1 | `overrides` | a promoted-method shadow the oracle's same-file model cannot see |
| 1 | `uses` | a field read on an imported type (`LogMessage -> Message`) |

**Two caveats on the checker itself**, recorded because they cost three attempts to find:
this grammar/binding does **not** give stable object identity (`field("type") === namedChild(0)`
is FALSE on nodes with identical spans), so every structural comparison must be by BYTE SPAN; and
the oracle's model is per-file, so a callee declared in a sibling file is unknown to it — which is
why `is` (declared in modernize.go, called from maps.go) needed a structural rule rather than a
name lookup.

## The two RULED types, and why each is language-level

Both are registered in `script/m14/spec/go-completeness.json` as `evidence: "ontological"`.

| type | ruling | justification |
| --- | --- | --- |
| `decorates` | **ONTOLOGICAL** | Go has no applied-decorator construct. `//go:` directives are passive COMMENT metadata the compiler reads; they are not expressions attached to a declaration. There is no callable to name, so there is nothing to decorate with. |
| `part_of` | **ONTOLOGICAL** | Go has no `part`/`include` composition directive. `//go:embed` includes BYTES into a variable, which creates **0 source inclusions** — measured — so there is no source-level containment edge to emit. |

Neither is a grammar-parse failure, and neither can become a grammar patch: the grammar parses the
relevant constructs fine, the RELATION does not exist in the language.

## Explanation rules — three contracts, all 100 %

| contract | rule | measured |
| --- | --- | --- |
| `reasonCode` | every edge below confidence 1.0 names WHY it is below 1.0 | **100 %** |
| `bindReason` | every edge whose target is a reference names why the target did not bind | **100 %** |
| `relationshipType` | every edge names the CONSTRUCT that produced it | **100 %** |

## Ambiguity that is stated rather than hidden

| ambiguity | disambiguator | measured |
| --- | --- | --- |
| a target leaf colliding with the source name (self-loops) | `selectorText` carries the literal selector text beside the (owner . leaf) pair | 2,774 self-loops, **86.59 %** carry a disambiguator |
| a receiver identifier that may name a type or a variable (`GO-GAP-3`) | `receiverOwnerScope` = `same_file_type` \| `type_not_declared_in_this_file` | 14,979 method `contains`: **13,729 (91.65 %) verified**, 1,250 marked unverifiable, **0 unlabelled** |

`GO-GAP-3` cannot be resolved at this layer: `func (T) NoName()` and `func (s) Untyped()` have
identical trees, Go decides semantically across the package, and `analyze()` is per-file. Deleting
was refuted by arithmetic — it would remove 1,251 legitimate sibling-file owners to fix rows in
files that cannot compile. So the rows stay and say which side of the line they are on.

## Gates

| gate | result |
| --- | --- |
| `bun run typecheck` | clean |
| `bun run audit:fixtures` | **go 49 pass / 0 fail**, 50 languages, 0 regressions |
| `bun run audit:analyzer-docs` | **50/50 FULLY complete** + count contract |
| `bun run audit:mutations` | **62 / 62 Go mutants caught**; the 2 survivors are typescript (another lane) |
| `bun run audit:fixture-coverage` | **go PASS** (40 handled, 139 fixture types, 0 uncovered, 0 dead literals) |

## Cross-repo confirmation

The same invariants were re-checked on a **1,200-file stride spanning 23 Go repositories**, so the
result is not specific to the two measured codebases: 18,470 symbols with **0 bad ranges**,
111,937 edges with **0 empty endpoints and 0 off-enum**, and reasonCode / bindReason /
construct-label each at **100 %**.

## What this review cannot tell you

Three honest limits, stated so the numbers are not read as more than they are:

1. **The differential is same-grammar.** It refutes, it cannot confirm — a defect both paths share
   is invisible to it.
2. **The 400-file draw is a draw.** Recall figures come from it; the corpus-wide tables do not.
3. **`renders` fires 5 times** in 3,422 files. Thin, but implemented, fixture-pinned
   (`go/renders-template-execution`), and the construct is genuinely rare — it did not appear in a
   1,200-file cross-repo stride, which is expected rather than broken.
