# real-clean-analyzer.md

> **Status (M60 pass 3 — the ruling table).** Pass 2 adjudicated nine types and left
> `extends` as prose. It is now a registered ruling with a falsifying probe:
> `script/m14/clean-ruled.ts` exports `CLEAN_RULED`, the arbiter runs it, and
> `npx tsx script/m14/ontology-coverage-gate.ts clean` exits **0** with
> **`FALSIFIED 0`** and **`ruled-without-justification 0`** — **emitted 9/10,
> ruled-sound 1**, over 312 admitted files. The new evidence is a PARSE-TREE POSITION
> CENSUS rather than a node-name list: **5,567 declarations, 55 distinct
> (declaration, child) pairs, 0 UNCLASSIFIED**, against a corpus of 2,181 files and a
> second run over the 312 the arbiter walks. See
> [`extends` — RULED, registered and falsifiable](#extends--ruled-registered-and-falsifiable).
> Pass 3 also found and fixed a **defect in the analyzer itself**, unrelated to the
> ruling: an operator-named class declared in the same file read as imported
> (`isExternalClass` false on **24** `implements` edges) and its member set read as
> unreachable, so its `overrides` edges were dropped. Two mutants and one fixture pin
> both halves; see [A spelling mismatch that made both lookups miss](#a-spelling-mismatch-that-made-both-lookups-miss--pass-3).
>
> **Status (M60 pass 2, ontology adversarial review).** The pass-1 body below is the
> 2026-09-28 M14.0 completeness round and is retained as its record. That round
> re-measured it, found **`overrides` was a GAP rather than an absence** and
> implemented it (582 edges, 2,181 files), and **restated 9 of the pass-1 figures**
> because the grammar pin moved to v1.2.8 and the corpus instrument changed — not
> because the corpus grew. Every number carries its instrument and its corpus, and
> the numbers that moved are listed in [Figures that moved](#figures-that-moved-and-why)
> rather than quietly edited. The instruments are named in
> [Instruments](#instruments-every-number-in-this-document-has-one).
>
> **Round-1 findings** are in `reviews/clean/m14-0-clean-completeness.md`.

## Instruments — every number in this document has one

| instrument | what it measures | corpus |
| --- | --- | --- |
| `script/m14/clean-ontology-census.ts` | relationship types, resolution rates, confidence, site lines, endpoint hygiene — **through production `parseFile`**, never `analyze()` | 2,181 files (default: the 312 tracked) |
| `script/m14/clean-extends-overrides-probe.ts` | `overrides` and the pass-2 `extends` reading: grammar inventory (A) and parse-tree semantic counts (B) | 2,181 files |
| `validation/m14/fixtures/clean/extends-construct-probe.mts` | pass 3 — the `extends` POSITION census and the grammar inventory, importing the ruling table's own walk so the evidence and the arbiter cannot drift | 312 tracked + 2,181 wide, both reported |
| `script/m14/clean-ruled.ts` | the ruling table the arbiter consumes; `countOnTree` IS the position census | whatever the arbiter walks |
| `script/m14/ontology-coverage-gate.ts clean` | EMITTED vs RULED-SOUND vs FALSIFIED, per type | 312 admitted files |
| `script/m14/firing-check.ts --files 120 clean` | does each type FIRE through production `parseFile` | 120-file stride sample |
| `script/m14/clean-label-probe.mts` | Q4 — whether each edge's TYPE label is provable against an independent walk of the same tree | 312 files |
| `script/m14/clean-honesty-gate.ts` | resolution, empty names, unknown kinds, ownerless members, crash files — through **`analyze()`** | 312 files |
| `script/m14/clean-completeness-gate.ts` | the grammar's named node types against the spec's buckets | fixtures |
| `script/m14/run-fixtures.ts --lang clean` | 11 fixtures | fixtures |
| `script/m14/clean-mutant-run.ts` | 9 mutants, judged by the shared harness's own rule | fixtures |
| `validation/m14/fixtures/clean/extends-probe-roles-check.mts` | the ruling census's slot ROLES, per declaration, importing the census from the ruling table | the one fixture |
| `validation/m14/fixtures/clean/operator-class-spelling-probe.mts` | the spelling defect's own count: operator-shaped `implements` edges where the flag disagrees with the file | 312 tracked files, `analyze()` |
| `validation/m14/fixtures/clean/extends-probe-roles-regen.mts` | regenerates the probe expectation, preserving every hand-written note | the one fixture |
| `script/m60/rel-type-coverage-gate.ts --langs=clean` | DERIVATION — which emitted types an oracle actually audits | 1 lane |
| `script/m14/differential.ts --lang clean --sample 60` | Q3 — the second-opinion oracle | Clyde + clean-stdlib, 60 files each |

**The two census instruments disagree and both are reported.** `clean-ontology-census.ts`
(2,181 files, `parseFile`) and `clean-honesty-gate.ts` (312 files, `analyze()`) are
different code paths over different corpora, so their totals are not comparable and
are never mixed in one table. The size of the gap is measured rather than waved at:
on the **same 312 files**, `parseFile` yields **30,187** relationships and `analyze()`
**30,689** — a difference of **502 edges (1.7%)**, and it is not spread evenly:

| type | `parseFile` (production) | `analyze()` (per-file unit) | delta |
| --- | --- | --- | --- |
| `uses` | 1,457 | 1,457 | 0 |
| `overrides` | 306 | 306 | 0 |
| `instantiates` | 122 | 122 | 0 |
| `references` | 9,551 | 9,559 | +8 |
| `imports` | 1,891 | 1,920 | +29 |
| `calls` | 3,798 | 3,886 | +88 |
| `implements` | 712 | 772 | +60 |
| `exports` | 4,839 | 4,937 | +98 |
| `contains` | 7,511 | 7,730 | +219 |

Both are reproducible: the arbiter, the firing check and the census independently
report `calls 3,798 / contains 7,511 / imports 1,891 / exports 4,839 / implements 712`
for the same 312 files, and `parseFile` was run twice with identical totals. The delta
is therefore **the pipeline stages `analyze()` skips**, not run-to-run noise — which is
the reason every production figure in this document is the `parseFile` one.


## Language

- Analyzer file: `src/ast/real-clean-analyzer.ts`
- Parser: `tree-sitter-clean` **v1.2.8** (authored by the project owner; pinned
  `wasm/tree-sitter-clean.wasm` rebuilt from `tree-sitter-clean@7dfe6d12` release
  v1.2.8, published 2026-09-30 to npm, crates.io and PyPI — the prior v1.2.7
  adoption is recorded in `reviews/m60-clean-grammar-127-adjudication.md`).
  The pin is recorded in `validation/m14/grammar-pins.json` (sha256 `001361f63d…`,
  6,791,209 B; round record `reviews/functional-family/m60-grammar-pins.md`).
  Two facts govern how that hash may be used. **npm's `tree-sitter-clean@1.2.8`
  publishes `grammar.js` / `scanner.c` / `grammar.json` / `node-types.json` but no
  wasm**, so the wired bytes are not claimed to be hash-matched to a published
  artifact. And **a `tree-sitter build --wasm` is not byte-deterministic** — two
  consecutive builds of one `parser.c` at v1.2.8 produced different sha256s — so
  the hash pins the bytes in this tree, not a function of the source. What a
  consumer can require is the reproducible part: the id-order, type-set and
  field-set digests in the same block, measured through web-tree-sitter 0.25.9.
- Language detection: `.icl` / `.dcl` → `clean` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealCleanAnalyzer`
- **Pure AST. ZERO regular expressions** — measured with TypeScript's own
  scanner (`RegularExpressionLiteral` count = 0), and enforced by
  `script/m14/clean-completeness-gate.ts`, which fails on a planted regex
  literal. Note this was already true of the previous version (an earlier
  M49.R2 wave replaced its two literals with `startsWith`/`slice`/`includes`), so
  it is not a round-over-round gain; the gain is that the analyzer no longer
  needs text inspection to find a name at all. The remaining text operations are
  inventoried and classified in [Hygiene](#hygiene-zero-regex-and-what-it-is-checked-against).
- Spec: `script/m14/spec/clean-completeness.json` — all **137** distinct named node
  types the grammar declares are classified, with the gate at
  `script/m14/clean-completeness-gate.ts`.

## The measured surface this analyzer is built against

| | count | instrument |
| --- | --- | --- |
| Clean files measured (312-file corpus + 8 fixtures) | 320 | round 1 |
| **Clean files in the WIDE corpus** (`clean-wide-manifest.txt`) | **2,181** | `clean-ontology-census.ts --wide` |
| AST nodes over the 312-file corpus | 331,079 | round 1 |
| **AST nodes over the 2,181-file corpus** | **3,107,897** | `clean-extends-overrides-probe.ts` |
| **files the pinned grammar parses with no ERROR** | **1,524 of 2,179 (69.9%)** | round 1, at the v1.2.8 pin; **NOT re-measured this round** |
| distinct node types the pinned grammar DECLARES (named) | **141** | `clean-completeness-gate.ts` (round 1 recorded 137) |
| **distinct node types the grammar PRODUCES across the corpus (named + anonymous)** | **199** | `clean-extends-overrides-probe.ts` |
| named types the analyzer HANDLES, each fixture-backed | **102**, all occurring in corpus code | `clean-completeness-gate.ts` (round 1 recorded 99) |
| named types classified `internal_silent` | 30 | `clean-completeness-gate.ts` |
| named types in a `gap` | 1 | `clean-completeness-gate.ts` |
| named types in a `design_decision` | 8 | `clean-completeness-gate.ts` |
| **SymbolKind values observed on 63,012 symbols** | **9, none empty, none `unknown`** | `clean-ontology-census.ts --wide` |
| **symbols with an empty name** | **0** | both census instruments |
| **relationship endpoints equal to the literal `unknown`** | **0** | `clean-ontology-census.ts --wide` |

Two denominators, deliberately not merged: **141** is what the grammar *declares* and
**199** is what it *produces* over the corpus, the difference being anonymous tokens
(`!`, `::`, `(`, `{`, …). A claim of the form "the grammar has N node types" is
ambiguous until the denominator is named, so both are published.

The previous version of this analyzer named **35** of the 137 then-declared named types.
The 100 it did not name covered **81,531 corpus sites**. That is the gap round 1 closed.

## Grammar tree shape (as pinned, v1.2.8)

Everything the analyzer reads is a node **field**, not a child scan. The shapes
that matter:

```
module_declaration        → name: module_name → module_identifier        ("Data" "." "Map")
import_declaration        → module: module_name (REPEATED), alias: module_name
                          → items: identifier | constructor | operator leaf
                                    | class_method_name | constructor_subset
                                    | record_subset | range_operator
type_definition           → name: constructor | body: type_definition_body
                          | parameter: type_variable | rhs: data_constructors
type_definition_body      → rhs: data_constructors | record_definition | constructor | …
data_constructor          → name: constructor | argument: <type> (REPEATED)
record_definition         → record_field → name: identifier | type: <type>
class_declaration         → name: class_name | parameter: type_variable | dotted_type
                          | context: class_context | type: type_function
class_context             → ","-separated constraint list: 474 nodes holding 1,378
                                    constraints, 496 of which name a class
instance_declaration      → name: instance_class | argument: <type> (REPEATED)
                          | context: class_context | type: … | body: code_expression
generic_declaration       → name: identifier | parameter: type_variable (REPEATED)
                          | context: identifier | context_arg: type_variable (REPEATED)
generic_case_definition   → name: identifier | kind | pattern | body
derive_declaration        → name: identifier | <the derived type>
function_declaration      → name: constructor|identifier | pattern (REPEATED) | body (REPEATED)
operator_definition       → name: parenthesized_operator|parenthesized_name|operator
macro_definition          → name: constructor|identifier|parenthesized_* | body (REPEATED)
type_signature            → name: signature_name | type: <type> | context: class_context
                          | fixity: fixity_annotation | body: code_expression
signature_name            → identifier | constructor | parenthesized_operator | parenthesized_name
special_block             → special_member → variable: type_variable | type: <type>
fixity_declaration        → operator | associativity | precedence
foreign_export            → name: identifier
where_block / with_block  → local_binding → (the definition it wraps)
local_binding             → the definition it wraps (a name-bearing child, NOT a field)
application               → function: <callee> (the LEFT-NESTED head) | argument (REPEATED)
single_quoted_name        → the corpus's qualified form: 'Data.Error'.Ok
qualified_identifier      → the alias form: M.lookup
record_expression         → name (REPEATED) | value (REPEATED)
record_update             → record | field: update_field (REPEATED) | value (REPEATED)
field_access              → record | field
type_function             → [domain, arrow, result]   ← the result is child(2)
type_application          → [type, arg, arg, …]     ← the DOMAIN of a function type
strict_type               → "!" + <type>      uniqueness_type  → "*" + <type>
unique_var_type           → "u:" + <type>    dotted_type      → "." + <type>
code_expression           → code { abc_instruction (REPEATED) }
```

Two shapes that are easy to get wrong and are called out because the analyzer
depends on them:

- **An application is LEFT-NESTED.** `f a b c` is
  `application(application(application(f, a), b), c)`, so only the innermost
  application carries the callee. Measured over 23,908 applications, the
  `function` field is 13,102 `application` (the nest), 8,340 `identifier`, 2,045
  `constructor`, 162 `field_access`, 78 `single_quoted_name`, 61
  `unboxed_expression`, 25 `parenthesized_operator`, and 95 across ten more
  shapes (`string`, `paren_expression`, `index_access`, `record_update`,
  `tuple_expression`, `list_expression`, `lambda_expression`, and two
  comprehensions). Reading `namedChild(0)` as "the head" is right for the head and wrong
  for the nest, which is why the head is read from the `function` FIELD and the
  nest is simply ignored.
- **A function type's domain is a `type_application` whose children ARE the
  parameters, in order.** `f :: !A !B -> C` has a two-child domain; so does
  `f :: (OrderBook Int) -> C`, which is why Clean source parenthesises a
  multi-argument type there. Pairing the domain's children with the definition's
  `pattern` fields positionally is therefore sound, and no arrow scan over a
  string is needed (the haskell lane has to do that scan; this one does not).

## Symbol contract

| Field | Supported? | How extracted |
| --- | --- | --- |
| `name` | ✅ | Every declaration reads its grammar field: `module_declaration.name`, `type_definition.name`, `class_declaration.name`, `instance_declaration.name` (the `instance_class`), `generic_declaration.name`, `function_declaration.name`, `operator_definition.name`, `macro_definition.name`, `foreign_export.name`, `generic_case_definition.name`, `data_constructor.name`, `record_field.name`, `type_signature.name` (normalized across all four `signature_name` shapes). |
| `kind` | ✅ | `module`; `type_definition` → `type`; record fields → `property`; ADT constructors → `constructor`; class → `interface`; generic → `interface`; instance → `class`; class/instance members → `method`; `macro_definition` → `macro`; everything else callable → `function`. |
| `ownerName` / `ownerKind` | ✅ | The enclosing module for module-level symbols; a type for its constructors and fields; a class or instance for its members; **and, new this round, the enclosing FRAME for a where/with/let binder** — see [Local identity](#local-identity-where-with-and-let). |
| `qualifiedName` | ✅ | The scoped identity of a local (`describe.nonNegative`). A module-level symbol needs none: its `name` is already unique in the file, and the store falls back to `name`. This is what makes a local's relationship endpoints resolvable while the symbol keeps the bare name the source declares. |
| `visibility` | ✅ | `public` for module-level; **`local` for a where/with/let binder**, which is also what keeps it out of the export surface. |
| `range` (lines + columns + byte indices) | ✅ | the declaration node. A multi-clause function's range extends to the last clause's end. |
| `parameters` | ✅ **REAL** | The definition's `pattern` fields (one field = one parameter, in order) paired positionally with the `type` field's domain argument types. A pattern that binds no single target is named by its own text. |
| `returnType` | ✅ **REAL** | `type_function`'s THIRD child — the one after the `arrow` node. 3,314 symbols carry one. |
| `genericParameters` | ✅ **REAL** | `type_variable`s the signature or declaration binds (1,358 symbols) — and a `type_variable` is a **binding, never a reference**, which is what keeps `a` out of the reference graph. |
| `comments` / `docstring` | ✅ **REAL** | The contiguous comment run immediately above the declaration, plus a trailing comment on its own end row, plus comments inside it. 998 symbols carry comments, 350 carry a docstring. |
| `qualified_calls` | ✅ **REAL** | The qualified call targets the frame's bodies spell, quote-stripped (44 symbols). |
| `complexity` | ✅ **REAL** | Decision points counted while the frame is open, so it is O(1) per decision node and O(n) for the file. |
| `isAbstract` | ✅ | A class/instance member whose only occurrence is a signature. |
| `isStatic` | ❌ | Clean has no static member. N/A. |
| `docstring` on a `macro` | ✅ | same comment rules. |

### The 253-defect: the instance target

`instance Array {} a` carries `array_type` and `type_variable` in the `argument`
FIELD and has **no direct `constructor` child at all**. Measured over the corpus
the field is 782 occurrences on 741 instances, of which only 489 are a bare
`constructor`; the other 293 are `array_type` 127, `list_type` 97, `type_variable`
32, `type_paren` 16, `question_type` 9, `tuple_type` 8, `unit_type` 4. On those 253
declarations — across 203 files — the previous analyzer's
`findChild(node, n => n.type === "constructor")` returned null and the instance was
skipped whole: no Class symbol, no `implements` edge, no member scope, and every
`instance_member` inside it (1,009 corpus-wide) left ownerless or attributed to
the module. The target is now read from the field, and the remaining shapes are
resolved structurally (an `array_type`'s inner type, a `type_paren`'s inner type)
rather than by text. **488 Class symbols → 741.**

### Local identity: `where`, `with` and `let`

A `where` / `with` / `let` binder is a real callable. Measured over the corpus:
**1,911 `local_binding` occurrences** in the corpus, of which **1,821 wrap one of
the three callable definition shapes** (1,361 `function_declaration`, 449
`type_signature`, 11 `operator_definition`) and 90 wrap a bare pattern or an
expression. They publish **1,090 local symbols**, all of kind `function` (a local
signature merges with its definition, and a multi-clause local merges with itself),
and there are **5,085 applications inside where blocks** under them. The
previous analyzer set `currentFunction = undefined` for the whole block — the M11.11
"closure boundary" — so every one of those applications attributed to nothing and
none of the 1,821 binders published a symbol.

The haskell lane solved this exact construct with scoped local identity
(`real-haskell-analyzer.ts:15-30`) and the rule is adopted here unchanged:

- a binder's identity is `${owner}.${name}`, so it can never collide with a
  module-level callable of the same name;
- the identity rides the symbol's `qualifiedName` (so an edge endpoint resolves to
  the right row) while `name` stays the bare declared name (so the C1/C2
  name-surface gate sees the name the source declares);
- call resolution walks the scope stack, so a local is only ever a target from
  inside its own scope;
- it is `visibility: "local"` and NOT exported — M11.11 §2 is unchanged, and it is
  now stated in `emitExports` rather than being a side effect of the symbol not
  existing.

**42 of the 1,090 locals shadow a name their own frame declares** (`printPools`
inside `printPools`, and `printPools` has an inner `printPools` in the corpus) and
**0 shadow a module-level symbol** — so the shadowing risk that motivated the
scoped identity is real but smaller than it looked, and the measurement is the
reason to say so.

Across the whole corpus, **250 symbols have `ownerName === name`**, and all 250
are Clean's own name-sharing rather than a defect:

| shape | count | example |
| --- | --- | --- |
| a newtype: a data constructor named as its type | 185 | `:: ErrPrefs = ErrPrefs` |
| a local binder sharing its frame's name | 42 | `printPools` inside `printPools` |
| the MODULE named as the symbol | 12 | a `.dcl` for module `Target` declaring type `Target` and three instances of it |
| a one-method class whose method shares the class name | 11 | `class addTabViewItem a where addTabViewItem :: …` (Cocoa's ObjC delegates) |

All four are safe by the same construction: the store keys a symbol row
`${fileId}:${name}:${lineStart}` (`parallel-indexer.ts:2259`), so the rows are
distinct, and resolution also matches `qualifiedName` (`:2734-2736`). The
`Target` case has one visible cost: the module's `contains` edge to its own type
`Target` collides by name and is deduplicated away, so `Target.dcl` publishes the
type and the three instances with correct owners but no module→`Target` edge.
That is the name-keyed `contains`/export dedupe, which is deliberate and pinned by
`instance-target-name-collision.icl`.

## Relationship contract

| Type | From → To | When | Corpus |
| --- | --- | --- | --- |
| `calls` | callable → callable | an application whose head is a declared callable, resolved through the scope stack so a local wins over the module binding | 2,143 |
| `calls` | callable → qualified name | the head is a `single_quoted_name` (the corpus form, 233 sites) or a `qualified_identifier` (the alias form, 2 sites, both in this repo's fixtures). Target is the source-spelling with its quote characters dropped. | |
| `calls` | callable → class | the head is a declared CLASS name: Clean's implicit dictionary passing makes `C x` a call of `C`'s class method. **84** uppercase applied sites resolve to a class the file declares | |
| `calls` | callable → declared function | the head is a `constructor`-typed node that this file declares as a CALLABLE. Clean lets a constructor be a function and the grammar types both `constructor`, so 939 corpus sites were `instantiates` edges on names that are Clean uppercase FUNCTIONS (`FModified`, `NSMakeSize`, `ApplicationOptionsToFlags`) | |
| `instantiates` | callable → data constructor | the head is a `constructor` this file declares via a `data_constructor` node. **Only these** — see [The 24,986-site row](#the-24986-site-row). | 122 |
| `uses` | callable → record field | a `field_access` read, a `record_expression` construction, or a `record_update` write, where the field is declared in this file. 1,406 edges. The FP family emits no bare VALUE read: a receiver, a parameter or a pattern variable never produces an edge | |
| `uses` | callable → data constructor | a `constructor_pattern` — a MATCH, which is a dependency and not a construction | |
| `implements` | instance target → class | `instance C T` where the class name is the `name` field's own node, on that node's line | 739 |
| `implements` | derived type → generic | `derive g T` — the same shape as an instance: an implementation of a class AT a type | 43 |
| `references` | symbol → type | Clean's `extractDeclaredTypeRefs`: every type a signature, a record field, an ADT constructor argument, a type synonym's RHS, a class context or a `special` block names. **A `type_variable` is a binding and is excluded.** Each edge carries the NAME's own line, not the type expression's start | 9,568 |
| `references` | module → imported module | the module-level dependency, on the module NAME's line | 1,533 |
| `imports` | module → `<module>:<item>` | one per imported NAME, the form `src/ast/import-resolution.ts` joins against the exporting file's export surface. 943 corpus items over 367 selective imports reached nothing before, because every import edge was the wildcard | 1,921 |
| `contains` | owner → member | module → members, type → constructors and fields, class/instance → methods, **and a local frame → its own binders**. The CHILD's own naming line is the anchor that resolves the intended target among same-named siblings (#921) | 7,777 |
| `exports` | module → exported name | one per exported name, on the symbol's own line. Clean has no `export` keyword — a `.dcl`'s definition list IS the interface — so the surface is a first-class edge and not only a property of the exports array | 5,093 |
| `overrides` | instance member → class member | **new this round.** `instance C T where m` supplies the member `m` that `class C` declares abstract. Qualified `T.m -> C.m`, in-file class only, and never a self-edge. | **582** |

**Every relationship carries a 1-based `line_number` on the name-bearing node,
per-site and not per-set** (232,773 of 232,773 at the 2,181-file corpus, 0 absent).
The line is part of the DEDUPE KEY, so a function called from three lines is three
edges at three lines, and a line that is not a positive integer is recorded as ABSENT,
never as 0 (M59.O2).

### The 24,986-site row

One edge class could not be made honest, and the analyzer now emits nothing for it.
The question is what an uppercase applied name that is **not** a data constructor
declared in this file actually is. The population is measured on the AST — every
application whose innermost `function` field is a `constructor`-typed node,
excluding names the file declares via `data_constructor` — because the DECLINED
sites emit no edge and so cannot be counted from the output. Over the **2,179-file**
corpus that population is **24,986 sites**, each classified against what its own
file declares:

| the target is declared in this file as a… | sites | share |
| --- | --- | --- |
| function | 4,472 | 17.90% |
| **not declared anywhere in this file** | 19,566 | 78.31% |
| macro | 465 | 1.86% |
| class | 194 | 0.78% |
| type | 289 | 1.16% |

**19,566 sites (78.31%) name something no file in the corpus declares at all**, so
the analyzer cannot prove a construction. Of the 5,420 the file CAN name, **zero are
data constructors** — that is the population's definition — and 82.5% are functions.
The node type alone proves a
construction in zero cases, so the branch emits nothing, the count is published as
`metadata.declinedInstantiations` (19,430 over the corpus) so the cost is visible in
the analyzer's own output, and the consequence is recorded: **the M14.0.F5 oracle
is red on this lane**, and the disagreement is the point. The oracle derives an
`instantiates` from every `constructor`-headed application, so satisfying it means
asserting a data construction for at least 97% of these sites.

Three edge kinds DO survive an external target because their MEANING does not
depend on what the target is — a `references` edge in a typed position is a type
reference whatever the type is, an `implements` edge is an instance whatever the
class is, and a `calls` edge to a source-spelled qualified name is that call.
This one does not. See `reviews/clean/m14-0-clean-completeness.md` §6.

### Retracted numbers, kept visible

Three figures in this document's history were wrong, and each is named where it was
wrong rather than quietly edited:

- **"1,026 sites, 19.30% real constructors"** — a different population on an earlier
  analyzer state (it counted uppercase applied sites *including* declared
  constructors, before the decline existed), reproducible by no instrument.
- **"4,107 applications inside where blocks"** — actually 5,085, and 42,289 at the
  2,179-file scale.
- **"`qualified_identifier` never occurs in the corpus"** — it does. The 312-file
  census was too small to see it, and the branch was rare rather than dead.

The table above is what `clean-census.ts` recomputes; the corrections tables in the
review §6.1 and §12.1 record each one.

## Complexity and metrics

- `metadata.complexity` counts: `case_expression` 131, `case_alternative` 373,
  `guard_equation` 1,594, `guard` 23, `if_expression` 165,
  `comprehension_qualifier` 172, `binary_expression` 4,981. The previous list
  counted only the first two and neither `if_expression` nor
  `comprehension_qualifier` — 337 sites of real branching, silently uncounted.
- `metadata.patterns` — 20 marks, 8 of them new this round (`Macros` 92 files,
  `Generics` 23, `Specialised Members` 9, `Foreign Function Interface` 7,
  `Operator Fixity Declarations` 12, `Class Contexts` 69, `Qualified Instances`
  11, `Inline Machine Code` 61). Each mark previously existed for hundreds of
  corpus sites that carried no mark at all.
- `metadata.hasTypeInference: true` — a Clean signature IS its type.
- `metadata.analysisVersion: "12.0.0-clean-ast-complete"`.

## Corpus results (312 files, 331,079 nodes)

Round 1's before/after table, retained as its record. The "after" column is what round
1 measured; the figures that moved since are restated in
[Figures that moved](#figures-that-moved-and-why) rather than edited here.

| | before | after (round 1) |
| --- | --- | --- |
| symbols | 6,340 | **8,336** |
| relationships | 11,108 | **30,558** |
| exports | 4,443 | **5,093** |
| import edges | 0 (the arrays were the only record) | **1,921** |
| symbols with a `returnType` | 0 | **3,314** |
| symbols with `parameters` | 0 | **1,712** |
| symbols with `genericParameters` | 0 | **1,358** |
| symbols with `comments` | 0 | **998** |
| symbols with a `docstring` | 0 | **350** |
| symbols with `qualified_calls` | 0 | **44** |
| `class` symbols (instances) | 488 | **741** |
| `macro` symbols | 0 | **556** |
| unknown symbol kinds | 0 | 0 |
| empty symbol names | 0 | 0 |
| members without an `ownerName` | 0 | 0 |
| crash files | 0 | 0 |
| symbol-free files | 3 (all legitimately symbol-free include stubs) | 3 |

## The 10 relationship types: one verdict each

`EMITTED` means production `parseFile` produced the type on real corpus files.
`RULED` means a written reason **and** a corpus measurement, and the ruling names the
probe and what count would overturn it.

**Two populations, never mixed.** `PROD` is the **312 files `git ls-files` admits** —
the set `script/m14/ontology-coverage-gate.ts` and `script/m14/firing-check.ts` walk,
measured through production `parseFile` at this commit. `WIDE` is the 2,181-file
content-deduplicated corpus (`script/m14/clean-wide-manifest.txt`).

| type | emitted | verdict | PROD edges (312 files) | PROD corpus resolution | WIDE edges (2,181 files) | WIDE corpus resolution | self-edges (PROD) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extends` | ❌ not emitted | **RULED** — registered in `script/m14/clean-ruled.ts`; instrument B position census, 0 UNCLASSIFIED of 5,567 declarations; corroborated by instrument A | 0 | — | 0 | — | — |
| `calls` | ✅ EMITTED | — | 3,798 | 98.9% | 27,485 | 99.9% | 809 |
| `uses` | ✅ EMITTED | — | 1,457 | 100.0% | 11,864 | 99.8% | 1 |
| `contains` | ✅ EMITTED | — | 7,511 | 100.0% | 57,855 | 100.0% | 0 |
| `imports` | ✅ EMITTED | — | 1,891 | 84.2% | 11,878 | 97.6% | 0 |
| `references` | ✅ EMITTED | — | 9,551 | 88.3% | 81,534 | 99.0% | 54 |
| `exports` | ✅ EMITTED | — | 4,839 | 100.0% | 37,126 | 100.0% | 293 |
| `implements` | ✅ EMITTED | — | 712 | 97.2% | 2,990 | 97.3% | 0 |
| `overrides` | ✅ EMITTED | **GAP → implemented in pass 2**; believed missing at handover | 306 | 100.0% | 582 | 100.0% | 0 |
| `instantiates` | ✅ EMITTED | — | 122 | 100.0% | 1,459 | 99.9% | 0 |

The `emitted` column is machine-graded by `script/m14/verify-doc-truth-emissions.ts`,
which reads this table and compares each row against the `RelationshipType.*` aliases
`src/ast/real-clean-analyzer.ts` actually constructs. `overrides` moved from a negative
to a positive in pass 2, and the gate is what convicts a doc that claims otherwise.
`extends` leads the table because it is the only type whose absence is a measurement,
and a ruling is the row a reader needs first. It also happens to be the row the gate
needs not to lose — see the finding below.

**A defect in that gate, found by using it.** `verify-doc-truth-emissions.ts`'s
`readClaimTable` row loop is:

```ts
let started = false
…
  if (isRuleRow(cs)) continue
  if (!started) { started = true; continue }   // <-- consumes the FIRST body row
```

The `---` rule row is already skipped by `isRuleRow`, so `started` is still false when
the first data row arrives — and that row is consumed to set the flag and never graded.
**The first row of every claim table in the repository goes uncompared.** Measured on
this lane: with `calls` first, the gate reported `UNDOCUMENTED [clean] calls`; with
`extends` first it reports nothing for clean. That is a gate defect, not a doc defect,
and it is reported to the supervisor rather than worked around silently — the ordering
above is disclosed here for exactly that reason. `script/m14/verify-doc-truth-emissions.ts`
is shared machinery and was not modified. **Re-verified at this commit**: `clean` is
absent from `FALSE_NEGATIVE`, `FALSE_POSITIVE` and `UNDOCUMENTED`, and
`docs/DOC-TRUTH-EMISSIONS.md` records its row as
``calls contains exports implements instantiates overrides references uses imports``
— 9 types, matching the analyzer.

The `files` column is deliberately absent: the census caps its per-type file set at
400, so any type at the cap reads `400` and the number is not a count. Types below the
cap: `uses` 366 files, `overrides` 40, `instantiates` 167.

PROD totals: **30,187 relationships, 8,288 symbols, 312/312 files parsed, 0 parse
failures, 0 degraded fallbacks, 0 empty names, 0 empty/unknown kinds, 0 `unknown`
endpoints, 0 edges without a site line.** WIDE totals: **232,773 edges**. Both read
through `parseFile`; `script/m14/clean-ontology-census.ts` prints the production entry
point in its own header so a reader cannot mistake one for the other.

`extends` leads the table because it is the only type whose absence is a measurement,
and a ruling is the row a reader needs first.

### `extends` — RULED, registered and falsifiable

**Structural reason.** Clean has no type inheritance. A class constrains its type
parameter (`class Ord a | Eq a`) rather than inheriting from another type, and the
constraint is a DICTIONARY REQUIREMENT, not a supertype relation: `Ord` is not a kind
of `Eq`, `a` is merely required to have both. Publishing it as `extends` would assert a
subtype relationship the language never writes.

**Why the table rules on instrument B and not instrument A.** Instrument A asks whether
the grammar has a RULE for the construct, and for Clean the answer is a clean negative:
the pinned wasm declares **290 node types and 29 field names**, **0** of the 22 probed
supertype node types and **0** of the 17 probed supertype words appear in either, and
**0** of the 29 field names is a supertype slot. But a bare A-ruling for Clean would be
hiding the strongest counter-argument instead of answering it. Clean HAS a `class`
declaration carrying a `class_context`, and `class_context` is the node a reader will
point at: `class Ord a | Eq a` names another class inside a class declaration, and
`instance Ord Int with Eq Int` does the same on an instance. **8 node types the grammar
declares have "class" or "inst" in their name** (`class`, `class_method_name`,
`class_context`, `class_declaration`, `class_name`, `class_member`, `instance_class`,
`instance_declaration`, `instance_member`), and seven of them are produced by this
corpus. A table that listed them would be falsified by the arbiter; a table that
omitted them without saying why would be decoration. So the ruling rests on the
**position** measurement instrument A cannot make: *every slot a Clean declaration
exposes is a name, a member, a context, a parameter annotation, a body or a comment.*

**Instrument B — parse-tree position census, and it is the arbiter's own probe.**
`script/m14/clean-ruled.ts` exports `countCleanExtendsConstruct`, and the evidence file
`validation/m14/fixtures/clean/extends-construct-probe.json` is produced by importing
that same function, so the number and the probe cannot drift apart. The probe walks
every `class_declaration`, `instance_declaration`, `derive_declaration` and
`class_context`, and reports any direct named child no measured slot accounts for.

| population | files | nodes walked | declarations | distinct (declaration, child) pairs | **UNCLASSIFIED** |
| --- | --- | --- | --- | --- | --- |
| TRACKED — what the arbiter walks | 312 | 331,048 | 1,430 (173 class, 741 instance, 43 derive, 473 context) | 55 | **0** |
| WIDE | 2,181 | 3,107,897 | 5,567 (423 class, 2,539 instance, 610 derive, 1,995 context) | 55 | **0** |

Every one of the 55 pairs is in a named role, and the roles are counted, not asserted:

| role | slots | occurrences | what it is |
| --- | --- | --- | --- |
| name | `class_name`, `instance_class`, `constructor`, `identifier`, `class_method_name`, 14 operator-token types | 9,607 | the declared name, or the constraint's name — `class Foo a`, `\| Eq a`, `\| == a` |
| member | `class_member`, `instance_member` | 3,756 | a member the declaration owns |
| parameter | `type_variable`, `type_function`, `type_paren`, `type_application`, `list_type`, `tuple_type`, `array_type`, `dotted_type`, `fixity_annotation`, `generic_kind_type`, `uniqueness_star`, `question_type`, `unit_type` | 5,341 | a type parameter and its annotation |
| context | `class_context` | 393 | a dictionary requirement or composition |
| body | `code_expression` | 135 | the member bodies of an instance or generic class |
| comment | `line_comment`, `block_comment` | 350 | not code |
| parse-error | `ERROR` | 82 | the parser failing; counted apart, never as a construct |

**UNCLASSIFIED is the only bucket a supertype clause could occupy, and it is empty on
both populations.** The whitelist was not written down and then defended — it was
iterated against the corpus, and the three iterations are recorded because each one is
a reading a reader would otherwise have to reconstruct:

1. **230 hits, all `operator_*`** — `class_context > operator_compare` (160),
   `operator_mul` (6), `operator_add` (29), `operator` (4). Read, not assumed:
   `instance == (StrictList a) | == a` (`clean-ide/Util/StrictList.icl:9`) makes `==` a
   class, so an operator token is a constraint's NAME here, the same role `constructor`
   plays 1,496 times for `| Eq a`. All 14 operator node types the grammar DECLARES are
   in the name role, not just the 4 this corpus uses — listing only the observed four
   would have reported a corpus that constrained on `&&` as carrying a supertype clause,
   which is a false conviction of a correct ruling. `operator_definition` is excluded on
   purpose: `name :: type` is a member definition.
2. **15 hits, all type expressions** — `question_type` (`? a`, `?^ a`, `?# a`) 9 and
   `unit_type` (`()`) 6, children of `instance_declaration` and `derive_declaration`.
   An instance target carrying one is annotating a parameter.
3. **0 hits.** The two roles that remained unexercised at each step are the ones a
   supertype would have to occupy, and neither exists.

**Instrument A, corroborating.** `extends-construct-probe.json` → `instrumentA`:

| measurement | value |
| --- | --- |
| node types the grammar PRODUCES over the corpus | 199 (188 over the 312 tracked) |
| probed supertype node types present | **0** of 22 |
| probed supertype words present | **0** of 17 |
| grammar's own declared node types / field names | 290 / 29 |
| supertype words in the declared type table | **0** |
| supertype slot field names in the declared field table | **0** |
| Clean keywords present as declared types (calibration) | **22** of 23 — `class`, `instance`, `where`, `with`, `derive`, `import`, `definition`, `implementation`, `infix`, `special`, `generic`, `if`, `case`, `let`, `export`, `qualified`, `as`, `from`, `module`, `of`, `::`, `\|`. The one absent is `deriving`, which the tree-sitter-clean grammar spells `derive`. |

The calibration row is what makes the negative meaningful: the table is demonstrably
capable of holding Clean keywords, so "absent" means absent rather than "the probe holds
nothing". The 11 `dotted_type` children of `class_declaration` were read one by one —
they are kind annotations on a type parameter (`class List .l e` → `.(a .e)`), not
supertypes.

**What would overturn this ruling.** The probe pushing a single hit, which is what a
grammar that added a supertype clause would produce on the first file that used it: any
`class_declaration` / `instance_declaration` / `derive_declaration` / `class_context`
carrying a named child outside the 55 measured pairs. Or a tree-sitter-clean release
declaring a node type or field name among the 22 and 30 probed. Or a corpus file in
which a class names another class in a position that is not `class_context`. **All three
are satisfiable by a correct implementation**, which is what makes this a falsifiability
claim rather than a decoration — and the arbiter flips the row to FALSIFIED by itself,
with no supervisor action, if the first happens.

**The limitation this ruling cannot retire, stated rather than implied.** The pinned
grammar does not record the difference between a dictionary requirement `| Eq a` and a
composition `with Eq Int` — same `class_context` node, same fields, no field marking a
constraint as a base type. So the ruling rests on the **absence of a supertype SLOT**,
not on the presence of a constraint, and no probe over this wasm could decide it by
reading a `with` clause. If a future tree-sitter-clean distinguishes them, the
composition form becomes a separate question this ruling has not answered.

### `overrides` — a GAP the handover belief got wrong

At handover `overrides` was believed missing alongside `extends`, and no ruling existed
for it — a type with no ruling is not RULED, it is unmeasured. Measuring it produced a
non-zero count, so the belief was wrong in the direction that matters.

**Why Clean HAS the construct.** Clean has no `override` keyword, so every keyword-based
probe is unavailable — which is exactly why the absence survived. It has **typeclasses**:
`class Show a where show :: !a -> String` declares `show` **abstract**, and
`instance Show Thing where show t = …` supplies it. At type `Thing` the compiler selects
the instance's `show` in place of the class's. The project already records this
equivalence for the language Clean descends from:
`docs/analyzers/real-haskell-analyzer.md:57` states
`` `instance C T where m ...` → `overrides T.m -> C.m` ``, and the F# lane reads the
keyword (`real-fsharp-analyzer.ts:656-669`, `Dog.Speak -> Animal.Speak`).

**Instrument B measurement, before the branch existed.** `clean-extends-overrides-probe.ts`
instrument B1: an `instance_declaration` member whose name is in the `class_declaration`'s
member set, resolved against a **corpus-wide** class index:
**1,036 occurrences across 110 files, 78 distinct classes**, of 1,480 instance members
examined (1,480 of 1,480 had their class declared somewhere in the corpus).

**What ships is narrower, deliberately.** The in-file guard leaves **582 edges across 40
files**. The difference is the point: an `implements` edge survives an external target
because its meaning does not depend on what the class is (this document's own 24,986-site
row). An `overrides` edge **does** — it asserts this member is the implementation of
*that specific class member*, so a class declared in another file is a claim about a
declaration the run never read. The honest count is the in-file one: **582**.

**The one place it would have been wrong, and was.** The first implementation emitted
**642** edges, of which **60 were self-edges** (`List._cons -> List._cons`), all from
polymorphic instances of a locally-declared class (`instance List [] a where _cons …`
in clean-stdlib/`_SystemStrictLists.icl`). A polymorphic instance publishes no symbol of
its own, so its members are attributed to the class and the two composed endpoints are
identical. `frameOwner !== className` now refuses them; the mutant
`clean/overrides-self-edge-guard-dropped` proves the refusal is load-bearing.

### A spelling mismatch that made both lookups miss — pass 3

**An operator is a class name in Clean, and the two sites spell it differently.**

| site | spelling | corpus |
| --- | --- | --- |
| a DECLARATION | `class (==) infix 4 a :: !a !a -> Bool` — the symbol name keeps the parentheses | `clean-stdlib/StdOverloaded.icl:23`, `StdFile.icl:373` |
| an INSTANCE | `instance == Bool :: !Bool !Bool -> Bool` — bare | `clean-stdlib/StdBool.dcl:10`, `eastwood/src/sharedUtil/Range.icl:31` |

The analyzer read the declaration's `name` field verbatim as `(==)` and the instance's
as `==`. Every lookup keyed on the bare spelling therefore missed, and it missed in two
places at once:

**1 — `implements.isExternalClass` was false 24 times.** The flag exists to say which of
the two cases an `implements` edge is: the class is declared in this file, or it is
imported. Almost every Clean class IS imported, so `true` is the normal case and the flag
is the only thing stopping a reader assuming otherwise. Measured over the 312-file corpus
with `analyze()`: **24 `implements` edges carried `isExternalClass: true` for a class
declared in the same file** (`clean-stdlib/StdFile.dcl` and `StdFile.icl`, class
`(<<<)`). The external count fell **555 → 531** and the false-external count is now **0**.
No edge was added, removed or relabelled; one metadata field was wrong on 24 of 772.

**2 — the `overrides` in-file guard could not see those classes' member sets.** Same
miss, and here it silently DROPPED edges rather than mislabelling them: `classMembers`
was keyed `(==)` and read as `==`, so the guard refused the edge for a class the file
declares. **0 new edges on the 312-file corpus**, and the reason is worth stating because
it is why the defect survived two rounds: the corpus spells its operator-named classes on
ONE line (`class (==) … ::`), and the one-line form gives the member set nothing to read.
So the aggregate count could not see it and neither could the differential. It is pinned
by `clean/extends-probe-roles`, which declares `class (>>=) a where` in the `where` form
and requires `overrides Thing.>>= -> >>=.>>=`.

**The same miss was in this lane's honesty gate.** `implements.classNotDeclaredHere` reads
`classNames`, built from interface-kind symbol names, so it inherited the paren
mismatch: **318 → 306** after the same correction. The two figures are *not* the same 24
edges and are not comparable — that bucket's predicate is
`!resolvable(target) && !classNames.has(target) && !typeNames.has(target)`, which is
narrower than the flag's, so 12 of the 24 were already resolving by `qualifiedName` and
never entered it. Both numbers are recorded rather than reconciled, because reconciling
them would mean changing a predicate whose exact shape is the gate's business.

**Why no count-based check on this lane could have found it.** Both halves leave the
edge totals intact or lower, the labels correct, the endpoints qualified and the site
lines right. `verify-doc-truth-emissions` compares emitted type NAMES; the census
compares totals; the differential has no oracle for either field. The only instrument
that sees it is a fixture written to name the spelling, and the spelling is only visible
in a file that declares an operator-named class in the `where` form — a shape this corpus
does not contain.

**And the lane's own hygiene gate caught the fix's regression.** The first version of
`isLocallyDeclaredOperatorClass` guarded with `/^[A-Za-z_][A-Za-z0-9_']*$/`, and
`clean-completeness-gate.ts` failed it:

```
FAIL analyzer contains 1 regex literal(s): /^[A-Za-z_][A-Za-z0-9_']*$/
```

This file's rule is stronger than the M49.R2 policy — **zero** `RegularExpressionLiteral`
nodes — and the gate convicted the commit that added the fixture meant to prove the
correction. Replaced with `isPlainIdentifierName`, a character test in the same shape as
the file's other two character predicates. The gate is load-bearing and this is the
second time on this lane it has caught something (the first is in
[Hygiene](#hygiene-zero-regex-and-what-it-is-checked-against)).

## The six questions, per emitted type

The questions fail independently, so each is answered with its own instrument and its
own denominator. Q1 (Exists) is a source derivation and is not re-measured here; it is
answered "the analyzer constructs it" for the 9 EMITTED types because each has a
`pushRel` call site, and "no call site exists" for `extends`.

### Q2 — Fires

The counts above. Every one of the 9 EMITTED types produced a non-zero count on 2,181
real files through production `parseFile`, so none is dead code. `extends` is the only
type that produces nothing, and it is RULED rather than dead.

### Q3 — Correct (an independent oracle agrees)

`script/m14/differential.ts --lang clean --sample 60`, the lane's existing read oracle
(`deriveCleanEdges`), 60 files each from Clyde and clean-stdlib:

| | Clyde | clean-stdlib |
| --- | --- | --- |
| tree truth edges | 1,177 | 702 |
| covered by the analyzer | 700 (59.5%) | 653 (93.0%) |
| MISSING (truth derives, analyzer does not) | 477 | 49 |
| analyzer edges | 1,214 | 1,021 |
| UNEXPLAINED (analyzer emits, truth does not) | 610 (50.2%) | 496 (48.6%) |
| heuristic (confidence < 1.0) | 0 | 0 |
| unexplained by label | `references=368, calls=234, overrides=6, instantiates=2` | `calls=208, references=207, implements=42, overrides=39` |

**The oracle's declared limitation, stated rather than glossed.** `deriveCleanEdges` is a
separate walker over the SAME grammar, so a grammar bug present in both paths is
invisible to it. This lane's 30.1% parse-failure rate (limitation 0 below) is exactly
such a class: a shape neither walker can read is a shape neither can disagree about.

**This differential is RED on the lane, and the disagreements are named rather than
smoothed.** The `instantiates` half is the 24,986-site row below: the oracle derives an
`instantiates` from every `constructor`-headed application, so 477 MISSING on Clyde is
the oracle asserting constructions the analyzer declines to invent. The
`references`/`calls` unexplained halves are the oracle's stricter name-matching, not
fabrications — see Q4, where an independent tree walk finds **0** label violations.

**`overrides` has NO oracle, and that is now a live cost.** The harness prints
`COMPARED WITH NO TRUTH: overrides` and classifies all 45 sampled `overrides` edges as
unexplained, which its own message calls "a confident fabrication". They are not — the
Q4 probe below proves each target is a real `class_member` — but the differential cannot
know that, because `deriveCleanEdges` derives no `overrides` rows. Implementing the type
made this lane's differential **redder**, and the oracle that would clear it is in
shared `script/m14/differential.ts`. Reported, not edited.

### Q4 — Labelled (the edge carries the right type)

`script/m14/clean-label-probe.mts` walks each file's tree a second time, reading only
grammar `name` fields, and asks whether each edge's claim is provable. 312 files,
production `parseFile`:

| claim | checked against | violations |
| --- | --- | --- |
| `instantiates` target IS a `data_constructor` in the same file | `data_constructor.name` | **0** |
| `uses` with `isRecordField` target IS a `record_field` in the same file | `record_field.name` | **0** |
| `calls` with `isClassMethodCall` target IS a `class_declaration` in the same file | `class_declaration.name` | **0** |
| `implements` target IS a class declared in the same file | `class_declaration.name` | 5 of 2,990 — all external by nature (`==`, `FileEnv`, `toString`, `NSLayoutAnchor`, `NSLayoutXAxisAnchor`), each flagged `isExternalClass` by the analyzer |

**The strongest argument that `overrides` is the WRONG label, and the corpus's answer.**
The counter-argument is that an instance member *implements* an abstract member and
overrides nothing — there is no prior definition being replaced, so `implements` (already
emitted at the instance level) is the honest word. The corpus settles it three ways: (a)
the project's own Haskell lane, whose typeclasses are the same construct, publishes
exactly this pairing as `overrides`; (b) the class member is ABSTRACT, so it is not a
definition and there is no definition being replaced, which is why the edge is directed
instance→class and never the reverse; (c) relabelling it `implements` would put an edge
whose SOURCE is a method into a label whose sources every other lane's oracle derives as
a type or a class, and would double-count one relationship under two labels since the
instance-level `implements` edge already exists. The mutant
`clean/overrides-relabelled-as-implements` pins (c).

### Q5 — Resolved (both endpoints bind to a real symbol)

Two rates per type, because resolving only inside the emitting file would convict every
edge to an imported symbol. `intra` = both ends bind in the emitting file; `corpus` =
both ends bind anywhere in the 2,181-file sample, under the store's own three strategies
(bare name, `Owner.member`, leaf after the first `.`).

- **100.0% intra and corpus:** `contains`, `exports`, `overrides`, `instantiates`
- **99.8–99.9% both:** `calls`, `uses`
- **`implements` 43.6% intra / 97.3% corpus.** The intra gap is by design: 318
  `implements` edges name a class this file does not declare, because almost every Clean
  class is imported. `clean-honesty-gate.ts` counts them as
  `implements.classNotDeclaredHere` and accepts them explicitly rather than leaving a
  reader to infer the reason from a missing symbol.
- **`references` 19.3% intra / 99.0% corpus.** The intra figure is the honest one for a
  reader: 7,734 edges name a type or context this file does not declare
  (`references.externalTypeOrContext`, counted by the honesty gate). This is the
  reference point the workstream names — CSS `references` resolves at both ends on 66.8%
  of its edges; clean's `references` resolves at 99.0% corpus-wide and **19.3%
  intra-file**, and both numbers are published because a reader asking "does this edge
  bind?" and a reader asking "does this edge bind *in this file*?" get different answers.
- **`imports` 1.4% intra / 97.6% corpus.** The intra figure is near zero **by
  construction and correctly so**: an `imports` edge's target is `<module>:<item>`, a
  name bound in ANOTHER file. An intra-file rate near 100% (11,878 of 11,878) here would mean the analyzer
  was resolving imports to the importing file, which would be wrong.

### Q6 — Confident (`evidenceClass` and confidence are right)

Measured over 232,773 edges at the 2,181-file corpus:

| type | confidence distribution | edges < 0.7 | `evidenceClass` the pipeline assigned |
| --- | --- | --- | --- |
| `calls` | 0.90 × 27,485 | 0 | `usage_contextual` |
| `uses` | 0.90 × 11,864 | 0 | `structural` |
| `contains` | 1.00 × 57,855 | 0 | `structural` |
| `imports` | 1.00 × 11,878 | 0 | `import_based` |
| `references` | 1.00 × 10,029 · 0.95 × 71,505 | 0 | `reference_qualified` |
| `exports` | 1.00 × 37,126 | 0 | `structural` |
| `implements` | 1.00 × 2,990 | 0 | `structural` |
| `overrides` | 1.00 × 582 | 0 | `reference_qualified` |
| `instantiates` | 1.00 × 1,459 | 0 | `structural` |

**Heuristic ratio: 0 of 232,773 edges (0.000%) are below 0.7.** The honesty contract §4
requires that ratio to be countable, and it is — as exactly zero. Two honest notes
attached to that number:

1. **0.9 is not 1.0.** `calls` and `uses` sit at 0.90 because the callee/field is
   resolved against a name set, not a type — a name match can be shadowed by a binding
   this file's own parse did not surface. The contract's threshold is 0.7, so these are
   above it, but they are inferences and are priced as inferences.
2. **Symbols carry no `evidenceClass` at all** — 0 of 63,012 symbols have one
   (`evidenceTally` in the census reads `ABSENT` for the whole population). Only
   relationships carry a tier. That is a store-schema observation, not a lane defect,
   and it is recorded here because a reader looking for a symbol-level evidence tier will
   not find one.

### DERIVATION findings: **4**

`script/m60/rel-type-coverage-gate.ts --langs=clean`, **re-run and reproduced at this
commit** (pass 3):

```
CHECK 1 — DERIVATION: every emitted type has an oracle derivation
  clean        4 un-audited: ["contains","exports","imports","uses"]
  4 findings in 1 lanes
baseline: 104 recorded, 3 NEW, 103 repaid
REGRESSIONS (not in the recorded debt):
  DERIVATION|clean|emits `exports` but the differential audits ["calls","extends","implements","instantiates","overrides","references"]
  DERIVATION|clean|emits `imports` but the differential audits ["calls","extends","implements","instantiates","overrides","references"]
  DERIVATION|clean|emits `uses`    but the differential audits ["calls","extends","implements","instantiates","overrides","references"]
```

**Three of the four are NEW, not recorded.** The gate's own baseline line says so:
`3 NEW`. Only `contains` appears in `validation/m60/ledger.json`'s recorded debt, so
`exports`, `imports` and `uses` are un-audited types the ledger does not yet know about.
That is a ledger-completeness finding about shared state, not about this lane — the
lane-side number is 4 either way, and the derivations needed are unchanged.

Those four are emitted, stored, and compared against nothing: **57,855 + 37,126 + 11,878
+ 11,864 = 118,723 edges (50.8% of the lane's payload)** ride in no oracle. The gate's
audited set for clean is `["calls","extends","implements","instantiates","overrides","references"]`.

Two of the six audited labels are audited **in name only**: `deriveCleanEdges` derives no
`extends` and no `overrides` rows, so both compare 0/0 and agree with
themselves without a single disagreement to disagree about — the structural defect class `ontology-coverage-gate.ts` exists for. The
`overrides` half is visible above in the differential's `COMPARED WITH NO TRUTH` line;
the `extends` half is invisible precisely because the count is 0 on both sides.

**Emitting `overrides` did NOT raise this count from 4, and that is worth being precise
about.** The gate derives the audited set from the harness's own allowlist, and
`overrides` was already IN clean's audited set — so publishing the type left the count
at 4. But an audited label with no oracle behind it is a worse state than an unaudited
one, not a better one: an unaudited type is visibly unchecked, while an audited one
looks checked and compares 0 against 0. The count did not move; the risk behind it did.
That is the same shape as the `extends` row below.

**Paying this down needs shared machinery, so it is reported and not done.**
`script/m14/differential.ts`'s `deriveCleanEdges` (exported at line 16735) is the only
place clean's read oracle lives, and it is supervisor-owned. The four oracles needed,
each derivable from grammar fields with no analyzer import:

| type | the derivation, from `deriveCleanEdges` |
| --- | --- |
| `contains` | for every `module_declaration`/`type_definition`/`class_declaration`/`instance_declaration` whose `name` field is set, push `contains owner -> child` for each child whose own `name` field is set, anchored on the child's line |
| `exports` | for a `.dcl`, every module-level symbol whose `name` field is set is exported (Clean has no `export` keyword — the definition list IS the interface) |
| `imports` | for each `import_declaration`, one edge per `items` child and one `<module>:*` when the item list is empty, target `<module>:<item>` |
| `uses` | for each `record_field.name`, `field_access.field`, `record_expression.name` and `record_update`'s `update_field`, push `uses owner -> field` when the field is declared in the file |

`extends` needs no oracle while it stays ruled at 0. `overrides` needs
`{label:"overrides", from:`${instanceTarget}.${member}`, to:`${className}.${member}`}`
for an `instance_declaration` whose class appears in a `class_declaration` member set —
the same pairing `clean-extends-overrides-probe.ts` instrument B1 already computes, so
the rule exists and is measured.

## Gates re-run at this commit

Every command below was run in this worktree on `analyzer/CLEAN` at this commit, and
the result is the one printed — not a remembered one. `npx tsc --noEmit -p tsconfig.json`
was clean before the doc edits and after them.

| command | result | exit |
| --- | --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | no output | 0 |
| `npx tsx script/m14/ontology-coverage-gate.ts clean` | `emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0` over 312 admitted files | **0** |
| `npx tsx script/m14/ontology-coverage-gate.ts --coverage` | 14 lanes can be ruled for, `clean` among them | 0 |
| `npx tsx script/m14/verify-ruling-tables-registered.ts` | 14 tables on disk, 14 registered, `PASS` | 0 |
| `npx tsx script/m14/firing-check.ts --files 120 clean` | `9/10 fired, 16231 edges, 120/120 files`, `degraded 0`, analyzer digest `stable` | 0 |
| `npx tsx script/m14/clean-ontology-census.ts` | 312/312 parsed, 30,187 edges, 8,288 symbols, 0 empty names, 0 unknown kinds, 0 unknown endpoints, 0 degraded | 0 |
| `npx tsx validation/m14/fixtures/clean/extends-construct-probe.mts` | TRACKED 0 UNCLASSIFIED / WIDE 0 UNCLASSIFIED; instrument A 0 of 39 probed | 0 |
| `bun run script/m14/clean-honesty-gate.ts` | 312 files, 8,288 symbols, 30,689 relationships, **no violations**; `implements.classNotDeclaredHere` 318 → 306 after this round's correction (`analyze()`, see Instruments) | 0 |
| `bun run script/m14/clean-completeness-gate.ts` | 141 declared named node types, 141 classified, **all checks pass** | 0 |
| `npx tsx script/m14/clean-mutant-run.ts` | 9 mutants, **caught 9/9**, every one made the suite red | 0 |
| `npx tsx script/m14/run-fixtures.ts --lang clean` | clean: **pass 11, fail 0**, `fixture baseline gate: no regressions` | 0 |
| `npx tsx validation/m14/fixtures/clean/extends-probe-roles-check.mts` | **PASS** — 18 declarations, 23 (declaration, child) pairs, 0 unclassified, 0 ERROR, 0 MISSING | 0 |
| `npx tsx validation/m14/fixtures/clean/operator-class-spelling-probe.mts` | 772 `implements`, 198 operator-shaped, 174 external (correct), **0 external-but-local** (read 24 before the fix), 0 instances reading a parenthesised class name | 0 |
| `npx tsx validation/m14/fixtures/clean/extends-probe-roles-regen.mts` | idempotent: regeneration leaves the expectation byte-identical, 0 notes dropped | 0 |
| `npx tsx script/m60/rel-type-coverage-gate.ts --langs=clean` | 4 DERIVATION findings, 3 NEW; checks 2/3/4 pass — **and it OVERWRITES the repository-wide results file, see report item 5** | 0 |
| `bash script/m14/no-regex-gate.sh` | `real-clean-analyzer.ts` contributes **0** of the tree's 4 regex literals (all 4 are `real-svelte-analyzer.ts`) | 0 |
| `npx tsx script/m14/differential.ts --lang clean --sample 60` | **RED, and reproduced exactly.** Clyde: `tree-truth=1314 covered=787 (59.9%) MISSING=527 \| analyzer-edges=1322 unexplained=671 (50.8%) heuristic=0`. clean-stdlib: `tree-truth=655 covered=606 (92.5%) MISSING=49 \| analyzer-edges=941 unexplained=462 (49.1%) heuristic=0`. `COMPARED WITH NO TRUTH: overrides` on both (6 and 39 edges). Writes no artifact on a scoped run, by design | 0 |
| `bun run script/m14/verify-doc-truth-emissions.ts` | repository `FAIL` (7 FALSE_NEGATIVE / 42 UNDOCUMENTED / 15 NO_CLAIM_TABLE) — **`clean` in none of them**; its row reads 9 types | 0 |

**Q3 is red, and the red is not new.** The 527/49 MISSING counts and the 50.8%/49.1%
unexplained rates reproduce the figures already recorded under
[Known limits](#known-limits-stated) 7 and 8 to the digit, so this round neither
introduced nor repaired them. What the red is made of is named per label:
`unexplained-by-label` is `references=383, calls=278, overrides=6, implements=2,
instantiates=2` on Clyde and `references=196, calls=191, overrides=39, implements=36`
on clean-stdlib. Two of those five labels are not analyzer defects at all —
`overrides` has no oracle by construction (limitation 8), and the `instantiates`
MISSING rows are the 24,986-site row's `declinedInstantiations` family, where the
analyzer deliberately declines to name a receiver it cannot type. The oracle is shared
(`script/m14/differential.ts`) and was not modified.


**The one gate that must be run with `bun`, not `npx tsx`.**
`script/m14/verify-doc-truth-emissions.ts` reads `__dirname` at line 131, which is not
defined in ES-module scope, so `npx tsx` dies with
`ReferenceError: __dirname is not defined in ES module scope` **before reading a single
doc** — and it exits 0 while doing it, so a caller that only checks the exit code reads
it as a pass. Two lanes' worth of honesty gate is in that trap. The file is shared
machinery and was not modified; the fix is `import { fileURLToPath } from "node:url"`
plus `const __dirname = path.dirname(fileURLToPath(import.meta.url))`, or a `.cts`
rename.

**The fixture gate takes `--lang`, and a bare language argument is silently ignored.**
`script/m14/run-fixtures.ts` reads its lane list from `process.argv.includes("--lang")`
at line 1532 and from nothing else, so `run-fixtures.ts clean` does **not** scope to
clean: it runs every lane and exits **6**, on a finding about two *other* lanes —
`fixture-lane gate: 2 fixture director(ies) no runner lane claims: lua, r`, 12 and 18
expectation files respectively that nothing executes. Measured at this commit. The
correct invocation is `npx tsx script/m14/run-fixtures.ts --lang clean`, which prints
`summary: {"clean":{"pass":11,"fail":0}}`, `fixture baseline gate: no regressions`, and
exits 0. The bare form is the more dangerous of the two errors this document records,
because the output it produces is a real gate result about someone else's lane rather
than an error — and the `lua`/`r` orphan finding it surfaces is **not** clean's to fix.

## Reported to the supervisor, not fixed

Four findings outside this lane's ownership. Each is stated so it can be applied
without re-deriving it. None was worked around silently.

1. **`script/m14/verify-ruling-tables-registered.ts` cannot see a lane that has shipped
   a table.** Its `UNADJUDICATED` list is still `["clean","graphql","r","scss"]` after
   this round added `script/m14/clean-ruled.ts`, and the gate still prints
   `PASS`. The stale-list check at lines 77-83 tests each entry with `specSuppliesRuling`
   only — never against the `onDisk` set built at line 33 — so a lane whose spec happens
   to carry a `RULED` decision passes the staleness check forever. `clean`'s spec
   carries **no** `RULED` decision (6 decisions, 0 with that status), so the lane slips
   through on a different accident: the check reads `decisions` under
   `design_decision`, and if that path ever does match, `clean` will be reported stale
   for a table it has. Fix: add `if (onDisk.has(lang)) { … exit 1 … }` to the same loop,
   or drop `clean` from the list. **Not edited** — shared machinery.
2. **`script/m14/verify-doc-truth-emissions.ts` needs `bun`.** See the gate table above:
   `__dirname` under `npx tsx`, and a 0 exit on the crash. **Not edited.**
3. **The shared differential still audits no clean oracle for four emitted types.**
   `contains`, `exports`, `imports`, `uses` — and the gate now reports **3 of them as
   NEW regressions** against `validation/m60/ledger.json`. The four derivations are
   written out in [DERIVATION findings](#derivation-findings-4) and need
   `script/m14/differential.ts`'s `deriveCleanEdges` (exported at line 16735) plus one
   `…CLEAN_TRUTH` import. **Not edited.**
4. **`script/m14/verify-doc-truth-emissions.ts`'s `parseClaimTable` drops the first body
   row of every claim table.** Reproduced in [the verdict table's
   note](#the-10-relationship-types-one-verdict-each) and unchanged by this round;
   it is why `extends` is ordered first in this lane's table, which is disclosed rather
   than relied on. **Not edited.**
5. **`script/m60/rel-type-coverage-gate.ts --langs=<one>` DESTROYS the repository-wide
   evidence file it reports from.** Run scoped, it overwrites
   `validation/m60/results/rel-type-coverage.json` with the single lane's result.
   Measured here: the file went from its committed content to **1,445 changed lines,
   almost all deletions**, i.e. every other lane's recorded findings removed, and
   `git diff --stat` was the only thing that showed it — the command printed a correct
   clean-lane report and exited 0. It was restored with `git checkout --` in the same
   minute and **nothing was committed from it**. A scoped `--langs` run should either
   write to a per-lane path or refuse to write when the lane set is not the full set.
   **Not edited** — `validation/m60/` is supervisor-owned.

## Figures that moved, and why

Nine pass-1 figures no longer reproduce. The corpus did **not** grow — the 312-file set
is the same 312 files — so the movement is the grammar pin moving to **v1.2.8** and the
2026-09-29 grammar wave (`f32dbacfb`, parse health 69.9% → 76.0%), plus this round's
`overrides` branch. Both instruments are named so the pair is comparable.

| figure | pass 1 recorded | measured now | instrument |
| --- | --- | --- | --- |
| symbols (312 files) | 8,336 | **8,288** | `clean-honesty-gate.ts` |
| relationships (312 files) | 30,558 | **30,689** | `clean-honesty-gate.ts` |
| `references` (312 files) | 9,568 | **9,559** | `clean-honesty-gate.ts` |
| `contains` (312 files) | 7,777 | **7,730** | `clean-honesty-gate.ts` |
| `exports` (312 files) | 5,093 | **4,937** | `clean-honesty-gate.ts` |
| `imports` (312 files) | 1,921 | **1,920** | `clean-honesty-gate.ts` |
| `calls` (312 files) | 2,143 (one sub-kind) | **3,886** (all four sub-kinds) | `clean-honesty-gate.ts` |
| `uses` (312 files) | 1,406 | **1,457** | `clean-honesty-gate.ts` |
| `implements` (312 files) | 739 | **772** | `clean-honesty-gate.ts` |
| `instantiates` (312 files) | 122 | **122** (unchanged) | `clean-honesty-gate.ts` |
| declared named node types | 137 | **141** | `clean-completeness-gate.ts` |
| handled + fixture-backed types | 99 | **102** | `clean-completeness-gate.ts` |
| `internal_silent` types | 29 | **30** | `clean-completeness-gate.ts` |
| wide-corpus files | 2,179 | **2,181** | `clean-ontology-census.ts --wide` |
| AST nodes (wide) | 3,107,410 | **3,107,897** | `clean-extends-overrides-probe.ts` |

**Run-to-run instability, declared rather than smoothed.** Two runs of the unchanged
2,181-file census differ by up to 0.03% per type (`calls` 27,492 vs 27,485,
`contains` 57,860 vs 57,855, total 232,851 vs 232,773). The cause is measured, not
guessed: `[BB-HANG] parser stuck 120s` fires on a **different file each run** under the
shared machine's load (average 25–30 during this round), and the killed file's edges are
absent from that run. Run 1 lost `clean-libraries/Examples/ObjectIO/…/Life.dcl`; run 2
lost `Prelude/Data/List.dcl`. Every rate in this document is therefore stable to three
decimal places and no figure is quoted to more precision than that.

### Retracted numbers, kept visible

Round 1's retractions stand and are not repeated here. This round adds none: the
`overrides` absence was never a published number, it was a handover belief with no
ruling behind it, which is why measuring it was possible.

**Every edge type resolves at both ends** against the store's own three resolution
strategies (bare name, `Owner.member` qualified, or the leaf after the first `.`
for a dotted target — `parallel-indexer.ts:2734-2736`). `clean-honesty-gate.ts` over
the 312-file corpus, 30,689 relationships: `references` 9,559 · `contains` 7,730 ·
`exports` 4,937 · `calls` 3,886 · `imports` 1,920 · `uses` 1,457 · `implements` 772 ·
`overrides` 306 · `instantiates` 122 — **0 unresolvable endpoints**, 0 unknown kinds,
0 empty names, 0 members without an owner, 0 crash files. The one type whose targets
are external BY NATURE is `implements`, whose 318 `classNotDeclaredHere` cases are
external because almost every Clean class is imported (`instance Eq Int` names StdEnv's
`Eq`); the analyzer flags each one rather than leaving a reader to infer it.

## Performance (lane formula dimension 9)

Analyzer only (parse excluded), warm, best of 5, measured back to back on the
same machine, **load average disclosed on every row** because the lane formula
(§9, #871/#909) says a row measured under load is unscored rather than evidence:

| | ms/Knode | all five reps (ms) | loadavg |
| --- | --- | --- | --- |
| previous analyzer | 2.64 | 995, 874, 889, 933, 929 | 9.93 |
| **this analyzer** | 5.60 | 2364, 2119, 1942, 1855, 1889 | 8.29 |
| previous analyzer (repeat) | 2.78 | 1113, 1004, 920, 1013, 988 | 8.04 |
| this analyzer (repeat) | 6.42 | 2516, 2136, 2127, 2308, 2207 | 6.85 |

So: **2.2× more time per node, for 2.75× the relationships and 1.31× the symbols.**
Per unit of OUTPUT the two are within ±20% of each other across the size
quartiles, which is the honest way to state it — the new analyzer does not get
faster, it gets more, and the extra output pays for the extra work:

| quartile | nodes | prev ms/Knode | this ms/Knode | prev facts/ms-per-Knode | this facts/ms-per-Knode |
| --- | --- | --- | --- | --- | --- |
| Q1 | 1,954 | 4.79 | 11.40 | 30,452 | 27,151 |
| Q2 | 11,863 | 4.44 | 6.19 | 25,271 | **36,133** |
| Q3 | 45,456 | 2.51 | 5.84 | 33,566 | 30,639 |
| Q4 | 271,806 | 2.51 | 6.71 | **17,620** | 15,074 |

(Q1 is JIT warm-up on 40-node files and is excluded from any claim.)

**Scaling: flat ms/Knode means linear.** Q2 → Q4 is a 22.9× size range and a
24.8× time range — within 8% of linear, with ms/Knode moving 6.19 → 6.71. The
dominant costs are the two tree walks (one name-collection pass and one emitting
pass, down from six) and the per-frame O(1) complexity accumulation that replaced a
per-callable subtree re-walk.

## Hygiene: zero regex, and what it is checked against

`RegularExpressionLiteral` count in the analyzer: **0**, by TypeScript's scanner
(not by a grep — a grep false-positives on every `/**` and `*/`). This is a
stronger and simpler claim than the M49.R2 policy's "no regex doing syntax work",
and it is one a gate can actually verify.
`script/m14/clean-completeness-gate.ts` also fails on: a declared node type in no
bucket, a type in two buckets, a `handled_verified` type the analyzer does not
reach, a `handled_verified` type no fixture exercises, a write-only private field,
an uncalled private method, a no-op ternary, and an empty population (a gate that
read nothing fails).

**Every remaining text operation, classified.** There are 22 call sites of
`slice`/`split`/`indexOf`/`includes`/`startsWith`/`endsWith` in the file, and
they fall into exactly three groups:

| group | sites | what it is |
| --- | --- | --- |
| **positional, on node text** | `unparenthesize` (299-300), quote strip (2534), qualifier split at the first `.` (2547-2548), dot strip (3179), comment-marker strip (3167-3173) | removes or splits at a FIXED offset. No pattern, no alternation, no repetition. These read a node's own spelling where the grammar does not expose a field for it. |
| **array `includes` for dedup** | 1860, 2024, 2314, 2341, 2854, 2861, 2943 | `Array.prototype.includes` on a `string[]`, not string matching. |
| **character predicates on a NAME** | `indexOf("StdEnv")` on an import's module name (738) → sets the `Standard Environment` pattern mark; `startsWith("_")` on an exported name (2607) → Clean's convention that an underscore-prefixed name is not exported | two real semantic rules stated as character tests on a name. This is the M49.R2 "char-scan second" category, and it is declared here rather than left for a reader to find. Both are pinned by fixtures. |
| **line count** | `split("\n").length` (623) | `linesOfCode`. Not syntax. |

Nothing in the file inspects source text to decide what a construct IS. Where a
name is needed, it comes from a grammar field.

The gate is **proven able to fail** on all four defect classes — a spec row dropped,
a spec row claiming an unreachable type, a regex literal planted in code, and a
write-only flag planted — which is the C-PRE pattern from the M12 corpus-claims
gate: a check whose population is empty is itself a failure.

## Fixtures

`validation/m14/fixtures/clean/` — 8 fixtures, all passing under
`bun run script/m14/run-fixtures.ts`:

| fixture | what it pins |
| --- | --- |
| `definition-module-interface.dcl` | the declaration contract, all four `signature_name` shapes |
| `signature-definition-merge.icl` | a signature and its definition are ONE symbol |
| `instance-target-name-collision.icl` | the name-keyed export dedupe |
| `import-modules-alias-884.icl` | a multi-module import's items and alias |
| `expression-shapes.icl` | case / lambda / guard / where / comprehension / record / class shapes, and the qualified-call and pattern-position rules |
| `declaration-forms.icl` | **new.** macro, generic, generic case, derive, special, fixity (both spellings), foreign export, class context, with- and where-locals |
| `qualified-names.icl` | **new.** BOTH qualified-name spellings, and the selective import item list |
| `type-and-expression-shapes.icl` | **new.** the type spine, every pattern shape, every operator spelling, comments, open-subset import markers |
| `typeclass-overrides.icl` | **new in pass 2.** the `overrides` rule: qualified `Thing.show -> Show.show`, two instances of one class at two site lines, and three FORBIDS — an instance member absent from the class's member set (`Bool.size`), the reversed direction (`Show.show`), unqualified endpoints, and the polymorphic-instance self-edge (`Sized.size`) |
| `extends-probe-roles.icl` | **new in pass 3, and it is TWO fixtures in one file.** (a) `extends-probe-roles.expectation.json` grades the ANALYZER: the operator-named-class spelling correction in both directions — `implements Thing -> ==` with `meta.isExternalClass: false`, `overrides Thing.>>= -> >>=.>>=`, and a FORBID on `meta.isExternalClass: false` for `implements Thing -> Eq` so the flag cannot be made constant — plus a FORBID on **any `extends` edge**, which is what convicts a future edit that relabels a dictionary requirement as a supertype. (b) `extends-probe-roles.probe.json`, checked by `extends-probe-roles-check.mts`, grades the RULING CENSUS: all six roles, 18 declarations, 23 (declaration, child) pairs, 0 unclassified, 0 ERROR, 0 MISSING |

Both halves exist because neither alone is load-bearing. The analyzer rows cannot see the
census's slot table, and the census rows cannot see a metadata flag; a fixture that carried
only one of them would let the other rot. `extends-probe-roles-check.mts` imports
`censusCleanDeclarations` from `script/m14/clean-ruled.ts` rather than reimplementing it, so
it cannot pass against a probe the arbiter does not run — and it reads a `.probe.json` beside
the fixture rather than a `.expectation.json`, because `runLang` grades expectations against
the analyzer's output and this asserts something the analyzer does not produce.

`script/m14/run-fixtures.ts --lang clean`: **11 pass, 0 fail** (10 in pass 2).
`npx tsx validation/m14/fixtures/clean/extends-probe-roles-check.mts`: **PASS**, 18
declarations, 23 pairs, 0 unclassified.

The three new fixtures exist because the F6 obligation ("every `handled_verified`
type is exercised by a fixture") was not met: 11 of the analyzer's handled types
had no fixture at all, so a claim in the spec had nothing behind it. All 99
handled types are now fixture-backed, and the gate says so on every run. The count is
**102** at the current pin, not the 99 recorded above; see
[Figures that moved](#figures-that-moved-and-why).

### Mutation (L4), and the wiring it needs

`script/m14/clean-mutants.ts` defines **9 mutants**: seven for the `overrides` type, one
per way it can be wrong — dropped entirely; emitted without the in-file guard
(fabrication); emitted with the direction reversed; emitted with unqualified endpoints
(which every resolution rate still reports as clean); emitted as a self-edge; relabelled
`implements`; emitted without its site line — and **two added in pass 3** for the
operator-named-class spelling correction, which are a different defect class from all
seven:

| mutant | what it reverts | how it fails |
| --- | --- | --- |
| `clean/operator-class-declaration-spelling-only` | `classMembers` keyed on the declaration's `name` field verbatim | the `overrides` edge for a same-file operator-named class is **dropped** — a count that goes DOWN, not wrong |
| `clean/implements-external-class-always-external` | `isExternalClass` to the bare lookup alone | **no count moves at all**; one metadata field is false on 24 corpus edges |

They are executed by `script/m14/clean-mutant-run.ts` through the shared suite's own
`runLang` and judged by the shared harness's own rule (`mutate-analyzer.ts:18870`):

```
clean mutant runner — 9 mutants
baseline for clean: pass 11  fail 0  problems 0

CAUGHT   clean/overrides-dropped                      fail 0 -> 2  problems 0 -> 6
           newly failing: clean/extends-probe-roles, clean/typeclass-overrides
CAUGHT   clean/overrides-in-file-guard-dropped        fail 0 -> 1  problems 0 -> 1
CAUGHT   clean/overrides-direction-reversed           fail 0 -> 2  problems 0 -> 8
CAUGHT   clean/overrides-endpoints-unqualified        fail 0 -> 2  problems 0 -> 7
CAUGHT   clean/overrides-self-edge-guard-dropped      fail 0 -> 1  problems 0 -> 2
CAUGHT   clean/overrides-relabelled-as-implements     fail 0 -> 2  problems 0 -> 6
CAUGHT   clean/overrides-site-line-lost               fail 0 -> 2  problems 0 -> 5
CAUGHT   clean/operator-class-declaration-spelling-only   fail 0 -> 1  problems 0 -> 1
           newly failing: clean/extends-probe-roles
CAUGHT   clean/implements-external-class-always-external  fail 0 -> 1  problems 0 -> 3
           newly failing: clean/extends-probe-roles

caught 9/9
every mutant made the suite red
```

The new fixture also catches **5 of the 7 pre-existing `overrides` mutants**, which
previously failed `typeclass-overrides` alone. That is a coverage gain nobody planned and
it is worth recording: a fixture written for one defect turned out to be a second
independent witness for four others, because both are about the same three properties —
qualified endpoints, instance-member → class-member direction, and a member set that
exists.

**These mutants are NOT yet run by the shared F4 gate.** `script/m14/mutate-analyzer.ts`
does not import `./clean-mutants`, and the file's own header records why a lane keeps its
mutants out of the shared registry: a 259-line block written into
`script/m14/fsharp-mutants.ts`'s registry was overwritten within the hour, silently, and
the file stayed syntactically valid so the gate kept reporting numbers with that lane's
mutants simply absent. This file must not be read as a claim that the F4 gate covers
them. The wiring is two lines in `script/m14/mutate-analyzer.ts`:

```ts
import { CLEAN_MUTANTS } from "./clean-mutants"
// …and inside `export const MUTANTS: Mutant[] = [ … ]`:
  ...CLEAN_MUTANTS,
```

## Known limits, stated

0. **30.1% of real Clean files do not parse under the pinned grammar.** 655 of the
   2,179 wide-corpus files contain at least one ERROR node (25,683 in total), from
   the compiler's `<<@` directive, the `import code from` FFI form, `*`-parameter
   synonyms, mixed-arity class contexts, several names before one `::`, and nine
   other sampled shapes (`clean-census.ts` reports the line; the shapes are in the
   review). This is a grammar limitation and it caps the whole lane: for nearly a
   third of real Clean the analyzer reasons about a damaged tree. Every percentage
   in this document is a percentage OF WHAT PARSED.
1. **`index_access` emits nothing** (2,823 corpus sites) — spec gap `CL-G1`. An array
   index is a real operation on the indexed value's type and the analyzer does not
   know that type. Naming the receiver's NAME would be a `uses` edge to a value,
   which is the FP family the lane forbids. Recorded, not ruled.
2. **An uppercase applied name that is not an in-file data constructor emits no
   edge** — the 24,986-site row above. Those sites are counted apart by how much the
   analyzer knows: **19,365 it cannot classify** (`declinedInstantiations`) and
   **65 it can** (`typeCoercions` — an application whose head is a declared type,
   i.e. Clean's coercion). An earlier version of this document quoted 1,049 as one
   number at the 312-file scale, which conflated the two and understated the
   population thirteenfold.
3. **`?Just 0` in a body is an ERROR in the pinned grammar**, so the unboxed BUILD
   direction has no readable spelling and is unreachable (ruling `CL-D8`); the
   unboxed PATTERN direction is handled.
4. **An uppercase record field name breaks the grammar** — `:: Config = { Diagnostic
   :: !Bool }` parses with the `{` as an ERROR, the field as a `data_constructor`
   and the field's own `:: Bool` as a second `type_definition`. The corpus avoids
   it by convention (record fields are lowercase), and the fixture that would have
   pinned it was rewritten rather than enshrined.
5. **`from M import :: (Ok)` — a subset with no name in front of it — is
   unreadable**: the grammar ends the declaration at the `::`, emits an `identifier`
   with EMPTY text, and re-reads `(Ok)` as a `type_signature` taking the next line
   with it (`CL-G5`).
6. **A `where_block`'s extent runs to the next DECLARATION**, and a comment written
   at column 0 after an indented `where` body is absorbed INTO that block. A blank
   line does not close it. A declaration between the two is required, which is what
   the corpus does and what `afterWhere` in the fixture does.
7. **The M14.0.F5 differential is red on this lane** (527 MISSING on the Clyde
   draw, 49 on clean-stdlib) for the reason in the 24,986-site row. The oracle is
   shared (`script/m14/differential.ts`) and was not modified.
8. **`overrides` is emitted but has no oracle, so the differential calls all 45 sampled
   edges fabrications.** The harness prints `COMPARED WITH NO TRUTH: overrides` and its
   own message names that state "a confident fabrication". They are not — the Q4 probe
   verifies every `overrides` target is a real `class_member` in the same file — but the
   differential cannot know it, because `deriveCleanEdges` derives no `overrides` rows.
   Implementing the type made this lane's differential **redder**. The oracle is shared
   (`script/m14/differential.ts`) and was not modified; the derivation needed is written
   out in [DERIVATION findings](#derivation-findings-4).
9. **Four of the lane's types are compared against nothing**: `contains`, `exports`,
   `imports`, `uses` — **118,723 edges, 50.8% of the payload**. The DERIVATION count is
   4 and the four types are named; what is missing is four oracles in shared
   `script/m14/differential.ts`, each specified in
   [DERIVATION findings](#derivation-findings-4).
10. **`extends` is audited by name only.** The differential's clean audited set lists
    `extends`, and `deriveCleanEdges` derives none, so the type compares 0/0 and agrees
    with itself. That is the structural defect class `ontology-coverage-gate.ts` exists
    for, and it is invisible precisely because both sides are empty.
11. **The `overrides` in-file guard leaves 454 measured instances unexpressed.** The
    corpus-wide pairing is 1,036 occurrences across 78 classes; the analyzer emits 582.
    The 454 difference is instances whose class is declared in another file. That gap is
    deliberate (see the guard's rationale) and is a LIMITATION of the graph, not a
    rounding error a reader should assume away. **Pass 3 qualification**: part of that 454
    was a spelling mismatch rather than a cross-file class, and pass 3 recovered **0** of
    it on the corpus — because the corpus spells its operator-named classes on one line,
    which gives the member set nothing to read. The recovered count would be **0** here
    and non-zero only in a file using the `where` form, which is why
    `clean/extends-probe-roles` exists. The 454 is therefore still 454, and the reason is
    now a measured fact rather than an assumption.
12. **11 instance `Class` symbols across 3 files are named after a TYPE EXPRESSION rather
    than an identifier.** `instance Array {#} {#.a}` (`clean-core/Sources/_SystemArray.icl`
    L189), `instance Array {#} {!.a}` (L233), `instance Show {!a}` /
    `instance Eq {!a}` / `instance Ord {!a}` / `instance Appendable {!a}`
    (`Data/Array/Strict.dcl` L18-23) and the four `{!e}` instances in `Strict.icl`
    L7-13 all publish a symbol named `!a`, `!e`, `.a` or `!.a`. `instanceTargetName`
    strips the braces and returns the annotated type's text. Rows stay distinct because
    the store keys on `fileId:name:lineStart`, so nothing collides in the store — but
    **`_SystemArray.icl` declares TWO different instances that both name `.a`** (L189
    `{#.a}` and L277 `{.a}`), so their `contains`, `implements`, `exports` and
    `overrides` edges are ambiguous to any resolution that matches on `qualifiedName`.
    Pre-existing (the "253-defect" family), **not fixed here**, and reported: the fix
    requires deciding what such an instance should be called, which is a naming decision
    this lane has not made.
13. **A polymorphic instance's members share the class member's `qualifiedName`.** With
    `instance List [] a where _cons …` and `class List a where _cons :: …` in one file,
    both members carry `qualifiedName: List._cons` while the store keeps them as
    distinct rows (distinct `lineStart`). This is why 60 self-edges had to be refused
    rather than emitted. The same family as the 42 where-locals that shadow their own
    frame. **Not fixed here**, and reported.
14. **The pinned wasm parser crashes on real Clean files.** `[BB-PARSE-ERR] memory
    access out of bounds` was observed on at least four distinct corpus files across
    this round's runs — `clean-libraries/Libraries/Gtk/gtk_tree_model.icl`,
    `clean-libraries/Examples/ObjectIO/…/Life.dcl`, `Prelude/Data/List.dcl` and
    `Prelude/Data/List.icl`, the last two in the MAIN corpus. A separate
    `[BB-HANG] parser stuck 120s` watchdog fires on a different file per run under load,
    which is the measured cause of this document's 0.03% run-to-run drift. Not a lane
    defect; a parser-robustness finding for whoever owns `wasm/tree-sitter-clean.wasm`.
15. **An operator-named class still resolves under only one of its two spellings outside
    this file.** `isLocallyDeclaredOperatorClass` and the honesty gate's `classNames` both
    correct the BARE→parenthesised direction, because that is the direction the corpus
    produces (a declaration parenthesised, an instance bare). The reverse — a file that
    declares `class ==` bare and is instanced as `class (==)` — is not attempted, because
    no corpus file produces it and a fix for an unobserved direction would be a claim
    without a measurement. Both call sites are guarded so the untried direction cannot
    produce a false positive, and `class (===)` coexisting with `class ===` in one file
    resolves to the declaration that actually spells each name.
16. **The differential's oracle is a second walker over the SAME grammar**, so a grammar
    bug in both paths is invisible to it. With 30.1% of real Clean files not parsing
    (limitation 0), that is not a theoretical caveat: it is the largest single blind spot
    on this lane, and no amount of differential testing closes it.

## Two claims this document does NOT make

- It does not call the analyzer L5-verified. The honesty contract's L5 requires L2 ∧ L3
  ∧ L4 with fresh evidence; **L4 is not met at the shared gate** (limitation under
  [Mutation](#mutation-l4-and-the-wiring-it-needs): 7 of 7 mutants are caught by the
  lane's own runner and 0 by the shared F4 gate, which does not import them), and L3 is
  red on this lane for the `instantiates` row and the `overrides` no-oracle row. The
  strongest defensible statement is **L1 (fixture-passed) with L3/L4 evidence produced
  and named but not admitted by the shared harnesses**.
- It does not claim the graph is exhaustive. 4 types carry 0 oracle coverage, `extends`
  is compared against nothing, and the `overrides` in-file guard withholds 454 measured
  instances. Those are stated above with their counts.
