# real-cpp-analyzer.md

## Language

- Analyzer file: `src/ast/real-cpp-analyzer.ts`
- Parser: `tree-sitter-cpp`, **a LOCAL FORK of upstream 0.23.4** — not the npm
  package. The fork is vendored at `grammars/tree-sitter-cpp/` and is
  byte-pinned: `validation/m14/grammar-pins.json` records the wired wasm's
  sha256 + length, the enumerable node surface, and a per-file sha256 for every
  vendored source file; `script/m14/verify-grammar-pins.ts` re-measures all of it
  and fails on any drift. Re-runnable:

  ```bash
  bun script/m14/verify-grammar-pins.ts
  ```

  The fork exists for upstream issue #743 and carries three rules upstream 0.23.4
  does not have — `macro_prefixed_type_specifier`, `macro_specifier`, and
  `preproc_header_name` (3 named types, 0 fields). The patches are load-bearing
  rather than cosmetic: the fork parses **22 of this lane's 28 fixtures clean
  where upstream 0.23.4 parses 20**, and the two it rescues
  (`preproc-has-include.cpp`, `macro-decorated-specifier.cpp`) are the ones whose
  symbols would otherwise be lost. Measured by
  `script/cpp-review/grammar-provenance.ts`; the full record, including the
  byte-identity ledger against the npm tarball, is `grammars/tree-sitter-cpp/PIN.md`.
  (This section previously said "0.23.4 (npm, latest)", which was false: the
  wired wasm was never the npm bytes, and the byte lengths of the two differ by
  ~118 KB.)
- Grammar shape (as walked):
  `translation_unit` →
  `namespace_definition`/`class_specifier`/`struct_specifier`/
  `enum_specifier`/`template_declaration`/`function_definition`/
  `field_declaration`/`declaration`/`alias_declaration`/`preproc_include` tree;
  `class_specifier` → `type_identifier` + `class_body`; `function_definition`
  → `declarator` (→ `qualified_identifier` with `namespace_identifier`/
  `type_identifier`/`template_type` scope chain) + `compound_statement`;
  `call_expression` → `function` (→ `field_expression`/`qualified_identifier`/
  `template_function`) + `arguments`)
- Language detection: `.cpp`/`.cc`/`.cxx`/`.hpp`/`.hxx` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealCppAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (pure-String helpers, no regex — see Regex inventory,
  which now means it).

## The defect gate (read this first)

`validation/m14/results/cpp-defect-register.json` — **1,722 real C++ files**
(fmt, nlohmann-json, Catch2, abseil-cpp, spdlog, zig; 45,710 symbols,
238,205 relationships). Re-runnable:

```bash
BB_CORPUS_ROOT=$HOME/ishaq/fixtures/repositories \
  bun run script/cpp-review/defect-register.ts     # exits non-zero on any gated class > 0
```

Every class states the CONTRACT it breaks, and asserts on what the analyzer
**publishes** — not on a tree shape, because a shape can be present and correctly
handled. Eight gated classes, all at **0**:
handled. Seven gated classes, all at **0**:

| class | the contract | was | now |
|---|---|---|---|
| **D1** | C++ has no identifier spelled with a keyword ([lex.name]), so such a name resolves to nothing — as a `calls` target, a `uses` target, or a symbol name | 6,940 | **0** |
| **D2** | a class cannot inherit from itself, and the namespace qualifier is the whole information content of a C++ inheritance edge | 49 | **0** |
| **D3** | one edge per pair for `contains`/`references`, where many sites express one fact | 928 | **0** |
| **D4** | a declared name is not a type; when the grammar's recovery displaced the declarator, the name is in the adjacent `ERROR` | 10 | **0** |
| **D5** | C++ has no nested function definition, so a `function_definition` inside a body is a local direct-initialization | 792 | **0** |
| **D6** | the analyzer's own source uses a regex, while this doc claimed zero | 2 | **0** |
| **D7** | a specifier's name arrives as a `qualified_identifier`, so the class publishes as `anonymous` | 48 | **0** |
| **D8** | a trailing annotation macro decorates the declaration before it and declares nothing; the grammar recovers it as a second `function_definition` whose BODY is the real declaration's, so publishing it invents a member AND misattributes the body's reads to a macro. A test-macro `TEST(Suite, Name) { body }` heading is the opposite case and is **not** this defect | 20 | **0** |

