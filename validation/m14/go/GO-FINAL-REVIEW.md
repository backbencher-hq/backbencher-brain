# GO LANE — FINAL REVIEW

**Verdict: the Go lane is complete for what a per-file analyzer can do.** Every number below was
measured by `ASTEngine.parseFile` over the current re-runnable baseline on 2026-11-16 — none is
carried over from an earlier draw. Nothing in this table is predicted.

**Population** — `go-tools` + `terraform`, `testdata/` excluded, the same population every
round-11/12 measurement in `docs/analyzers/history/go-lane-notes.md` cites. It is re-runnable:

```
BB_CORPUS_ROOT=<corpus-root>/bb_tests/repositories bun run script/m14/go-firing-probe.ts
```

**Do not difference these numbers against the two historical corpora** (`go-stdlib` @ `6f5c275e`,
and `.corpus/`): both repositories were removed from the tree, and a cross-corpus delta measures
the corpus, not the analyzer. `docs/analyzers/go.md`'s banner states this at the top of the page.

## Headline

| dimension | result |
| --- | --- |
| files parsed / crashed | **3,422 / 0** |
| symbols | **58,470**, every range a real slice containing its own name (**0 bad**) |
| relationships | **363,830**; **0** off-enum, **0** empty endpoints |
| canonical types | **12 of 14 emit**; `decorates` + `part_of` **RULED** (ontological, not grammar) |
| outgoing resolution | **361,959 / 363,830 = 99.49 %** of sources are same-file symbols |
| incoming resolution | **116,556 / 363,830 = 32.04 %** of targets are same-file symbols; the rest are leaves |
| **unexplained rows, either direction** | **0** — every sub-1.0 edge carries a `reasonCode`, every reference target a `bindReason`, every edge a construct label |

The 68 % of targets that are not same-file symbols is **not** a gap: they are LEAF targets whose
owner lives in another file, in another package, or is a module path. The lane's contract is leaf
targets, and the table below shows that **100 % of them carry a named reason** — 0 unexplained.


## Symbols by kind

| kind | count |
| --- | --- |
| `method` | 16,126 |
| `property` | 15,516 |
| `function` | 12,524 |
| `struct` | 4,114 |
| `constant` | 3,481 |
| `module` | 3,422 |
| `variable` | 1,979 |
| `type` | 874 |
| `interface` | 434 |

Scope: package-level **23,195**, members **31,190**, function-local (labelled) **663**; exported 39,603 / unexported 18,867.

## Relationship types

| type | edges | files | conf | evidenceClass | src resolves | tgt resolves | global src |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | **128,259** | 3,086 | 0.8×128,258, 0.9×1 | usage_contextual 128,259 | 128,259/128,259 | 17,334/128,259 | 16 |
| `contains` | **31,665** | 1,725 | 1×31,665 | structural 31,665 | 30,564/31,665 | 31,665/31,665 | 3 |
| `decorates` | **0 — RULED** | — | — | — | — | — | — |
| `exports` | **13,110** | 2,542 | 1×13,110 | structural 13,110 | 13,110/13,110 | 13,110/13,110 | 0 |
| `extends` | **86** | 45 | 0.8×86 | inferred 86 | 86/86 | 86/86 | 0 |
| `implements` | **404** | 121 | 1×404 | structural 404 | 400/404 | 404/404 | 1 |
| `imports` | **23,347** | 3,174 | 0.9×23,347 | import_based 23,347 | 23,347/23,347 | 23/23,347 | 0 |
| `instantiates` | **20,124** | 2,236 | 0.8×19,618, 0.6×506 | structural 19,618<br>inferred 506 | 20,124/20,124 | 3,978/20,124 | 97 |
| `mixes_in` | **640** | 253 | 0.8×640 | inferred 640 | 640/640 | 640/640 | 0 |
| `overrides` | **22** | 9 | 0.95×22 | usage_contextual 22 | 0/22 | 22/22 | 0 |
| `part_of` | **0 — RULED** | — | — | — | — | — | — |
| `references` | **71,249** | 3,144 | 0.95×71,249 | reference_qualified 71,249 | 71,242/71,249 | 25,736/71,249 | 573 |
| `renders` | **5** | 3 | 0.9×5 | usage_contextual 5 | 5/5 | 5/5 | 0 |
| `uses` | **74,919** | 2,921 | 0.7×68,706, 1×6,031, 0.8×182 | usage_contextual 74,919 | 74,919/74,919 | 23,553/74,919 | 52 |

### `calls` — 128,259 edges

Construct labels: `go_function_call` 127,015 · `go_package_scope_call` 1,243 · `go_goroutine` 1

Reason codes: 
- `callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file` — 128,259

Bind reasons: 
- `callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file` — 128,259

### `contains` — 31,665 edges

