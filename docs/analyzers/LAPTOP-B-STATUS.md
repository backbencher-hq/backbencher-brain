# Laptop B — relationship-type tracker

This laptop's own file. One row per lane, one column per relationship type. Tick a cell
when a verdict for it has been **measured and committed**. A cell is not ticked because
someone believes it works.

Laptop B owns 23 lanes (`docs/analyzers/PROMPT-LAPTOP-B.md:15`, quoted with its line
number on purpose so the next reader can check it rather than trust it):

bash · f# · zig · lua · julia · nim · php · powershell · r · dart · sql · graphql ·
protobuf · json · yaml · css · scss · hcl · make · toml · xml · markdown · clean

## The four things a cell can say

| cell | means | what it costs |
|---|---|---|
| `E` | **EMITTED** — the type fires, measured on the production path | a count and a file count |
| `R` | **RULED** — a corpus measurement proves the construct never occurs | the corpus and the zero |
| `N/A` | **not applicable** — this language cannot express it at all (a stronger RULED) | the reason, stated |
| `·` | no verdict yet | — |

`N/A` is a **verdict**, not a blank. A lane is complete when every one of its ten cells
is `E`, `R` or `N/A` — and `N/A` may only be claimed behind a corpus measurement, never
on a prose argument. Completeness is `N/N applicable`, where `applicable = 10 − N/A`.

## The grid

`E` cells below are **seeded** from `validation/m60/results/rel-type-coverage.json`
(generated 2026-10-07T01:58Z). Read them as *"the coverage gate records this type as
firing"*, **not** as a closed verdict: a closed verdict also needs the type to be audited
by a differential and, for the row to mean anything, its incoming side measured.

```
lane        calls cont  expo  exte  impl  impo  inst  over  refe  uses   | ruleable via | applicable | incoming AMB / UNRES
bash         E     E     E     ·     ·     E     ·     E     E     E    | TABLE        |    7       |    623 /   5,084
clean        E     E     E     ·     E     E     E     E     E     E    | — none —     |    9       |  3,520 /   3,097
css          ·     E     ·     ·     ·     E     ·     E     E     E    | TABLE        |    5       |      5 /   4,401
dart         E     E     E     E     E     E     E     E     E     E    | SPEC         |   10       |  4,673 /  14,515
f#           E     E     ·     E     E     E     E     E     E     E    | TABLE        |   10       | 40,791 /  33,339
graphql      ·     E     E     E     E     E     ·     E     E     E    | — none —     |    6       |  3,710 /   4,427
hcl          E     E     E     ·     ·     E     ·     E     E     E    | SPEC         |    5       |  3,800 /   8,417
json         E     E     E     E     E     E     ·     E     E     E    | TABLE        |    2       |     71 /       0
julia        E     E     E     E     ·     E     E     E     E     E    | TABLE        |    9       |  4,249 /  19,281
lua          E     E     E     E     ·     E     E     E     E     E    | TABLE        |    9       |  7,409 /   6,663
make         E     E     E     ·     ·     E     ·     ·     E     E    | SPEC         |    6       |      0 /   1,636
markdown     ·     E     ·     ·     ·     E     ·     ·     E     E    | SPEC         |    4       |     68 /  15,107
nim          E     E     E     E     E     E     E     E     E     E    | TABLE        |    9       | 12,491 /   9,424
php          E     E     E     E     E     E     E     E     E     E    | TABLE        |   10       |  4,606 /  17,784
powershell   E     E     E     E     E     E     E     E     E     E    | SPEC         |    6       | 18,665 /  46,944
protobuf     ·     E     E     ·     ·     E     ·     E     ·     E    | TABLE        |    4       |      3 /   1,486
r            E     E     E     E     E     E     E     E     E     E    | — none —     |    5       |      8 /     190
scss         E     ·     E     E     ·     ·     ·     E     E     ·    | — none —     |    7       |      0 /   1,185
sql          E     E     E     E     E     E     E     E     E     E    | TABLE        |    6       |    198 /     973
toml         ·     E     ·     ·     ·     ·     ·     ·     E     ·    | TABLE        |    2       |     45 /       0
xml          E     E     ·     E     ·     E     ·     E     E     ·    | TABLE        |    3       |  6,007 /      72
yaml         E     E     E     E     ·     E     ·     E     E     E    | SPEC         |    4       |    135 /     225
zig          E     E     E     ·     ·     E     E     ·     E     E    | TABLE        |    7       | 19,962 /  14,461
```

**Two columns, two instruments — do not subtract them.** The `E` grid comes from the M60
coverage gate; `applicable` and `AMB/UNRES` come from `incoming-check` (30-file sample
for `applicable`, whole-corpus — 600 files per lane, `make` 129, `clean` 164, `r` 21 —
for `AMB/UNRES`). They **disagree for 11 of 23 lanes** (`json` 9 emitted vs 1 fired;
`sql`, `nim`, `r`, `powershell` 10 vs 5–8). Reconciling them is open work.

## Per-lane detail

**Ruling sources — 19 of 23 are ruleable, not 23.** 13 have a corpus-measured table
(`bash css fsharp json julia lua nim php protobuf sql toml xml zig`), 6 stand on a SPEC
prose ruling (`dart hcl make markdown powershell yaml`), and **4 are unadjudicated:
`clean`, `graphql`, `r`, `scss`** — no table and no spec ruling.

**Types that fire but are compared against nothing** (emitted ∩ never-audited, from the
coverage gate). 83 type-instances fleet-wide:

| lane | count | types |
|---|---|---|
| sql | 9 | everything except `imports` |
| hcl, json, lua, make, nim, r, yaml | 6 each | calls, contains, exports, imports, references, uses |
| graphql | 5 | contains, exports, imports, references, uses |
| clean, protobuf, xml | 4 each | contains, exports, imports, uses (+ extends, overrides for xml) |
| php | 3 | contains, exports, imports |
| dart, fsharp, julia, markdown, scss | 2 each | dart: overrides, references · f#: imports, uses · julia: exports, imports · markdown: imports, references · scss: calls, exports |
| powershell | 1 | imports |
| bash, css, toml, zig | — | clean on this axis |

