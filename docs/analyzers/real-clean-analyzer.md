# real-clean-analyzer.md

> **Status (2026-09-28, M14.0 clean-completeness round).** Rebuilt from 864 lines to
> 3,000+ against an exhaustive census of the pinned grammar. Every number in this
> document is measured over the 320-file Clean universe on this machine and every
> claim is re-runnable. The round's findings, with their evidence, are in
> `reviews/clean/m14-0-clean-completeness.md`.

## Language

- Analyzer file: `src/ast/real-clean-analyzer.ts`
- Parser: `tree-sitter-clean` **v1.2.7** (authored by the project owner; pinned
  `wasm/tree-sitter-clean.wasm` rebuilt from `tree-sitter-clean@302fb5d0` release
  v1.2.7, adopted 2026-09-25 — `reviews/m60-clean-grammar-127-adjudication.md`).
  The pin is recorded in `validation/m14/grammar-pins.json` (sha256 `9ea8525dcb…`,
  6,743,856 B; round record `reviews/functional-family/m60-grammar-pins.md`): npm's
  `tree-sitter-clean@1.2.7` publishes `grammar.js` / `scanner.c` / `grammar.json` /
  `node-types.json` but **no wasm**, so the wired bytes are not claimed to be
  hash-matched to a published artifact.
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

| | count |
| --- | --- |
| Clean files measured (312-file corpus + 8 fixtures) | 320 |
| **Clean files in the WIDE corpus** (`clean-wide-manifest.txt`) | **2,179** |
| AST nodes over the 312-file corpus | 331,079 |
| **AST nodes over the 2,179-file corpus** | **3,107,410** |
| **files the pinned grammar parses with no ERROR** | **1,524 of 2,179 (69.9%)** |
| distinct node types the grammar declares | 185 (139 named slots → **137** distinct named names) |
| named types occurring in the corpus | **137** (all of them) |
| named types the analyzer HANDLES, each fixture-backed | **99**, and all 99 occur in CORPUS code |
| named types classified `internal_silent` | 29 |
| named types in a `gap` | 1 |
| named types in a `design_decision` | 8 (+11 further rulings recorded against types already in a behaviour bucket) |

The three declared named types that never occur in the 320-file universe are
`lazy_pattern`, `unit_pattern` and `qualified_identifier`. All three are pinned by
fixture instead: the first two by `declaration-forms.icl`, the third by
`qualified-names.icl` — which is the only reason `qualified_identifier` is
`handled_verified` rather than unclassified.

The previous version of this analyzer named **35** of those 137. The 100 it did not
name covered **81,531 corpus sites** — the whole generic machinery, every macro,
every class context, the record-field access graph, the selective-import lists,
the where-locals, and every type reference in the corpus. That is the gap this
round closed, and the review lists each piece with its size.

## Grammar tree shape (as pinned, v1.2.7)

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

**Every relationship carries a 1-based `line_number` on the name-bearing node,
per-site and not per-set** (30,558 of 30,558). The line is part of the DEDUPE
KEY, so a function called from three lines is three edges at three lines, and a
line that is not a positive integer is recorded as ABSENT, never as 0 (M59.O2).

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

| | before | after |
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

**Every edge type is 100% resolvable** against the store's own three resolution
strategies (bare name, `Owner.member` qualified, or the leaf after the first `.`
for a dotted target — `parallel-indexer.ts:2734-2736`), and **every edge type is
100% semantically provable** except `implements`, whose 322 external-class cases
are external because almost every Clean class is imported (`instance Eq Int` names
StdEnv's `Eq`). The instrument is `script/m14/clean-honesty-gate.ts`.

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

The three new fixtures exist because the F6 obligation ("every `handled_verified`
type is exercised by a fixture") was not met: 11 of the analyzer's handled types
had no fixture at all, so a claim in the spec had nothing behind it. All 99
handled types are now fixture-backed, and the gate says so on every run.

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
