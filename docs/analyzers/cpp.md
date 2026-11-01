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
- **The `.h` boundary (measured 2026-10-17).** `detectLanguageFromPath` maps `.h` → `c` *by
  spelling* and disambiguates by *content* (`language-detection.ts:402`: Objective-C markers →
  `objective-c`, C++ markers → `cpp`, else `c`). Production applies that content branch for the
  analyzer decision (`engine.parseFile` re-detects with content at `engine.ts:1763` and calls
  `getAnalyzer(language)` at `:1830`), so a C++-marker header **is** parsed by this analyzer in
  production. The M14 gate's discovery does not: `incoming-gate.ts:314 admitByExtension` admits by
  extension set, and cpp's set contains no `h`, so a cpp lane run parses none of them and resolves
  `.cc` calls against a key space that omits every header declaration. Measured on this corpus:
  **3,095 `.h` files content-route to cpp** (11,787 to c, 259 to objective-c), carrying **87,181
  `#define`s**; `CPP-RESIDUAL.md` attributes **83% of this lane's `calls` residual** to exactly that
  boundary (fmt: 3,040 macro `#define`s + 2,090 header definitions of 6,227 unresolved `calls`).
  The exact change is proposed in `validation/m14/proposals/cpp-h-routing.md` — it is deliberately
  NOT in this file, because a per-file analyzer cannot read another file.
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
| name | ✅ | namespace `namespace_identifier`; class/struct/union `type_identifier` (or the `template_type` base name, CPPD1); **ONTOLOGY/D21: a construct C++ writes NO name for — `namespace { … }`, `union { … } n;`, `struct { … } n;`, `enum { … };` — publishes NO SYMBOL at all**; function/method declarator identifier (last named child of `qualified_identifier` for out-of-line `Class::method`); constructor normalized to `constructor`; member `field_identifier`/`identifier`; `using` alias `name` field; macro name; enumerator identifier. **Every one of these is gated by `isCppSpelledName`** — a declared name is an identifier, and a keyword declarator is a macro or a damaged region, never a declaration. |
| kind | ✅ | namespaces → `namespace`; classes/structs with bodies → `class` (and **ONTOLOGY/D23: `metadata.isAbstract` now fires on 5 of the corpus's 5 abstract classes, from 3** — the `= 0` was being read from a node's direct children only, and a macro-decorated head's scope carried no `symbolRef`); `enum class` → `enum` (members → `enum_member`); methods (declarations + out-of-line definitions, incl. template `Registry<T>::add`) → `method`; constructors → `constructor`; members → `property`; `using X = ...` aliases → `type`; object-like macros with value bodies → `constant`; file-scope static vars → `variable` (private, internal linkage) |
| qualified/container name | ✅ | `ownerName` = enclosing namespace/class via scope stack (out-of-line definitions use the explicit `Class::` scope; template `Registry<T>::add` resolves through the `template_type` scope node); visibility from access specifiers (`public:`/`private:`/`protected:`). **A function is never an owner** except for a local `class`/`struct`/`enum`, which has members that need one. |
| range (start/end line + column) | ✅ | the declaration/definition node |
| parameters | ✅ | function declarator `parameter_list` → `name`/`type`/`defaultValue`/`isOptional` on method/function/constructor symbols. **M60.P1: this row was a FALSE CLAIM until this milestone** — the field was never produced, and `UniversalSymbol.decorators`/`returnType` sat as DEAD emit cells in `script/m60/payload-matrix.ts` while this table said ✅. Two rules make the values correct rather than merely present, and both are pinned by `cpp/m60-signature-payload` and by six mutants: **(1) the type slice stops at the parameter's NAME node, not its declarator** — a `reference_declarator`'s text is `& name` and its start index points at the `&`, so slicing at the declarator publishes `const std::string` for `const std::string& name`, a *different C++ type that overloads differently* (and the same slice is the override-matching key, so `f(Widget&)` and `f(Widget)` hashed alike); **(2) a defaulted parameter is a DIFFERENT node** (`optional_parameter_declaration`), so reading only `parameter_declaration` silently drops every defaulted parameter in the corpus. A variadic `...` is deliberately NOT a parameter — it has no name and no type, and the family shape has no slot for it. |
| returnType | ✅ | the declaration's `type` field, EXCEPT for a deduced return type: `auto f() const -> std::string` has `type` = `auto`, so the real type is read from the `trailing_return_type` **child** of the declarator (measured shape: `function_declarator [trailing_return_type [->, type_descriptor]]`) — it is a child, not a field, and `childForFieldName` returns null for it. M60.P1: absent before this milestone. **Where `auto` is still published, it is the honest spelling, and that is a measured distinction rather than a leftover:** the trailing return type gives the type only when the author WROTE one. 95 corpus symbols spell a bare deduced return with no `->` at all (e.g. `auto UnpackStructImpl(const T& t, MakeIndexSequence<3>, char) { … }` in fmt's bundled gmock, 12+ of them in one header), and there the declared type genuinely *is* `auto` — the real type is deduced from the return statement in the body, which this analyzer does not evaluate and must not guess. Publishing `auto` there is truthful; publishing it for a written `-> std::string` is a name that resolves to nothing. |
| documentation/comments | — | n/a (C++ comments not extracted as doc) |
| complexity metrics | ✅ | memory-safety score (smart pointers `std::make_unique`/`std::make_shared` boost, raw `new`/`delete` penalize); patterns (`auto`, `lambda`, `constexpr`, RAII, smart pointers); framework detection (Qt/STL/Win32) from `#include` patterns — pure-String scans |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | M60.P1: the declaration's modifiers as their **source spellings, in source order** (`["static", "constexpr"]`), on BOTH the function branch and the field/variable branch — `static constexpr int kMax = 2;` carries as much modifier information as `virtual double area() const = 0;`, so a field that answers for one and not the other is a field a consumer cannot rely on. The scan matches a child by TEXT and EXCLUDES the declaration's own payload fields (`type`, `declarator`, `default_value`, …), **not** by `isNamed`: the grammar is inconsistent and both forms occur in this lane's own fixtures — `virtual` is an unnamed token on a method, while `static`/`constexpr` are NAMED `storage_class_specifier`/`type_qualifier` wrappers on a field, and an `isNamed`-only rule finds the modifier on the method and misses it on the field. `override`/`final` are `virtual_specifier`s, a level below the declaration, so they need the second lookup. A destructor and an operator overload are deliberately absent: `~File` and `operator==` are part of the NAME, not modifiers applied to it. `isPureVirtual`/`isAbstract`/`isTemplate` remain separate metadata flags. |

## Relationship ontology — the ten verdicts, each with a number

The engine's `RelationshipType` carries **10 distinct values**. This lane emits
**9** of them as relationships and rules **1**. Every verdict below is a MEASUREMENT
on the two pinned C++ corpora through the PRODUCTION entry (`parseFile`, never
`analyze()`): **162 candidate files, 128 admitted as C++ by
`language-detection.ts`, 34 excluded as C, 6,060 symbols and 10,339 relationships**.
The excluded 34 are reported rather than dropped silently — `.h` is routed by
CONTENT (`EXTENSION_LANGUAGE.h === "c"`), and counting the C lane's rows in the C++
lane's census would be a fabrication of exactly the kind the census exists to
prevent. `script/cpp-review/relationship-ontology.ts` asserts that every value the
engine carries appears below and that the emitted/not claim matches the analyzer's
push sites; `script/cpp-review/ontology-census.ts` is what produced the counts.

| type | verdict | count | files | distinct (source,target) pairs | where |
|---|---|---|---|---|---|
| calls | **EMITTED** | 4,651 | 107 | 2,177 | `call_expression` → callee leaf |
| contains | **EMITTED** | 3,755 | 98 | 3,535 | owner→member, post-loop |
| imports | **EMITTED** | 913 | 123 | 169 | `preproc_include` (was `references` until the ontology round) |
| uses | **EMITTED** | 846 | 81 | 752 | bare value reads + field access |
| exports | **EMITTED** | 75 | 18 | 61 | export-marker macro in the specifier or a class head |
| extends | **EMITTED** | 42 | 29 | 26 | `base_class_clause`, plus the ERROR-node clause of a macro-decorated head |
| references | **EMITTED** | 27 | 7 | 21 | `using`-dependencies only (the includes moved to `imports`) |
| instantiates | **EMITTED** | 21 | 14 | 20 | `new_expression` → constructed type |
| overrides | **EMITTED** | 9 | 2 | 9 | base-class virtuals, transitive, signature-aware |
| implements | **RULED** | 0 | 0 | 0 | measured on four legs below |