## The dart row, and Flutter — a population gap, not an analyzer gap

**Decision: dart is not declared "a Flutter analyzer".** That phrase is a promise about a
*target universe*, and the measured target universe is currently missing. The dart lane's
population is three corpora:

| corpus | size | .dart files | files with `part` | mixins | extensions |
|---|---|---|---|---|---|
| dart-sdk | 529 MB | 25,734 | 1,229 | 1,426 | 1,901 |
| dart-http | 8.6 MB | 335 | 9 | 1 | 9 |
| flutter-packages | 280 MB | 4,033 | 145 | 94 | 58 |

### What the corpus does NOT contain

`flutter-packages` is flutter/flutter's **`packages/`** directory — the ecosystem
(go_router, camera, google_sign_in, material_ui, …) — **not the Flutter framework**.
Measured on 2026-10-07:

- `packages/flutter/lib/src/widgets/**.dart` → **0 files**. `packages/flutter/lib/src/material/**.dart` → **0 files**.
- No Flutter SDK checkout exists at all (no `bin/flutter`).
- `BlocProvider` → **0 files**, `Bloc<` → **0**, `Cubit<` → **0**, `emit(` → **0**. The
  blocs/cubits case named by the engineers is **not in the population to be tested**.
- But `extends StatefulWidget` → **658 files**, `extends StatelessWidget` → **651**,
  `with …Mixin` → **127**, `@override` → **1,873**.

So **1,309 files have a superclass declared in a package that is not in the corpus**, and
1,873 files override a member declared in the framework. `StatelessWidget`,
`StatefulWidget`, `BuildContext`, `Widget` and the `TickerProvider` mixins are all declared
in `package:flutter/*`, which is `N/A` to every resolution walk — not because the analyzer
is blind, but because the declaration is outside the declared population.

### Why the committed numbers look the way they do

The analyzer is not naive about Flutter: `real-dart-analyzer.ts` handles
`mixin_declaration` (including the `on` constraint), `mixin_application`,
`extension_declaration`, `extension_type_declaration`, `part_directive`,
`part_of_directive`, the `superclass`/`interfaces`/`mixins` heritage clause, type arguments
and Dart 3 class modifiers. The committed 600-file census
(`validation/m14/measurements/dart-600-8237d3e31ac2.raw.ndjson`, both-ends resolved
*within-census*) reads:

```
type          edges    files    both-ends resolved   conf < 0.7
uses         20,570      492           53.7%             2,457
calls        10,239      470           54.4%                 0
contains      6,936      348          100.0%                 0
instantiates  2,644      359           25.9%                 0
imports       1,815      472            0.0%                 0
references    1,320      162          100.0%                 0
overrides     1,220      147           16.1%                 0
extends         560      194           33.0%                 0
implements      276       81           38.0%                 0
exports          10        7            0.0%                 0
TOTAL        45,590                     39.2% (17,856)     2,457
```

Read those rows against the corpus gap and two distinct causes appear, neither of them
"Dart cannot do Flutter":

1. **`imports` resolves 0.0% across 1,815 edges — that is the enum blocker, not the
   corpus.** `Imports = "brain_import"` while the analyzer emits `"imports"`, so every
   import edge is invisible to consumers. This is the sharpest consequence of the blocker:
   an import edge is exactly how a Flutter file declares its dependency on
   `package:flutter/material.dart`, so the one edge type that ties app code to the
   framework currently delivers nothing.
2. **`extends` 33.0%, `overrides` 16.1%, `instantiates` 25.9%, `implements` 38.0% are
   measuring a missing target universe**, not a broken walk: their targets are the 1,309+
   framework superclasses and 1,873 `@override`s declared outside the population.

### What "perfect" requires here

Add the Flutter framework itself to the population (`packages/flutter/lib/**`) and the
packages the engineers name (flutter_bloc/cubit), land `ENUM_HARD_FIX` so `imports` exists
at all, then report dart **per corpus** — dart-sdk, dart-http, flutter-packages,
framework, ecosystem — so no gap can hide in a union average.

