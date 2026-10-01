# real-perl-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-perl-analyzer.ts`
- Grammar: `wasm/tree-sitter-perl.wasm`, sha256 `ac0248edc420...`, 4,757,625 B
- Pinned source: `tree-sitter-perl@1.2.1` from its npm tarball, vendored at
  `grammars/tree-sitter-perl/`; registered in `validation/m14/grammar-pins.json`
  and gated by `script/m14/verify-grammar-pins.ts`
- Detection: `.pl`, `.pm`, `.t` -> `perl` in `src/ast/language-detection.ts`
  (the F5 lane additionally samples `.PL`, which production routes by name)
- Wiring: `ASTEngine.parseFile` -> `RealPerlAnalyzer`
- Corpora: `mojo@93f59174` (the M12 pinned perl target, 275 files) and
  `plack@c821514` (independent, 226 files)

The grammar is a *build*, not a published artifact: neither `tree-sitter-perl@1.2.1`
nor `@2.0.0` ships a `.wasm` in its npm tarball, and `tree-sitter-wasms@0.1.13/out`
has no Perl build. Provenance is therefore established offline, by the registry's own
rule rather than by assertion: a fresh `emcc` build of the vendored 1.2.1 source
(`-shared -O2 -sSIDE_MODULE=1`, emscripten/emsdk 3.1.64) reproduces the wired
`idOrderDigest c954cfdc...`, `typeSetDigest 61033c08...` and `fieldSetDigest
d0e6aa8f...` exactly, and produces **identical trees on 275/275 mojo files**. The
wired bytes are a build of 1.2.1's source.

## Symbol contract

| Construct | Symbol | AST rule |
| --- | --- | --- |
| `package Name;` / `package Name { }` | `class` | `package_statement` -> `name` field |
| `class Name { }` (5.38 core OO) | `class` | `class_statement` -> `name` field |
| `role Name { }` (5.38 core OO) | `trait` | `role_statement` -> `name` field |
| `sub name { }` inside a package | `method` | `subroutine_declaration_statement` -> `name` field |
| `method name { }` inside a class/role | `method` | `method_declaration_statement` -> `name` field |
| `sub new { }` | `constructor`, named `constructor` | the same `name` field, normalized from `new` |
| `sub name { }` at file scope | `function` | same node, no owner in scope |
| `our $VERSION` / `our @EXPORT` | `constant` | `variable_declaration` -> `variable` field -> `varname` |
| `our $ISA` / `our @ISA` | `variable` | same node, with `isInheritanceVariable` |
| `use constant NAME => v` | `constant` | fat-comma **keys** of the argument list |
| `has 'name' => (...)` (Moose/Moo) | `property` | the first argument's `string_content` / `autoquoted_bareword` |
| `field $x;` in a class/role body | `property` | `variable_declaration` with an unnamed `field` token |
| `sub f ($a, $b = 1, @rest)` | parameters on the method | the `signature` field's `mandatory_parameter` / `optional_parameter` / `slurpy_parameter` |
| `sub f :lvalue :method` | `decorators` | the `attributes` field -> `attrlist` -> `attribute` -> `name` |

Lexical `my` / `state` declarations, plain parameters written as
`my ($a, $b) = @_`, anonymous subs, and expression payload are **never symbols**.
A package, class or role symbol's `scope` is **itself** -- the namespace a class
belongs to is the class, not the package declared before it.

`field` is a Property only directly in a `class` / `role` body; in a method body it
is a lexical and is not emitted.

## Relationship ontology

| Relationship | Rule | Carries a line |
| --- | --- | --- |
| `contains` | one edge per owned member: subs, package globals, `use constant` names, Moose attributes, class fields | no, by design |
| `calls` | `function_call_expression`, `ambiguous_function_call_expression` and `method_call_expression`, target = the receiver-qualified owner where the source proves one, else the leaf; source = the enclosing sub | the callee node |
| `instantiates` | a concrete package invocant on `->new`, or `new` with a named class argument | the invocant node |
| `extends` | `use parent` / `use base` / `use Mojo::Base` (named **or** flag-only), an `@ISA` / `$ISA` assignment, and Moo's `extends 'X'` | the naming node |
| `implements` | Moo `with 'R'` and `use role 'R'` | the argument node |
| `overrides` | a class method whose name the first declared base also declares | no, by design |
| imports | `use Module ...` and `require Module`; **never** `no` | |
| exports | `@EXPORT`, `@EXPORT_OK` and the `%EXPORT_TAGS` keys | |

### `line_number` (M59.A7)

Every relationship that corresponds to a **source construct** carries that
construct's 1-based `line_number`, taken from the node that *names* the edge -- the
callee leaf, the invocant, the heritage word -- never from the enclosing statement.

Measured over the 7-corpus census (107,513 relationships):

| label | with a line | without | why |
| --- | --- | --- | --- |
| `calls` | 71,230 | 0 | |
| `instantiates` | 3,307 | 0 | |
| `implements` | 666 | 0 | |
| `extends` | 1,959 | 0 | |
| `contains` | 22,266 | 0 | the line that NAMES the child, via `meta.nameLine` |
| `overrides` | 8,085 | 0 | the OVERRIDING method's own declaration line |