Totals after the CPP3 round: **6,060 symbols and 10,339 relationships** over the 128
admitted files (from 6,197 and 10,636 at the ontology round's HEAD). The delta is
−137 symbols and −297 relationships, and **every one of the 297 is either a
`contains` row or a `calls` row the CPP2 round removed** (288 `contains` from the
D21 sentinel change, 9 `calls` from D25); no relationship type was added and no
type's count rose. `script/cpp-review/perf-interleaved.ts` measures the same change
as **2,551,624 → 2,504,488 bytes of serialized output, −1.85%** for the CPP2 step and
**2,504,488 → 2,502,465, −2,023 bytes (−0.08%)** for the CPP3 step, which is the
number `bb_graph`'s payload budget actually cares about.

### CPP4 — the corpus was ABSENT, so the table above was re-measured from nothing

The table above was written by three earlier rounds in this lane. **The corpus those
rounds measured is not on this machine**: `$HOME/fixtures/repositories` was
an empty directory at the start of the CPP4 session, and the earlier rounds recorded
their run paths as `$HOME/ishaq/fixtures/repositories` — a laptop-local path that
does not exist here. So none of the numbers in this section could be re-checked by
reading them; they were re-derived.

Both pinned repos were re-fetched for this session (`git clone --depth 1`,
`sqlite/sqlite` and `google/benchmark` as `cpp-sample` — the identity the previous
rounds recorded for `cpp-sample`). **This is a fresh shallow clone, not a byte-pinned
corpus**, and that is a limit on the claim, not a caveat to wave at: the relevant
file *contents* are stable, which the counts themselves show — every one of the nine
emitted counts came back identical to the figure recorded above, to the row, on a
corpus fetched by a different process. A count that reproduces across two independent
fetches of the same upstream is evidence; it is not a pin, and it is not one either.

**Re-run of the firing check, through the production path** (`getParser` →
`parseFile` → `getAnalyzer` → `analyze`; `script/cpp-review/ontology-census.ts`,
never `analyze()` directly):

```
corpus $HOME/fixtures/repositories | repos sqlite,cpp-sample
candidates 162 | cpp files analysed 128 | symbols 6060 | relationships 10339 | parseErrorFiles 0
admitted as cpp : {"cpp-sample/cpp":117,"sqlite/cpp":11}
EXCLUDED (another lane's language): {"cpp-sample/c":3,"sqlite/c":31}
```

| type | verdict | count | files | distinct pairs | reproduced? |
|---|---|---|---|---|---|
| calls | EMITTED | **4,651** | 107 | 2,177 | identical |
| contains | EMITTED | **3,755** | 98 | 3,535 | identical |
| imports | EMITTED | **913** | 123 | 169 | identical |
| uses | EMITTED | **846** | 81 | 752 | identical |
| exports | EMITTED | **75** | 18 | 61 | identical |
| extends | EMITTED | **42** | 29 | 26 | identical |
| references | EMITTED | **27** | 7 | 21 | identical |
| instantiates | EMITTED | **21** | 14 | 20 | identical |
| overrides | EMITTED | **9** | 2 | 9 | identical |
| implements | RULED | **0** | 0 | 0 | identical |

**9 of 10 types FIRE through production `parseFile` on a real corpus.** The tenth
(`implements`) reads 0, and 0 is its verdict rather than a failure to fire — the
four-leg ruling below measures why, and the falsifier is stated there.

**Every edge this analyzer emits is OUTGOING.** `RealCppAnalyzer.analyze` is declared
`(rootNode, content, filePath)` — there is no companion-index parameter and the body
reads **no** `context.*` at all, so every relationship is derived from nodes inside the
single file that was handed to `analyze`. Resolving *who points at this file* is a
separate subsystem that does not exist yet: no edge in these 10,339 rows was arrived at
by asking another file a question. A reader who takes "4,651 `calls` edges" to mean
"4,651 incoming call sites" is reading a number this analyzer cannot produce in either
direction.

### `implements` — RULED, on four legs, and the ruling's evidence was rebuilt

**This section replaces the previous one, and the reason it was replaced is the
useful part of it.** The earlier ruling rested partly on
`script/cpp-review/language-shape-census.ts`'s `pure_virtual_in_inherited_class`
probe reading **0** over the corpus. That 0 was wrong — both of the probe's
disjuncts are dead:

- it fired on `n.type === "pure_virtual_clause"`, a rule the pinned fork DOES
  declare (`grammar.js`: `pure_virtual_clause: _ => seq('=', /0/, ';')`) but reaches
  only from `inline_method_definition` and `constructor_or_destructor_definition`,
  and the corpus produces **0** of them — the probe's own grammar inventory prints
  `pure_virtual_clause 0 files 0 <-- ABSENT`, which is the tell that it was pointed
  at the wrong node; and
- its second disjunct was `/\)\s*=\s*0\s*$/` over a `function_declarator`'s own TEXT,
  and that text ends at `)`. The `= 0` lives in the PARENT `declaration`'s
  `init_declarator` (`declaration [declarator=init_declarator] >
  init_declarator [declarator=function_declarator value=number_literal]`).

The lane's own second instrument, `script/cpp-review/pure-virtual-census.ts`, counts
the same population structurally and reads **7 sites over 4 files**. Two instruments
in one lane, **0 against 7**, and the 0 was the one a verdict was built on. The probe
is repaired in place (now `pure_virtual_site`, reading 7) and the ruling is rebuilt
from the tree by `script/cpp-review/cpp2-implements-instrument.ts`, which carries a
self-test that FAILS if it cannot find a construct that is definitely there.

**Leg 1 — the language has no spelling for it, and that is countable in the grammar
source, not argued.** The pinned fork's `grammar.js` contains **0** occurrences of the
token `'implements'` and **0** of `'interface'`. It does declare `concept_definition`,
`requires_clause` and `pure_virtual_clause`, so this is not a parser gap: over **162
candidate files and 269 distinct node types** the fork produced **0**
`concept_definition`, **0** `requires_clause`, **0** `requires_expression`, **0**
`requires_parameter_list`, **0** `constraint_conjunction`/`disjunction` and **0**
`pure_virtual_clause`. A type that satisfies a named requirement, and a constrained
template, are the two C++ constructs that state the relation distinctly from
inheritance, and neither occurs.

**Leg 2 — every other lane reads a construct the language provides.** Measured across
this repository's analyzers by ARM D of the instrument: **24 lanes push
`RelationshipType.Implements`, over 49 push sites**, and each one reads either a
DECLARED kind (C#'s `SymbolKind.Interface`/`declaredKind`, Solidity's
`interfaceNames`, Go's `interface_type`, Rust's `traitNode`, Erlang's behaviour
attribute, Elixir's protocol), a grammar node that exists ONLY for the relation
(`super_interfaces`, `interfaces`, `ImplementsInterfaces`, `protocols`,
`implements_member_clause`), or a SLOT the language orders (`i === 0 ? Extends :
Implements`). **3 sites** are classified `heuristic` — C#'s `looksLikeInterface`
(`I[A-Z]`, and C# emits it at `confidence: 1.0`) and Solidity's unresolved-declaration
counter — and **13** are `unclassified`, listed in the evidence file so a reader can
check them rather than take the classification on trust. `extends` and `implements` are
an **exclusive partition of one heritage list** in the 6 lanes that have both
(`swift`, `clojure`, `vb`, `csharp`, `scala`, `kotlin`): a single ternary whose two
arms are the two labels. C++ has one unpartitioned heritage list, so there is nothing
to partition, and a C++ `implements` that duplicated an `extends` edge for the same
pair would be a shape the family does not have.

**Leg 3 — the population is large, and every row of it is already emitted as
`extends`.** This is the leg that decides the ruling is NOT "the construct never
occurs", because it does:

| measurement | value |
|---|---|
| pure-virtual sites, counted on the TREE (Arm A) | **7** (4 `field_declaration/direct`, 3 `declaration/init_declarator`) |
| abstract classes, Arm A (3 with a body + 2 recovered from a macro-decorated head) | **5** |
| abstract classes, Arm B (the analyzer's own published `metadata.isAbstract`) | **5** — the same five names: `Benchmark`, `BenchmarkReporter`, `Fixture`, `MemoryManager`, `ThreadRunnerBase` |
| `extends` edges naming an abstract base | **25 of 42** (5 same-file, 20 other-file, 17 into a concrete base) |

So `extends` already carries the whole fact: a consumer asking "who satisfies
`BenchmarkReporter`" gets 9 edges today. Nothing is lost by refusing the second
label.

**Leg 4 — and the label would not be a fact about the program.** The only available
discriminator is "the base declares a pure virtual", and the base's body is in
another file in **20 of the 25** cases. Under this lane's declared per-file design
(documented under *Unsupported constructs*) the analyzer does not receive a companion
index, so the same C++ declaration would be labelled `implements` in the translation
unit that happens to contain the base and `extends` in every other one. **The 5/20
split is the measurement of that.** An edge whose LABEL depends on which TU you read
it from is not a fact about the program, and the honesty contract's bar for a
heuristic is a reason code plus a countable ratio — here the ratio would be 5 of 25
and the reason code would be "a file I did not read".

**The falsifier, and what would overturn this.** The ruling is RULED, not ruled-out:
it is a statement about the pinned grammar plus a corpus measurement, and
`script/cpp-review/cpp2-implements-instrument.ts` re-derives all four legs on every
run. A probe reading non-zero for "a base named as an interface by a token in the
DERIVED class's own heritage clause" overturns leg 1 and makes the type a GAP. That
probe can only ever read 0 for C++ specifically, because the grammar has no such token
— which is the honest form of the claim. The instrument's own self-test asserts the
opposite direction on a construct that IS present: on
`validation/m14/fixtures/cpp/pure-virtual-signature-910.cpp` it must find `Base`'s
three pure virtuals and three same-file `extends` edges into it, and it exits
non-zero if it does not. **On this corpus it finds 5 same-file edges into an abstract
base**, so the construct is not absent and the ruling is not resting on absence.

### `imports` — EMITTED (was not). Why the KIND is not a taste question

The lane emitted 913 `#include` rows as `references` and 0 as `imports` for a whole
wave, and the differential stayed quiet, because the oracle also read `references`.
The reason it mattered is a CONSUMER, not a taxonomy:

```sql
-- src/lsp/graph_request.ts, the file-level section of bb_graph's usages surface
WHERE relationship_type = 'imports' AND source_symbol_id IS NULL
  AND target_symbol_id IS NULL AND source_external = ?
```

An include stored as `references` is not mislabelled — it is **unreachable** by the
one reader that answers "what does this translation unit depend on". The C lane made
this exact relabel in M60/#910, `real-nim-analyzer.ts` carries the same shape, and
`script/m14/mutate-analyzer.ts` already holds a reverting mutant whose description
is *"downgrades the include edge from the first-class `imports` kind back to the old
`references` + metadata shape — the asymmetry every harness was blind to"*.

`references` is **not** emptied by the move: the `using`-dependency shape stays
`references`, because an include dependency and a using-dependency are two facts
about two constructs with two different targets (`vector` vs `std::vector`).
Pinned both ways by `cpp/imports-include-910`, and `module` + `fileLevel` are pinned
with it because `parallel-indexer.ts` reads `fileLevel` to know which FILE a
symbol-less dependency row belongs to.

### `exports` — EMITTED. A convention, and what the edge therefore asserts

C++ before C++20 has no `export` keyword, so the construct that means "this
declaration is part of the library's public ABI" is a **convention**: a macro in the
declaration-specifier position. `script/m14/ontology-coverage-gate.ts` records the
precedent in the other direction — a Node manifest's `exports`/`main`/`bin` are
conventions written as ordinary object keys, "a grammar cannot see a CONVENTION",
and the gate EMITTED `exports` for json on exactly that argument.

The rule reads an underscore-delimited COMPONENT of the macro's name — `EXPORT`,
`EXPORTS`, `EXPORTABLE`, `API`, `DLLEXPORT`, `VISIBILITY`, `PUBLIC_API` — which is
what CMake's `generate_export_header`, autotools and abseil's `ABSL_EXPORT` all
produce. It is deliberately **not** "some all-caps macro in type position": over the
two pinned corpora that would have fired on 118 sites and been wrong on 43 of them
(`BENCHMARK_ALWAYS_INLINE` 17, `BENCHMARK_UNUSED` 4, `HANDLE` 3, `DWORD` 3,
`BENCHMARK_NORETURN` 2, `WORD` 2, …). An `exports` edge pointing at
`BENCHMARK_ALWAYS_INLINE` asserts an ABI fact that is false, and a fabricated edge is
counted as unexplained and poisons `bb_graph`.

What the edge asserts is the SYNTACTIC fact and only that: **source** = the DECLARED
name, **target** = the macro **as written**, `metadata.exportMacro` = the same
spelling, `metadata.relationshipType = "module_export"`, `confidence: 1.0`. The C
lane states it the same way (`#963`). The inference from marker to ABI is carried by
the rule and written down here, in one exported place (`cppExportMarker`), rather
than smuggled into the number. `ExportInfo[]` still carries the payload array; the
edge adds the link from the published name to the marker, which the array does not
have.

### The six questions, answered per emitted type

Source derivation answers the first and nothing else, so each of these is a
MEASUREMENT over the same 128 admitted files. **Oracle agreement is from
`script/cpp-review/ontology-oracle.ts`, a second walker over the same grammar** —
and both sides walk the same pinned wasm, so a node the grammar does not produce is
invisible to it by construction. That limit is stated once, here, rather than
claimed away per row.

| type | 1 exists | 2 fires | 3 oracle agrees | 4 labelled | 5 resolved | 6 confident | R7 |
|---|---|---|---|---|---|---|---|
| calls | yes | **4,651 rows / 107 files** | audited by `script/m14/differential.ts` — **not re-runnable on this machine** (the pinned `fmt`/`nlohmann-json` repos are absent and the harness refuses a corpus it was not pinned to); the lane oracle does not cover `calls` | yes, after **D25** — 9 rows said a class calls itself and were removed | source resolves in-file **13.3%**, corpus-wide **68.7%** — the gap is the callee, not the caller | confidence **ABSENT on all 4,651**; `evidenceClass: usage_contextual` on all | 0 empty, 0 placeholder, 0 missing `line_number` |
| contains | yes | **3,755 / 98** | **3,535/3,535 = 100%** (lane oracle) | yes | **66.8%** both ends, **100%** target corpus-resolvable | 1.0 on all; `structural` | **0 empty, 0 placeholder** (was 20 placeholder targets and 133 sentinel symbols — fixed by D21) |
| imports | yes (ontology round) | **913 / 123** | **169/169 = 100%** | yes | **0%** by design — the target is an EXTERNAL module name (`<vector>`), so no in-file symbol resolves it, and that is correct rather than a loss | 1.0 on all; `import_based` | 0 |
| uses | yes | **846 / 81** | audited by the shared differential, not re-runnable here | yes | **34.6%** both ends, **91.6%** target corpus-resolvable | 459 @1.0, 387 @0.9 `usage_contextual`; **every sub-1.0 row carries `reasonCode: "member-name-unresolved"`** (M14 §4.1) | 0 |
| exports | yes (ontology round) | **75 / 18** | **61/61 = 100%** | yes | **0%** by design — the target is the MARKER, not a declared entity | 1.0 on all; `structural` | 0 |
| extends | yes | **42 / 29** | **26/26 = 100%** (lane oracle) | yes | 16.7% both ends, **92.9%** target corpus-resolvable | 1.0 on all; `structural` | 0 |
| references | yes | **27 / 7** | **21/21 = 100%** (lane oracle) | yes | 0% — the target is the namespace the `using` names | 0.9 on all, `import_based`, **`reasonCode: "using-declaration-names-a-namespace"`** | 0 |
| instantiates | yes | **21 / 14** | audited by the shared differential, not re-runnable here | yes | 38.1% both ends, 71.4% target corpus-resolvable | 1.0 on all; `structural` | 0 |
| overrides | yes | **9 / 2** | **9/9 = 100%** (lane oracle) | yes | leaf target + `metadata.overriddenOwner` (2026-10-17, see below); **before that: 0%**, both endpoints were SYNTHETIC (`Cls.method`), not symbols | 0.9 `signature-match` (inferred) / 1.0 `override-keyword+signature-match` (the author wrote `override`) | 0 |

**`overrides` target spelling — corrected 2026-10-17.** The row above used to say Q5 = 0% because
both endpoints were synthetic. That was a real defect and it is now fixed: the edge target is the
DECLARED member's leaf (`run`) and the matched base travels in `metadata.overriddenOwner` (`Base`).
Reason, measured: the resolver matches a target against a symbol's `name` or `qualifiedName`, and a
cpp member symbol carries no distinct `qualifiedName`, so `Base.run` names nothing at all — **1,875
of 1,875 `overrides` edges read `unresolved` on the whole population** (`CPP-RESIDUAL.md` §1). This
is not a new design: commit `a29357562` landed exactly this spelling and measured it (86 edges: 86
unresolved → 0; fixtures 36/11 → 41/6), and the later `0b597d2e4` "take main" merge dropped it.
After the restoration the edges are **ambiguous by leaf, not unresolved** — C++ member names repeat
across classes — and the base that the signature/keyword evidence selected is recorded in metadata,
which is the machine-readable answer to "which declaration did the resolver intend". A resolver that
wants to bind them uniquely can read that field; the analyzer cannot make two same-named member
symbols one. Fixtures: cpp went from 42 pass / 9 fail to **50 pass / 1 fail** (§ the remaining
failure is `friend-definition-body-owner`, a stale pin discussed in `CPP-STATE.md`).

**Whole-population AFTER (same command, one run, rc=0, 2026-10-17):** `overrides` = **1,875 edges ·
0 resolved · 0 collRes · 1,875 amb(decl) · 0 unresolved · 0 noDecl** (was 1,875 unresolved), and the
lane total moved by exactly that type — unresolved **339,896 → 338,021**, amb(decl) 454,816 →
456,691, resolved 391,063 and **collRes 104,069 unchanged**, `arbitraryTwin` for this type **0 → 0**.
That is a MOVE from unresolved to ambiguous, not a reduction of the residual total (794,712): the
residual is `amb + unresolved` by construction, and the owner is the part that can now be read.
Two defects the hand-read of ten edges surfaced are recorded as C8/C9 in `CPP-STATE.md` (a
macro-prefixed class named after its base, and a qualified external base binding to a same-file
sibling leaf); they are the next in-scope work.

`script/cpp-review/ontology-census.ts` measures every column above on each run:
endpoint resolution against an index built from ANALYZER OUTPUT (exact about what the
analyzer published, which is the population `bb_graph` resolves against), a
confidence/`evidenceClass` distribution per type, and the four R7 checks — sub-1.0
rows with no reason code, rows with no `line_number`, rows with an empty endpoint, and
rows whose target is a placeholder literal. **All four are 0 on all nine emitted
types.**

**What each answer means, where it is not "fine".**

- **Q1/Q2 are separated on purpose.** `overrides` had a live branch and produced
  **0 edges** over this corpus before this round — a branch that never matches is
  dead code, and derivation cannot see it. `references` is the mirror: 940 rows
  before, 27 now, because 913 of them were re-labelled rather than lost.
- **Q5 is where `contains` and `imports`/`exports` differ in KIND, not in degree.**
  `contains` resolves both ends 66.8% of the time in-file and 100% corpus-wide, and
  the 33.2% that do not are members whose owner is a class in ANOTHER file — the
  documented per-file boundary, not a fabrication. `imports` and `exports` resolve
  **0%** by construction and that is the correct answer: `<vector>` and
  `BENCHMARK_EXPORT` are not declarations in this file, and a resolution rate that
  was high here would mean the analyzer had started inventing symbols for them.
  Reporting 0% without saying so would read as a defect; it is the contract.
- **`calls` and `uses` resolution FELL this round, and the fall is the fix working.**
  `calls` 14.2% → 13.4%, `uses` 56.5% → 34.6%. Nothing about those two edge types
  changed except that 1,073 of their rows no longer carry `anonymous` as their
  SOURCE, and `anonymous` used to be a PUBLISHED SYMBOL, so those rows scored as
  "resolved" against a name 92 unrelated scopes shared. They now score against
  nothing, which is the truth: a translation unit has no name for an in-file symbol
  to be owned by. The same 262 symbols lose their `ownerName` outright. **A
  resolution rate that counted the sentinel as a hit was measuring the defect.**
- **Q6: `calls` carries NO `confidence` field at all** — 4,651 of 4,651 absent,
  where an earlier version of this table read "1.0". The store's default makes absent
  and 1.0 behave alike, but a document claiming a value the row does not carry is the
  same class of defect as claiming a `contains` shape that does not occur. The
  `evidenceClass` on those rows is `usage_contextual`, which for a syntactic
  `call_expression` → callee-leaf edge is arguably the wrong tier; it is left as it
  is because `classifyEvidenceTier` is the family's shared shape and changing one
  lane's tier without the family's decision would make the column mean two things.
  **Reported, not changed.**
- **R7 is now 0 on every emitted type.** It was not: 133 symbols published under the
  literal name `anonymous`, across 65 of the 128 files, carrying 1,611 relationship
  rows, 20 of them `contains` rows with the sentinel as the TARGET. The ontology round
  recorded this as "the largest unfixed defect this census found" and declined to fix
  it because the fix is a family decision. **The decision was made here and is
  recorded below as D21**, with the measurement that made it safe: all 41 non-namespace
  `anonymous` symbols sit on a line carrying no identifier after the
  `class`/`struct`/`union` keyword, so nothing real was deleted by declining them.

**One `extends` row the shared differential cannot see.** Three of this round's new
`extends` edges come from a base clause the grammar puts inside an `ERROR` node
(`class BENCHMARK_EXPORT ConsoleReporter : public BENCHMARK_EXPORT
BenchmarkReporter` parses as `class_specifier` + `ERROR("ConsoleReporter : public
BENCHMARK_EXPORT")` + `identifier("BenchmarkReporter")`), so `base_class_clause` is
never produced and the shared cpp oracle — which reads `base_class_clause` — cannot
derive them. One of the three fell in the 60-file draw, which is why the
`cpp-sample:cpp` differential reports **1 unexplained (0.1%)** where it previously
reported 0. The remedy is one arm in the shared oracle, which is master-owned; the
measurement is here so the need is specific.

**One edge per pair, and where that rule does and does not apply.** A callee emits
exactly one of `calls`/`uses`/`references` for any (source, target) pair — the
Java M12.01 ontology. Beyond that, a repeated row is a duplicate only when the
repeat expresses ONE fact: containment between two named entities, and an
include dependency. A repeated *call* is two facts. The first cut of the defect
register conflated the two and reported 29,708 duplicates; the corrected
measurement is 928, and the distinction is pinned by
`cpp/one-edge-per-pair-959` as an exact count of 6 for six call sites.

## Ontology round — five defects the ontology census found, and the gates they beat

Four of the five were found by asking "what does the analyzer publish for this
construct?" rather than by diffing two walkers, and **all four passed every gate
that existed before them** — 33 cpp fixtures, the differential at 0 unexplained, and
the mutation harness reporting every mutant caught. That is the point of measuring
the LANGUAGE.

| class | the contract it breaks | was | now |
|---|---|---|---|
| **D16** | a nested macro-decorated class keeps its OWNER | 10 classes published with `scope: "global"` and no `ownerName` | **0** |
| **D17** | a macro is not a type: a published `returnType` is the DECLARED type | 87 | **0** |
| **D18** | a decorated class head's real name is the class's name | 5 misnamed + 1 unpublished | **0** |
| **D19** | a pure virtual is a member, and a parameter NAME is not part of a C++ signature | 3 members unpublished, every rename-hidden override lost | **0** |
| **dead branch** | the analyzer reads only node types the pinned grammar produces | 7 `class_body` comparisons against a rule the fork does not declare | **0** |

### D16 — the owner was dropped, and "dropped" is a store-level fact

The decorated-class publish branch set `scope: "global"` and omitted `ownerName`.
That is not cosmetic: `parallel-indexer.ts` reads the owner as
`symbol.ownerName || symbol.scope`, so a nested decorated class resolved its owner
to the literal string `"global"`, found no such symbol, and persisted it with
`owner_symbol_id = NULL`; and the `contains` post-pass, which reads the same pair,
emitted **`contains global -> Run`** for `struct BENCHMARK_EXPORT Run` nested inside
`class BENCHMARK_EXPORT BenchmarkReporter` — a class that HAS an owner and lost it.
Ten such sites over the two pinned corpora.

### D17/D18 — one root cause, four readers

A macro-decorated head reaches the analyzer as a `function_definition` whose
`class_specifier` names the MACRO. Four things then went wrong at once, and the
grammar produces FOUR different sibling orders for it, each measured:

| shape | source | siblings before the body | what the pre-fix reader published |
|---|---|---|---|
| A1 | `class BENCH_EXPORT Base {` | `identifier "Base"` | `Base` — correct |
| A2 | `class BENCH_EXPORT Reporter : public BENCH_EXPORT Base {` | `ERROR("Reporter : public BENCH_EXPORT")`, `identifier "Base"` | **`Base`** — the class deleted, its base published twice |
| A3 | `class BENCH_EXPORT Sealed final {` | `identifier "Sealed"`, `ERROR("final")` | **`final`** — a keyword as a class name |
| A4 | `class BENCH_EXPORT ALIGNED Thing {` | `identifier "ALIGNED"`, `ERROR("Thing")` | **`ALIGNED`** — a macro as a class name |

The reader now keys each arm on EVIDENCE rather than position — an `ERROR` holding
`identifier` then `:` is the grammar's own account that a base clause followed; an
`ERROR` whose immediately preceding sibling is a macro means that sibling is a
second head marker — and takes the bases from the siblings after the `ERROR`, which
is what makes `extends`, `classBases` and therefore `overrides` work on A2 at all.

Two implementation notes worth keeping, because both produced a wrong answer first:

- **Node identity.** `parent.namedChild(i)` returns a FRESH JS wrapper per call in
  this binding, so `c === spec` is false even for `spec`. The first cut put the
  specifier itself into the sibling list and published three classes as the literal
  string `class BENCHMARK_EXPORT`, with `extends` edges pointing at their own names.
  The rule is now `sameExtent`, and the file has been bitten by this twice (the D15
  body skip is recorded for the same reason).
- **The `ERROR` need not hold one child.** `: public BENCH_EXPORT Base` puts the
  base's own head marker in the `ERROR` too, so demanding exactly one named child
  missed A2 whenever the base was decorated — the shape that actually occurs.

### D19 — a pure virtual is how C++ spells an interface

Two independent defects, both invisible to derivation:

1. `virtual bool f(const T&) = 0;` inside a **macro-decorated** class parses as
   `declaration > init_declarator > function_declarator` — the declarator is one
   level down. `init_declarator` was missing from the wrapper list, so
   `getFunctionDetails` returned null and, because the caller takes the function's
   SYMBOL and its SCOPE out of that result, the interface's own members were
   published **nowhere**: `BenchmarkReporter` published `ReportRunsConfig`,
   `Finalize`, `List` and nine more, and not `ReportContext` or `ReportRuns`. Seven
   pure-virtual sites over the corpus: 4 in the direct `field_declaration` shape
   (published) and 3 in the `init_declarator` shape (**0 published**). Now 7 of 7.
2. The override matcher built its parameter signature with a **second, weaker**
   declared-name lookup — a `declarator`-FIELD chain, which cannot see a name under a
   `reference_declarator` because that is a plain NAMED child. So `const Context&
   context` resolved to no name and the whole text, name included, became the "type".
   Two declarations of the same type with different parameter names then hashed
   differently, and a name is not part of a C++ signature. Measured on
   `reporter.h`: `overrides` 0 → 6, with the pre-fix survivors being exactly the
   zero-argument methods — the population where "no parameters" accidentally agrees
   with "parameters whose names happen to match".

   The rule is now the analyzer's SINGLE declared-name funnel, which is what the
   published `parameters` payload already used. The two had drifted into a second
   answer about a second question, and the divergence was invisible because the
   payload's own fixture (`cpp/m60-signature-payload`) passed throughout.

### The dead branch, and what caught it

`grammars/tree-sitter-cpp/grammar.js` declares **no `class_body` rule at all** — the
C++ body node is `field_declaration_list`. The analyzer carried seven
`class_body` comparisons (four exact-type, three substring), and over the corpus the
fork produced `field_declaration_list` **235** times and `class_body` **0**.
`script/m14/verify-fixture-coverage.ts` was already reporting it
(`deadLiterals: class_body`, cpp FAIL) — **a pre-existing failure in this lane, at
HEAD**, not something this round introduced.

The round introduced its own instance of the same class one step earlier: the first
cut of `specifierTypeText` used `text.replace(/\s+/g, " ")` and the dead-literal
gate reported the cpp count going 0 → 1. Both the gate firing and the gate having
already been red are worth recording — a gate that is red for a pre-existing reason
still catches a new one, which is the argument against disabling it.

## The CPP3 round — three defects in the analyzer's own BYTES and in its last fabrication class

This round's corpus is the same two pinned repos through the same production entry:
**162 candidate files, 128 admitted as C++, 34 excluded as C, 6,060 symbols and
10,339 relationships**. What it changed is 9 relationship rows out of 10,348 and three
properties of the analyzer's own source file. Both halves matter, and the second is
the one that had been false for two rounds.

### D24 — a literal NUL byte in the analyzer source, and what it cost two tools

`src/ast/real-cpp-analyzer.ts` carried **one raw NUL byte** in the contains
de-duplication key:

```ts
const relKey = `${_owner}<NUL>${s.name}`
```

The intent — a separator no C++ identifier can contain — is right and the runtime
string was right. It is present at `origin/main`, at the ontology handover, and
through both ontology batches. Two measured costs, neither visible in a diff because a
diff renders the byte as nothing:

- **`grep` classifies a file holding a NUL as BINARY.** Every grep-based reader of this
  analyzer gets `binary file matches` and no lines. This was hit while measuring D25: a
  plain `grep -n` over the emission sites silently returned nothing and only `grep -a`
  returned rows.
- **`script/m14/audit-analyzer-grammar.ts` could not parse its own subject.** It reads
  this file with tree-sitter-typescript to extract its node-type references; the NUL
  became an `ERROR` node, so the gate printed
  `[warn] real-cpp-analyzer.ts: source did not parse cleanly; extraction may be
  incomplete` directly above cpp's row. cpp's `refs=88 unknown=0` was therefore
  measured over a tree containing an ERROR. Post-fix the same probe reports **0
  ERROR and 0 MISSING nodes** and `refs=88` is **unchanged** — which independently
  confirms the CPP2 round's reading that the earlier `FAIL unknown=2` was an artifact
  of the broken parse and not a real unknown literal.

The separator is now the escape `\u0000`: the same string, the same key, written as
source text. `grep -c` on this file now returns a line count.

**No fixture can gate this, and that is the reason the gate is a separate file.** A
fixture runs the analyzer's OUTPUT, and the pre-fix and post-fix separators are the
SAME STRING — the output is byte-identical either way. The mutant
`cpp3/d24-nul-separator-restored` in `script/cpp-review/cpp2-source-mutants.ts` is a
**disclosed survivor** for that reason, with the measurement attached. What gates it is
`script/cpp-review/source-integrity.ts`, which reads the bytes.

### D27 — the lane's "zero regexes" claim was false for two rounds, and it was found by reading the source

`specifierTypeText` collapsed whitespace in a `macro_prefixed_type_specifier`'s
non-macro children with a regular-expression literal. Running `defect-register.ts`'s
**own D6 algorithm** over the analyzer source at each commit:

| commit | D6 findings |
|---|---|
| `e47b4a069` (ontology handover) | **0** |
| `a29b69ec9` (ontology round) | **3** |
| `92f6535c8` (CPP2 round) | **3** |
| this commit | **0** |

So the claim this document has carried since before the ontology work — "**Zero** —
re-derived from the analyzer's own source on every defect-register run" — was true at
handover and **false for two whole rounds**, and the ontology round's own commit
message asserted "regex inventory 0 regex literals" while shipping one. The two
ontology rounds also shipped two more D6 findings that are not regexes at all:

1. a **one-line `/** … */` doc comment** — D6 is a *character* test, not a parse, so a
   comment's own delimiters read as a slash-delimited run; and
2. **a grammar rule quoted verbatim** out of the fork's `grammar.js`, whose middle
   token is the grammar's zero-literal token written between slashes.

Both were closed by **wording**, not by weakening the detector: the doc comment became
`//` comments and the grammar rule is described in words. That distinction matters —
loosening D6 to make the file pass would have removed the only gate this lane has over
its own text rules.

**Why the register could not say so.** `defect-register.ts` gates D6 correctly and
would have failed on any of the three — the character before each literal is in its
position set. It could not be run: all five of its corpora (fmt, nlohmann-json,
Catch2, abseil-cpp, spdlog, zig) are absent from this machine. **A documented zero
that no runnable gate re-derives is exactly the defect the ontology workstream is
about**, and it survived two rounds here for that reason alone.

The rule is now `collapseSpaces`, a pure-String single pass with the same answer.
**It was ungated when written** — the first application of the revert left 39 of 39
fixtures green — so `cpp/exports-marker-910` gained one `expectReturnType` row
(`Counter`, declared `unsigned   long   long`, published `unsigned long long`) and
`cpp3/d27-whitespace-not-collapsed` now dies on it. `returnType` is an
overload-resolution input rather than a display field, which is why the assertion was
worth adding for a three-character difference.

### D25 — a class calling itself: 9 fabricated `calls` edges

**The contract.** A class body DECLARES; it does not execute ([class.mem]). No member
of a class may have the class's own name ([class.ctor]). So a `call_expression` at
class scope whose callee is the enclosing class's name is that class's constructor
declaration or definition — and a constructor is not callable and has no body to call
from.

**Where it happens.** A well-formed class body parses its constructors correctly:
`Direct();` is `declaration[declarator=function_declarator]`, and the analyzer
publishes a `constructor` symbol. But a **macro-decorated head** — `class LIB_API
Widget {` — is recovered as a `function_definition` whose specifier carries no body of
its own and whose PARENT's `compound_statement` IS the body (the D15/D18 shape), and
that compound statement is in ERROR. Inside it the bare `Ctor(...)` is recovered as
`expression_statement > call_expression`, or one level deeper as a `call_expression`
inside an `ERROR` under an access-specifier `labeled_statement`.

**The population, verified line by line at both ends.** 9 rows over 6 files, and every
one of the nine names a constructor:

| site | source text |
|---|---|
| `reporter.h:131` | `BenchmarkReporter();` |
| `reporter.h:189` | `JSONReporter() : first_report_(true) {}` |
| `state.h:172` | `State(std::string name, IterationCount max_iters,` |
| `sysinfo.h:49` | `CPUInfo();` |
| `sysinfo.h:61` | `SystemInfo();` |
| `mutex.h:106` | `MutexLock(Mutex& m) ACQUIRE(m) : ml_(m.native_handle()) {}` |
| `perf_counters.h:138` | `PerfCounters(const std::vector<std::string>& counter_names,` |
| `perf_counters.h:154` | `PerfCountersMeasurement(const std::vector<std::string>& counter_names);` |
| `benchmark_api.h:219` | `FunctionBenchmark(const std::string& name, Function* func)` |

Corpus `calls` **4,660 → 4,651**, relationships **10,348 → 10,339**, and all nine rows
are from the one branch.

**The control that makes the rule mean something.** Of the **71** `call_expression`s
inside a decorated head's body, 7 name the class and **64 name something else, and all
64 survive**: `MutexLock(Mutex& m) : ml_(m.native_handle())` carries a real member
call in its member-initialiser **on the same source line as one of the nine removed
rows**, and `static PerfCounters NoCounters() { return PerfCounters(); }` is a real
construction inside a method body. Recursion is untouched for the same reason — **43**
`source === target` rows survive over the corpus and every one is from a function or a
method (`void String::size_impl() { size_impl(); }`). A guard that keyed on "inside a
decorated body", or on the spelling alone, would delete one of those two populations;
`cpp3/d25-overfires-on-method-self-call` is the mutant that proves it, and
`cpp/class-scope-constructor` pins all four control rows.

### One fabrication found, measured, and DELIBERATELY not fixed

Of the same 71 calls, the ones whose callee is a bare identifier that is an **all-caps
macro** are a different class: `BENCHMARK_DISALLOW_COPY_AND_ASSIGN(Benchmark&)` (a
deleted copy-assignment declaration), `BENCHMARK_DEPRECATED_MSG("use 'range(0)'
instead")` (an annotation that declares nothing), `BM_CHECK_LE(nr_counters_,
kMaxCounters)` (a check). Each is published as `calls <class> -> <MACRO>`, which
asserts the class calls something that is not a function. Six rows would be removed
and **five of the six are right** — the sixth, `BM_CHECK_LE`, is a real macro invoked
inside a constructor body, so it is a real fact with an unresolvable target.

A rule that is wrong on one row in six removes one real fact and fabricates nothing,
so the expected gain is positive and the population is too small to justify a rule
whose discriminator cannot separate 5 from 6. **Recorded as D26-CANDIDATE with its
measurement** rather than shipped, and the population is stated so the next round can
re-measure it instead of re-deriving it.

## The CPP2 round — three defects, and the ruling they changed

Two of these were found by measuring the flag the `implements` question rests on
rather than by diffing two walkers, and one of the two was found only because a probe
was run against another probe and disagreed. All three passed every gate that existed
before them: 37 cpp fixtures, the differential at 0 unexplained, and the mutation
harness reporting every mutant caught.

### D21 — an unnamed scope publishes no symbol, and nothing is lost by saying so

`namespace { … }`, `union { … } n;`, `struct { … } n;` and `enum { … };` are ordinary
C++ and C++ **writes no name** at those positions. The analyzer published the literal
string `anonymous` for every one. Measured over the 162 candidate files of the two
pinned corpora:

| | count | detail |
|---|---|---|
| symbols named `anonymous` | **133** | 92 `namespace`, 39 `class`/`struct`/`union`, 2 `enum`, over **65 files** |
| `contains` rows with the sentinel as an endpoint | **537** | **20 as the TARGET** — the R7 placeholder-literal endpoint outright |
| `calls` rows with the sentinel as SOURCE | **882** | every one an edge out of a name 92 unrelated scopes share |
| `uses` rows | **191** | as SOURCE |
| `instantiates` rows | **1** | as SOURCE |

882 `calls` rows under one name is the consumer damage: `bb_graph` on `anonymous`
merged 92 unrelated scopes and `bb_impact` could not say which one broke.

**Probed in both directions first, because "declined" and "lost" are identical on a
symbol count.** Every one of the 41 non-namespace `anonymous` symbols sits on a line
whose text after the `class`/`struct`/`union` keyword carries **no identifier at
all** — 39 anonymous unions/structs in `sqlite/src/sqliteInt.h` (`union { void
(*xLegacy)(void*,const char*); int (*xV2)(u32,void*,void*,void*); } trace;`) and 2
anonymous enums. **0 carry a name that failed to resolve**, so the refusal deletes
nothing real.

Nor is declining a consolation. It is where the language puts the members: an unnamed
namespace has an implicit using-directive in its enclosing scope
([namespace.unnamed]) and an anonymous union's members are members of the enclosing
class by definition ([class.union.anon]). The A/B over the two corpora:

| | before | after |
|---|---|---|
| symbols | 8,319 | 8,182 |
| `anonymous` symbols | 133 | **0** |
| relationship rows touching the sentinel | 1,611 | **0** |
| owner transitions | — | **388** symbols moved off the sentinel: 126 onto a real enclosing class (`benchmark` 75, `internal` 46, `SrcItem` 30, `Walker` 20, `WhereLoop` 16, …) and 262 to no owner at all |
| `contains` | 4,043 rows / 114 files | 3,755 rows / 98 files, **placeholder targets 20 → 0** |

**The declared residual, stated rather than rounded away.** 262 members of an unnamed
namespace at FILE scope lose their `contains` edge, because a translation unit is not
a named entity and this analyzer does not invent one — the same bucket every other
file-scope function and variable is already in. 11 further members, of
`typedef struct { … } Name;`, get no named owner either even though the typedef alias
`Name` IS published; attributing them to the alias is a real improvement and a
separate change, and `cpp/unnamed-scope-919` pins the current shape (`Alias` published
as a `type`, `handle`/`flags` ownerless) so it cannot drift silently.

### D22 — a decline path that walked no body, found because D21 made it fire

Declining a class specifier walks its children with a loop bounded by
`namedChildCount` that indexed `node.child(i)` — the **full** child list. For a class
specifier the first `namedChildCount` children are the `class`/`struct`/`union`
keyword and the `{`, and the `field_declaration_list` holding every member comes
AFTER them, so **the body was never visited at all**. The mismatch was latent until
D21 put the path into use; on the first D21 run it deleted **154 real member symbols**
of anonymous unions in `sqlite/src/sqliteInt.h` (`xLegacy`, `xV2`, `isInterrupted`,
`pHash`, `addColOffset`, …). The accessor is now matched to the bound at all three
sites.

**One of the three sites is a measured DEAD BRANCH and is reported as one.**
`script/cpp-review/cpp2-dead-branches.ts` re-derives it: over the 162 candidate files,
**0 of 1,001 `function_definition` nodes trip `returnTypeIsClassDefinition`** — the
guard needs the node's `type` FIELD to be a specifier carrying a
`field_declaration_list`, which no real C++ writes. The accessor there was matched to
its bound because it is the same count/accessor argument as the two sites that ARE
exercised, but **no fixture can fail on it and the reverting mutant SURVIVES**;
`script/cpp-review/cpp2-source-mutants.ts` records it as a **disclosed survivor**
carrying that count, and prints it as `NOTE` rather than hiding it. A dead branch in a
hot analyzer is a finding for master, not a claim of coverage.

### D23 — a pure virtual is `= 0`, and this grammar writes the `0` in two places

| shape | node |
|---|---|
| 1 | `field_declaration [declarator=function_declarator type=primitive_type]` — the `0` is a **direct** child |
| 2 | `declaration [declarator=init_declarator type=primitive_type]` > `init_declarator [declarator=function_declarator value=number_literal]` — the `0` is **one level down** |

The rule scanned DIRECT children only. Over the two pinned corpora (7 pure-virtual
sites in 4 files) it flagged **3** and missed **4**. Nothing about the member SYMBOL
depends on the `0`, so no symbol count and no differential could see it: what was lost
is `metadata.isPureVirtual` on 4 members and `metadata.isAbstract` on the classes that
own them — and `BenchmarkReporter`, the corpus's most-inherited abstract base (9 of the
42 `extends` edges), was one of the misses.

**A second half, in the same class of defect.** A macro-decorated head
(`class BENCHMARK_EXPORT Reporter {`) is recovered as a `function_definition` whose
specifier has no body and whose PARENT's `compound_statement` IS the body. The scope
built for it carried no `symbolRef`, and `isAbstract` is copied from the scope onto
the class SYMBOL at scope exit — so the flag could not fire for a decorated head even
once the shape was read. Both halves are fixed, and the fix moved the published
population from **3 of 7** sites and **3** abstract classes to **7 of 7** and **5**,
which is what the `implements` ruling's Arm B now measures against Arm A.

The rule also now **requires the declarator to be a `function_declarator`**, which the
direct-child scan did not: `virtual int zeroMember = 0;` is a member with an
initialiser, not an interface operation. `cpp/pure-virtual-abstract-919` pins that
class as NOT abstract, and pins an `override` as NOT a pure virtual (C++ forbids the
two in one declaration).

## Two defects found in this round and REPORTED, not fixed

Both are outside what this round's scope could close honestly, and both are named here
with their measurement rather than left in a note.

### R2 — a macro-decorated class head carrying a MULTI-LINE macro and a base clause is deleted

`cpp-sample/include/benchmark/reporter.h:201`:

```cpp
class BENCHMARK_EXPORT BENCHMARK_DEPRECATED_MSG(
    "The CSV Reporter will be removed in a future release") CSVReporter
    : public BenchmarkReporter {
 public:
  CSVReporter() : printed_header_(false) {}
  bool ReportContext(const Context& context) override;
  void ReportRuns(const std::vector<Run>& reports) override;
  void List(const std::vector<internal::BenchmarkInstance>& benchmarks) override;
```

The grammar produces neither the `function_definition` recovery D15 handles nor a
readable `base_class_clause`:

```
declaration [declarator=init_declarator type=class_specifier]
  class_specifier [name=type_identifier] "class BENCHMARK_EXPORT"
  init_declarator [declarator=identifier value=argument_list] "BENCHMARK_DEPRECATED_MSG( … )"
labeled_statement
  statement_identifier "CSVReporter"
  ":"
  declaration [declarator=init_declarator type=type_identifier] "public BenchmarkReporter { … }"
```

So `macroDecoratedClassDecl` declines it (it requires a `function_definition` parent),
and the cost is: **no `CSVReporter` symbol**; **no `extends CSVReporter ->
BenchmarkReporter`** edge; **no `overrides` edges** for its four written `override`
specifiers, which is why the corpus's 77 written `override` specifiers still yield 9
edges; its four members' reads attributed to the enclosing `benchmark` namespace
instead of the class; and **one fabricated symbol** — `variable BenchmarkReporter` at
line 203, a second symbol in that file carrying the BASE class's name, which collides
with the real `class BenchmarkReporter` from line 56. Measured: **1 class deleted, 1
`extends` lost, 4 `overrides` lost, 8 `contains` lost, 1 wrong-named symbol
fabricated, in one file.** Fixing it needs a new recovery arm keyed on
`labeled_statement` + `statement_identifier`, which is a family decision about how a
name inside a recovery is trusted.

### R3 — a constructor DECLARATION is published as a self-call — **CLOSED in the CPP3 round as D25**

`BenchmarkReporter();` at `reporter.h:131` parses as
`expression_statement > call_expression > identifier`, and the analyzer emitted
`calls BenchmarkReporter -> BenchmarkReporter @131`. A constructor declaration is not
a call: it declares a member, and the member (`constructor`, owner
`BenchmarkReporter`) is already published.

**The reason this was left open is recorded because the resolution shows the
discriminator was available the whole time.** The open question was whether the rule
could be told apart from **D5**'s legitimate case — `std::string contents(
ReadEntireFile(f));`, a local variable written with direct-initialization parentheses,
which is the same `call_expression` shape. It can, and not by shape: **D5's case
sits inside a function body and R3's sits at class scope**, and C++ has no statement
at class scope at all. A second fact makes it unambiguous without any scope test —
*no member of a class may have the same name as the class itself*
([class.ctor]), so inside class `C` the only thing spelled `C` is `C`'s own
constructor. `parentContext.kind === class` plus `source === targetName` therefore has
exactly one reading. See **D25** below for the measurement and the control that keeps
the rule from deleting real recursion.

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

## ALL-OUT-OF-ALL D1 — the applicable set, taken from the PINNED GRAMMAR

The D1 clause of the programme bar (`validation/m14/verification/ALL-OUT-OF-ALL-PROGRAMME.md`
§9.1) asks for "every relationship type the language can express", enumerated from the
grammar rather than from the ten-value matrix. The instrument is
`script/m14/cpp-applicable-set.ts` and the machine-readable table is
`script/m14/spec/cpp-spec-table.json` (generated by `script/m14/cpp-spec-table.ts`, which
refuses to write from a missing measurement). Re-runnable:

```bash
bun run script/m14/cpp-applicable-set.ts --out validation/m14/fixtures/cpp/measurements/applicable-set.json
```

**The grammar is enumerated, not remembered:** `wasm/tree-sitter-cpp.wasm` (sha256
`0821b6f6…`) exposes 548 node-type slots through `web-tree-sitter`'s own `Language` API —
**208 named types + 286 anonymous tokens** — and every applicability claim below is answered
from that enumeration.

**APPLICABLE (10/10), each with an emission site, a positive fixture row, and a RED PROOF**
(the real fixture runner, the REAL `RealCppAnalyzer` with exactly that value's edges removed;
a fixture that passed at baseline and fails with the emission absent is a fixture that can go
red — measured, 10 mutant runs): `calls` 19 fixtures red · `uses` 17 · `contains` 18 ·
`imports` 10 · `references` 5 · `exports` 3 · `extends` 11 · `implements` 2 · `overrides` 8 ·
`instantiates` 4. Baseline at the measurement: **50 pass / 1 fail** (the recorded
`cpp/friend-definition-body-owner` contract conflict), exit 0, findings [].

**RULED NOT APPLICABLE, with grammar-absence evidence:** `decorates` (no decorator/annotation
production; `attribute_specifier` exists but is adjudicated as exports + metadata, the same
ruling java made for annotations), `renders` (no JSX production), `mixes_in` (no mixin/with
production), `part_of` (no part directive — `#include` is `imports`).

**THE C++ RULINGS the programme asked to be proved rather than assumed** (full text in the
spec table's `rulings` block, IDs CPP-R1–R4):

- **`implements` = APPLICABLE BY ADAPTED SEMANTICS.** C++ has NO `implements`-clause
  production — `implements_clause` / `class_interface_clause` / `super_interfaces` are ABSENT
  from the 208 named types and 286 tokens (checked by the instrument, which FAILS if they ever
  appear). The value is emitted for **pure-virtual-base contracts**: a base whose body declares
  `virtual R f() = 0;` is an interface, and `D : public I` implements it. Site
  `real-cpp-analyzer.ts:4797`, metadata `reasonCode: pure-virtual-base` + the pure-virtual
  member list. Ruling it non-applicable would contradict the emission and its 2 red fixtures.
- **`template_instantiation` ≠ `instantiates`.** A template instantiation is a compile-time
  type specialization; `instantiates` is OBJECT CREATION and is emitted from `new_expression`
  only (template arguments stripped: `new std::vector<int>` instantiates `vector`). Measured:
  `Box<int> b;` with an in-file `template <typename T> struct Box` emits no `instantiates` row.
- **`using` / namespaces are not `imports`.** `imports` is `#include` only (a module path);
  a `using`-dependency is `references` (site `:2521`) and namespace containment is `contains`.
- **Multiple inheritance needs no new value.** `base_class_clause` holds a LIST
  (`base_class_clause_repeat1`), so `class D : public B, private C` is two `extends` edges
  (and, for pure-virtual bases, two `implements` edges).

**The other C++ constructs the handoff named, measured and mapped** (full table in the spec
table's `constructTable`): classes/structs/unions → contains/extends/overrides/implements/
instantiates; templates → references for arguments and `instantiates` for `new`; namespaces →
contains/references; using-declarations → references; operator overloads → a contained symbol
(operator-EXPRESSION dispatch emits no `calls` — a documented analyzer rule, measured); lambda
captures → `uses` for file-declared names and `calls` for calls in the body (a capture of a
parameter/local, which is not a published symbol, emits no edge); structured bindings → `uses`
for a read of a file-declared initializer and NO edge for the declared binding names;
concepts/requires → RULED as carrying no relationship (grammar-present; the whole-population
construct count is carried by the D2 census, so this is a count instead of a silence).

**One measured correction to this lane's own spec, recorded rather than deleted:** the
completeness spec's CPP-D5 note claimed member WRITES were emitted as `uses`. Measured on the
pinned grammar at the D1 commit, assignment-LHS writes are GATED OUT (`int x; x = n + 1;`
emits no uses; a member READ does) — the rule the code states at `:4166-4188`. CPP-D5 now
records the corrected contract and the reversal.

## ALL-OUT-OF-ALL D2/D3/D4 — whole-population emission, resolution classes, and the audit

**D2 — what the analyzer EMITS, at whole population.** `script/m14/cpp-emission-census.ts` (lane-owned)
runs the production entry (`src/ast/pool-worker.parseFile`, the same call `engine.ts` makes) over the admitted
population and counts rows/files/repos per type, plus every metadata payload and the grammar constructs.
Command: `BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-emission-census.ts --cap=0 --json`.
**Population 7,435/7,435 parsed · 31 repos · 0 failures · 0 degraded** (extensions
cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu; 2,071 tracked-but-absent + 8 over the 1 MB cap excluded and counted).
**TOTAL 1,282,777 rows:** calls 931,193 · contains 168,351 · uses 117,705 · imports 51,143 · extends 4,331 ·
references 3,174 · instantiates 3,093 · overrides 1,884 · exports 1,528 · implements 375. The census also
walks the grammar per file (per-file parser, tree disposed) so the constructs that carry NO relationship are
counts: concept_definition 2 / requires_clause 10 / requires_expression 2 (ruled construct);
template_instantiation 267 vs instantiates 3,093 (CPP-R2); lambda_expression 5,614; structured bindings 389;
operator_name 3,335; **multiple inheritance 114 classes with more than one base in 58 files/5 repos** (CPP-R4).
Evidence page: `validation/m14/verification/CPP-D2.md`.

**D3 — what the emitted edges RESOLVE to, and every non-resolution in a named class.**
`BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=2000000 bun run script/m14/incoming-gate.ts cpp
cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu 0 --dump` over the SAME 7,435 files: **TOTAL 1,282,777 = resolved 411,648 +
amb(decl) 469,395 + unresolved 401,734** (+collRes 106,506 tracked as the correctness axis) · extOK/ext?/extFAIL
all 0 · bind*/cause* all 0 · self-test PASS · arbitraryTwin (whole population) **564,803**. The lane's
`script/m14/cpp-dump-classify.ts` reads the gate's own dump (no second population), asserts closure arithmetic
before printing (`1,282,777 == 411,648 resolved + 871,129 classified + 0 claims + 0 bindings + 0 causes`;
sum of class rows == 871,129; unclassified-label 0) and puts every row in exactly one named wall:
**W1-callable-not-declared-in-run 614,081 · W10-macro-defined-name 114,398 · W11-member-leaf-owner-unresolved
83,169 · W2-module-path-not-a-symbol 50,915 · W1-type 4,776 · W4-qualified-name 2,771 · W5-export-marker 835 ·
W9-operator-name 180 · W8-non-class-standard 4.** The `--index` arm was RUN and is a **measured structural
non-arm**: production's `PROJECT_INDEX_EXTENSIONS` has no C++ spelling, the gate built 0 indexes, the analyzer
reads no projectIndex, and the A→B delta is 0 in every column (TABLE 1 byte-identical). The lane's resolution
was never index-assisted — which is why the per-file-model wall W1 dominates. The **census TOTAL and the gate
arm's TOTAL are equal (1,282,777)** — two independent pipelines agreeing over one population.
Evidence page: `validation/m14/verification/CPP-D3.md`.

**D4 — every emitted label derived AND compared.** The lead wired the lane's `deriveCppUnadmittedTruth` into
`script/m14/differential.ts` (`c56315033`), admitting `contains`, `references`, `imports`, `exports`,
`overrides` to cpp's compared set in the same change (the other five — calls/uses/extends/instantiates — were
already compared; `implements` was found to have NO shared truth on the first post-wiring draw and is now
pushed by the lane's own pure-virtual walker). Both canonical draws, current digest:
`fmt --sample 60` → files 60 · tree-truth 8,666 · covered 8,523 (98.3%) · MISSING 143 · analyzer-edges 9,583 ·
unexplained 2,146 (22.4%) · heuristic 0; `nlohmann-json --sample 60` → 60 files · tree-truth 757 · covered 752
(99.3%) · MISSING 5 · analyzer 755 · unexplained 40 (5.3%) · heuristic 0. The `COMPARED WITH NO TRUTH` disclosure
is gone from both. Every non-matching row is classified by `script/m14/cpp-d4-audit.ts` with its deciding side
(fmt: 50 MISSING / 444 unexplained in 11 named classes; nlohmann-json: 10 / 245 in 6), and the two draws'
residual is measured debt, not claimed clean. The contract instrument `cpp-oracle-verify.ts` gives 5/5
synthetic positive+negative cases and a self-test that proves the matcher can fail. Evidence page:
`validation/m14/verification/CPP-D4-AUDIT.md` (+ `CPP-D4-ORACLE.md` for the inventory/wiring patch).

**D5 — permissions.** Fixtures **51 pass / 1 fail** (the recorded `friend-definition-body-owner` contract
conflict, unchanged from baseline; exit 0, "no regressions"); completeness inventory 212 types, lane-pass 8/8;
**no-regex CLEAN** at the AST level (`script/m14/cpp-no-regex-census.ts`: RegExpLiteral 0 · new RegExp 0 ·
regex argument 0; 9 allowed STRING arguments to split/replace, i.e. the character scans); perf row measured on
the differential's fmt extension universe, 60-file draw — mean **146 ms/file**, median 31.14, p90 491.05, max
1512.54, **3.676 ms/KiB**, analyzer share **85.4%** / parse 14.6%, load 5.67 — ratio **0.95×** against the
pinned differential baseline 154.1 ms/file, reported **UNSCORED** per the `#871` no-re-pin ruling (shared box);
`npx tsc --noEmit -p tsconfig.scripts.json` and `-p tsconfig.json` both report **0 errors naming any cpp
script or this analyzer** (other lanes' pre-existing errors are not this lane's files).

> **THE NO-REGEX RECORD WAS STALE AND WAS RE-MEASURED (2026-10-20).** Four regex literals had entered this
> analyzer with the task-22 project-index work (commit `b8a22225d`) while the census above was last run
> BEFORE that commit, so the recorded "CLEAN" was stale evidence rather than a wrong gate. The four sites are
> now the module-level zero-regex helpers `isIdentifierShapeWithDollar` (≡ `/^[A-Za-z_$][\w$]*$/`) and
> `collapseTypeNoise` (≡ `t.replace(/[*&\s]+/g, " ").trim()`), proven equivalent over a 499-case
> character-class-exhaustive corpus, with the whole-population emission census reading `perType == perType`
> and `totalEdges 1,282,777` against the recorded baseline — byte-identical. The census reads CLEAN again.
> The fixture count moved 50 → 51 because the citation fixture, which had been committed WITHOUT its
> `.expectation.json` and therefore pinned nothing, now pins the emission in both directions (the flag-off
> rows the suite runs, and the flag-on claim state `cpp-citation-verify.ts` asserts at 12/12 PASS).
> Evidence: `validation/m14/verification/CPP-VERDICT-PROPOSAL.md` §5.

**D6 — truthfulness.** `arbitraryTwin` whole-population baseline recorded **564,803** (arm A = arm B, delta 0);
`extFAIL`/`bindFAIL`/`causeFAIL` **0** on both arms; claims are never merged into resolutions (this lane emits
no external claims, and the gate's own claim block reads a MEASURED zero of 469,395 ambiguous rows); every
number above travels with its command and scope; negative results written down (indexed arm structurally
inert, `contains/global`-owner contract question, shared-oracle over-derivations where the ANALYZER is the
deciding side, the `.h`-by-content population boundary, the `friend-definition-body-owner` stale pin).

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
- **Those two lanes CANNOT be re-run on this laptop.** `script/m14/differential.ts`
  pins `LANG_REPOS.cpp = "fmt"` and `SECOND_CORPUS` adds `nlohmann-json`, and
  neither repo is present under `fixtures/repositories` on this machine — a scoped
  run without `--repo` dies with `corpus repo missing: …/element-plus`, which is the
  harness refusing to run against a corpus it was not pinned to. The two pinned C++
  corpora WERE run instead, and both are reported here rather than substituted
  silently:

  | lane | files | tree-truth | covered | MISSING | unexplained | heuristic |
  |---|---|---|---|---|---|---|
  | `sqlite:cpp` (40-file draw) | 40 | 34 | 34 (100%) | **0** | **0** | 0 |
  | `cpp-sample:cpp` (60-file draw) | 60 | 1,281 | 1,281 (100%) | **0** | **1** (0.1%) | 0 |

  `cpp-sample` is google/benchmark; the one `unexplained` row is the ERROR-node
  inheritance edge, named and explained in the ontology section above. Neither run
  wrote evidence — the harness says so itself ("a scoped run is for inspecting
  lanes, and writing it here would replace that claim with a smaller one"), so
  `validation/m14/results/*` is **not** regenerated by this round.
- **The differential cannot audit 5 of the 9 types this lane emits.** Its
  compared-label set for `cpp` is `calls, extends, implements, instantiates, uses`.
  `contains`, `overrides`, `references`, `imports` and `exports` are therefore
  **DERIVATION findings** in `validation/m60/results/rel-type-coverage.json` — "the
  type is stored and compared against nothing" — and `implements` is in the audited
  set while the analyzer emits 0 of it, which is the mirror-image waste. This round
  closed the lane's half of that with `script/cpp-review/ontology-oracle.ts`; see
  the oracle section for its agreement numbers and for the limit both sides share.
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

**39 cpp fixture suites; the harness reports `{"cpp":{"pass":39,"fail":0}}`**
(`bun run script/m14/run-fixtures.ts --lang cpp`, run at this commit — the harness
emits that verdict, this document does not). **Two are new in the CPP2 round** and
**one is new in the CPP3 round** (`cpp/class-scope-constructor`), each proved to FAIL
against a deliberately broken analyzer by `script/cpp-review/cpp2-source-mutants.ts`
(**7 of 9 mutants caught, 2 disclosed survivors** — see below), and **two pre-existing
fixtures had rows CORRECTED** because they were pinning the defect as correct. One
pre-existing fixture (`cpp/exports-marker-910`) also **gained** a row in the CPP3
round, because D27's rule was written ungated: the first application of its revert left
39 of 39 fixtures green.

| fixture | pins | how it is proved to fail |
|---|---|---|
| `cpp/class-scope-constructor` | **D25**, both recovery shapes (`expression_statement > call_expression` and the `ERROR`-under-`labeled_statement` one), plus **four control rows** that are the direction which costs real edges — a method calling a method of the same name, twice, once on an undecorated class and once on a decorated one, and the real member call inside `MutexLock`'s member-initialiser on the SAME source line as one of the nine suppressed corpus rows — plus the well-formed `Direct` constructor symbol that shows the guard is not "hide constructors" | `cpp3/d25-class-scope-ctor-self-call` (under-firing, the fabrication) and `cpp3/d25-overfires-on-method-self-call` (over-firing, would delete all 43 real recursive call rows). Reverting the guard by hand takes the suite **39 → 38 with `cpp/class-scope-constructor` the only failure** |


| fixture | pins | how it is proved to fail |
|---|---|---|
| `cpp/unnamed-scope-919` | D21 in all four unnamed shapes (file-scope namespace, namespace nested in a named one, anonymous union, anonymous struct in a union, anonymous enum) plus the D22 decline paths and the D21 documented residual | `cpp2/d19-sentinel-republished` and `cpp2/d20-declined-body-not-walked`; both take the suite from 0 to 3 failures |
| `cpp/pure-virtual-abstract-919` | D23 both halves — the `= 0` shape-2 read, the decorated-head `symbolRef`, the declarator requirement, and the `override`-is-not-pure control | `cpp2/d9-shape2-and-symref-lost` (under-firing) and `cpp2/d9-overfires` (over-firing); each takes the suite 0 → 1 |
| `cpp/imports-include-910` | the `imports` KIND for `#include`, plus `module` + `fileLevel`, plus the `using`-stays-`references` control and the macro-composed-argument forbid | ontology-round source revert |
| `cpp/exports-marker-910` | all four decorated-head shapes, the export marker's component rule with four negative controls, and the `returnType` strip | ontology-round source revert |
| `cpp/pure-virtual-signature-910` | the `init_declarator` pure virtual published and overridden, and the type-only signature with renamed parameters plus two name-hiding controls | ontology-round source revert |

### Two corrections of a wrong expectation, and why they are not relaxations

**`cpp/specifier-qualified-name-962` asserted `enum anonymous` and
`contains anonymous -> buffer_size` as EXPECTED rows**, on the reasoning — recorded in
that file's own `rationale` — that refusing to publish an unnamed enum "would trade a
fabrication for a loss, because `enum { buffer_size = 512 }`'s enumerator would go
missing". That argument was testable and it is **false**: the enumerator does not
depend on the enum's symbol. `buffer_size` is still published as an `enum_member` and
its edge now reads `contains outer -> buffer_size`. Measured over the two pinned
corpora, the loss the rationale feared was **1 row in that fixture against 1,611 rows
carrying a name 92 unrelated scopes shared.** Both rows moved to forbids /
re-pointed, with the measurement in the file.

**`cpp/contains-name-line-921` pinned `property bits` with `ownerName: "anonymous"`
and two `contains` edges on the sentinel.** The fixture's actual subject is #921 — a
`contains` edge carries the line that NAMES the child — and that is unaffected: the
same-line control survives with `line_number: 27` and `from: Widget`. The `from`
changed from the sentinel to the real enclosing class, which is what D21 does.

**The general lesson, and it is the CPPD15 lesson again.** Both fixtures were
*pinning* a placeholder name as the expected answer, which is how a sentinel survives
a year of gates: nothing in the suite can fail on a rule that both sides agree about.
The measurement that found it was not a diff — it was asking what a construct with no
name publishes.

Six are older and each pins one fixed class:

| fixture | pins |
|---|---|
| `cpp/keyword-names-957` | D1 at all three gate positions, plus both boundaries (`operator` overloads, contextual keywords) |
| `cpp/extends-self-base-958` | D2, per-base, plus the control that a real qualified base survives |
| `cpp/one-edge-per-pair-959` | D3 via `expectRelationshipCount`/`equals` — **an exact count, which is the only assertion form that can fail on a duplicate** — and the `calls`-are-not-duplicates distinction as an exact count of 6 |
| `cpp/recovered-declared-name-960` | D4, including the ordering (recovery consulted **first**, not as a `??` fallback — the first cut used `??` and fixed nothing) and the no-comment control |
| `cpp/no-nested-function-def-961` | D5, plus the local-class asymmetry and the constructor roster |
| `cpp/specifier-qualified-name-962` | D7 both arms, all three attribute spellings, and the two controls (an unqualified specialization, and a genuinely unnamed enum — now a FORBID on the sentinel) |

**55 cpp mutants in the shared harness, all caught**
(`BB_MUTANT_ONLY="cpp/" bun run script/m14/mutate-analyzer.ts` → `all 55 mutants
caught`, filtered 1,483 → 55), plus **5 source-level mutants in this lane's own
`script/cpp-review/cpp2-source-mutants.ts`: 4 caught, 1 disclosed survivor.**

The shared harness mutates the analyzer's RESULT (`transform(result, content)`), which
is the right instrument for an edge or a payload rule and the wrong one for a rule
that decides WHICH NODES ARE WALKED — D21, D22 and D23 are all in that second class,
and no result transform can invent the symbols or the metadata the pre-fix code
produced, because the post-fix result does not contain the information. `script/m14/**`
is master-owned, so the shared harness is left alone and the lane owns this one.

**The gate's own helpers were wrong twice before it was right, and both are worth
recording.** The first version of `replaceNth` computed `parts.slice(0, n - 1)`, which
DROPS `parts[0]` — the text before the first occurrence — so the mutated file was
truncated and the gate reported `class decline: expected exactly 1 occurrence, found
0`. A mutation gate whose helper silently deletes the code under test reports the
broken helper as a surviving rule. The second was a revert that scanned the
declaration's own named children for a `virtual_specifier`, which sits one level down
inside the declarator: the mutant applied, could not reach the construct it claimed to
break, and **SURVIVED while reporting itself applied**. Both are the same failure the
contract's §5.3 exists to prevent, and both are why the gate now treats a revert that
does not apply as a FAILURE and distinguishes a harness error from a surviving mutant.

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

### CPP2 round — payload and latency, re-measured against the ontology round's HEAD

`BASE=a29b69ec9475de1576bee7b2ca5eb17d6b82f183 BB_CORPUS_ROOT=… CPP_REPOS=sqlite,cpp-sample bun run script/cpp-review/perf-interleaved.ts 7`
— 162 files, 7 reps, both arms in one process over the same parsed trees.

**Payload — machine-independent, and it SHRANK:**

| | pre (ontology HEAD) | post (CPP2) | delta |
|---|---|---|---|
| symbols | 8,447 | 8,310 | **−137** |
| relationships | 12,272 | 11,984 | **−288** |
| relationship bytes (JSON) | 2,551,624 | 2,504,488 | **−47,136 (−1.85%)** |
| `contains` | 5,580 | 5,292 | **−288** |
| every other type | — | — | **0** (`calls` 4,687, `imports` 969, `uses` 862, `exports` 75, `extends` 42, `references` 27, `instantiates` 21, `overrides` 9) |

**No relationship type was added this round and none grew.** `implements` remains at
0, so `bb_graph`'s un-narrowed default (`graphDefault = calls, extends, implements,
uses, instantiates, overrides, contains, references, imports, exports`) pays nothing
for it — and the −1.85% is the direction the workstream budgets. **No baseline was
re-cut.**

**Latency — no measurable change, and the box cannot resolve the question.** pre median
5,218.8 ms / best 4,569.8 ms (32.21 ms/file); post median 5,850.4 ms / best 4,006.7 ms
(36.11 ms/file); **ratio median 1.121, best 0.877**. The two ratios point in opposite
directions and the spreads overlap almost entirely (pre 4,570–9,581, post
4,007–9,175), so there is no time claim in either direction — stated rather than
resolved, for the same reason as the two rounds before it. The machine-independent
number is the payload table above.

Hot-path audit, unchanged and re-checked against this round's edits: single-pass DFS
over AST children (O(nodes)); per-node lookups use bounded child scans; relationship
source resolution is the current scope-stack top (O(1)); the `contains` post-loop is
one pass over the symbol list with a `Set`. The three new/changed rules are all O(1)
or O(children): `CPP_ANONYMOUS` is a `Set`-free string compare on a name already in
hand, `cppPureVirtualDeclaration` scans one node's own children plus its
`init_declarator` children, and the D22 accessor fix changes an index, not a bound.
**D22 in fact REDUCED work at the class decline path** — `namedChild(i)` skips unnamed
tokens, so a declined specifier no longer pushes its `class` keyword and `{`.

### CPP3 round — payload and latency, re-measured against the CPP2 HEAD

`BASE=92f6535c8 … bun run script/cpp-review/perf-interleaved.ts 11`, 162 files, 11
interleaved reps:

| | pre | post | delta |
|---|---|---|---|
| symbols | 8,310 | 8,310 | **0** |
| relationships | 11,984 | 11,975 | **−9** |
| bytes | 2,504,488 | 2,502,465 | **−2,023 (−0.08%)** |
| `calls` | 4,687 | 4,678 | **−9** |

Every other type is **+0**, no type was added and no type grew. The bytes move for
rows alone because D25 deletes whole `calls` rows, which is the only direction that
can help `bb_graph`'s un-narrowed default.

**Latency — no claim.** pre median 11,825.6 ms / best 6,293.2 ms; post median
13,107.6 ms / best 6,180.1 ms; **ratio median 1.108, best 0.982**. The two point in
opposite directions and the spreads overlap almost entirely (pre 6,293–20,023, post
6,180–17,945), so there is no time claim in either direction. D25's guard is one
string comparison plus one enum comparison per `calls` branch and `collapseSpaces` is
one pass over a node's own text, so there is no mechanism a reader would point at —
but the box cannot resolve 1.108 on a 3.3× spread, so the mechanism argument is not
offered as the measurement. Stated, not resolved, for the fourth round running.

## The lane's instruments (what re-measures every claim above)

Ten probes, all lane-owned, all re-runnable, all writing to `$CPP_OUT` (default
`/tmp/opencode/cpp-review`). They exist because derivation cannot answer "does the
branch fire", and because a ruling with no measurement is a defect.

| script | answers | CPP2 result |
|---|---|---|
| `script/cpp-review/ontology-census.ts` | per type: edges, files, distinct pairs, per-repo, confidence, `evidenceClass`, `metadata.relationshipType`, in-file + corpus resolution, `line_number` presence, R7 empty/placeholder counts, sub-1.0-without-`reasonCode` | the verdict table; **R7 all 0 on all nine emitted types** |
| `script/cpp-review/cpp2-implements-instrument.ts` | the `implements` ruling on four arms: **A** tree (pure virtuals + abstract classes, analyzer-independent), **B** published (`isPureVirtual`/`isAbstract` + the extends-into-abstract split), **C** syntax inventory (grammar tokens + concept/requires/pure-virtual node counts), **D** the family (every lane that emits `implements`, and by what arm). Carries a **self-test** that exits non-zero if it cannot find a construct that is definitely there | RULED; self-test PASS; A and B agree on the same 5 abstract classes and 7 pure virtuals |
| `script/cpp-review/cpp2-source-mutants.ts` | source-level mutation for the rules a RESULT transform cannot reach | **7 of 9 caught, 2 disclosed survivors** (`cpp2/d20-returntype-body-lost` on a measured dead branch; `cpp3/d24-nul-separator-restored`, which no fixture CAN see because the pre-fix and post-fix separators are the same string) |
| `script/cpp-review/cpp2-dead-branches.ts` | branches the pinned corpus never reaches, counted as nodes | **1**: `returnTypeIsClassDefinition`, 0 of 1,001 |
| `script/cpp-review/language-shape-census.ts` | the GRAMMAR INVENTORY (every distinct node type the pinned wasm produces) plus AST-shape probes | `pure_virtual_site` **0 → 7** (the repaired probe); 269 distinct node types |
| `script/cpp-review/ontology-oracle.ts` | a SECOND walker for the five DERIVATION types, importing nothing from the analyzer | 100% on all five |
| `script/cpp-review/pure-virtual-census.ts` | pure-virtual sites by grammar shape, and whether each is published | 7 sites, 7 published, 0 missed |
| `script/cpp-review/macro-decorated-head-census.ts` | the four decorated-head shapes, and what the analyzer published for each | D16/D17/D18 at 0 |
| `script/cpp-review/perf-interleaved.ts` | payload (rows + bytes, per type) and interleaved latency | ontology→CPP2: −288 rows, −1.85% bytes, ratio 1.121 median / 0.877 best. CPP2→CPP3: −9 rows, −2,023 bytes (−0.08%), ratio 1.108 median / 0.982 best, spreads overlapping |
| `script/cpp-review/source-integrity.ts` | **D24 and D27.** Three assertions on the analyzer's own BYTES: zero C0 control bytes, D6's regex-literal algorithm re-counted, and zero ERROR/MISSING nodes under tree-sitter-typescript (the condition `audit-analyzer-grammar.ts` only warns about). Carries a **self-test that injects each defect separately** and asserts the EXPECTED outcome per arm, including the two arms that document D6's blind spots rather than hiding them | **PASS, 0 findings, 0 blind assertions, 7 self-test arms** — 0 NUL bytes, 0 D6 findings, 0 TS parse errors |

`script/cpp-review/relationship-ontology.ts` is the lane's ontology GATE and runs three
checks: every engine value is documented; the doc's verdict matches the analyzer's push
sites; and **the doc's emitted set matches a corpus census** rather than only the
source. Verified it can fail: against a census with `overrides` zeroed it reports `the
code emits it (true) but the corpus census measured the opposite (false)`.

## Gates re-run in the CPP2 round, with their actual results

Every row is a command and the number it printed at this commit. Rows that could not
run say so and say why.

| gate | command | result |
|---|---|---|
| fixtures | `bun run script/m14/run-fixtures.ts --lang cpp` | **38 pass / 0 fail**; baseline gate `no regressions` |
| source mutation (this lane) | `bun run script/cpp-review/cpp2-source-mutants.ts` | **4 caught / 1 disclosed survivor**, exit 0. `d19-sentinel-republished` and `d20-declined-body-not-walked` each take the suite 0 → 3 failures; `d9-shape2-and-symref-lost` and `d9-overfires` each 0 → 1 |
| shared mutation | `BB_MUTANT_ONLY="cpp/" bun run script/m14/mutate-analyzer.ts` | **all 55 mutants caught** (1,483 → 55) |
| lane ontology gate | `bun run script/cpp-review/relationship-ontology.ts` | **PASS** — engine values 10, analyzer emits 9, `implements` silent and documented as ruled |
| lane oracle | `BB_CORPUS_ROOT=… CPP_REPOS=sqlite,cpp-sample bun run script/cpp-review/ontology-oracle.ts` | **100%** on all five: `imports` 169/169, `exports` 61/61, `extends` 26/26, `overrides` 9/9, `contains` **3,535/3,535** (was 3,768 at the ontology HEAD — both arms moved together, which is the D21 A/B) |
| `implements` instrument | `… bun run script/cpp-review/cpp2-implements-instrument.ts` | **self-test PASS**; A 7 sites / 5 abstract classes, B 7 `isPureVirtual` / 5 `isAbstract` (the same five names), C 0 grammar `implements` tokens and 0 concept/requires nodes over 269 node types, D 24 lanes / 49 sites / 6 exclusive-partition lanes |
| dead branches | `… bun run script/cpp-review/cpp2-dead-branches.ts` | 1 dead branch, with its count |
| payload / latency | `BASE=a29b69ec… … bun run script/cpp-review/perf-interleaved.ts 7` | **−288 rows, −1.85% bytes**, no type added, no type grown; latency ratio 1.121 median / 0.877 best, no claim |
| fixture coverage / dead literals | `bun run script/m14/verify-fixture-coverage.ts` | cpp **PASS** `handled=43 fixtureTypes=207 uncovered=0 ambiguous=0 deadLiterals=0` (the gate as a whole exits 1 on another language) |
| grammar audit | `bun run script/m14/audit-analyzer-grammar.ts` | cpp **PASS** `refs=88 unknown=0 unknownFields=0`. **Read this with the caveat below** — cpp reported `FAIL unknown=2` at the ontology HEAD and the flip is an ARTIFACT, see the next paragraph. The gate as a whole exits 3 on `rust` (2 unregistered literals) |
| typecheck | `npx tsc --noEmit -p tsconfig.json` | no errors |
| shared differential, cpp | `bun run script/m14/differential.ts --lang cpp` / `--repo fmt` | **CANNOT RUN HERE** — the pinned cpp corpora (`fmt`, `nlohmann-json`) are absent from this machine, and the harness refuses a corpus it was not pinned to (`corpus repo missing`). The lane oracle is the substitute and it is stated as such everywhere it is quoted |
| shared ontology coverage gate | `bun run script/m14/ontology-coverage-gate.ts cpp` | **exits 2 — `no RULING TABLE for cpp`**. The gate's own refusal is correct: with an empty table it would call every un-emitted type RULED-UNJUSTIFIED, which is a verdict about the table. `script/m14/**` is master-owned; the four-leg ruling above is written to be pasted into that table |
| payload matrix (M60.P1) | `npx tsx script/m60/payload-matrix.ts` | cpp **12 dead emit cells**, unchanged from the ontology round — this round moved no payload field. Two of the twelve are the stale needles the doc already names (`isStatic` looked for as a key, `qualified_calls` looked for in a `key:` form) |
| grammar pins | `bun run script/m14/verify-grammar-pins.ts` | **RED for every language on this machine, and RED at HEAD too** (69 failures in the root worktree, 77 in this one). The cpp rows are `vendored file removed: src/parser.c`, `src/grammar.json`, `src/node-types.json`, `src/tree_sitter/*.h` — those paths are **gitignored** (`grammars/tree-sitter-*/src/*`), so a fresh clone never has them and the gate is measuring the checkout, not the grammar. Pre-existing, not caused by this round |
| honesty gate | `bun run script/m14/verify-honesty.ts` | **21 failures, all of them evidence FRESHNESS** (F2–F9: "N declared input(s) changed since <sha> — regenerate"). **The same 21 fail at the ontology HEAD with my analyzer change stashed**, so the analyzer change adds to the count rather than causing it. The artifacts are master-owned (`validation/m14/results/*.json`) and need regeneration on a machine holding the full 41-language corpus |

**The grammar-audit flip is an artifact and is recorded as one.** At the ontology HEAD
cpp reported `FAIL refs=88 unknown=2`, both `class_body`, reported at lines **153** and
**3759** — and those lines hold `function isMacroSpelling(s: string): boolean {` and
`if (fnScope) {`. The gate prints `[warn] real-cpp-analyzer.ts: source did not parse
cleanly; extraction may be incomplete`, and its row numbers come from that incomplete
parse, so it was reading node-type literals out of COMMENTS. Editing the comment text
moved the parse and the two hits with it. `refs=88` is identical in both runs, so **no
node-type comparison was added or removed by this round** and the flip is not evidence
of a fix. The underlying defect — a grammar audit that cannot parse its own subject and
does not fail on that — is master-owned (`script/m14/audit-analyzer-grammar.ts`).

## Gates re-run in the CPP3 round, with their actual results

Every row is a command and the number it printed at this commit. Rows that cannot run
say so and say why; the CPP2 block above is left as it was printed then, because
re-running a gate and reporting only the new number is how a lane's history gets
rewritten by its own last writer.

| gate | command | result |
|---|---|---|
| fixtures | `bun run script/m14/run-fixtures.ts --lang cpp` | **39 pass / 0 fail**; baseline gate `no regressions` |
| fixtures, pre-fix | the D25 guard reverted in place | **38 pass / 1 fail**, `cpp/class-scope-constructor` the only failure |
| source mutation (this lane) | `bun run script/cpp-review/cpp2-source-mutants.ts` | **7 of 9 caught, 2 disclosed survivors**, exit 0. New: `cpp3/d25-class-scope-ctor-self-call`, `cpp3/d25-overfires-on-method-self-call`, `cpp3/d27-whitespace-not-collapsed` caught; `cpp3/d24-nul-separator-restored` a disclosed survivor |
| source integrity (this lane) | `bun run script/cpp-review/source-integrity.ts` | **PASS** — 0 NUL bytes, 0 D6 findings, 0 TS parse errors; **7 self-test arms, 0 blind assertions**, including the two that pin D6's blind spots |
| shared mutation | `BB_MUTANT_ONLY="cpp/" bun run script/m14/mutate-analyzer.ts` | **all 55 mutants caught** (1,483 → 55) |
| lane ontology gate | `bun run script/cpp-review/relationship-ontology.ts` | **PASS** — engine values 10, analyzer emits 9, `implements` silent and documented as ruled |
| lane oracle | `BB_CORPUS_ROOT=… CPP_REPOS=sqlite,cpp-sample bun run script/cpp-review/ontology-oracle.ts` | **100% on all five**: `imports` 169/169, `exports` 61/61, `extends` 26/26, `overrides` 9/9, `contains` **3,535/3,535** |
| ontology census | `… bun run script/cpp-review/ontology-census.ts` | **6,060 symbols, 10,339 relationships**; `calls` 4,651/107, `contains` 3,755/98, `imports` 913/123, `uses` 846/81, `exports` 75/18, `extends` 42/29, `references` 27/7, `instantiates` 21/14, `overrides` 9/2, `implements` 0/0. **R7 all 0 on all nine emitted types** |
| `implements` instrument | `… bun run script/cpp-review/cpp2-implements-instrument.ts` | **self-test PASS**; A 7 sites / 5 abstract, B 7 `isPureVirtual` / 5 `isAbstract` (same five names), C 0 grammar `implements`/`interface` tokens and 0 concept/requires/pure-virtual nodes over 269 node types, D 24 lanes / 49 sites / 6 exclusive-partition lanes |
| dead branches | `… bun run script/cpp-review/cpp2-dead-branches.ts` | **1** dead branch (`returnTypeIsClassDefinition`, 0 of 1,001 `function_definition` nodes); 269 distinct node types |
| payload / latency | `BASE=92f6535c8 … bun run script/cpp-review/perf-interleaved.ts 11` | **−9 rows, −2,023 bytes (−0.08%)**, every other type +0; ratio 1.108 median / 0.982 best, **no time claim** |
| fixture coverage / dead literals | `bun run script/m14/verify-fixture-coverage.ts` | cpp **PASS** `handled=43 fixtureTypes=207 uncovered=0 ambiguous=0 deadLiterals=0`. **This gate WRITES `validation/m14/results/M14.0.F1.json` and `M14.0.F6.json` as a side effect of running**, so running it dirties two master-owned artifacts; they were reverted, not committed |
| grammar audit | `bun run script/m14/audit-analyzer-grammar.ts` | cpp **PASS** `refs=88 unknown=0 unknownFields=0`, **and the `[warn] real-cpp-analyzer.ts: source did not parse cleanly` line is GONE** — D24 removed the cause. `refs` is identical to the pre-D24 run, which is the independent confirmation that the CPP2 round's `FAIL unknown=2` was reading literals out of comments |
| typecheck | `npx tsc --noEmit` | no errors |
| shared differential, cpp | `bun run script/m14/differential.ts --lang cpp` | **CANNOT RUN HERE** — throws `corpus repo missing: …/element-plus` before it reaches the cpp lane; the pinned cpp corpora (`fmt`, `nlohmann-json`) are absent and the harness refuses a corpus it was not pinned to. The lane oracle is the substitute and is labelled as such everywhere it is quoted |
| defect register | `bun run script/cpp-review/defect-register.ts` | **CANNOT RUN HERE** — all five corpora absent. **This is the gate that would have reported D27's three D6 findings**, which is why D27 was found by running D6's algorithm by hand instead |
| honesty gate | `bun run script/m14/verify-honesty.ts` | **21 failures, all evidence FRESHNESS** (F2–F9). **The same 21 fail with this round's changes stashed** |
| grammar pins | `bun run script/m14/verify-grammar-pins.ts` | **RED for every language**, at HEAD and on a clean worktree — the gate measures `grammars/tree-sitter-*/src/*`, which `.gitignore` excludes. Pre-existing, not this round |

## Evidence pointers

- Fixtures: `validation/m14/fixtures/cpp/` (**39** suites = 77 files) · expectations
  `*.expectation.json`
- **Defect register (the gate): `validation/m14/results/cpp-defect-register.json`** —
  **NOT re-runnable on this machine**: the five corpora it names (fmt,
  nlohmann-json, Catch2, abseil-cpp, spdlog, zig) are all absent from
  `$HOME/fixtures/repositories`, and the corpus it was measured over is
  1,722 files against this round's 162. Its numbers are quoted here as the ontology
  round recorded them and are NOT restated as current.
- Probes and their disciplines: `script/cpp-review/README.md`
- Ontology instruments: `script/cpp-review/ontology-census.ts`,
  `cpp2-implements-instrument.ts`, `cpp2-source-mutants.ts`, `cpp2-dead-branches.ts`,
  `language-shape-census.ts`, `ontology-oracle.ts`, `macro-decorated-head-census.ts`,
  `pure-virtual-census.ts`, `export-marker-census.ts`, `perf-interleaved.ts`,
  `relationship-ontology.ts`
- Differential: `script/m14/differential.ts` — the corpus oracle shares the
  analyzer's rules by import. **Not re-runnable for cpp here** (pinned corpora
  absent); the lane's own `ontology-oracle.ts` is the second opinion that did run, and
  it imports NOTHING from the analyzer
- Mutants: `script/m14/mutate-analyzer.ts` (`BB_MUTANT_ONLY="cpp/"`) for the
  result-level ones, `script/cpp-review/cpp2-source-mutants.ts` for the
  source-level ones
- Grammar: `grammars/tree-sitter-cpp/` (local fork of upstream 0.23.4, byte-pinned) · M12 census
  `validation/m12/results/cpp-corpus-errors.json` · `cpp-complexity.json`
- Ground truth: `validation/m12/ground-truth/cpp.json` ·
  `validation/m12/results/cpp-differential.json`
- Issues: #957 (D1) · #958 (D2) · #959 (D3) · #960 (D4) · #961 (D5)

## The DERIVATION findings, and the lane oracle that answers them

`validation/m60/results/rel-type-coverage.json` records five DERIVATION findings for
`cpp` — the analyzer emits a type that the M14 differential never compares against
anything:

```
DERIVATION|cpp|emits `contains`   but the differential audits ["calls","extends","implements","instantiates","uses"]
DERIVATION|cpp|emits `overrides`  …
DERIVATION|cpp|emits `references` …
DERIVATION|cpp|emits `imports`    …     (new in this round)
DERIVATION|cpp|emits `exports`    …     (new in this round)
```

"Stored and compared against nothing" is worth as much as adding anything, because
an unverified edge ships a bug invisibly — and this round is the argument: the
`overrides` branch was live, correct, and had produced **zero** edges on this corpus
for a whole wave, and `references` was mislabelled for the same period. Neither fact
is derivable from the source.

`script/cpp-review/ontology-oracle.ts` is the lane's answer: a second walker over
the same grammar, re-deriving `imports`, `exports`, `extends`, `overrides` and
`contains` and comparing them against production `parseFile` output. It imports
**nothing** from `real-cpp-analyzer.ts` — not `isCppSpelledName`, not
`extendsTargetName`, not `cppExportMarker`, not `macroDecoratedClassDecl` — because
a second COPY of a rule is a second ANSWER, and two sides that cancel out of every
count is how a wrong edge survived a year of gates (#916, and the CPPD15
self-agreeing `uses num_bits`). Its rule lists are deliberately not identical: the
export-marker set adds `EXPORT_API` and drops `PUBLIC_API`, and the keyword set is
70 spellings against the analyzer's 123, so a disagreement would surface rather than
be hidden by sharing.

**Result: 100% agreement on all five** — `imports` 169/169, `exports` 61/61,
`extends` 26/26, `overrides` 9/9, `contains` 3,768/3,768, with zero analyzer-only and
zero oracle-only rows.

**Its limit, stated once and not claimed away.** Both sides walk the SAME pinned
wasm, so a node the grammar does not produce for a construct that exists is invisible
to both — which is exactly why the LOSS questions are answered by
`language-shape-census.ts` and `macro-decorated-head-census.ts`, which count NODES
instead of comparing walkers. The oracle also caught two bugs **in itself**, both in
the direction that accuses the analyzer of a loss: it published a decorated class
under its second head marker (no A4 arm), it read a decorated base's raw
`::`-qualified text as the base name, and it walked every ordinary class body in
the OUTER scope, which unregistered the members of every undecorated class. All
three were fixed in the oracle; in each case the analyzer was right and the
disagreement is what localised it.

## Needs for MASTER — every one in a master-owned file, none made here

Listed because `docs/analyzers/ONTOLOGY-WORKSTREAM.md` gives an agent the analyzer,
its doc and its fixtures, and requires a shared change to be *reported* rather than
made. Each item states the measurement that makes the need specific.

| # | file | the need | the measurement that motivates it |
|---|---|---|---|
| 1 | `script/m14/ontology-coverage-gate.ts` | **add a `cpp` RULING TABLE.** The gate exits 2 for this lane with `no RULING TABLE for cpp`, and its own header says a gate with an empty table would call every un-emitted type RULED-UNJUSTIFIED — a verdict about the table, not the lane. The entry is the four-leg `implements` ruling above: instrument A = `concept_definition` / `requires_clause` / `pure_virtual_clause`, plus the grammar-token count (0 `'implements'`, 0 `'interface'`). The other 9 types are EMITTED and need no table entry | the gate refuses to report for cpp at all today |
| 2 | `script/m14/differential.ts` | add the **ERROR-node base-clause arm** to the shared cpp oracle | 3 of the corpus's 42 `extends` edges come from a `base_class_clause` the grammar parks in an `ERROR` node; 1 falls in a 60-file draw and is counted unexplained (0.1%) |
| 3 | `script/m14/differential.ts` | add `contains`, `overrides`, `references`, `imports`, `exports` to the **compared-label set** for cpp | cpp sits on the DERIVATION list with 5 findings; the lane's own oracle measures 100% agreement on all five, but the shared gate is what `validation/m60/rel-type-coverage-baseline.json` reads, so this lane cannot leave that list no matter what the lane oracle says |
| 4 | `script/m14/mutate-analyzer.ts` | `cpp/d3-duplicate-contains-and-references` now duplicates the **wrong kind** — the include edges it de-duplicates moved to `imports`. Add `imports` to its filter. Then add result-level mutants for the CPP2 rules where one is derivable: the `exports` marker rule, the `returnType` strip, the decorated-head four-arm reader, `init_declarator` in the declarator-wrapper list | the mutant's own description is now false; it asserts a `references` duplication that moved |
| 5 | `script/m14/audit-analyzer-grammar.ts` | the audit prints `[warn] real-cpp-analyzer.ts: source did not parse cleanly` and **then reports node-type literals with row numbers taken from that incomplete parse** — it read two `class_body` hits out of COMMENTS and reported them at lines 153 and 3759, which hold `function isMacroSpelling` and `if (fnScope) {`. A warn that does not fail the gate, followed by line numbers derived from it, is how a lane's status flips on a comment edit | cpp went `FAIL unknown=2` → `PASS unknown=0` this round with `refs=88` identical in both runs; the flip is an artifact and is recorded as one |
| 6 | `script/m14/verify-grammar-pins.ts` | the gate measures **files the repo gitignores**: `grammars/tree-sitter-*/src/*` (`.gitignore:46`), so `src/parser.c`, `src/grammar.json`, `src/node-types.json` and `src/tree_sitter/*.h` are absent from every fresh clone. 69 pin failures at HEAD in the root worktree, 77 in a clean worktree, for **every** language | pre-existing and unrelated to this round; it makes the pin gate unusable as a drift check |
| 7 | `validation/m60/rel-type-coverage-baseline.json` | the two new DERIVATION findings from the ontology round (`imports`, `exports`) are reported as REGRESSIONS by a shrink-only gate, because the baseline records 3 cpp findings and the live count is 5 | `validation/m60/rel-type-coverage-baseline.json`'s own `rule` field |
| 8 | `validation/m14/results/*.json` (F2–F9) | the honesty gate reports **21 evidence-freshness failures** — every one of them is "N declared input(s) changed since <sha>". **The same 21 fail with this round's analyzer change stashed**, so the analyzer change adds to the count rather than causing it. Regeneration needs a machine holding the full 41-language corpus | `bun run script/m14/verify-honesty.ts`, both arms |
| 9 | `script/cpp-review/defect-register.ts` + `validation/m14/results/cpp-defect-register.json` | not re-runnable on this machine: all five of its corpora (fmt, nlohmann-json, Catch2, abseil-cpp, spdlog, zig) are **absent** from `$HOME/fixtures/repositories`, and it measured 1,722 files against this round's 162. Its D1–D8 table is therefore quoted here as the ontology round recorded it, not as current | the corpus listing, plus the doc correction under *Evidence pointers* |
| 10 | `src/ast/types.ts` / family | the question `implements` was asked to settle has a **family answer, not a C++ answer**: C++'s only spelling of interface satisfaction is a pure virtual on the BASE, so the label would depend on which TU is read (measured 5 of 25 same-file). If the family wants that relation queryable across languages, the right shape is a metadata flag on `extends` (`meta.interfaceSatisfaction: "abstract-base" | "declared-interface"` with a reason code) rather than a second edge type that duplicates `extends` — 6 lanes already treat the two labels as an exclusive partition of one heritage list | `cpp2-implements-instrument.ts` ARM D: 24 lanes, 49 push sites, 6 exclusive-partition |
| 11 | `script/m14/run-fixtures.ts` | **no change needed, and that is worth saying**: `meta.x: null` on `expectSymbols` is what lets the new fixture state that a class must **not** be abstract, and `expectSymbolCount`/`equals` is what pins "0 symbols named `anonymous`" as an exact count rather than "≥ 1 match". Both already existed | `cpp/unnamed-scope-919`, `cpp/pure-virtual-abstract-919` and `cpp/class-scope-constructor` are written entirely in existing matcher features |
| 12 | `script/m14/differential.ts` | **the shared cpp oracle needs D25's arm, or this round's fix will read as a regression.** The oracle derives `calls` by walking `call_expressions`, so it will still derive the 9 constructor rows the analyzer no longer publishes — and analyzer-only rows are what the differential counts as `unexplained`. The predicted delta is **+9 unexplained `calls` rows on a 60-file draw that includes one of those six files**, from a *removal*. If it does not appear, the differential has a different blind spot and that is worth knowing too | 9 rows over 6 files, each verified against its source line; the files are `reporter.h`, `state.h`, `sysinfo.h`, `mutex.h`, `perf_counters.h`, `benchmark_api.h` |
| 13 | `script/m14/audit-analyzer-grammar.ts` | **make the "did not parse cleanly" warn FAIL the gate, or at least fail the lane's row.** D24 was a NUL byte that this gate could not see past: it warned and then reported row numbers derived from the broken parse, and the CPP2 round's `FAIL unknown=2` → `PASS unknown=0` flip moved when a COMMENT was reworded. The warn is now silent because the cause is gone, which removes the symptom and not the hole | the warn's own text, `source did not parse cleanly; extraction may be incomplete`; post-D24 the same probe measures 0 ERROR / 0 MISSING nodes |
| 14 | `script/m14/verify-fixture-coverage.ts` | **stop writing master-owned evidence as a side effect of being read.** Running it rewrites `validation/m14/results/M14.0.F1.json` and `M14.0.F6.json`, so an agent running a read-only check ends up with two dirty files it must remember to revert, and the rewritten F1 records **another lane's** regression (`rust` dead literals 0 → 2) that this lane has no way to adjudicate. Both were reverted here | `git status` after the run; `M14.0.F1.json`'s `deadLiteralRegister.adjudication.countRegressions` goes from `[]` to `[{from: 0, lang: "rust", to: 2}]` |
| 15 | `src/ast/real-cpp-analyzer.ts` (family-wide) | **`calls` `confidence` is ABSENT on all 4,651 rows** while `evidenceClass` says `usage_contextual`. That tier is the family's shared `classifyEvidenceTier` shape, so changing one lane's value would make the column mean two things — but a syntactic `call_expression` → callee-leaf edge is a different kind of claim from a usage-contextual inference, and the two fields disagreeing is the kind of thing a consumer reads as a bug in one of them | the census's `confidence {absent: 4651}` against `evidenceClass {usage_contextual: 4651}` |

## Open, and why

- **`contains global -> X` happens 1,246 times over 52 files, and this table
  previously said "Never `global contains X`".** The claim was false. Measured
  breakdown of the 1,246 targets: **893 `constant`, 352 `macro`, 1 `class`** — every
  one of them a file-scope symbol carrying `scope: "global"` and no `ownerName`,
  i.e. an object-like macro or a file-scope constant, which have no container in the
  source. The 1 `class` is `Barrier` in `src/mutex.h`, where the grammar closes the
  enclosing namespace early (the R1 family), so file scope is what the tree says.
  `global` is the lane's established file-scope sentinel — the same one `imports`
  and `references` use as their source. The ANALYZER is left as it is and the
  DOCUMENT is corrected, because the alternative — dropping 1,245 rows — deletes a
  real containment fact for a shape that is noise only to a consumer that expects
  both endpoints to be symbols. Flagged to master because `global` is never a
  symbol, so `bb_graph`/`bb_impact` cannot resolve those rows either way, and
  whether to keep them is a family decision rather than this lane's.
- ~~**133 symbols published under the literal name `anonymous`**~~ — **RESOLVED in the
  CPP2 round as D21.** 0 sentinel symbols, 0 sentinel endpoints, 0 placeholder
  `contains` targets, measured on both corpora and pinned by `cpp/unnamed-scope-919`
  plus three source mutants. Two PRE-EXISTING fixtures were pinning it as expected and
  had rows corrected. The declared residual is stated under D21: 262 file-scope
  members of an unnamed namespace, and 11 members of a `typedef struct { … } Name;`,
  have no named owner.
- **`returnTypeIsClassDefinition` is a DEAD BRANCH**: 0 of 1,001 `function_definition`
  nodes over the 162 candidate files trip its guard, so no fixture can fail on the
  accessor there and its reverting mutant SURVIVES (disclosed, with the count, in
  `script/cpp-review/cpp2-source-mutants.ts`). Measured by
  `script/cpp-review/cpp2-dead-branches.ts`. Closing it is a decision about whether
  the guard should exist; flagged to master.
- **A macro-decorated head carrying a MULTI-LINE macro AND a base clause is deleted**
  (`R2` above, `reporter.h:201`): 1 class, 1 `extends`, 4 `overrides`, 8 `contains`
  lost, and 1 wrong-named `variable BenchmarkReporter` fabricated, in one file. It is
  also why the corpus's **77 written `override` specifiers across 26 files yield 9
  `overrides` edges** — the other 68 are bases this analyzer cannot see (per-file
  design) or the deleted `CSVReporter`. Not fixed: the recovery needs a new arm keyed
  on `labeled_statement` + `statement_identifier`, which is a family decision about
  how far a name inside a recovery is trusted.
- **A constructor DECLARATION is published as a self-call** (`R3` above,
  `reporter.h:131`): `calls BenchmarkReporter -> BenchmarkReporter`. Not fixed because
  the shape is indistinguishable from D5's legitimate case without composing the two
  discriminators, and that composition is larger than this round's evidence supports.
- **R3/D5 aside, the shared differential's oracle does not have the ERROR-node base
  clause arm**, so one `extends` row per 60-file draw counts as unexplained. The
  measurement is under *One `extends` row the shared differential cannot see*.
- **The `macro_prefixed_type_specifier` fork rule does not cover a macro before a
  COMPLEX type.** `LIB_EXPORT std::string Version();` gets
  `type: type_identifier "LIB_EXPORT"` with the real type glued onto the
  declarator's `qualified_identifier` (and the `::` token's own text is EMPTY), so
  the declared type is unreadable there. `returnType` is omitted rather than filled
  with the macro — pinned in `cpp/exports-marker-910` — and **no `exports` edge is
  emitted for that shape**, which is a residual loss: the corpus has 0 sites of it
  among the `macro_prefixed_type_specifier` ones, so the number is measured as 0
  rather than asserted.
- **A macro's own `#define` must be READABLE for the marker rule to fire**, and a
  `#define` whose body contains `__attribute__((...))` parses to a bare `preproc_arg`
  with no `preproc_def` at all — so the analyzer never sees the DECLARATION and
  cannot tell the marker from a typedef. Measured at
  `cpp-sample/include/benchmark/export.h:13` and, in the fixture, on the
  `__attribute__((always_inline))` spelling. That is the R2 family (a `#define` the
  recovery destroyed) and it is why the fixture's non-export marker has a
  grammar-readable body, with the reason written in the fixture rather than left as
  a silent simplification.
- **`declaredReturnType`'s macro roster is order-dependent.** A `#define` written
  BELOW the declaration is not in `macroNames` when the declaration is walked, so
  the residual is a published `returnType` equal to a macro the file defines later.
  Measured 0 sites over the two pinned corpora (every marker there precedes its use);
  the robust form is a pre-pass over `preproc_def` nodes. Declared rather than
  hidden.
- **The shared cpp oracle cannot derive an `extends` edge from a decorated head**,
  so one row per 60-file draw counts as `unexplained`. Named and explained above;
  the fix is one arm in `script/m14/differential.ts`, which is master-owned.
- **`script/m14/differential.ts` needs a cpp ruling table** for
  `script/m14/ontology-coverage-gate.ts`: the gate's `RULED_BY_LANG` has `bash` and
  `json` and nothing else, so running it for `cpp` exits 2 with "no RULING TABLE for
  cpp" — it refuses to report rather than calling every un-emitted type
  RULED-UNJUSTIFIED, which is correct behaviour and still means the one gate whose
  header explains this whole workstream cannot be run for this lane. What it needs
  is this lane's `implements` row (instrument A, `concept_definition` /
  `requires_clause` / `pure_virtual_clause`) and the `imports` /
  `exports` / `overrides` EMITTED entries.
- **`script/m14/mutate-analyzer.ts`'s `cpp/d3-duplicate-contains-and-references`
  mutant now duplicates the WRONG kind.** It re-duplicates `contains` and
  `references`, and the include edges this lane de-duplicates moved to `imports`,
  so the one-edge-per-pair protection for includes is no longer mutation-tested. It
  needs `imports` added to its filter (master-owned file), and the round's five new
  behaviours need their own mutants — described in the commit message.
- **The `calls` tier question is open rather than answered.** `evidenceClass` on
  4,651 `calls` rows is `usage_contextual` and `confidence` is ABSENT, where a
  syntactic `call_expression` → callee-leaf edge is the most structural thing the
  analyzer produces. `classifyEvidenceTier` is the family's shared shape and one
  lane changing its tier alone would make the column mean two things, so this is a
  question for the family, not a change for this lane.


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

- **C8 (2026-10-18): a macro-decorated class WITH a base clause is named by its real sibling identifier, not by its base.** `class GTEST_API_ Derived : public Base {…}` parses as `class_specifier` (name field = the MACRO) + a bare `identifier` sibling (the real name) + an `ERROR` holding `": public Base"`. Arm 1 used to fire on any ERROR holding an identifier and a colon, so it named the class after its BASE and lost the class and its `extends` edge. `colonFirst` now decides: the colon before the identifier means the ERROR is the base clause, arm 3 reads the sibling name, and the ERROR's identifiers are collected as bases. Verified on the C8 shape and on A2/A1 controls (`.tmp-f48/probes/c8-verify.mts`).