Construct labels: `go_struct_field` 15,490 · `go_method_on_receiver` 14,979 · `go_interface_method` 1,110 · `go_owner_membership` 86

Reason codes: — (none: every edge is at confidence 1.0)

Bind reasons: — (none required)

### `exports` — 13,110 edges

Construct labels: `go_exported_identifier` 13,110

Reason codes: — (none: every edge is at confidence 1.0)

Bind reasons: 
- `exported_name_recorded_as_a_leaf_whose_owning_package_is_not_the_target` — 13,110

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

### `imports` — 23,347 edges

Construct labels: `go_import_spec` 23,347

Reason codes: 
- `target_is_a_module_path_not_a_symbol` — 23,347

Bind reasons: 
- `target_is_a_module_path_not_a_symbol` — 23,347

### `instantiates` — 20,124 edges

Construct labels: `go_composite_literal_construction` 19,618 · `go_instantiation` 485 · `go_package_scope_instantiation` 21

Reason codes: 
- `type_read_from_a_composite_literal_whose_declaration_may_be_in_another_file` — 19,618
- `pascal_case_name_is_a_constructor_convention_with_no_declaration` — 506

Bind reasons: 
- `type_read_from_a_composite_literal_whose_declaration_may_be_in_another_file` — 19,618
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

### `references` — 71,249 edges

Construct labels: `declared_type` 58,815 · `return_type` 12,434

Reason codes: 
- `declared_type_leaf_whose_declaring_file_is_out_of_scope` — 70,268
- `type_parameter_declared_here_but_scoped_to_its_declaration_not_a_symbol` — 981

Bind reasons: 
- `declared_type_leaf_whose_declaring_file_is_out_of_scope` — 70,268
- `type_parameter_declared_here_but_scoped_to_its_declaration_not_a_symbol` — 981

### `renders` — 5 edges

Construct labels: `go_template_render` 5

Reason codes: 
- `render_relation_inferred_from_an_html_template_execution_and_the_template_symbols_own_construction` — 5

Bind reasons: — (none required)

### `uses` — 74,919 edges

Construct labels: `go_selector_use` 68,706 · `identifier_usage` 6,031 · `go_channel_operation` 182

Reason codes: 
- `field_leaf_read_whose_receiver_type_is_not_resolved_per_file` — 68,706
- `channel_leaf_read_without_its_element_type` — 182

Bind reasons: 
- `field_leaf_read_whose_receiver_type_is_not_resolved_per_file` — 68,706
- `used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope` — 6,031
- `channel_leaf_read_without_its_element_type` — 182

## Incoming — what an unresolved TARGET actually is

Targets that are not a symbol declared in the file: **247,274**, and **0 of them lack a
`bindReason`**. Grouped by the reason the lane gives:

| # | type | reason code | what it means |
| --- | --- | --- | --- |
| 110,925 | `calls` | `callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file` | the callee is a leaf; its owner (receiver type or package) is not resolved per-file |
| 51,340 | `uses` | `field_leaf_read_whose_receiver_type_is_not_resolved_per_file` | a field read; the receiver's type is declared elsewhere |
| 44,574 | `references` | `declared_type_leaf_whose_declaring_file_is_out_of_scope` | a type named in type position whose declaration is in another file |
| 23,324 | `imports` | `target_is_a_module_path_not_a_symbol` | an import path is a MODULE, never a symbol — "unresolved" is the correct shape |
| 16,146 | `instantiates` | `type_read_from_a_composite_literal_whose_declaration_may_be_in_another_file` | the constructed type's declaration may be in another file |
| 939 | `references` | `type_parameter_declared_here_but_scoped_to_its_declaration_not_a_symbol` | a type parameter: declared HERE, scoped, so not a symbol |
| 26 | `uses` | `channel_leaf_read_without_its_element_type` | a channel leaf whose element type is not resolved |
| **0** | — | *(none)* | **no unresolved target is unexplained** |

## Outgoing — what an unresolved SOURCE actually is

Sources that are not a symbol declared in the file: **1,871 of 363,830 = 0.51 %**. A source is the
attributing declaration, so this direction matters more than the other and is 99.49 % exact.

| # | type | what the source is | status |
| --- | --- | --- | --- |
| 1,101 | `contains` | owner declared in a **sibling file** of the same package | **correct** — GO44 measured this class; deleting it is the regression a file-local test would cause |
| 737 | `calls`/`references`/`instantiates`/`uses` | the **`global` pseudo-source** — a site with no enclosing named declaration (package-scope initializers, blank/unnamed receivers) | **correct and bounded** — measured, not assumed |
| 22 | `overrides` | a **qualified `Type.Method`** source | **by design** — this is the one type whose source is qualified, and it carries `targetQualified` too |
| 11 | `references`/`implements` | owner declared in a sibling file | **correct** — same GO44 class as `contains` |