**All 108,013 relationships carry a line.** This table used to record two
"declared exceptions" -- `contains` and `overrides`, 30,351 edges between them --
and both declarations were wrong, which is worth setting out because the reasoning
in each sounded right:

  - `contains`: "membership is a fact about two symbols, not a construct." True of
    the EDGE, and irrelevant to its line. The CHILD's name is written in the file:
    `sum` is on the line reading `method sum ($self) { ... }`. M60's own lane audit
    classes a lineless edge as a finding precisely when the target name is written
    there, and c, cpp and objc all moved their `contains` edges onto the child's
    own name for this reason (#921). "No naming node" was true of the POST-PASS
    and false of the child.
  - `overrides`: "an inferred edge, or a guess." The inference is about the BASE
    -- a first-parent chain, which is why the edge carries confidence 0.5 and
    `evidenceClass: inferred` and can never clear a structural floor. The method
    being overridden is not in doubt and is written in this file, so it has a
    naming node like any other declaration.

Neither had a fixture: both expectations pinned `line_number: null`, the harness's
UNKNOWN assertion, which made the absence an assertion rather than an oversight.
What found them was `script/m14/tmp/perl-lineoracle.mts`, which reads each claimed
line back against the file's own text -- presence is not correctness, and a
fabricated 0 or a container's line copied onto every member scores identically to a
right one. Two fixtures, two pins and six mutants now hold the rule.

The per-label table and the census total are two instruments and they agree to
the edge: `fixtures/perl/census.mts` and `fixtures/perl/lineless.mts` both sum to
107,513. They did not agree for most of this wave (107,838 vs 107,870, a 32-edge
gap) because the two instruments walked different file sets -- see
[the file-surface section](#the-file-surface-is-production-s-exactly).

### Honesty: every sub-1.0 edge carries a reason code

`docs/M14-HONESTY-CONTRACT.md` section 4.1 requires a machine-readable reason on
any edge below confidence 1.0. Before this wave, 8,179 of 8,754 sub-1.0 edges in
the mojo sample carried a bare number. The vocabulary now says what is actually
uncertain: `name-only-callee`, `dynamic-receiver`, `concrete-invocant`,
`magic-token-invocant`, `use-parent-declaration`, `mojo-base-declaration`,
`isa-array`, `moo-role-composition`, `use-role-composition`, `base-declares-method`,
`first-parent-guess`.

`first-parent-guess` is the heuristic class, and it is deliberately small: since
PERL-MR15 built the cross-file companion, only the **347** `overrides` edges whose
base lies outside the project keep it, at **0.5** and below the 0.7 consumer
threshold, so they are counted as suspicion rather than as a claim. The other
6,111 are withdrawn outright and 1,627 are confirmed at 0.95 by a base that is
actually in the project.

## The grammar fact that decides this lane

The pinned build gives **one field name to several children** of a parenthesised
construct. `our @EXPORT_OK = (a => 1, b => 2)` puts `(`, the `list_expression` and
`)` ALL under the `right` field, so `childForFieldName("right")` returns the empty
`(` marker and the payload is unreachable through the single-child API.

Measured on 5,875 corpus files: **39,897 such sites across 41 field pairs, in 3,049
files (52%)** -- `variable_declaration.variables` 25,750,
`assignment_expression.right` 3,570, `binary_expression.right` 1,607, and so on.
Every payload read therefore goes through `fieldNodes()`, which collects *all*
children carrying the field.

Two consequences that are easy to get wrong:

- The `variable_declaration` scope (`our` / `my` / `state` / `field`) is an
  **unnamed** child token. A named-child scan finds nothing and every package
  global in the corpus vanishes -- the 2,379 constants measured before this wave
  all came from a `node.text.startsWith("our ")` prefix match. The scan walks the
  raw child list.
- `package NAME { }` does **not** leak the package past the closing brace; only the
  statement form does. Proved by executing perl 5.34: with `package Outer { }`
  followed by `sub after_block {}`, `__PACKAGE__` is `main`, and the pre-review
  analyzer reported `Outer`.

## Import and export semantics

- `no strict;` / `no warnings;` are **not** dependencies. `no` is the unnamed first
  token of the same node type as `use`; recording it as an import invented a
  dependency edge on files that load nothing.
- `use constant NAME => value` is a **declaration**, not a dependency. Each
  fat-comma key becomes a Constant and no import is emitted. Before this wave the
  lane recorded `import { module: "constant" }` and lost the constant.
- `require Module` at runtime **is** a dependency (39 sites in mojo alone) and is
  emitted with `isDefault: false`; `require 5.010` is a version check and is not.
- `use 5.010;` / `use v5.36;` are a **language version requirement**, recorded as
  `metadata.perlVersion`. An import named `5.010` would put a fake module in the
  dependency graph and in every unused-import report.
- The Exporter surface is `@EXPORT`, `@EXPORT_OK` **and** `%EXPORT_TAGS`. Reading
  only `@EXPORT` lost the whole optional half of every Exporter module: exports
  across the 7 corpora went from 795 to 2,170.

## What is ruled, and why

- **Parameters are rare in real Perl, and that is not a defect.** The dominant
  idiom is `my ($self, $id) = @_`, which is a lexical declaration, not a
  signature. Measured: 40 subs with a real `signature` across 5,866 files. The
  pre-review number was **0**, because `childForFieldName("parameters")` names a
  field the grammar does not declare -- the M14 #863 residual, repaid here.
- **`@ISA` is a `variable`, not a `constant`.** It is the inheritance mechanism,
  not an application constant; handing it to a user searching for constants returns
  an inheritance table. The inheritance edge is emitted separately and carries a
  line.
- **A file-scope call is sourced from `"global"`.** Perl's most common real-world
  shape is a script (`Mojolicious::Lite`, `t/` files), where the whole DSL runs
  outside any sub and there is no caller symbol to name. This matches the PHP and
  python analyzers, and -- with `line_number` present -- the indexer attributes
  such an edge to the innermost storeable symbol enclosing its call site.
- **Self-reference guards compare fully qualified names.** A class that names
  itself as its base (`use Mojo::Base 'SelfNamed'` inside `package SelfNamed`)
  yields a useless self-edge. A **leaf** comparison looks equivalent and is not:
  `package MojoliciousTest3::Baz` over `Mojolicious::Baz` is a real subclass of a
  different class, and a leaf guard deleted 7 legitimate override edges.
- **Perl 5.38 `class` / `role` / `field` are why the lane needed the grammar's full
  vocabulary.** They are core-OO declarations, and the pre-review analyzer emitted
  no class symbol for them at all -- its methods became ownerless functions and the
  fields disappeared.
- **`use Mojo::Base -base` means "subclass Mojo::Base itself".** The pre-review
  rule skipped every option-bearing form, so 53 of mojo's 118 inheritance sites
  produced no edge at all.

## Regex inventory

**Zero.** No `RegExp`, no pattern methods. The word splitter is a character scan and
unquoting is index arithmetic. The one pattern this wave introduced
(`node.text.replace(...)` on a quoted literal) was removed rather than kept, because
the lane's own documentation promises zero and the grammar exposes the unquoted
text under `content` on every shape that needs the fallback.

## Verification evidence

- **M12 pinned ground truth**: `validation/m12/ground-truth/perl.json` --
  **32/32 facts, zero line mismatches**, symbols *and* relationships, against the
  three pinned fixtures at their pinned lines.
- **Differential**, own oracle (`derivePerlEdges` in
  `script/m14/differential.ts`), at **full corpus depth on all seven corpora**.
  The F5 lane runs two (mojo, plack); the other five go through
  `script/m14/tmp/perl-diff-adjudicate.mts`, which reuses the harness's own
  oracle and its own matching predicate:

  | corpus | files | tree truth | covered | MISSING | unexplained |
  | --- | --- | --- | --- | --- | --- |
  | mojo (M12 pinned, F5 lane) | 274 | 11,137 | 100% | 0 | 0 |
  | plack (second, F5 lane) | 225 | 2,393 | 100% | 0 | 0 |
  | perl5 core | 3,607 | 48,052 | 100% | 0 | 0 |
  | Moose-2.4000 | 961 | 12,156 | 100% | 0 | 0 |
  | Catalyst-Runtime-5.90132 | 465 | 6,422 | 100% | 0 | 0 |
  | Moo-2.005005 | 141 | 1,479 | 100% | 0 | 0 |
  | DBI-1.654 | 101 | 2,348 | 100% | 0 | 0 |
  | **all seven** | **5,774** | **83,987** | **100%** | **0** | **0** |

  **Auditing the corpora the census walks but the F5 lane never sampled is what
  found the defects in this wave**, and it is worth saying why two F5 corpora
  could not have: mojo and plack contain **zero** bare-`extends` files between
  them, and the spelling is overwhelmingly a Moose idiom -- 401 of the census's
  5,774 files. A lane that measures two of its seven corpora is not measuring the
  language; it is measuring the two places it happened to look.

  What the wider audit found, and where each row came from:

  | corpus | before | after | what was missing |
  | --- | --- | --- | --- |
  | Moose-2.4000 | 97.7% | 100% | 278 `overrides` (bare `extends`) |
  | Catalyst-Runtime | 94.1% | 100% | 379 `overrides` (bare `extends`) |
  | Moo | 98.7% | 100% | 20 `overrides` (bare `extends`) |
  | DBI | 2 unexplained | 100% | an indirect-object class, and a hash key read as a class |
  | perl5 | never audited | 100% | 325 rows, mostly `&`-sigil code references read as calls |

  None of those rows were added by a fix. They are rows the analyzer was always
  supposed to emit and did not, or rows it emitted that named a type that does not
  exist. The first three corpora are the same defect three times, which is what a
  401-file idiom looks like from inside a lane that never looked at it.

  `contains` is in the compared label set for this lane, so its 22,266 corpus
  ownership edges are audited too -- the first lane in the family where they are.
  The allowlist filters the truth side only, so a label outside it could never be
  covered and would have been a guaranteed false MISSING.
- **7-corpus census**, 5,774 files (mojo, plack, perl5 core, Moose, Moo,
  Catalyst-Runtime, DBI): 30,347 symbols, 107,513 relationships, 28,317 imports,
  2,170 exports, **0 crashes**, **0 unknown kinds**, **0 empty names**, **0 unknown
  relationship types**, 55 files with parse errors (619 error nodes), 1,939
  symbol-free files (test and script files that legitimately declare nothing).
  4,570 distinct call targets (16,504 edges) name a method or bareword that no
  definition in the corpus provides; that is an inter-file resolution question,
  not an unknown kind, and it is why the lane emits `calls` to the name and lets
  the indexer resolve it.

### A call target carries its owner when the source proves one (PERL-MR11)

`Mojo::IOLoop->start` states two things: that a sub named `start` is being
invoked, and that its owner is `Mojo::IOLoop`. The lane published only the first,
so `Mojo::IOLoop->remove`, `Mojo::IOLoop->stream` and `Mojo::IOLoop->server`
collapsed onto `remove`, `stream` and `server` -- and a caller of one class's
method read as a caller of another's. The target is now `IOLoop.start`, using
the same leaf convention the `instantiates` path already used for
`Util.constructor`.

| receiver | target | why |
| --- | --- | --- |
| `Mojo::IOLoop` (a `package` node, or a bareword with `::`) | `IOLoop.start` | the class is **provable** from the token itself |
| `app` (a bare bareword, no `::`) | `level` | see below |
| `$self`, `$loop`, a chained `app->log` | `helper` | a value has no class to name |
| `Mojo::IOLoop->reset` | *nothing* | `reset` is a perl **builtin** |

Two of those rows are load-bearing and each has a mutant, because each is a way
this rule has already been got wrong.

**A bare bareword is not a class.** The grammar types `app` and `Mojo::IOLoop`
both as `bareword`, so node type cannot separate them and only the `::` can. In
`mojo/t/mojo/cgi.t` the same construct is a lexical holding a `Mojo::Server`;
qualifying it would invent a class named `app` -- the same fabrication as the
phantom `DSN` and `use_module` this wave removed. So the rule is deliberately
the *narrow* one: qualify only what `::` or a `package` node proves.

**The builtin test is about the method, never about the target's shape.**
`addCall` checks its argument against `PERL_BUILTINS`. When the argument became
the qualified `IOLoop.reset`, the test stopped seeing `reset` and the lane began
emitting edges for a builtin -- 3 of them on the first run (`IOLoop.reset`,
`Promise.map`, `Reactor.reset`). The method name is what decides that; the
qualification happens after the decision, not before it.

Measured with `script/m14/tmp/perl-receiver-scope.mts`, which walks the tree and
compares what the analyzer published against what the source proves, and exits
non-zero on any target the tree does not justify:

| corpus | call sites walked | provable package (now qualified) | bare bareword (leaf kept) | unjustified targets |
| --- | --- | --- | --- | --- |
| mojo | 28,885 | 2,599 | 235 | 0 |
| plack | 1,630 | 303 | 19 | 0 |
| Moose | 13,941 | 1,637 | 1,654 | 0 |
| Catalyst-Runtime | 6,401 | 266 | 305 | 0 |
| Moo | 1,074 | 111 | 288 | 0 |
| DBI | 2,045 | 107 | 109 | 0 |
| perl5 | 56,166 | 5,758 | 2,190 | 0 |
| **total** | **110,142** | **10,781** | **4,800** | **0** |

Neither the differential nor any other fixture could see this defect. The
independent oracle in `derivePerlEdges` derived the target by leaf name exactly
as the analyzer did, so the pair agreed on a shape both were wrong about --
100% covered, 0 unexplained, on all seven corpora, the whole time. This is the
third time that pair has agreed on a shared premise (after the
`use constant { ... }` dead branch and the oracle's `!inSub` gap), and the
conclusion is the same: **agreement between an analyzer and an oracle is not
evidence about the source.** Only `perl/receiver-qualification` pins it, and
only the AST count gives it a size.

### A callee the source does not write is not a name (PERL-MR12)

The M59 line oracle reads every claimed line back against the file's own text, and
in doing so it asked a question the differential never could: is the NAME on that
line? A target that is not written cannot be verified, so it is a fabricated claim
rather than a weak one. Three classes came out of it.

**A method call whose name is computed.** `$self->${\( EXPR \)}` is perl's "call
the method this expression computes", and the grammar puts the whole expression in
the `method` field. The lane published that text as a callee name:

    Moo/Object.pm:56    calls -> DemolishAll->new
    Moo/Role.pm:224     calls -> ${\( $tc->can('coercion')||sub { ... } )}

The first is a `function` field holding compound text; the second is a fragment of
code. Neither is a method name, and 19 such edges left a 14-file draw. The rule is
a POSITIVE allowlist on the callee text -- a plain identifier, `::`-qualified, an
optional leading `&`, an optional leading `::` -- because a negative test can only
enumerate the dynamic cases somebody already hit, and this pair has been wrong that
way three times. The children are still walked, so the ordinary class call INSIDE a
deref is published: `Method::Generate::DemolishAll->new` inside `${\( ... )}` becomes
its own `instantiates` edge, and the fixture pins that control beside the refusal.

Two shapes in that allowlist are there because omitting them was a self-inflicted
regression, measured rather than argued: a leading `::` is how perl writes an
absolute package path (`::is_deeply`), and whether a leading `&` is a CALL or a
code-slot REFERENCE is `hasArgumentSyntax`'s decision, not the name test's. Leaving
both out cost 32 truth rows on Moo, 155 on Moose and 97 on perl5 -- all of them
calls the file really makes.

**An edge naming the KEYWORD instead of the name.** `use parent` takes a list:

    use parent 'Class::MOP::Module',        <- what addBase stamped
             'Class::MOP::HasAttributes',   <- where HasAttributes is written
             'Class::MOP::HasMethods',
             'Class::MOP::HasOverloads';

Three of Moose's four bases in `Class/MOP/Class.pm` live on lines the `use` never
touches. `addBase` was handed ONE shared `nameNode` -- the `parent` keyword -- which
is right for a single-argument list and wrong for every longer one, which is why no
fixture caught it. The same shape appears in `use role 'R'`, which was stamped from
the `role` keyword's node, and in Moo's `with qw/\n  MooseRoleOne\n  MooseRoleTwo\n/`,
which is ONE `quoted_word_list` node starting on the `with` line with the role names
*below* it. Each now claims the line its name is written on, with the keyword's line
kept as the fallback so an unresolvable shape keeps its previous line.

**And the oracle had to be corrected in the same direction, twice.** Its first gate
on the written-name rule was an early `return src()`, which leaves the walk BEFORE
its child loop -- so refusing to name a callee also stopped the children being
walked, and every real call inside a deref vanished from the truth side. The
analyzer's equivalent is a `break` out of a `switch`, which falls through to its
child walk. And the rule had to be stated in BOTH the file-scope and in-sub call
branches; it is a separate `if` with its own push, and stating it once has now cost
a mojo row. This is the one place in the analyzer/oracle pair where sharing a rule
is right: MR1, MR10 and MR11 were shared DERIVATIONS, where agreeing proved nothing,
while "a method name that is not written cannot be named" is a fact about the
file, so both sides testing it is corroboration.

Measured: 420 files, 14,103 relationships through the line oracle, **0 INCONSISTENT**
across Tiers A, B and C, with the oracle's own +7 line-shift self-test caught. The
corpora do **not** exercise the wrapped-declaration shape -- 0 symbols where the
name line differs from the declaration start -- so a fixture is the only thing
holding that rule, and that is stated rather than left implied.

### The file surface is production's, exactly
Three instruments walk the corpora -- `fixtures/perl/census.mts`,
`fixtures/perl/lineless.mts` and the F5 lane in `script/m14/differential.ts` --
and for most of this wave they walked **three different file sets**, which is
why no two of their numbers agreed (107,838 / 107,870 / 111,106+2,393).

`src/ast/language-detection.ts:42` maps `rb php lua pl pm t perl`, and `PL` is
**not** in that table: a `.PL` file is not a perl file to the engine. The census
walked `PL` for perl5 and Moose (92 extra files, 91 of them perl5's), the F5 lane
walked `PL` everywhere (one extra `Makefile.PL` each in mojo and plack), and
`lineless.mts` had its own hardcoded regex with `PL` in it. All three are now
`pm,pl,t`, which is production's set, and all three now sum to the same 107,513
relationships over the same 5,774 files.

The 92 excluded `.PL` files are real Perl that the product does not index. They
are named here rather than quietly dropped, because the line to move is this one:
if `language-detection.ts` ever routes `PL`, the census's ext sets, the F5 lane's
`ext` and `lineless.mts`'s regex all have to move with it.
- **Grammar pin**: registered and green -- `all 144 declared names present (4
  supertypes hidden by design), 140 wasm-named types all declared, 0 built-in
  extras`.
- **Fixtures**: `validation/m14/fixtures/perl/` -- one per defect class
  (package-block scope, signatures and attributes, 5.38 class/role, imports and
  exports, builtins and branches, inheritance declarations, magic-token invocant).
- **Forward compatibility**: emissions are identical under the wired 1.2.1 build
  and a fresh 2.0.0 build on **5,765 of 5,774** files (99.8%), measured by two
  independent passes -- one grammar per process, one corpus per process, 0 parse
  failures on both sides. The 9 that differ are all the same shape, and 2.0.0 is
  the **worse** answer on every one of them, which is why the transparency fix is
  recorded as a bump requirement rather than added to the wired build. An earlier
  version of this line said 5,750 of 5,774 with 24 differing and the direction
  reversed; see [the 2.0.0 upgrade](#the-200-upgrade-measured-refused-and-partly-repaid).

## The 2.0.0 upgrade: measured, refused, and partly repaid

`tree-sitter-perl@2.0.0` declares exactly one type over 1.2.1 --
`parenthesized_expression` -- and that is the wrapper that removes the multi-child
paren field:

| | 1.2.1 (wired) | 2.0.0 |
| --- | --- | --- |
| files with an unreachable payload field | 3,049 / 5,875 | 564 / 5,875 |
| unreachable sites | 39,897 | 1,419 |
| affected (node, field) pairs | 41 | 5 |
| parse damage on mojo | 4 / 275 | 4 / 275 |
| mojo trees identical to the wired build | 275 / 275 | 152 / 275 |

### What the first comparison got wrong, three ways

This section previously read "the 24 files where 2.0.0 is worse", with the
direction stated the other way round. Three separate faults produced that, and
they are recorded because each one produced a number that looked like a finding.

**The tool scored crashes as disagreement.** Its in-process diff mode caught a
thrown parse in `catch {}`, leaving that side's emission set empty. An empty set
compares equal to "this grammar agrees about nothing", so **2,806 of 5,774 files
(48.6%) were reported as 100% disagreeing** -- and the denominator still printed
5,774. Every figure that run produced was computed over 51% of the corpus. The
aborts were never a property of a file or a grammar: each corpus passes cleanly in
its own process with 0 parse failures, one file parsed 300 times in a row never
fails, and `Math/BigInt/t/isa.t` analyzes identically under both grammars in a
fresh process. The comparison is now two independent passes -- one grammar per
process, one corpus per process, throws recorded *into* the digest rather than
dropped -- and it prints its own coverage beside its verdict.

**The labels pointed backwards.** A per-file diff reported
`items=["VMS","VMS","skip_all","tests"]` as 2.0.0's output. It was **1.2.1's**.
2.0.0 was the correct side of essentially every disagreement, so a bump would have
*hidden* these defects rather than fixed them. Three label bugs agreed with each
other, which is how a measurement gets believed; only running the analyzer
directly on the file caught it.

**Seven of the node types named by the fix did not exist.** `fat_comma`,
`anon_sub`, `subroutine`, `match_expression`, `logical_expression`,
`list_call_expression`, `list_operator_expression` are in **neither** generation --
they were named by pattern from other grammars' conventions instead of read out of
`node-types.json`. All seven were dead branches, invisible to the fixture suite
because fixtures run 1.2.1 where the branches were equally dead. One was
load-bearing in a commit message, which claimed the `fat_comma` guard was "kept
for the grammars that do wrap"; no grammar wraps.

### The four rules, and what they repaid

The requirement this section used to state as outstanding -- *harvesting must
respect the `parenthesized_expression` boundary and must not read a nested list's
fat-comma keys as import names* -- has now landed, as four rules, all pinned by
`perl/import-argument-items` and four mutants:

1. A top-level `=>` makes a `use` argument list a key/value **specification**, not a
   list of names. Scoped to the import site: written into the shared word harvester
   it also silenced `our @EXPORT_OK = (gamma => 1, delta => 2)` and deleted four
   real exports.
2. **Code is not names**, for a `?:` branch.
3. **Code is not names**, for a call's arguments -- `use feature (sprintf(":%vd",
   $^V))` was recording sprintf's *format string*.
4. The `parenthesized_expression` transparency is deliberately **not** in the wired
   build; see the residual below.

The section's own example, re-measured against the current analyzer:

```perl
use Test::More (
    $^O eq 'VMS'
    ? ( skip_all => 'VMS' )
    : ( tests => 1 )
);
```

| | wired 1.2.1 | 2.0.0 |
| --- | --- | --- |
| `imports[0].items` | `["*"]` | `["*"]` |

Both grammars now agree, and `["*"]` is the honest answer: `skip_all` and `tests`
are `Test::More` plan arguments and `VMS` appears in a comparison and in a value,
so there are no imported names to list. Before the rules, 2.0.0 returned
`["VMS","VMS","skip_all","tests"]`.

### The residual: 9 files, and why it is not a branch

With all four rules in place, **9 of 5,774 files still differ**, and all nine are
one class: 2.0.0 inserts `parenthesized_expression` between a statement and its
`list_expression`, so a direct-child lookup finds no list and the `use` loses its
items -- `use Encode ':all'`, `use overload(...)`, Catalyst's two plugins.

That fix is intentionally **not** in the wired build. `parenthesized_expression`
does not exist in 1.2.1, the grammar-audit cell is zero-tolerance, and a branch for
a grammar the lane does not run is dead code by definition -- the same reasoning
that keeps `noninterpolated_string_content` out. The bump must re-add it, and
`reviews/perl/master-review.md` is where that requirement is recorded.

### Why it is still refused

Four measured reasons: it changes 123 of 275 trees on the corpus the M12 claims
were measured on, so it would invalidate the M12 corpus claims and every other
lane's pinned F5 row; the residual 5 unreachable pairs are genuinely repeated
fields that a collect-all-children read handles correctly anyway; the analyzer is
already correct under 1.2.1 on all but 9 of 5,774 files, so the bump buys almost
no correctness; and those 9 are a regression the bump must fix *first*, not a
re-baseline cost to accept. It is a scheduled grammar bump with an analyzer change
and a re-baseline, not a silent swap.

> Reproduce it with the two-pass comparison rather than a single in-process diff:
> `script/m14/tmp/perl-forward-compat.mts --grammar <name> <corpus>` writes one
> digest TSV per grammar per corpus, and the TSVs are compared outside any WASM
> runtime. A digest difference is a *value* change; the instrument prints
> `parseFailures` per pass so coverage cannot be inferred from the file count.

## Complexity envelope

One recursive AST walk. Symbol and relationship identity are O(1) set/map lookups;
contains and override resolution are linear post-passes. `fieldNodes` scans a
node's direct children, never the tree. `collectErrors` and `countBranches` are
iterative over an explicit stack rather than recursive, so deep Perl files do not
risk a JS stack overflow.

`PERL_BUILTINS` is derived from the grammar's own fixed op-token sets intersected
with perl 5.38's `opcode.h`, not hand-listed. The pre-review list was missing 10
words, and `say` and `system` alone produced phantom call edges on mojo.

`cyclomaticComplexity` counts decision points by the grammar's real node types --
`conditional_statement`, `elsif`, `loop_statement`, `for_statement`,
`cstyle_for_statement`, `conditional_expression`, `postfix_conditional_expression`,
`try_statement`, `catch`, plus the short-circuit operators. The pre-review set named
six node types the grammar does not declare, so the metric was 1 for almost every
real file; a fixture with ten decision points now reports 11.

## Honest limitations

- Cross-file override precision uses the project companion index, which production
  now builds (PERL-MR15, `src/ast/override-companion-pass.ts`, wired in
  `indexProjectParallel` before the store). Measured over all 5,774 corpus files:
  of 8,085 `overrides` edges, **1,627 are confirmed at 0.95, 6,111 are WITHDRAWN
  (75.6%), and 347 stay first-parent guesses at 0.5** because their base is outside
  the project. Before this, 75.6% of the label was false and every gate was green,
  because MISSING=0/unexplained=0 asks whether an edge is EXPLAINABLE from the tree,
  not whether it is TRUE.
  Two limits remain, both recorded in `perl/override-companion-resolve`: a base
  that declares NO method never enters the companion (`mergeSymbolsIntoOverrideCompanion`
  creates an entry only for a method symbol), so withdrawal is undecidable for it;
  and only the FIRST declared base is consulted, so one `use parent` per owner is
  what gets resolved. The companion is scoped to perl — making it
  language-agnostic would move java/kotlin/python/php/swift/dart, whose pinned
  baselines were measured without one.
- A method call on a dynamic receiver is a leaf-name match. The owning class is
  not knowable at this layer, which is what `dynamic-receiver` records.
- `use base` / `use parent` inheritance is read from one file. A base declared in
  another file of the same project is not seen, so `extends` targets can be
  external.
- Symbol-free files (1,939 across the census) are test and script files that
  legitimately declare no package or sub; each was inspected rather than assumed.
- The F1 grammar cell is green (0 unknown node types, 0 unknown fields). The 415
  node *types the corpora contain* is a different set from the 140 the grammar
  *declares*, and the classification that matters is the declared one: all **142**
  are in exactly one bucket of `script/m14/spec/perl-completeness.json` (**52**
  handled, **76** internal-silent, **14** ruled by 14 decisions, **0** gaps). Note the wasm declares 168
  named node-type **ids** that resolve to 140 unique names, so the completeness
  gate's "168 types" and this spec's 140 are both right and mean different things.

## What is measured, and what is still open

| station | state |
| --- | --- |
| F1 grammar cells | **green** -- 0 unknown node types, 0 unknown fields, 0 entries in the dead-literal record. **This claim was false when first written**: the cell was red at 2 unknown types and 1 unknown field, and the doc asserted green anyway. It is green NOW by measurement (`audit-analyzer-grammar.ts`, `perl PASS refs=53 unknown=0 unknownFields=0`), after PERL-MR4 removed seven node types it had invented. See the correction below. |
| F3 fixtures | **13 expectations, 13/13 pass.** `validation/m14/fixtures/perl/` — one per defect class, plus the three-file `override-companion-resolve` group that pins confirmed / withdrawn / unknown-base together |
| F4 mutation | **39 mutants, 39/39 caught** |
| perl ownership gate | **29/29** -- perl-owned CONTENT, seconds to run, the row that catches a commit that rebuilt a perl file from a stale base |
| line oracle (M59.A7) | **0 INCONSISTENT** over a 60-file draw per corpus (7 corpora, 14,156 edges), self-test caught. Presence at full depth: `perl-lineless` reports **107,467 / 107,467** relationships carrying a line, 0 without, across all six labels |
| #419 structural (A) | green -- 170/170 classified, each in exactly one bucket |
| #419 relationship kinds (B) | green -- the six kinds the lane emits, all pinned |
| #419 payload matrix (C) | green -- complexity, parameters, decorators, imports, exports |
| #419 evidence tiers (D) | green -- 3 tiers, 27 pins |
| #419 docs (G) | green |
| #419 differential (E) | green -- `mojo:perl` and `plack:perl` rows pinned, 0 missing / 0 unexplained |
| #419 perf (F) | green -- `avgMsPerFile` recorded for both |
| cross-language (H) | green |

All eight are green and perl is in `GATED_LANGS`. E and F were the last two, and
they got there the only honest way available: a **sanctioned scoped
`--pin-baseline`**, which added exactly two rows (`mojo:perl`, `plack:perl`) and
left all 181 existing rows byte-identical. A plain scoped differential
deliberately writes no evidence -- replacing a 30-language artifact with a
2-corpus one would shrink the milestone's claim -- and quoting someone else's
sweep as perl's result would have been worse. The gate is re-pinned whenever
the analyzer's edge set changes, because the pin records a `sampleSetHash` of
what the analyzer actually published; after PERL-MR11 it was re-pinned and the
diff was 11 lines, all inside the two perl rows.

`GATED_LANGS` means "reached CONFORMANT and runs in `npm run verify`", so
membership is a claim about the *whole* verify run too. Perl is in it; the
30-language `npm run verify` is not currently clean, for other lanes
(groovy, objc, lua/nim fixture coverage, stale F1 records). That is a
milestone-level fact for the owner, not a perl one, and nothing here
self-closes it.

### A false claim this document used to make

An earlier version of this file carried the line "F1 grammar cells: green -- 0
unknown node types, 0 unknown fields". It was **not green.** The cell was red at
**2 unknown node types and 1 unknown field**, and the sentence was written from
the pin being green rather than from the audit having been run. Two of the three
were branches this wave had just added for `tree-sitter-perl` **2.0.0** --
`noninterpolated_string_content` and `parenthesized_expression`, neither of which
exists in the wired 1.2.1 grammar -- and the third was
`childForFieldName("signature")`, which returns `undefined` on every sub.

That third one is the sharp end. `signature` is a node **type**, not a field: the
grammar's 44 field names are `alternative, arguments, array, arrayref, attributes,
block, body, callback, catch_block, catch_expr, condition, consequent, content,
continue, default, finally_block, function, hash, hashref, index, initialiser,
invocant, iterator, key, label, left, lexical, list, loopex, method, modifiers,
module, name, operand, operator, phase, right, statement, try_block, type, value,
variable, variables`, and `signature` is not among them. So the #863 fix had
replaced one non-existent field with a different non-existent field, and the
`findChildByType` fallback beside it is what has been producing every parameter all
along. The wrong word -- "FIELD" -- is what produced the original bug, and it
survived in the comment that claimed to have fixed it.

All three are gone rather than waived. The grammar allowlist is "empty by design:
every current finding must be fixed or justified", and both existing waivers
(`java`'s `comment`, `swift`'s `String`) are for literals the audit
*misenumerates* -- live code, not dead branches. These were neither. The 2.0.0
branches are requirements of a bump that is explicitly **not authorised**; they
belong to that wave, and deleting them moved **nothing** on any of the seven
corpora, which is the proof they were dead:

| corpus | before | after |
| --- | --- | --- |
| mojo / plack | 11,137 / 2,393, 0 / 0 | 11,137 / 2,393, 0 / 0 |
| Moose / Catalyst | 12,156 / 6,422, 0 / 0 | 12,156 / 6,422, 0 / 0 |
| Moo / DBI / perl5 | 1,479 / 2,348 / 48,052, 0 / 0 | 1,479 / 2,348 / 48,052, 0 / 0 |

The dead-literal record for perl is now **empty**, which is what closes #863: the
issue asked for the dead field read to go, and the register that existed to track
it is finally clear.

The lesson is the one the head gate now enforces: a claim copied from a
neighbouring gate is not a measurement. The pin being green says the grammar is
pinned; only the audit says the analyzer has no dead branches, and only the audit
was asked.

The two fixtures-plus-mutants waves each found something the previous station
could not, which is the argument for running them in this order:

- The **fixtures** found two real defects the differential could not see: the
  `use constant { ... }` brace form declared nothing (13 constants on mojo), and a
  double-quoted `use` argument lost its items. The brace form was invisible to the
  differential because the independent oracle carried the *same* dead branch --
  two implementations agreeing on a wrong reading of the grammar.
- The **mutants** found two holes in the machinery: `forbidImports` and
  `forbidExports` did not exempt `note`/`comment` the way `matchConstraints`
  does, so a forbid pin that documents itself could never fire (three mutants
  survived a suite that looked complete); and the completeness gate caught the spec
  leaving 5 of 140 types in no bucket and 2 in two.