Issues: [#957](https://github.com/backbencher-hq/backbencher-brain/issues/957) (D1),
[#958](https://github.com/backbencher-hq/backbencher-brain/issues/958) (D2),
[#959](https://github.com/backbencher-hq/backbencher-brain/issues/959) (D3),
[#960](https://github.com/backbencher-hq/backbencher-brain/issues/960) (D4),
[#961](https://github.com/backbencher-hq/backbencher-brain/issues/961) (D5),
[#962](https://github.com/backbencher-hq/backbencher-brain/issues/962) (D7).
Registered before worked, per M60 R3.

## What the gate does NOT cover, and one class that used to be invisible

**The differential audits 82.6% of the output.** The label set it compares for cpp is
`calls, uses, extends, implements, instantiates` — `overrides` is excluded for cpp by
name, `contains` is audited only for perl/xml, and `references` is in neither list.
`script/cpp-review/coverage-share.ts` measures the remainder: **41,408 of 238,205 rows
(17.4%)** — `contains` 27,587, `references` 13,321, `overrides` 500 — sit inside the
lane's "100% covered" and are not examined by it. The D3 work (928 duplicate
contains/references rows) was in exactly that unexamined region and was found by a
separate probe.

**D1–D6 are all fabrication-shaped — too much output — so none of them could see a
MISSING symbol, and neither can the differential**, which compares the analyzer against
an oracle written from the same reading of the same grammar. A shared blind spot
cancels out of every count; that is how the CPPD15 self-agreeing `uses num_bits`
survived a year of gates, and it is why the 100% coverage number was, in part, a
measurement of the defect: `fmt:cpp` truth was 4,600 with ~5,500 keyword call targets
inside it, and both sides agreed.

`script/cpp-review/loss-census.ts` asks the complement — for every declaration the
grammar hands over at file/namespace/class scope, is there a published symbol? — and
found **D7**. It is the first loss class, and the gate for it is the first one that had
to be written to run against a broken analyzer: the first cut imported the analyzer's
own `specifierDeclaredName`, and its self-test died with *"Export named
'specifierDeclaredName' not found"* instead of reporting a violation. A check that
cannot load against the code it gates has not proved it can fail, so D7's legibility
test is stated in the register itself, as the five-line contract it is, while the
analyzer implements it in the two exported helpers. Against the pre-fix analyzer the
gate reports `D7: 22` and `pass: false`; against the fixed one, 0.

## M60.P1 — the payload this document used to describe and the analyzer never emitted

Three rows in the symbol contract above (`parameters`, `returnType`,
`decorators/attributes`) were marked ✅ for this lane while the analyzer produced
none of them. `script/m60/payload-matrix.ts` had already recorded all three as
**dead emit cells**, so the repository was holding two contradictory artifacts and
the documentation was the one a reader would believe. There were two further
silent defects behind the first of them:

- **The parameter type was sliced at the wrong node.** The `type` is the
  declaration-specifier, which *includes* the `*`/`&`/`&&` that belong to the
  declarator's own prefix. A `reference_declarator`'s text is `& name` and its
  start index points at the `&`, so the natural-looking
  `param.text.slice(0, param.text.length - declarator.text.length)` publishes
  `const std::string` for `const std::string& name` and `const char` for
  `const char* format`. Those are not display slips: they are *different C++
  types that overload differently*, and the identical slice is the
  override-matching key in `buildParamSig`, where it made `virtual void
  f(Widget&)` and `virtual void f(Widget)` hash to one signature and let a
  derived `void f(Widget)` match the base's `f(Widget&)`. The rule is now one
  rule, taken at the parameter's NAME node, and it is pinned from both
  directions: `expectParameters` states the exact type (`const std::string&`),
  `forbidParameters.types` states that the parameter's own name may never appear
  in its type field.
- **Defaulted parameters are a different node.** In this grammar
  `int a` is a `parameter_declaration` and `double scale = 1.0` is an
  `optional_parameter_declaration`. A walk that reads the first node type alone
  looks correct on every undefaulted signature and silently loses every defaulted
  parameter in the corpus. A default is also deliberately NOT pre-bound: it is
  read by the walk-order declaration-position rule at its own node, because for
  `void f(int a = b, int b = 1)` the first default legitimately reads an *outer*
  `b`, and pre-binding would move the binding earlier than the declaration and
  change a flow-sensitive answer.

**Why no existing gate could see this.** D1–D6 are fabrication-shaped and D7 is the
first loss class, but all seven are symbol/edge classes — a symbol can be
perfectly named, correctly owned, and still carry an absent payload, and neither a
symbol count nor an edge assertion can notice. The differential cannot either: an
oracle written from the same reading of the same grammar never asks for the field,
so the blind spot is symmetric and cancels. The six mutants added with this work
are all `payload-loss`, and all five are caught by the one new fixture
`cpp/m60-signature-payload`; the fixture also fails on each of the four arms
independently, which is what makes them regression gates rather than documentation.

**The shared matrix, re-measured, confirms this — and one of its own defects is worth
recording here.** Run it with `bun run` (see below), and cpp dead emit cells go
**15 → 12** with `parameters`, `returnType` and `decorators` alive.

`script/m60/payload-matrix.ts` guards its entry with `if (import.meta.main) main()`,
which is correct — an unguarded call would make every future *import* rewrite its
committed artifact from whatever tree is checked out — but `import.meta.main` is a
**Bun** property, and the file's own header says `npx tsx script/m60/payload-matrix.ts`.
Under tsx the guard is falsy: `main()` never runs, the script prints nothing, and it
**exits 0**. I read the committed artifact, concluded this work had not landed, and was
wrong; the artifact was stamped `00:18:25Z` / commit `06ef6e7a` against a HEAD of
`0da6ea37`. A gate that exits 0 having done nothing is worse than one that fails.

Two cpp cells remain **falsely** dead, both stale needles rather than defects:
`isStatic` is looked for as `/\bisStatic\s*:/` while the analyzer uses JS **property
shorthand** (`isStatic,`), and `qualified_calls` is looked for in a `key:` form it is
never written in — yet both fields are genuinely published. A needle blind to property
shorthand is a systematic blind spot for any lane written in idiomatic TS, so this is
worth more than the two cells. The remaining dead cells are correct, including `from`/`to`
(for which cpp emits `source`/`target`/`fromSymbol`/`toSymbol` — all four verified
populated, rather than assumed). The matrix is a shared artifact and re-pointing its
needles is another lane's call; measured key sets for this lane are recorded in
`reviews/cpp/m60-payload-2026-09-29.md`.

## D8 — a trailing annotation is not a declaration

A thread-safety annotation written after a parameter list decorates the declaration in
front of it and declares nothing:

```cpp
virtual int current_value(Widget& w) const GTEST_LOCK_EXCLUDED_(mutex_) {
  ++reads_;
  return w.value();
}
```

The grammar ends the declaration at the `)` and recovers a **second**
`function_definition` whose declarator is the annotation and whose **body is the real
method's**. The analyzer published that as a member — measured as
`GTEST_LOCK_EXCLUDED_(mutex_)` with `expandedFrom: "macro-heading"`, 20 sites in one
bundled gmock file, 424 macro-named symbols over 13,753 files — and attributed the real
body's reads to the macro.

The suppression has **two halves**, and the second is the one that is not obvious from
the symbol set: the stolen body is a separate `compound_statement` node and reaches the
macro-declared-body branch on its own, so even with the phantom symbol gone, every read
in the real method's body was still owned by a macro. Both are suppressed; the body's
statements are then walked with the enclosing owner, which is worse than the real
method but strictly better than a macro.

**Four rules were written for the discriminator and three were wrong.** That is the
useful part of this section, because each failure deleted real symbols:

| rule | why it failed |
|---|---|
| the annotation's parameters are typeless | its argument is an *expression* — `internal::g_gmock_mutex` is spelled exactly like a parameter that has a type |
| the body is empty | it is not; the node **carries** the real body |
| the previous named sibling is a `declaration` | `prevNamedSibling` is `null` throughout this grammar, and by index a real `TEST` that follows a function declaration looks identical — **this deleted every gtest heading** |
| skip comments while scanning backwards | the scan meets the comment's **text** before its `//`, so a comment ending in a letter read as a continuation — **this deleted 20 headings in one file** |

What holds: the character before the macro, ignoring whitespace, is the end of a
parameter list or a declarator suffix (`)` `&` `>` `*`), or the tail of a trailing
keyword (`const`, `noexcept`, …) — and **no comment intervenes**. `TEST` is itself
spelled in all caps, so no rule that asks only "is the name a macro" can separate the
two families; only the position can.

Gated by `cpp/m60-annotation-macro` and three mutants. The third mutant is a
**control** — `cpp/d8-test-heading-deleted` — because a gate that only ever runs in the
under-firing direction proves nothing about the direction that costs symbols.

**The differential cannot see any of this.** `fmt:cpp` and `nlohmann-json:cpp` return
byte-identical hashes before and after the fix (`e8c749775f13e5e9`, `423635986f0058f9`),
because the affected files are not in the 60-file draws. That is the same both-sides
blind spot as CP1: the oracle is written from the same reading of the same grammar and
never asks whether a symbol's name is a declaration's name at all. The complement
question is what found it — `script/cpp-review/macro-name-census.ts`, which asks of
every published name whether it is a declaration's name *and* not a macro's.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | namespace `namespace_identifier`; class/struct/union `type_identifier` (or the `template_type` base name, CPPD1); function/method declarator identifier (last named child of `qualified_identifier` for out-of-line `Class::method`); constructor normalized to `constructor`; member `field_identifier`/`identifier`; `using` alias `name` field; macro name; enumerator identifier. **Every one of these is gated by `isCppSpelledName`** — a declared name is an identifier, and a keyword declarator is a macro or a damaged region, never a declaration. |
| kind | ✅ | namespaces → `namespace`; classes/structs with bodies → `class`; `enum class` → `enum` (members → `enum_member`); methods (declarations + out-of-line definitions, incl. template `Registry<T>::add`) → `method`; constructors → `constructor`; members → `property`; `using X = ...` aliases → `type`; object-like macros with value bodies → `constant`; file-scope static vars → `variable` (private, internal linkage) |
| qualified/container name | ✅ | `ownerName` = enclosing namespace/class via scope stack (out-of-line definitions use the explicit `Class::` scope; template `Registry<T>::add` resolves through the `template_type` scope node); visibility from access specifiers (`public:`/`private:`/`protected:`). **A function is never an owner** except for a local `class`/`struct`/`enum`, which has members that need one. |
| range (start/end line + column) | ✅ | the declaration/definition node |
| parameters | ✅ | function declarator `parameter_list` → `name`/`type`/`defaultValue`/`isOptional` on method/function/constructor symbols. **M60.P1: this row was a FALSE CLAIM until this milestone** — the field was never produced, and `UniversalSymbol.decorators`/`returnType` sat as DEAD emit cells in `script/m60/payload-matrix.ts` while this table said ✅. Two rules make the values correct rather than merely present, and both are pinned by `cpp/m60-signature-payload` and by six mutants: **(1) the type slice stops at the parameter's NAME node, not its declarator** — a `reference_declarator`'s text is `& name` and its start index points at the `&`, so slicing at the declarator publishes `const std::string` for `const std::string& name`, a *different C++ type that overloads differently* (and the same slice is the override-matching key, so `f(Widget&)` and `f(Widget)` hashed alike); **(2) a defaulted parameter is a DIFFERENT node** (`optional_parameter_declaration`), so reading only `parameter_declaration` silently drops every defaulted parameter in the corpus. A variadic `...` is deliberately NOT a parameter — it has no name and no type, and the family shape has no slot for it. |
| returnType | ✅ | the declaration's `type` field, EXCEPT for a deduced return type: `auto f() const -> std::string` has `type` = `auto`, so the real type is read from the `trailing_return_type` **child** of the declarator (measured shape: `function_declarator [trailing_return_type [->, type_descriptor]]`) — it is a child, not a field, and `childForFieldName` returns null for it. M60.P1: absent before this milestone. **Where `auto` is still published, it is the honest spelling, and that is a measured distinction rather than a leftover:** the trailing return type gives the type only when the author WROTE one. 95 corpus symbols spell a bare deduced return with no `->` at all (e.g. `auto UnpackStructImpl(const T& t, MakeIndexSequence<3>, char) { … }` in fmt's bundled gmock, 12+ of them in one header), and there the declared type genuinely *is* `auto` — the real type is deduced from the return statement in the body, which this analyzer does not evaluate and must not guess. Publishing `auto` there is truthful; publishing it for a written `-> std::string` is a name that resolves to nothing. |
| documentation/comments | — | n/a (C++ comments not extracted as doc) |
| complexity metrics | ✅ | memory-safety score (smart pointers `std::make_unique`/`std::make_shared` boost, raw `new`/`delete` penalize); patterns (`auto`, `lambda`, `constexpr`, RAII, smart pointers); framework detection (Qt/STL/Win32) from `#include` patterns — pure-String scans |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | M60.P1: the declaration's modifiers as their **source spellings, in source order** (`["static", "constexpr"]`), on BOTH the function branch and the field/variable branch — `static constexpr int kMax = 2;` carries as much modifier information as `virtual double area() const = 0;`, so a field that answers for one and not the other is a field a consumer cannot rely on. The scan matches a child by TEXT and EXCLUDES the declaration's own payload fields (`type`, `declarator`, `default_value`, …), **not** by `isNamed`: the grammar is inconsistent and both forms occur in this lane's own fixtures — `virtual` is an unnamed token on a method, while `static`/`constexpr` are NAMED `storage_class_specifier`/`type_qualifier` wrappers on a field, and an `isNamed`-only rule finds the modifier on the method and misses it on the field. `override`/`final` are `virtual_specifier`s, a level below the declaration, so they need the second lookup. A destructor and an operator overload are deliberately absent: `~File` and `operator==` are part of the NAME, not modifiers applied to it. `isPureVirtual`/`isAbstract`/`isTemplate` remain separate metadata flags. |

## Relationship ontology

The engine's `RelationshipType` carries **10 distinct values**. This lane emits
**7** of them as relationships. All 10 are listed, because a consumer reading the
table must be able to tell "C++ has no such construct" from "the analyzer forgot",
and the first version of this table did not: it marked `imports` and `exports` as
emitted (they are **not** relationships for C++ — they are separate
`ImportInfo[]` / `ExportInfo[]` payload) and omitted `implements` entirely.
`script/cpp-review/relationship-ontology.ts` asserts that every value the engine
carries appears below, and which of them the analyzer emits.

| Relationship type | Emitted as a relationship? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ 27,558 | REAL container ownership: namespace→class/enum/alias, class→method/property/constructor, enum→member, and function→local `class`/`enum` (a local type has members and needs an owner). Never `global contains X`. **D3: one edge per `(owner, name)` pair** — the overloads stay SYMBOLS, only the duplicated edge is dropped. | 1.0 |
| references | ✅ 13,321 | include dependencies (`global → header` from `#include <...>` / `#include "..."`, pure-String `stripIncludeChars` unwrap) and `using`-dependencies. **D3: one edge per module**; the `imports` array still receives every occurrence, because a count and a dependency are different things. | 1.0 |
| uses | ✅ 16,071 | three positions, all gated by `isCppSpelledName` (D1): bare value reads (CP1, resolution via the file-scope/namespace/class roster) and non-call field access (`a.b` / `ptr->field`). Field expressions that are the function of a call skip the uses walk — the `calls` edge is the fact. | 1.0 / 0.9 |
| calls | ✅ 179,268 | `call_expression` → callee leaf, unwrapped through template/dependent/parenthesized wrappers; source = enclosing method/function. `calls` is deliberately **not** deduplicated: two call sites are two facts, each with its own M59.A7 `line_number`, and the C/TypeScript/Java lanes emit both. | 1.0 |
| extends | ✅ 1,047 | `base_class_clause` → base name. **D2: a base whose cleaned leaf equals the derived class's own name is refused** — `char_traits : std::char_traits<T>` is real inheritance from a *different* class, and the leaf clean had discarded the only thing that said so. | 1.0 |
| instantiates | ✅ 407 | `new_expression` → constructed type | 0.9 |
| overrides | ✅ 500 | base-class virtuals tracked in-memory, resolved transitively with a depth cap, signature-aware (parameter TYPES only, CPPD5/CPPD11), self-base guarded (D2) | 0.9, `reasonCode: "signature-match"` |
| **implements** | ❌ **never emitted** | C++ has no separate interface construct: interface satisfaction IS inheritance, and inheritance is emitted as `extends`. There is no `implements` keyword, no `implements` clause, and no distinct base-class list to read. Emitting it would mean inventing a distinction the language does not make. | — |
| **imports** | ❌ **never as a relationship** | Carried as `ImportInfo[]` payload, not as an edge: `module` + `items[]` + `range` + `isImport`/`isSystemInclude`/`isUsingDeclaration`. The persister reads `imp.module` and DROPS any import without one (the C-D2 defect class), so a `module` field is the contract. The *graph* consequence of an import is the `references` edge above. | — |
| **exports** | ❌ **never as a relationship** | Carried as `ExportInfo[]` payload. Export names are unique and resolve to top-level symbols (M49 F3 invariant); containment rides `contains`, so an `exports` edge would duplicate it. | — |

**One edge per pair, and where that rule does and does not apply.** A callee emits
exactly one of `calls`/`uses`/`references` for any (source, target) pair — the
Java M12.01 ontology. Beyond that, a repeated row is a duplicate only when the
repeat expresses ONE fact: containment between two named entities, and an
include dependency. A repeated *call* is two facts. The first cut of the defect
register conflated the two and reported 29,708 duplicates; the corrected
measurement is 928, and the distinction is pinned by
`cpp/one-edge-per-pair-959` as an exact count of 6 for six call sites.

## The D1 keyword rule (the single largest class)

One exported set, `CPP_KEYWORDS` (123 spellings: ISO 14882 through C++23, the
alternative tokens, the standard preprocessor operators, and the
implementation-reserved spellings), applied at every position a name is
produced:

| position | why a keyword is impossible there |
|---|---|
| call-target descent (`calleeLeafNode`) | a callee names a function; a keyword names none |
| `declaredNameNode` | the single funnel for variables, fields, parameters, bindings |
| `getFunctionDetails` | a function's name is an identifier |
| `addValue` | the single funnel the bare-read resolver consults |
| `uses` emission (bare-read branch) | edge-level guarantee |
| `uses` emission (field branch) | a trailing return type reaches here as a `field_expression` |
| alias / `typedef` / class / enum / enumerator / namespace / `using` names | each declares or names an entity |

#924 found the first class of this — a callee spelled with a **builtin type**
keyword, 17 sites over two corpora — and fixed it with a 16-name set checked in
one place. **The enumeration was the defect, not the fix.** A type-only set
cannot see the cast family, and a set checked in one place cannot cover the
other six positions. The corpus then measured 6,940 rows: `static_cast` 5,534,
`reinterpret_cast` 1,013, and — the strongest form of the argument — `if` 29,
`for` and `switch` as **call targets**, which is a fabrication with no reading
at all in any language.

The rule's two boundaries are as load-bearing as the rule. `operator` is in the
set as an **exact** spelling only, so `operator=`, `operator()` and every other
overload are ordinary names and survive. Contextual keywords (`final`,
`override`, `import`, `requires`) are legal identifiers and stay callable. Both
directions are pinned in `cpp/keyword-names-957`.

The F5 oracle **imports** `isCppSpelledName` rather than keeping a copy of the
list, for the reason #916 established: a second copy of a rule is a second
answer, and the two sides cancelling out of every count is how the CPPD15
self-agreeing `uses num_bits` survived a year of gates. The same is true of
`extendsTargetName` and `recoveredDeclaredName`.

## Supported constructs

- Namespaces: `namespace geometry { ... }` → namespace symbol; contains edges
  for every direct member
- Classes/structs with bodies → class symbols; forward declarations
  (`class ForwardOnly;` — no `class_body`) produce NO symbol and NO scope push
  (C negative contract); destructors (`~Shape`) are compiler-managed and
  excluded
- `enum class` → enum symbol with enum_member children
- Inheritance, template classes + out-of-line template method definitions,
  `using` aliases, out-of-line definitions, member fields, object-like macros
  with value bodies, file-scope `static` variables
- Function-local variables, literals and template parameters → NO symbols, NO
  edges (negative fixture). **D5: and a function-local `using X = Y;` /
  `typedef Y X;` is likewise not published** — the C lane's CGD20 rule
  ("function-local typedefs are execution artifacts (C-D1)"), which the C++ lane
  had no counterpart for
- **D5: a local variable written with direct-initialization parentheses is a
  variable, not a function.** `std::string contents(ReadEntireFile(f));` parses
  as a `function_definition` because `T name(args);` and `T name(args) { }` are
  ambiguous without a symbol table. C++ has no nested function definition, so the
  shape is provably not one; the name is still bound as a local, because
  dropping the binding would fabricate a read of an outer name of the same
  spelling

## Unsupported / explicit-unknown constructs

- The pinned grammar cannot parse some real C++. Two measured populations, kept
  apart because one is the analyzer's business and one is not:
  - **R1 (reported, not gated): 23 of the corpus's class bodies have a grammar node
    that ends before the source's own brace balance does.** This figure was
    **715 until it was measured rather than trusted**, and the correction is the
    useful part: the old check had two defects that both INFLATED it. It asked
    body-less nodes too, and **891 of the corpus's 4,261 `class`/`struct`/`union`
    nodes are FORWARD DECLARATIONS** — `class Message;` — which tree-sitter
    correctly gives a `class_specifier` with no body, so the next unrelated `{ … }`
    later in the file answered "your brace balance ends later than you do". Six
    consecutive lines of gtest's own `// Forward declarations.` banner became six
    "truncations" of 1,200+ rows each. And its source-side scanner counted braces
    inside strings and comments. A truncation is a body that ENDS EARLY; it cannot
    be a body that was never there. The worst REAL case is
    `nlohmann-json/single_include/nlohmann/json.hpp`: `class basic_json` spans
    source rows **128..6408** and its `class_specifier` covers **128..716**, so
    **5,692 rows — 91% of the class — are walked outside the class node** (224,879
    characters). Note the old artifact recorded that as `linesOutside: 224879`, a
    CHARACTER delta in a field named for lines. The analyzer cannot invent a class
    node the grammar did not produce, so this is
  - **R1 (reported, not gated): 715 of the corpus's classes have a grammar node
    that ends before the source's own brace balance does.** The worst case is
    `nlohmann-json/include/nlohmann/json.hpp`: `class basic_json` spans source
    lines **128..6408** and its `class_specifier` covers **128..716**, so
    **5,692 lines — 91% of the class — are walked outside the class node.** The
    analyzer cannot invent a class node the grammar did not produce, so this is
    reported with its number rather than papered over. `script/cpp-review/class-extent.ts`
    re-derives the gap for any class. (The D5 fix removed the analyzer-side
    amplification of this: before it, one recovered `function_definition`
    swallowed the remainder and became the owner of ~2,000 symbols.)
  - The 124 corpus `grammarErrorFiles` from the M12 census are genuine hard-system
    C++ the grammar cannot parse — compiler attribute macros wrapping return
    types, `PRIu64`-style printf format macros, libtsan's internal typedefs
- Cross-file resolution (`Shape` declared in Shape.h, used in Shape.cpp) is
  per-file by design — the analyzer signature does not consume the engine's
  companion index (production wiring tracked by M12.44, same as Java/C)
- Framework detection is a substring scan over the written include text, so it
  has false positives by construction (`#include <mqtt/…>` contains `qt`). It is
  metadata, not an edge, and is not gated

## Regex inventory

**Zero — re-derived from the analyzer's own source on every defect-register
run, and confirmed by a census regeneration.**

The gate that proves it is D6 in `script/cpp-review/defect-register.ts`: it
parses `src/ast/real-cpp-analyzer.ts` for regex literals and `RegExp`
constructors and reads **0**.

`bun run script/m12/regex-census.ts` independently agrees — after the change, a
regenerated `validation/m12/results/regex-census.json` carries **no
`real-cpp-analyzer.ts` entry at all**, because a file appears in `perFile` only
when it uses a regex. That artifact is **not committed here**: the census is
HEAD-anchored by design (`script/m12/census-truth.ts` — the committed state is
the truth, the working tree is "a disclosed preview, never the source of
truth"), and regenerating it while other lanes have uncommitted analyzer work
would record their preview as HEAD.

This was **false until this round**, and the false claim was the more serious
defect. The doc previously read:

> the C++ analyzer has **0 regex usages** (the 3 baseline regexes eliminated —
> census 102 → 99 total across all analyzers)

while the census it cites recorded **2**, both classified `needs_review`:
`rawText.split(/::|\s+/)` and `t.split(/::|\s+/)`, the base-class leaf clean. The
census was right and the doc was wrong. A document that under-reports its own
analyzer's text rules is worse than the rules, because it is what a reviewer
trusts instead of re-measuring.

Both are now one pure-String helper, `lastScopeSegment` — a segment split rather
than a regex split, single pass, no allocation beyond the segments it keeps.
The remaining pure-String helpers are `stripIncludeChars`, `stripAccessSpecifier`
and `joinHeadingLines`, plus the character-class comparisons in
`isIdentifierChar` and `isPlainIdentifier` (an identifier test is not worth a
census entry — the project's direction is fewer text rules, not more).

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/cpp.json` (authority:
  `manual_audit`; 87 facts) · Result: `validation/m12/results/cpp-differential.json`
- **M14 F5 differential, cpp, after this round** (issue-pinned corpora,
  `BB_CORPUS_ROOT` set, 60 files per lane, seeded sample):

  | lane | files | tree-truth | covered | MISSING | unexplained | heuristic |
  |---|---|---|---|---|---|---|
  | `fmt:cpp` | 60 | 4,499 | 4,499 (100%) | **0** | **0** | 0 |
  | `nlohmann-json:cpp` | 60 | 860 | 860 (100%) | **0** | **0** | 0 |

  Stable across sample rotations. Strict invariants hold with `hidden=0 hard=0
  soft=0`, so the published rule hid nothing.
- **Truth SHRANK while coverage stayed at 100%** — `fmt:cpp` truth 4,600 → ~4,500
  — and that is the point: the oracle was deriving the same fabrications the
  analyzer was, and both sides agreed. Fixing the analyzer without sharing the
  rules with the oracle is what produced the 83 MISSING rows the first pass
  surfaced; sharing `extendsTargetName` and the roster predicates took it to 0.
- The D2 rule compares **base names, not spellings**, because the analyzer reads
  a specialization's CPPD1 `template_type` base name (`formatter`) while the
  oracle keeps the head spelling (`formatter<std::byte, Char>`). Comparing those
  literally re-introduced the impossible self-inheritance for every
  specialization — 18 rows, measured.
## Fixtures and mutants

27 cpp fixture suites, all green (`bun run script/m14/run-fixtures.ts --lang cpp`).
Five are new and each pins one fixed class:

| fixture | pins |
|---|---|
| `cpp/keyword-names-957` | D1 at all three gate positions, plus both boundaries (`operator` overloads, contextual keywords) |
| `cpp/extends-self-base-958` | D2, per-base, plus the control that a real qualified base survives |
| `cpp/one-edge-per-pair-959` | D3 via `expectRelationshipCount`/`equals` — **an exact count, which is the only assertion form that can fail on a duplicate** — and the `calls`-are-not-duplicates distinction as an exact count of 6 |
| `cpp/recovered-declared-name-960` | D4, including the ordering (recovery consulted **first**, not as a `??` fallback — the first cut used `??` and fixed nothing) and the no-comment control |
| `cpp/no-nested-function-def-961` | D5, plus the local-class asymmetry and the constructor roster |
| `cpp/specifier-qualified-name-962` | D7 both arms, all three attribute spellings, and the two controls (an unqualified specialization, and a genuinely unnamed enum) |

**41 cpp mutants, all caught** (`BB_MUTANT_ONLY="cpp/" bun run script/m14/mutate-analyzer.ts`),
9 of them new. One of the new mutants was caught by *my own* fixture's limit and
that is recorded rather than hidden: the D3 fixture's first version used
`expectRelationships`, which means "≥ 1 match", so a duplicated edge satisfied it
and the mutant **SURVIVED**. The mutation harness is what said so.

One fixture change is a **correction of a wrong expectation**, not a relaxation:
`cpp/preproc-has-include` used to pin `calls global -> __has_include` as an
expected relationship. The #743b grammar fix made `__has_include(<h>)` *parse*,
and "it parses into a call_expression" was recorded as "it is a call".
`__has_include` is a standard preprocessor **operator**, not a function, so the
edge pointed at nothing. Those rows moved to `forbidRelationships` with the
reasoning in the fixture's own `rationale`; the `#743b` grammar fix is untouched,
and `FMT_HAS_INCLUDE`/`MAX` — ordinary macro names — keep their edges, which is
what shows the correction is scoped to names the language reserves.

## Performance

**No measurable time change, and the measurable win is output volume.** The
first A/B ran each arm in its own process and reported 14.6 ms/file pre-fix
against 18.6 ms/file post-fix — a 27% "regression" on a box whose run-to-run
spread was 27%, i.e. contention, not code. `script/cpp-review/perf-interleaved.ts`
puts both arms in **one** process, alternates the order every rep, and excludes
parse. Two runs:

| run | ratio (best) | ratio (median) | pre spread | post spread |
|---|---|---|---|---|
| 1 | 0.755 | 0.975 | 4,280–8,985 ms | 3,231–7,554 ms |
| 2 | 0.898 | 1.101 | — | — |

The distributions **overlap completely**, so there is no time claim in either
direction — stated rather than resolved, because a contended box cannot resolve
it. What is machine-independent is the output, over 120 files per pass:

| | pre | post | removed |
|---|---|---|---|
| symbols | 3,117 | 3,026 | **91** |
| relationships | 15,808 | 15,035 | **773** (4.9%) |

Hot-path audit: single-pass DFS over AST children (O(nodes)); per-node lookups
use bounded child scans; relationship source resolution is the current
scope-stack top (O(1)); the `contains` post-loop is one pass over the symbol
list with a `Set` for the one-edge-per-pair rule. The D1 gates are `Set`
lookups on a 123-entry set. No O(n²) or per-symbol O(n) scans.

## Evidence pointers

- Fixtures: `validation/m14/fixtures/cpp/` (27) · expectations `*.expectation.json`
- **Defect register (the gate): `validation/m14/results/cpp-defect-register.json`**
- Probes and their disciplines: `script/cpp-review/README.md`
- Differential: `script/m14/differential.ts` — the corpus oracle shares the
  analyzer's rules by import
- Mutants: `script/m14/mutate-analyzer.ts` (`BB_MUTANT_ONLY="cpp/"`)
- Grammar: `grammars/tree-sitter-cpp/` (local fork of upstream 0.23.4, byte-pinned) · M12 census
  `validation/m12/results/cpp-corpus-errors.json` · `cpp-complexity.json`
- Ground truth: `validation/m12/ground-truth/cpp.json` ·
  `validation/m12/results/cpp-differential.json`
- Issues: #957 (D1) · #958 (D2) · #959 (D3) · #960 (D4) · #961 (D5)

## Open, and why

- **R1 (23 truncated class bodies)** is a grammar limitation, not an analyzer
  defect. It was 715 until the check itself was measured — see the defect gate.
- **R1 (715 truncated classes)** is a grammar limitation, not an analyzer defect.
  It is reported with its number on every register run. Closing it means a newer
  tree-sitter-cpp, not more analyzer code — and the analyzer-side amplification
  it caused is already fixed (D5).
- **`validation/m12/results/regex-census.json` is stale for this lane** and is
  deliberately left uncommitted here (see Regex inventory). The committed census
  still describes the previous HEAD, so
  `script/m12/verify-regex-census.ts` now reports — measured, not predicted —
  `STALE real-cpp-analyzer.ts:1220:/::|\s+/` and `:1242:/::|\s+/`: entries the
  census lists that HEAD no longer has, which is the gate correctly noticing
  that HEAD changed. It also reports 2 stale entries from other lanes
  (`real-go-analyzer.ts:774`, `real-makefile-analyzer.ts:643`), so the gate is
  red for more than this lane; the M12 gate owner regenerates the census once
  those land. The cpp lane's own zero is gated by D6 meanwhile, which re-derives
  it from the analyzer source on every run.
- **The M14 whole-repo evidence artifacts (F1/F2/F3/F5) are stale** because they
  pin input hashes and this round changed `differential.ts` and the analyzer
  (alongside other lanes' work). They need regeneration on a machine holding the
  full 41-language corpus; the cpp lane's own numbers are above and in the
  register.
- `script/m14/verify-name-surface-924.ts` and `verify-include-names-924.ts` both
  hardcode `$HOME/fixtures/repositories`, so on any other machine they
  read **0 files** and report their own checks as "dead". Verified against the
  real corpus by pointing that path elsewhere: name-surface **3/3 + V4 selftest
  pass** over 3,839 files (the pre-fix derivation independently flags V2 at 38 —
  an outside confirmation of D1's cast family), include-names **4/4 pass** over
  754 include sites. Making both honour `BB_CORPUS_ROOT` (as `differential.ts`
  already does) is a one-line change left undone deliberately: both files are
  shared across four lanes.