Under the standard set for this laptop (**all relationships resolved, no unknown, no
unexplained, and any residual stated with its reason**), the target is not
`unresolved = 0`. An edge whose target is declared outside the declared population is
legitimately **unresolvable**, and the goal is `unexplained = 0`: every unresolvable edge
carries a stated reason ("target declared in `package:flutter`, outside the declared
population") and a count. Chasing zero unresolved by guessing would fabricate edges, which
this programme has already been burned by.

### The bloc/cubit question, answered by measurement — and a correction

`validation/m14/fixtures/dart/flutter-bloc-generic-target.{dart,expectation.json}`
isolates the bloc/cubit question from the corpus by **declaring** the framework types in
the fixture, so it measures the ANALYZER and no corpus addition can change its verdict.
It is the dart lane's only Flutter fixture; the other 21 predate it and pass.

**CORRECTION, recorded on purpose.** The first version of this expectation asserted
`uses` for the two type-argument edges and a bare `build` for the override target, and it
FAILED on all three. My conclusion from that run — published in an earlier revision of this
file — was that "a call-site type argument is not being published as the edge target".
**That was wrong.** `validation/m14/fixtures/dart/dump-symbols.mts` shows the analyzer had
already emitted:

```
references   build -> CounterCubit                      line 72 conf 0.95
references   build -> CounterBloc                       line 73 conf 0.95
overrides    CounterPage.build -> StatelessWidget.build          conf 0.95
overrides    CounterBloc.state -> BlocBase.state                conf 0.95
```

The EXPECTATION was wrong, not the analyzer: a type mention is published as **`references`**
at 0.95 by `collectTypeMention`, and an `overrides` target is **owner-qualified**
(`StatelessWidget.build`, not `build`). Two cells were labelled from assumption instead of
from the store, which is the same defect class this programme keeps meeting — a number (here
a verdict) produced by an instrument that was never read. The fixture is still worth its
place: it is the lane's only Flutter coverage, and it pins the answer. Corrected run:

```
bun run script/m14/run-fixtures.ts --lang dart   ->  summary: {"dart":{"pass":22,"fail":0}}
```

**So: the bloc/cubit dependency resolves, and it resolves as `references` at 0.95.**
`context.read<CounterCubit>()` and `BlocBase.of<CounterBloc>(context)` both produce an edge
whose target is the **type argument** written inside the angle brackets — the semantically
meaningful declaration — with the call itself labelled separately (`calls build -> read`),
so nothing is double-counted. Flutter's dependency idiom is already expressible in the
ten types on this analyzer. The fixture now pins that, and forbids the weaker `uses` label
from drifting back onto it.

### Then what does Flutter actually need?

Not a second analyzer — a Flutter analyzer would duplicate ~99% of this file, and the
measurement above shows there is no Flutter construct it fails to resolve. Two things, and
neither is a rule-set gap:

1. **The corpus gap (population).** The framework is absent: `packages/flutter/lib/src/
   widgets/**.dart` is **0 files**. That makes `extends StatelessWidget` and its
   `@override`s point at declarations outside the population, which is why the committed
   census reads `overrides` 16.1% and `instantiates` 25.9% resolved — the fixture proves
   the same edges resolve when the base is present, because it declares one.
2. **The enum blocker.** `imports` resolves 0.0% across 1,815 edges, and an import edge is
   how a Flutter file declares its dependency on `package:flutter/material.dart`. This is
   `src/ast/types.ts` (`brain_import`), shared with the php and fsharp lanes.

The remaining dart work is therefore the incoming/ambiguity population (4,673 ambiguous /
14,515 unresolved whole-corpus) — name scoping, which is cause A and is the same fix the
other 22 lanes need.

## Blocked / pending

1. ~~**The enum blocker — affects every lane, both laptops.**~~ **REFUTED 2026-10-07, on the
   current tree, by the file itself.** `src/ast/types.ts:84` reads `Imports = "imports"` (the
   change landed in `3ebe0fb38`), and the comment above it records the same refutation from
   the other side: `"brain_import"` exists in no `src/` comparison anywhere. The second half
   of the claim is false too — **no analyzer imports `RelationshipType` from `./types`**; they
   all reach it through `ASTEngine` (`src/ast/engine.ts`), which is the same enum object. A
   blocker that was queued as `ENUM_HARD_FIX` + a 16-lane `ENUM_SWEEP` would have edited
   correct code in sixteen lanes. Re-check with two commands, one line:
   `sed -n '84p' src/ast/types.ts` and
   `grep -rn 'RelationshipType' src/ast/*.ts | grep -v engine | head`.
2. ~~**Four unadjudicated lanes**: `clean`, `graphql`, `r`, `scss`.~~ **REFUTED 2026-10-07**
   by the instrument this list names: `npx tsx script/m14/verify-ruling-tables-registered.ts`
   prints `unadjudicated lanes (neither table nor spec RULED) : 0`, with **20 ruling tables on
   disk and 20 registered** (`bash clean css dart fsharp graphql json julia lua markdown nim php
   powershell protobuf r scss sql toml xml zig`) and `PASS — every ruling table on disk is
   registered, and every registration resolves`. `clean`, `graphql`, `r` and `scss` each have a
   table. The four names came from an older run whose condition no longer holds; the row is kept
   struck through rather than deleted, because a blocker list that loses rows silently cannot be
   trusted to have lost only the false ones.
3. **83 emitted-but-never-audited type-instances** (table above).
4. **Incoming resolves in 0 of 23 lanes.** Whole-corpus, the worst are `f#` 40,791
   ambiguous, `zig` 19,962, `powershell` 18,665, `nim` 12,491, `lua` 7,409, `xml` 6,007.
   This is a *scoping* problem, not coverage: an ambiguous edge is one edge attributed to
   N declarations, so it cannot be reduced by emitting fewer edges.
5. **`calls` unresolved is real, not sampling** — on `sql` it stayed 36% at both 30 and
   400 files, while `uses` (71% → 5.0%) and `references` (32% → 1.3%) were sampling bias.
6. **Two instruments disagree — recomputed 14 of 23 lanes on 2026-10-07, not 11** (see the
   note under the grid; the row-by-row comparison is of the grid's `E` against the coverage
   gate's fired count, `json` 9 vs 1, `sql`/`nim`/`r`/`powershell` 10 vs 5–8 among them). The
   `11` is left visible under the grid rather than overwritten there, because the two numbers
   are from two readings of two artifacts and the second reader should be able to see both.
7. **Waiting on nothing external.** The three LSP branches are 0 commits ahead of `main`
   and `main` already carries `ide/vscode`, `ide/helix`, `ide/lsp4ij/bb-lsp`. Across all
   384 unmerged `origin` branches the union of paths `main` lacks is 2,066 files, and
   **0 are under `src/` and 0 under `ide/`** — they are `validation/` and `script/`
   evidence, not code.

## How to tick a cell

A tick is only written when the number and its population are committed:

```
bun run script/m14/run-fixtures.ts --lang <lane>          # the lane's fixtures
npx tsx script/m14/incoming-gate.ts <lang> <ext>          # outgoing + incoming
npx tsx script/m60/rel-type-coverage-gate.ts              # the E grid and audit gaps
bun run audit:ruling-tables                               # registration of rulings
npx tsx script/m14/verify-ruling-tables-registered.ts     # the unadjudicated list
```

Then write the cell, and commit the measurement that justifies it — one verdict per
commit. `N/A` requires the same evidence as `R`; it is never a shortcut.

## Round 1 (2026-10-07) — the whole-corpus walk cannot complete, and its checkpoint lies

**This blocks every whole-corpus dart number, so it comes first.** No analyzer change can
be scored until the walk finishes.

`npx tsx script/m14/ontology-coverage-gate.ts dart` over the **33,692 admitted files** of
the dart corpus does not reach its table. It prints no measurement at all:

```
[BB-PARSE-ERR] dart | .../is_postfix_completion_applicable_test.dart | memory access out of bounds
[BB-HANG] parser stuck 120s on .../is_postfix_completion_applicable_test.dart — exiting

re-run (resumes):
[BB-PARSE-ERR] dart | .../issue53209_2/main_lib.dart | memory access out of bounds
[BB-HANG] parser stuck 120s on .../issue53209_2/main_lib.dart — exiting
```

### The named file is innocent, twice over

| run | file named | size | parsed ALONE in a fresh process |
|---|---|---|---|
| 1 | `is_postfix_completion_applicable_test.dart` | 43 lines / 1,198 bytes | **clean** — 4 symbols, 20 rels |
| 2 | `pkg/front_end/.../issue53209_2/main_lib.dart` | a few lines | **clean** — 4 symbols, 5 rels |

A **different** file each run, and each one parses perfectly by itself. A content defect
cannot do that. This is why the lane's nine "hang runs" each ended by naming an innocent
file: the named file is the messenger, and the accumulator is the walk.

### The accumulator is retained WASM trees — measured, not argued

`script/m14/tmp/wasm-tree-retention.ts` on the same corpus, same order, one parser, with a
canary every N parses:

| mode | RSS @1,000 | RSS @2,000 | peak @2,600 | shape |
|---|---|---|---|---|
| **leak** (parse, keep rootNode, never delete) | 449 MB | 741 MB | **878 MB** | monotonic |
| **free** (`tree.delete()` after each file) | 126 MB | 135 MB | **139 MB** | flat |

6.3x less memory, and flat instead of climbing — about **0.29 MB retained per file**. The
mechanism is web-tree-sitter's: it allocates each `Tree` in the WASM heap and **only
`tree.delete()` returns it — there is no finaliser**, so one un-deleted tree per file
accumulates until `ts_malloc` cannot grow and the instance traps with `memory access out of
bounds`. The dart lane hit this ceiling; the walk is 33,692 files long.

**The rust lane already found and documented exactly this**, in `fbf950a35 fix(rust):
release every wasm tree — the sweep died at 5,000 files, not at one bad file`: "ALL 7,773
rustc files parse perfectly one at a time", recycling the parser did **not** fix it, RSS was
monotonic rather than sawtooth, and the remedy was a `tree.delete()` in a `finally`. It also
recorded the trap I am in: *"these tools print their report at the END, so heap exhaustion
produced NO OUTPUT AT ALL — indistinguishable from 'this corpus has no data'."*

Production is immune to this, and that was read rather than assumed: `engine.ts:2152`
deletes the tree in a `finally` ("🚨 CRITICAL MEMORY FIX"), and `parallel-indexer`'s worker
`exit` handler respawns a fresh worker with a fresh heap. **This is an INSTRUMENT defect** —
which is why the measurement layer dies and the analyzers do not.

### The checkpoint silently records killed files as WALKED

`validation/m14/measurements/walk-dart.txt` right now: **17,396 lines, all bare paths,
`0` marked bad** — i.e. **51.6% of 33,692**. Both files that killed the parser appear in it
as **completed**. That is the design working as written: the walk appends a path *before*
parsing it, so the log survives the hard `process.exit()` a 120s hang performs — "each line
was already on disk before the thing that could kill us began". The consequence is not the
one intended: **a file that kills the process is recorded as walked and is never retried**,
so the completed set over-counts and the effective population erodes by one file per death.
The `!` bad-marker is reserved for parse errors, and was never written here.

So every "N of N files" figure from this instrument is currently unsound in two ways: the
walk has not covered the corpus (51.6%), and some of the coverage it claims is a file it
never read.

### Next, in order

1. Release the tree in the walk's own path (a `finally`, mirroring rust) and prove the gate
   completes over all 33,692 files and prints its table.
2. Decide the checkpoint question honestly: a file recorded done-but-never-parsed must be
   distinguishable from one actually walked, or the corpus population is not a fact.
3. Only then measure the dart baseline (fired / ruled / applicable + incoming) that round 1
   was blocked on.

Whether the fix lands in a dart-owned file or in the shared gate (`script/m14/`,
`resumable-walk.ts`) is checked before editing, because php and fsharp are being worked in
parallel and a shared-file change has to be one owner's.

## PHP round 1 (2026-10-07) — the store deleted legal symbols, and recovery mis-nested a class body

Whole-corpus measurements, production entry point, all **5,094** admitted php files, 0 fallbacks.
Every number below is a delta against a re-run of the same instrument on the tree before the
round, so "+22" is a difference between two measurements and not a count from a log.

### 1. The symbol filter refused php names, not php declarations — **FIXED, 1 orphan edge → 0**

The projection (`src/ast/pool-worker.ts`, `keepSymbol`) refused php symbols **by NAME**
(`RESERVED = { php: new Set(["self", "parent"]) }`) with no reference to the kind or the owner,
while the analyzer kept emitting the `contains` edges that name those members. `self` and
`parent` are **semi-reserved** in php 7+: illegal as a top-level declaration name (`class parent
{}` is a parse error) and perfectly legal as a method, a property or a class constant. So the
rule deleted legal members and left edges with no endpoint. Whole corpus: exactly **one** such
edge existed — `contains Node -> parent` at `phpmyadmin/src/Navigation/Nodes/Node.php:54`
(`public Node|null $parent = null;`) — the lane's only orphan endpoint in 350,342 edges.

The fix exempts php **member kinds with an owner**; a class, interface, trait, enum, namespace or
top-level function named `parent`/`self` is still refused, which is the half that cannot be
written as valid php and is therefore pinned by an injectable mutant.

| | before | after |
|---|---|---|
| `contains` target not published | 1 | **0** |
| declared-in-tree-not-published edges | 248 | **24** |
| resolved unique | 128,795 | 129,020 **(+225)** |

**Why no fixture caught it, and why that is structural**: `script/m14/run-fixtures.ts:728`
evaluates every fixture with `analyzer.analyze()` **directly** (it says so at its own `:518`), so
a rule in the PROJECTION is invisible to all 26 php fixtures and to all 53 php mutants — every
one of them stops one layer above the rule. Hence `validation/m14/fixtures/php/
orphan-endpoint-gate.mts`, which imports `parseFile` (the production path) and fails on a
`contains` target its own file did not publish; it carries a control that refuses to report if
its classifier cannot separate a published target from an orphan. Current reading: **26 fixtures,
294 symbols, 242 contains edges, STRICT orphaned contains targets 0**, control PASS.

**The +225 is reported with a caveat rather than as a win.** 225 bare-name resolutions appeared
because the name `parent` now has exactly one published declaration — mostly `uses parent` in
`gql-graphql-php`'s `Visitor.php`/`VisitorTest.php` flipping from ambiguous to resolved. Those
edges are in OTHER repositories and resolve to `Node::parent`, a different repo's property. This
is cause A (name scoping) showing through a fix, not a resolution the fix earned, and it is
recorded so nobody reads +225 as coverage.

### 2. Recovery mis-nests, so the members after a damaged statement were invisible — **FIXED, 19 edges → 0**

`FSharp.Formatting/csharp/MarkdownSharpTests/source/php/markdown.php` writes **PHP-8-removed
curly-brace offset syntax** at line 910: `$level = $matches[2]{0} == '=' ? 1 : 2;`. The pinned
grammar errors there, and the recovery does not merely mark a node — it leaves the enclosing
method's body OPEN, so every following declaration becomes a `function_definition` **nested
inside** `method_declaration _doHeaders_callback_setext 905-1575`. That one file was the whole of
the 19 remaining `calls` edges in the audit's `DECLARED_IN_TREE_NOT_PUBLISHED` bucket: `doLists`,
`processListItems`, `makeCodeSpan`, `prepareItalicsAndBold`, `formParagraphs`, `encodeAttribute`,
`encodeAmpsAndAngles`, `encodeEmailAddress`, `handleSpanToken` — all real class members, called
from inside their own class, absent from the store.

**This is a CONTRACT VIOLATION, not a named limit**, and the contract was already written in this
lane: `php/error-recovery` states that for a file the parser cannot fully read, "the declarations
AROUND it still publish, INCLUDING THE ONES AFTER IT — degradation is PARTIAL, not total". That
fixture covers the shape where recovery MARKS a node; no fixture covered the shape where recovery
MIS-NESTS one.

Bisected rather than argued: replacing that ONE expression with `$matches[2][0]` moves 11 of 12
members back to direct children of the `declaration_list` and drops the nested count 9 → 0, while
the file's other legacy offset (`switch ($token{0})` at 1560) does not — so the two damage sites
differ, and a rule keyed on "the file has errors" would have fired on both. The fix is ONE
predicate asked by TWO paired halves: publish the mis-nested callables (as MEMBERS of the class the
source writes them in), and stop the damaged body's own walk from descending into them, or every
call inside them is emitted twice under two sources. `const`/`property` declarations are published
by the same escape but NOT skipped, because their branches never walk their initialisers and the
body walk is the only reader of those values.

| | before | after |
|---|---|---|
| declared-in-tree-not-published | 24 | **5** |
| resolved unique | 129,020 | 129,061 **(+41)** |
| edges total | 350,342 | 350,364 **(+22)** |
| published names | 21,200 | 21,222 **(+22)** |
| ambiguous / external / no-declaration / placeholder | — | **0 delta** |

The +41 is exactly 19 (the `calls` edges that now resolve) + 22 (the new `contains` edges for the
22 recovered declarations). The +22 edges are ALL `contains` (`contains` 35,087 → 35,109) and
**`calls` 103,190 and `uses` 155,016 are unchanged to the digit** — the fix published declarations
and fabricated no edge. That is what makes the instrument a verification rather than a report:
a fix that resolved edges by inventing them would move those two numbers.

Fixture `php/recovery-swallowed-members` (authored BEFORE the fix, with the pre-fix state measured
and recorded in it: **4 symbols / 9 edges**, against 8 / 13 after). Three mutants pin the decision
and all three are caught: the pre-fix state, the rejected reading (a recovered member published as
a GLOBAL function), and HALF the fix (the paired skip removed), which is caught only by the
fixture's `expectRelationshipCount` rows — `calls swallowedB -> swallowedA` exactly once,
`calls damaged -> swallowedB` exactly ZERO. That last mutant **SURVIVED the lane's own harness
while the production gate CAUGHT it**, and the difference was scope: `mutant-check.mts` checked no
count section at all. Two harnesses disagreeing about one mutant is a defect in the smaller one,
so its scope was extended and it now reads `all 11 mutants caught, 0 problems`.

### 3. The residue: 5 edges, each with a NAMED reason — unexplained = 0

| edges | target | reason (named, counted) |
|---|---|---|
| 1 | `calls -> findAllForUserEntity` (`WebauthnLibServer.php:136`) | declared on an **anonymous class** (`:345`), which this lane RULES unpublishable — M37.13: "the class has no nameable symbol, so no method symbol is fabricated". Counter-precedent, recorded rather than settled: java's family convention publishes `anonymous_<Super>`. Decision open. |
| 1 | `uses -> representation` (`ExporterTest.php:104`) | a property of that same anonymous class, same ruling. |
| 3 | `uses -> representation` (`:77`, `:88`, `:94`) | reads of a **PARAMETER** named `representation` — a variable in the file, never a published symbol. The audit's bucket label over-counts these three; the refined buckets belong in the committed instrument (TIER 3.3), not in a hand-written exception. |

So the lane's store-vs-analyzer divergence is now **0 unexplained edges and 5 reasoned ones**, and
neither remaining group needs a change to the analyzer to be *explained* — what is missing is a
DECISION about anonymous-class members.

### 4. Mutant wiring — the php registry had never run

`npx tsx script/m14/verify-orphaned-mutants.ts` reported
`script/m14/php-mutants.ts  PHP_MUTANTS  6  ORPHANED` and failed the gate with "Those mutants have
never run": **zero of the 386 registered mutants were php's**, so the F4 gate could not fail for
this lane while the lane read as a suite with no php reds. The lane's own harness had verified all
six, so its numbers were sound — the claim that was unsound was any reading of F4 as covering php.
Now wired (`WIRED`, 394 reachable), and the php slice reads **63 mutants, 63 caught, 0 survived,
exit 0**.

Two more findings from the same pass, both other lanes' to act on and neither touched here:

- `php/drop-external-override-guess` **SURVIVED** (`0 -> 0 failures`): the 0.5 first-parent guess it
  removes no longer exists, so the transform is a no-op that stayed red for a contract nobody
  relied on. Retired with a stated reason and a restore trigger; the surface is pinched in the
  other direction by `php/re-add-external-override-guess` (CAUGHT, `0 -> 1`).
- The runner's own comment promised that retired mutants are "REPORTED rather than skipped in
  silence", and the code computed the retired list and never printed it — so an excluded pin was
  indistinguishable from a killed one. Printing it immediately surfaced a bare retirement in
  another lane: `sql/sweep-stops-at-a-declaration-RETIRED-unfixtureable` has `retired: true` and
  NO `retirementReason`, which now prints as `BAD-FACT`.

### 5. The ruling-table proof gate could not run at all — **anchor repaired**

`validation/m14/fixtures/php/ruled-gate.ts` is the only instrument that proves the lane's RULED
rows against the corpus, and it had been failing on its own patch list:

```
ruled-gate: PATCH DID NOT APPLY — patch 2 — the map entry
  looking for: const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED
```

Measured: that inline form exists in **neither** the working tree **nor** `HEAD` — the object was
reformatted to one key per line, so the anchor could never match and the php ruling table has never
been proof-run by its own gate. The anchor was the DECLARATION LINE only, which no lane addition,
key reorder or reformat can break; the patch list now applies and the patched copy is written
(`BB_PHP_RULED_SKIP_GATE=1`, copy verified to contain `php: PHP_RULED`). It is the same defect the
swift lane recorded when a hardcoded mutant string silently stopped matching: **a check anchored to
a formatting choice is a check that expires without failing.**

The gate's own report item — "amend PHPD33's `resolution`" — is now discharged: PHPD33 was `RULED`
("no `exports` kind for php, deliberately") while the analyzer has emitted `exports` since the
define-exports round, and the premise it rested on ("PHP has no syntax to key on") was falsified by
`define()` at file scope. PHPD33 is now `FIXED` with the reversal and its numbers recorded, and
PHPD36 (new) records the recovery-escape decision. The gate's FULL corpus run is queued:
`BB_PHP_RULED_WORKERS=2 npx tsx validation/m14/fixtures/php/ruled-gate.ts`.

### What is NOT done in php

Ambiguity is untouched (155,752 edges, 44.5%), the three missing oracles (`contains`/`imports`/
`exports` = 63,774 edges, 18.2%), external naming, the four structural-limit labels, the runnable
gates (24 scripts still hardcode a `ROOT` that does not exist on this checkout), the 5 remaining
`verify-analyzer` false positives (now recorded as a stale GROUND TRUTH — it has zero `contains`
rows — rather than as analyzer false positives; PHPD33 and PHPD36 the only completeness rows
corrected this round), the full corpus run of the ruling-table proof gate repaired above, and the
legacy/real-world corpora. None of it is claimed here.

## Round 2 (2026-10-07) — the walk completes over all 33,692 files, and TWO of Round 1's mechanisms were wrong

Round 1 named the right symptom (the walk cannot finish; the checkpoint over-counts) and the
WRONG cause. Both corrections are stated here rather than quietly fixed, because the wrong
version is the one a reader would otherwise carry forward.

### Correction 1: the walk does not retain trees, and was never killed by a file

Round 1 blamed "retained WASM trees". Three measurements say otherwise:

- `engine.ts`'s `ASTEngine.parseFile` deletes the tree in a `finally` (the block Round 1
  itself quoted), so the production path retains nothing per file.
- A 6,000-file walk through the **production** `parseFile` at the gate's own concurrency: RSS
  **sawtooths** (445 → 673 MB, peak 980) rather than climbing, under BOTH bun and tsx.
- The finished 33,692-file walk: RSS **596.1 MB → 501.1 MB, −2.8 MB per 1k files** — it ends
  *lower* than it started.

The real killer was a **leaked timer in `engine.ts`**. `parseBomb` is armed, then disarmed on
the line AFTER `parser.parse(content)` — so a parse that THROWS (a WASM trap) skips the
`clearTimeout`. The guard stayed armed and fired **120 s later, in an unrelated turn of the
event loop**, printing whatever file that closure held and calling `process.exit(1)`. The file
it names is only the last parse that threw — which is exactly why the name changed every run
and why every named file was innocent alone. It killed run 1 at 20,207 files. The fix is a
`try/finally` around the parse.

The note in Round 1 that "the walk appends a path *before* parsing it" is also wrong: the
append happened AFTER `run()` resolved, so a hard kill wrote nothing, the same file was
re-walked and re-killed forever, and the file a run died on could not be named at all.

### Correction 2: the checkpoint's defect is subtler than "records killed files as WALKED"

`parseFile` does not reject when a parse crashes. It catches the error, writes
`[BB-PARSE-ERR]`, and returns `extractFallback(...)` — **regex** extraction marked
`fallback: true`. The walk therefore wrote a plain `done` line for a file the analyzer never
measured, and — the part that made it a measurement defect rather than a bookkeeping one —
**that file's regex edges were folded into the coverage table as evidence that the analyzer
emits that relationship.** Measured: `map_values3_test.dart` tripped a WASM trap, was logged
as `[BB-PARSE-ERR]`, and sat in the checkpoint as an ordinary success.

A SECOND crash path is silent in a different way: the analyzer timing out or blowing the JS
stack returns `metadata.analysisVersion: "2.0-basic-fallback"` with 0 symbols and **no
top-level `fallback`**. Two dart files hit it — `deep_nesting_expression_test.dart` and
`deep_nesting_statement_test.dart`, both `Maximum call stack size exceeded` — and counting
them as measured lets a type read as NOT EMITTED because the one file exercising it was never
analyzed. That is a false RULED-SOUND, and the version string is this codebase's own
signature for the path (`real-sql-analyzer.ts` documents the same 120 s crossing).

### What was fixed (each with its evidence)

| defect | fix | evidence |
|---|---|---|
| leaked `parseBomb` kills the walk 120 s after a caught trap | `try/finally` disarm in `engine.ts` | the two runs it killed, and the completed 33,692-file walk after |
| a swallowed crash is recorded as measured | walker v2: `>id` attempt BEFORE the parse, `id` / `~id` / `!id` outcomes after, `partial` true if any file is degraded | `walk-checkpoint-honesty.ts`, **30 assertions** |
| the file a run dies on is unknowable | `>` with no outcome = that file; retried once, then recorded `!` with the reason | same fixture, section 3 |
| regex edges counted as EMITTED | fallback rows collected separately and printed, never added to `observed` | `walk: >>> excluded from EMITTED — calls=11` |
| a resumed run printed "100.0% of the corpus" over a 10-file table | table coverage (`walked`) reported separately from walk coverage (`walked + alreadyDone`), loudly | run 6 vs run 7 below |
| recursion died on deep nesting AFTER the walk finished | `walkPreorder` — explicit stack, order-preserving, in all 3 walk sites | the stack trace it replaced |
| one unfreeable grammar per 500 files | reuse the cached `Language`; share ONE in-flight load, cached inside the loader | `Language.load` = **+2.4 MB, monotonic, `Language.delete` undefined**; probe: **1 grammar over 3,000 files** |

### The proof: the gate completes and states its population

`npx tsx script/m14/ontology-coverage-gate.ts dart --fresh` — exit **0**:

```
corpus: 33692 admitted files
walk: 33684/33692 files measured in THIS run (100.0% — the files every edge count below is computed from)
walk: 33692 offered = 33684 measured by the analyzer (this run) + 0 measured by an earlier run + 8 DEGRADED (regex fallback, not the analyzer) + 0 degraded earlier + 0 abandoned
walk: partial=true  retried=0  fresh=33692  history trusted
walk: rss 596.1MB -> 501.1MB (-2.8MB per 1k files)
emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0
```

Whole-corpus edge counts, all ten types EMITTED by the real analyzer: `uses` 1,148,731 ·
`calls` 636,664 · `contains` 525,695 · `overrides` 154,829 · `instantiates` 151,206 ·
`imports` 105,086 · `references` 73,041 · `extends` 38,119 · `implements` 12,221 ·
`exports` 2,030. The 8 degraded files are named and excluded, not silently counted.

**The population fix is not theoretical.** Run 6 (resumed, 10 files walked) reported
`exports RULED-UNJUSTIFIED — NOT EMITTED and its construct is absent` from a table whose
header claimed 100.0% of the corpus. Run 7, over 33,684 files, reports `exports EMITTED,
2,030 edges`. Same corpus, same code, opposite verdict — decided entirely by whether the
population was stated. That is the defect this round exists to end.

### Honest limits of this round

- The 33,692-file proof run (run 7) ran with the grammar-reuse and load-dedup fixes but
  **before** the in-flight-cache race fix; the race fix is verified by `parser-reload-probe.ts`
  (1 grammar over 3,000 files, post-fix), not by run 7.
- The `rssMbPerKFile` metric is only meaningful over a long walk: run 7's −2.8 MB/1k is real,
  but a 3,000-file probe reports +124 MB/1k because lazy module loading dominates the first
  500 files. The plateau (452 → 455 MB from file 1,500 to 3,000) is the honest retention read.
- 8 of 33,692 files (0.02%) are measured by the regex fallback and carry no analyzer evidence.
- The traps are not fully deterministic: run 6 degraded 12 files, run 7 degraded 8, so the
  retry-once policy is doing real work — but a file that degrades twice is now recorded as such
  rather than retried forever.

## Round 3 (2026-10-07) — dart's incoming side, measured over the WHOLE corpus for the first time

Round 1/2 gave dart a whole-corpus OUTGOING table. The incoming side was still a
**600-file sample**, and the programme already knows what that costs: on `sql`, going from
600 files to the corpus moved `uses` 71% -> 5.0% and `references` 32% -> 1.3%. So it was
re-measured, whole corpus, before any further analyzer work:

```
npx tsx script/m14/incoming-gate.ts dart dart 33692      # 28 min, exit 1 (FAIL)
population: 33692 parsed of 33692 sampled (6 repos)
parse failures: 0   degraded (regex fallback): 2
endpoint keys indexed: name + 571,213 qualifiedName aliases

type          edges    resolved  amb(decl)  amb(kind)  unresolved
calls         636,743   158,467    326,009     177,888     152,267
uses        1,148,799   168,796    750,722     492,892     229,267
contains      525,735   163,674    361,993     133,245          68
imports       105,109         0          0           0     105,109
references     73,041    37,111     35,930      15,091           0
exports         2,030         0          0           0       2,030
extends        38,125    14,275     16,076       8,951       7,773
implements     12,221     5,003      5,872       3,467       1,340
overrides     154,835    42,360      5,568         564     106,907
instantiates  151,229    52,189     49,759      28,084      49,281
TOTAL       2,847,867   641,875  1,551,929     860,182     654,042
VERDICT: FAIL — 1,551,929 ambiguous + 654,042 unresolved of 2,847,867 edges
```

**22.5% of dart's 2,847,867 edges resolve to exactly one declaration.** The rest is the
worklist, and it splits into four named causes rather than one:

1. **`overrides` 106,907 unresolved (69% of the type)** — by far the largest single
   unresolved class, and the least like "cause A". An override target is published
owner-qualified (`StatefulWidget.build`), so a base class from outside the corpus (the
   Flutter framework is **0 files** — see the corpus gap above), or a base declared in
   another package, leaves the edge with nothing to bind. This is the one worth attacking
   first: it is 16.3% of ALL dart edges, one type, one mechanism.
2. **`imports` 105,109 unresolved (100%) and `exports` 2,030 (100%)** — the shared enum
   blocker: `src/ast/types.ts` declares `Imports = "brain_import"` while the analyzers emit
   the literal `"imports"`, so these edges are invisible to every consumer. Not dart-owned;
   shared with php and fsharp.
3. **Ambiguity, `amb(decl)` 1,551,929** — the bare-name population (cause A): `build` in 3
   places, `close` in 2, `_createProfile` in 2. 571,213 qualifiedName aliases are already
   indexed, so a lane that publishes FILE-SCOPED qualified names and targets that path is
   measured rather than ambiguous — that is the lever, and `uses` (750,722) is where it pays.
4. **`calls`/`uses` unresolved 381,534** — stdlib and SDK names (`setUpAll`, `expect`,
   `startsWith`, `http`, `drain`) that are legitimately outside the corpus and carry **no**
   external marker: `external 0` on every row. The gate accepts a declared marker
   (`isExternal`/`stdlibModule`/…); dart declares none, so its stdlib reads as broken.

All four are stated with their population. A single "unresolved" number would have hidden
that `overrides` is 16% of the graph and that `contains` is already essentially clean (68
unresolved out of 525,735).

### And the gate that produced this could not fail

`incoming-gate.ts` printed `VERDICT: FAIL` for this run and exited **0**. Its own header
says it exists because `incoming-check` "cannot fail: it has no `exitCode` assignment and no
threshold" — but the arbiter's exit was `process.exit(v.pass || rep.degraded > 0 ? 0 : 1)`,
which by precedence is `v.pass || (rep.degraded > 0)`: **any run with one degraded file
exits 0.** Two degraded files turned a FAIL over 2.2M bad edges into success for anything
that reads an exit code. Fixed: FAIL exits 1, and a PASS over a degraded population also
exits 1, because a PASS is a claim about the population. (Also: the second crash signature
`2.0-basic-fallback` is now counted as degraded here, not as parsed.)

### The deep-nesting crash, fixed — and the cost that remains measured

The dart SDK's own stress fixtures were 2 of the 8 degraded files, because the analyzer's
`processNode` recursed once per tree level and `deep_nesting_statement_test.dart` is a tree
of depth **20,004**. `RangeError: Maximum call stack size exceeded`, 500 identical frames,
all in one function. It is now an explicit-stack preorder walk with the child list
materialised once per node (`namedChildren`) — the recursion is gone, the expression fixture
went from crash to **150 ms**, and the dart fixture suite is still 22 pass / 0 fail.

What remains is COST, and it is now attributed rather than guessed: the statement fixture
completes in **455,824 ms**, still past the engine's 120 s analyzer budget, and a scaling
series (truncated slices of the same file, 3,905 -> 31,905 nodes) is **quadratic in node
count**: 0.056 -> 0.384 ms/node. `node --cpu-prof` puts **92% of the run inside
web-tree-sitter's own accessors** (`ts_node__child` 63.8%, `ts_node_child_with_descendant`
28.3%) and **0.3% in the analyzer's JavaScript** — and the sql lane already documented that
mechanism (`real-sql-analyzer.ts`: every property access returns a FRESH wrapper, so
`namedChild(0) === namedChild(0)` is false). Materialising the child list once in the new
walker recovered only ~13% (14,044 -> 12,259 ms at 31,905 nodes), so the accessor storm is
in the ~590-line per-node body, not in the walk: **that is the next dart task, and it is
attributed to a surface an existing optimisation pattern in this repo already solves.**

## Totals today

- Outgoing at `10/10 applicable`: **3 of 23** (`dart`, `fsharp`, `php`).
- Outgoing at `N/N applicable` **with incoming resolving**: **0 of 23**.
- Ruleable lanes: **23 of 23 — 20 by a corpus-measured table, 3 by a SPEC prose ruling
  (`hcl make yaml`)**, from `script/m14/verify-ruling-tables-registered.ts`'s own two lists.
  Unadjudicated: **0** (was reported as 4; refuted above with the command that says zero).
- **php's outgoing is now measured to `unexplained = 0`**: of 350,364 edges, 129,061 resolve
  uniquely, 155,752 are ambiguous (the incoming/cause-A axis, untouched), 44,558 + 19 + 204 + 128
  name a local variable, a path, a keyword or a dynamic callee, 21,515 name php internals or
  namespaces outside the population, and **5** are now reasoned one by one (anonymous-class
  members, M37.13) instead of named as defects. The two fixes in this round moved 1 orphan
  `contains` endpoint to 0 and 19 declared-but-unpublished `calls` edges to 0, and changed NO
  other bucket.
- Zero regexes: **yes** (18 → 0; laptop A's handoff records they have not matched this).