## The two RULED types, and why each is language-level

Both are registered in `script/m14/spec/go-completeness.json` as `evidence: "ontological"`. Neither
is a grammar-parse failure — the grammar parses the relevant constructs fine, the RELATION does not
exist in the language.

| type | ruling | justification |
| --- | --- | --- |
| `decorates` | **ONTOLOGICAL** | Go has no applied-decorator construct. `//go:` directives are passive COMMENT metadata the compiler reads; they are not expressions attached to a declaration. There is no callable to name, so there is nothing to decorate with. |
| `part_of` | **ONTOLOGICAL** | Go has no `part`/`include` composition directive. `//go:embed` includes BYTES into a variable, which creates **0 source inclusions** — measured — so there is no source-level containment edge to emit. |

`docs/analyzers/go.md` previously filed `part_of` as `grammar-absence`; that was corrected in round
10 so neither exclusion can be misread as "the grammar stopped us".

## Explanation rules — the three coverage contracts

| contract | rule | measured |
| --- | --- | --- |
| `reasonCode` | every edge below confidence 1.0 names WHY it is below 1.0 | **312,620 / 312,620 = 100 %** |
| `bindReason` | every edge whose target is a reference names why the target did not bind | **332,160 / 332,160 = 100 %** |
| `relationshipType` | every edge names the CONSTRUCT that produced it | **363,830 / 363,830 = 100 %** |

The third was incomplete until round 12: `imports` and `contains` published no construct at all
(`contains` shipped a literal bare `metadata: {}`) — 55,012 edges, 15.1 % of the lane. `contains`
now names three distinct ownership relations (`go_struct_field` 15,490, `go_method_on_receiver`
14,979, `go_interface_method` 1,110) because that pass is the only place that knows which relation
it is emitting.

## Ambiguity that is stated rather than hidden

| ambiguity | how it is disambiguated | measured |
| --- | --- | --- |
| a target leaf colliding with the source name (self-loops) | `selectorText` carries the literal selector text beside the (owner . leaf) pair | 2,774 self-loops, **86.59 %** carry a disambiguator |
| a receiver identifier that may name a type or a variable (`GO-GAP-3`) | `receiverOwnerScope` = `same_file_type` \| `type_not_declared_in_this_file` | 14,979 method `contains`: **13,729 (91.65 %) verified**, 1,250 marked unverifiable, 0 unlabelled |

`GO-GAP-3` cannot be resolved at this layer: `func (T) NoName()` and `func (s) Untyped()` have
identical trees, Go decides semantically across the package, and `analyze()` is per-file. Deleting
was refuted by arithmetic — it would delete 1,251 legitimate sibling-file owners to fix rows in
files that cannot compile. So the rows stay and say which side of the line they are on.

## Gates

| gate | result |
| --- | --- |
| `bun run typecheck` | clean |
| `bun run audit:fixtures` | **go 45 pass / 0 fail**, 50 languages, 0 regressions |
| `bun run audit:analyzer-docs` | **50/50 FULLY complete** + count contract |
| `bun run audit:mutations` | **2,136 / 2,136 mutants caught** |
| `bun run audit:fixture-coverage` | all 27 languages pass |

## Cross-repo confirmation

The tables above are the two measured repos. The same invariants were re-checked on a **1,200-file
stride spanning 23 Go repositories**, so the result is not specific to these two codebases:
18,470 symbols with **0 bad ranges**, 111,937 edges with **0 empty endpoints and 0 off-enum**,
and reasonCode / bindReason / construct-label each at **100 %**.

## What this review changed

Four defects were found and fixed while assembling it, each committed:

1. Nine Go scripts defaulted to deleted corpus repos (`go-stdlib`, `cobra`) and silently skipped a
   missing repo, so they reported a clean **zero** over an empty population. Verified: the firing
   probe exited 0 printing `0`. Absent requested repo is now **fatal** (exit 1, named directory);
   all nine verified, default is now `go-tools,terraform`.
2. The doc banner called `.corpus/` "the one current, re-runnable measurement" — `.corpus/` was
   **also removed**, so the pointer sent readers to a corpus that is gone. It now separates all
   three corpora and names the real baseline with its command.
3. The host corpus path was leaked in nine tracked validation scripts, contradicting this repo's own
   "drop … the local corpus path" decision. Sanitized to `<corpus-root>` behind a guard; **0** Go
   scripts contain the host path now.
4. The oracle table's confidence column asserted "**0 reason codes**" for six types and called
   `overrides` "the only type whose sub-1.0 edges carry a `reasonCode`". Both were true when
   written and are false now: every sub-1.0 type carries one. Annotated as a dated snapshot with
   the current per-type table rather than silently rewritten.
