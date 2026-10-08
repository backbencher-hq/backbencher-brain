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
coverage gate). 81 type-instances fleet-wide (was 83 before php's `contains`/`imports` oracles
landed on 2026-10-08):

| lane | count | types |
|---|---|---|
| sql | 9 | everything except `imports` |
| hcl, json, lua, make, nim, r, yaml | 6 each | calls, contains, exports, imports, references, uses |
| graphql | 5 | contains, exports, imports, references, uses |
| clean, protobuf, xml | 4 each | contains, exports, imports, uses (+ extends, overrides for xml) |
| php | 1 | exports |
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

Ambiguity is untouched (155,752 edges, 44.5%) — that is the whole of what is left on the OUTGOING
axis, since the oracle side is finished: `contains`, `imports`, `exports` and `overrides` all joined
the compared set on 2026-10-08, the last of them through `script/m14/oracles/php-overrides.ts`, and
the spec's `declared_no_truth` list is now **empty** (the overrides declaration was withdrawn, not
kept as a stale suppression). The one bound that remains is a SUBSET rather than a label: overrides
speaks only where the base class is declared in the same file. Then: external naming, the four
structural-limit labels, the runnable
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

## PHP round 2 (2026-10-07) — the reason census is now an artifact, and the last defect shape is closed

### 1. `unexplained = 0` was a session result; it is now a commit

Round 1's headline rested on a gitignored scratch file, which makes it a claim about one checkout
rather than an artifact. It is now
`validation/m14/fixtures/php/reason-census.mts` → `validation/m60/php/reason-census.json`, whole
admitted population, production `parseFile`, **3m20s**:

> **350,367 endpoints, 0 in a class the census cannot name — on BOTH sides.**
> target `declared-in-tree-not-published` **0** · source `declared-in-tree-not-published` **0** ·
> source `unexplained` **0**.

The instrument checks itself before it walks: **15 target probes + 10 source probes** through the
SAME functions the corpus walk calls, including one that must land in `unexplained` (a classifier
that cannot produce its own defect class reports zero for everything). A failed probe exits 3.

**Both of the classes it reported on its first run were the instrument's bugs, and both were caught
by running it, not by reading it.** (a) The source ladder asked "does this file declare the name?"
before "did anything publish it?" — and every source inside a declaration is a name its own file
declares, so it filed **3,568 of 3,689** `markdown.php` edges as a defect class while the store held
all of those symbols. (b) The anonymous-class detector looked for an `object_creation_expression`
with a `class` child, which the pinned grammar never produces (`anonymous_class` is the node), so
every anonymous-class member was filed as a defect — phpunit's `ExporterTest.php` alone produced
four. **A walk that cannot see anonymous classes makes M37.13 look like a bug.**

Its population scan was **64.9s of a 91.7s run** — it read every candidate file to hand
`detectLanguageFromPath` a `content` argument that is consulted only for extensionless files and
`.h` headers. Path-only routing took it to 9.5s. A 3-minute instrument that says where its minutes
go is one that can be re-run; the previous one could not.

### 2. The last `DECLARED_IN_TREE_NOT_PUBLISHED` shape: a function declared inside a callable — **FIXED, 3 declarations, 0 remaining**

Whole-population tree walk: **25** `function_definition` nodes with a callable between them and the
program root, in 4 files. **22 are `markdown.php`'s recovery casualties** (members, not nested
functions — PHPD36, already published as members). The other **3** are Slim's test-helper idiom, and
they were FOUND BY THE CENSUS, not by inspection: two `references` edges from `testProcessRequest`
whose SOURCE was a declaration the store did not hold.

`node_type` is `function_definition`; the full decision is **PHPD37**. The short form: publish as
kind `function` owned by the file's namespace, from a pass that does NOT re-walk the nested body
(that body is already walked by the enclosing callable, and re-walking it double-emits every call
and read inside it). The two rejected readings are pinned as `forbidSymbols` rows: a `method` of the
enclosing class, and an ownerless global.

**The probe that found the population was itself wrong first, and the correction is the measurement:**
its first rule — "the declaration's parent is a `compound_statement`" — read 280 hits, **250 of them
in ONE file**: phpunit's `src/Framework/Assert/Functions.php`, whose 251 assert helpers are guarded
by `if (!function_exists('assertSame')) { function assertSame(...) {...} }` at FILE level, which is
NOT a scope and which the ordinary walk publishes correctly (measured: 252 symbols, 251 functions).

**Delta, all 5,094 files, same instrument before/after:** edges 350,364 → **350,367** (+3, all
`contains`) · resolved unique 129,061 → **129,064** · `perType.contains` 35,109 → **35,112** ·
published names 21,222 → **21,224** · `(owner, name)` member pairs 32,552 → **32,555** ·
`DECLARED_IN_TREE_NOT_PUBLISHED` 12 → **10** · **and ZERO delta in every other bucket and every
other type.** `calls` and `uses` unchanged to the digit — that is the difference between resolving
edges and inventing them.

Fixtures **27 pass / 0 fail** (the +1 authored BEFORE the fix: pre-fix 6 symbols / 10 edges against
8 / 12 after, with two `expectRelationshipCount` rows that fail if the body is ever walked twice).
Mutants: **67 registered, all 67 caught, 0 survivors** (`BB_MUTANT_ONLY=php/`), the four new ones
being the pre-fix state, the two rejected readings, and the damage guard removed.

**Known and NOT blessed, with its count:** a call/read edge inside a nested function's body is
attributed to the ENCLOSING callable (`calls registerHelper -> decorate`, one edge on the fixture,
written in `nestedHelper`'s body). It is an attribution decision, not an unexplained endpoint — the
enclosing callable is published, so the census is silent about it by construction — and the fixture
records the behaviour without pinning it as correct.

### 3. The ambiguity ceiling, priced before anything is implemented

`ambiguous:multiple-declarations` is 126,342 endpoints (36%), and the lane could not say whether
any of it is closable. The census now asks WHICH STAGE would leave exactly one candidate for each
of them, under a stated order — the sound filters first (owner channel, then the type's
callable/kind rule), then the preferences (same file, then the file's own namespace):

| stage | endpoints | share |
|---|---|---|
| **still ambiguous after EVERY lever** | **107,313** | **63.44%** |
| **resolved by the owner channel via the class's ANCESTORS** | **24,223** | **14.32%** |
| resolved by the same-file preference | 20,368 | 12.04% |
| resolved by the namespace preference | 10,188 | 6.02% |
| emptied by the kind filter | 3,129 | 1.85% |
| resolved by the sound filters | 2,756 | 1.63% |
| emptied by the owner filter | 1,179 | 0.70% |

**The largest lever is the only one that is not a preference**: 24,223 endpoints (14.32%)
resolve by walking the enclosing class's ancestors — `$this->persist()` in a subclass whose parent
declares `persist` is PHP's own resolution, and the ancestors come from the store's own
`extends`/`implements` edges. It also nearly empties the class it acts on: 25,402 were emptied by the
owner filter and only **1,179** stay emptied after the walk, so **95.4% of the members whose owner
publishes nothing are inherited members whose parent the store already holds**, and the residue is
the genuine external boundary. Trait use is deliberately out of the map, which makes 24,223 a LOWER
bound. The same-file (20,368) and namespace (10,188) preferences are smaller AND riskier, because
each REPLACES a resolution instead of narrowing one.

> **Update (PHP round 5, below):** this lever could not be implemented, and the reason was not the
> analyzer — the store column an ancestor walk has to read (`brain_symbol.super_types`) was NULL on
> every php row, so `override-retarget.ts` returned before its first query. The payload is now
> published and the column is populated; the 24,223 is unchanged and the walk is now possible where
> before it was not. Read round 5 before pricing any implementation of the stages below.


**A type-inference wall, now a number**: the survivors are `uses` 48,839, `calls` 21,052,
`imports` 4,509, `contains` 2,783, and their top names are `metadata` (6,477), `value`, `result`,
`config`, `message`, `response` — generic member reads off a receiver whose type nothing knows. No
rule over a name index decides those.

**17,964 endpoints are not resolutions at all**: 15,791 emptied by the OWNER filter (the edge names
an owner, no candidate carries it — inherited or foreign members, the cause-A family) and 2,173
emptied by the KIND filter (the name is published, but not as anything the type can point at).
Counting either as "closed" would be the easy and wrong reading.

Only 3,172 endpoints fall to sound narrowing; the 24,667 the two preferences would resolve each
REPLACE a resolution, which is the change shape that once produced a measured +225 that was a
cross-repo collision. They stay unpriced as features until each has its own fixture, mutant and
before/after, and the artifact carries the caveat in its data.

### 3b. The incoming direction, whole population, for the first time — and its hole has ONE cause

Measured by the same census over the same 350,367 edges: of php's 40,266 published declarations,
**21,144 (52.51%) are reached by at least one resolving edge** and **14,371 (35.69%) are NAMED BY
EDGES AND REACHED BY NONE**. The hole's causes were enumerated per declaration rather than counted
per pair: **all 14,371 are named by `ambiguous:multiple-declarations` edges and by nothing else** —
no mixed bucket, no external class, no keyword. 4,751 are named by nothing at all, and the four
buckets sum to the population (a control asserts it).

So php's incoming side is not a missing reverse walk and not a second defect: **it is the outgoing
ambiguity seen from the declarations**, which means the 63.44% that survives every lever is the
incoming ceiling to the endpoint. The ledger's php incoming row came from a 30-file and a 600-file
sampler; this replaces it with the population.

The same section exposed the census's third self-found bug, and it corrected the tables above: the
walk classified each file against the store as it stood when that file was reached, so declarations
published by a LATER file were invisible to an EARLIER one. Two-passing it (index, then classify)
took **29,181 endpoints out of `external:bare-name-outside-population`** and 5,142 out of
`external:namespace-outside-population` and into `resolved`/`ambiguous`, which is the bias direction
that flatters a lane: it made the CORPUS boundary look larger than it is. The corrected numbers agree
with the lane's independent whole-population audit to the digit (bare-name 10,644, namespace 1,536),
which the biased run did not.

### 4. What round 2 did NOT change

`ambiguous:multiple-declarations` is **126,342** and untouched — it is the incoming/cause-A axis and
the largest remaining item, not a regression. The three types with no independent oracle
(`contains`, `imports`, `exports`) are still pinned by fixtures rather than verified by a second
route; `validation/m12/ground-truth/php.json` still has zero `contains` rows (precision reads 0.930
with 5 FPs, all of them that gap); the lane's gates still carry the hardcoded `ROOT`; and the
external block is still a boundary of the POPULATION (this corpus has no WordPress, no Symfony, no
Laravel).

## PHP round 3 (2026-10-08) — the harness had lost php's independent truth, and nothing could say so

**Found by running two gates that had never run.** `script/m60/php-oracle-independence.ts` and
`script/m60/php-line-contract.ts` both pinned `ROOT = "$HOME/backbencher-brain"` — a
checkout this lane does not have (`…/mcp/backbencher-brain`) — so both died on their FIRST import,
and a gate that cannot start reports nothing, which reads exactly like a gate that passes. ROOT is
now derived from `import.meta.url` in both (`ruled-gate.ts` derives it the same way for the same
reason).

**The independence gate's first real verdict was FAIL — six violations, all true.** The merge
`dc7b8b494` ("607 remote commits united with 502 local") spliced `script/m14/differential.ts` and
dropped php's independent truth: `phpIndependentStaticIncludePath` (governs `imports`),
`phpIndependentCallableName` (governs `calls`), `derivePhpDeclaredTypeEdgesIndependent` (the whole
declared-type graph behind `references`) **and** `derivePhpContainsEdges` (governs `contains`).
The splice was repaired later for SYNTAX only (`d4c4bba34`: "a duplicated '}' after the zig truth
block closed the per-file lane loop early") and the lost CONTENT was never restored — while
`reviews/php/master-review.md` went on claiming "0 shared rules … measured at 0 disagreements …
proven to fail". Every one of those names is present at `93d5b5e65` (2026-09-30, an ancestor of
HEAD) and absent at HEAD.

**Restored, and held to provenance rather than paraphrased.** The three derivations are back in
`differential.ts` verbatim — `diff` against `git show 93d5b5e65:script/m14/differential.ts` is
**EMPTY** (350 lines) — and the truth loop, the include-path call site and the callee call site all
point at the independent versions; the import drops the two shared rules and keeps only the
deliberately exempted superseded comparison. The `contains` oracle is back in a LANE-OWNED module
`script/m14/oracles/php-contains.ts` (also byte-exact; the `dart-contains.ts` precedent — a shared
file is a file that conflicts) and it is REGISTERED, which took three edits, not one: the import,
the truth loop, and php's entry in the compared-labels list. An oracle that is defined but not
registered compares nothing, which is exactly how the label went unaudited.

| | before | after |
|---|---|---|
| `php-oracle-independence` | CRASHED (hardcoded ROOT) | **PASS** — 3/3 defined=1 refs=2, truth loop off the shared rule |
| php truth rows, phpunit draw | 1,229 | **1,795** |
| php truth rows, phpmyadmin draw | 1,674 | **3,122** |
| php differential, phpunit | 99.8% · MISSING=2 · unexplained=0 | 99.8% · MISSING=3 · **unexplained=55, all `contains`** |
| php differential, phpmyadmin | 100% · MISSING=0 · unexplained=0 | 100% · MISSING=0 · **unexplained=56, all `contains`** |

The three restored rules reproduce the shared ones EXACTLY on that draw — phpunit's 1,229 truth
rows and its two `references` MISSING rows are unchanged, phpmyadmin still 100% — which re-confirms
the authoring measurement a week later. `tsc --noEmit` clean; all 27 php fixtures pass.

**The 111 unexplained `contains` edges are ONE shape, and it is the oracle's gap, not the
analyzer's.** All 80 sampled are a NAMESPACE containing a type — `contains PHPUnit\TextUI ->
TestRunner`, `contains PhpMyAdmin\Controllers\Export -> …` — with 80 of 80 sources namespaced and
0 class-form. The oracle's shape map listed only the four NAMED-TYPE bodies as containers and was
written before M60's namespace containment landed — so the analyzer was not wrong and the ORACLE was
incomplete.

**The gap is closed the same day, and closed in both directions.** The oracle gained one marked
section (`M60 NAMESPACE CONTAINMENT`), re-derived from the tree: a namespace owns the declarations at
FILE SCOPE under it (a top-level `if` is not a scope, which is why phpunit's 251
`if (!function_exists(…))` helpers are contained by their namespace), while a member stays its
class's and a declaration inside a CALLABLE is the one shape it declares it does not model.

| draw | phpunit truth / MISSING / unexplained | phpmyadmin truth / MISSING / unexplained |
|---|---|---|
| `rot 4` | 1,003 / 1 / **0** | 2,542 / 1 / **0** |
| `rot 5` | 1,094 / 1 / **0** | 2,419 / 2 / **0** |

Two draws because the 60-file draw ROTATES — totals are not comparable across runs. `unexplained = 0`
is the 111 closed; it would also read 0 if the oracle had grown into the analyzer's own output, so the
column that proves the most is `MISSING`, which stayed at the PRE-EXISTING include-path rows and
never `contains`. No mutant pins this section and none can: the registry transforms the analyzer's
result, not a truth derivation — the pin is the reading, and the revert is deleting the marked
section (`unexplained = 111` comes back). Declared residual, counted rather than implied absent: a
named function inside a CALLABLE (PHPD37, 3 declarations, Slim) and recovery-escaped members
(PHPD36, 22, `markdown.php`) are analyzer `contains` edges in files OUTSIDE the two pinned corpora,
so this differential cannot see them.

**Still lost, same merge, NOT restored: `buildPhpOverrideCompanionWithVisibility`.** It existed in
`differential.ts` at `abae80c43` (2026-09-30 21:58, an ancestor of HEAD: definition + two call
sites) and is absent at HEAD. `php-line-contract.ts` imports it, so that gate now gets PAST its ROOT
fix and fails at the import — which is why php still has no committed line-contract artifact. It is
the last known casualty of `dc7b8b494` on php's path, and it is recorded rather than guessed at:
restoring it means reading its two call sites against today's file, not just its body.

**The last MISSING rows are gone too, and the fix was TWO edits rather than the one the ledger named.**
The truth's include leg pushed `references` where the analyzer has published `imports` since the
M12.PHP-IMPORTS round (adjudicated here already — "a stale oracle label, not a missing edge").
Relabelling alone fixes nothing: php's compared-labels entry had no `imports`, so the analyzer's
include edges were dropped from the comparison — and the label had NO truth derivation at all, which
is why `rel-type-coverage-gate` counted it as DERIVATION. So the `use`-clause half was written from
the tree (plain and grouped forms, FQN as written, prefix-joined, alias not part of the target), the
include half was relabelled, and `imports` was registered.

| draw | lane | truth | covered | MISSING | analyzer edges | unexplained |
|---|---|---|---|---|---|
| rot 6 | phpunit | 1,046 | 1,046 (100%) | **0** | 1,030 | **0** |
| rot 6 | phpmyadmin | 3,204 | 3,204 (100%) | **0** | 3,161 | **0** |
| rot 7 | phpunit | 1,326 | 1,326 (100%) | **0** | 1,285 | **0** |
| rot 7 | phpmyadmin | 2,898 | 2,898 (100%) | **0** | 2,885 | **0** |

`BB_LABEL_DUMP=php` is the evidence that this is not vacuous: `imports` reads **truth=280 /
comparable=280** on the phpunit draw and **596 / 596** on phpmyadmin — equal on both sides, for a
label that had zero truth the day before. And the gate that counted the gap now reads
`php 1 un-audited: ["exports"]` — and as of PHP round 4 that is **`php` in NO un-audited row at all**:
`emitted` and `audited` are the same ten labels, and php's DERIVATION list is empty (was
`["contains","imports","exports"]` two days ago). The gate still exits 1 on `79 NEW` rows — all of
them OTHER lanes, a shared debt baseline that predates this session's merges — reported, not
touched. And php is in NO regression
row; the gate's exit 1 comes from `80 NEW` rows belonging to OTHER lanes, a shared debt baseline that
predates this session's merges — reported, not touched.

## PHP round 4 (2026-10-08) — a real publication the graph did not carry, found by building the denominator `exports` never had

Round 3 left `exports` as php's last un-audited label. The obvious next move was to write its
truth oracle; the right one was first to ask whether the 57 edges it emitted were the RIGHT 57,
because **a count with no denominator cannot be wrong in a way anyone can see.** So the probe
grew one: every `define`-family call in the admitted population, split by callee RESOLUTION |
scope | name-literalness, with every shape key **pre-seeded at 0** — a key that appears only
once it fires cannot be told apart from a classifier that can never produce it.

**It read 58 implied publications against 57 emitted edges.** The missing one is phpunit's
`tests/end-to-end/generic/_files/auto_prepend_file.php`: one file-scope
`\define('AUTO_PREPEND_FILE_LOADED', true);`, in a file whose entire purpose is that PHP's
`auto_prepend_file` publishes a constant every later script can read — refused for its SPELLING
alone, because rule 1 tested the callee's literal text (`=== "define"`) rather than what it
resolves to. PHP's own rules settle it: *"Fully qualified names always resolve to the name
without leading namespace separator"*, while the fallback to the global function is stated for
**unqualified** names — so `\define` is the global function unconditionally, `namespace\define`
is a strict current-namespace lookup that does not fall back, and `Other\define` is a userland
function. (The manual pages are quoted in the code comment; this was resolved by reading the
resolution rules, not by trying spellings.)

**The fix is one condition** plus `metadata.calleeShape` recording which spelling was accepted.
Everything around it is evidence, in the order it was produced:

- the fixture and its expectation were extended **first** — four new negative shapes
  (`Other\define`, `namespace\define`, a nested `\define`, the aliased
  `use function define as pub`) — and the suite read `FAIL php/define-exports`;
- the fix made it **27/27 pass**;
- the revert mutant `php/drop-absolute-fq-define-publication` filters `exports` edges by
  `metadata.calleeShape` (GENERICALLY — no hardcoded target, so it cannot silently stop
  matching) and is **caught**; `mutant-check.mts` reads **16 caught / 0 survived / clean
  baseline**, and the php slice of the shared registry reads **68 caught / 0 survived**
  (1867 → 68 by filter);
- the whole population, before/after, same instrument: **10 content fields changed, every one
  of them following from that single edge** — `edgesSeen` 350,367 → 350,368, `symbolsPublished`
  40,266 → 40,267, `exports` 57 → 58 (`resolved:unique` 43 → 44),
  `targetClasses/resolved:unique` 115,660 → 115,661, `sourceClasses/source:global` 29,891 →
  29,892, `incoming/declarations` 40,266 → 40,267, `reachedByAtLeastOneResolvingEdge`
  21,144 → 21,145, `reachedAndNamedByNothing` 17,350 → 17,351 — with
  `namedButReachedByNone` UNMOVED (14,371) and `defectRows` / `unexplainedTotal` still **0**.

The shapes the rule still refuses are **priced, not assumed**: qualified `Other\define` 0
occurrences, relative `namespace\define` 0, the aliased form 0 (it *does* publish — unqualified
names go through the function import table — so it is recorded as a boundary rather than
half-implementing an import table for one callee), `class_alias`/`function_alias` 0, and **no
file in the population declares its own `define`**, which is the only way the bare-name test
could have been unsound. Two instrument corrections belong to the finding: the audit's own
classifier had to be made **reachable** before it could report a zero (`member_call_expression`
leaves the `function` field NULL, so a test on the callee field's type can never see
`$o->define()`), and the doc's old claim of "second implementation agreeing 57/57" was about a
copy that had already been withdrawn — the surviving instrument **disagreed**, which is how the
missing edge was found. Two instruments came out of this and are committed rather than left in a
scratch file: `exports-probe-controls.mts` gained a **(D) define-AUDIT control block** — the audit
that found the edge gets its own positive controls, or an audit that could only read zero would
have "confirmed" 57 forever — and `callee-shapes.mts` now PINS the grammar fact the audit's
classifier depends on (a member call leaves the `function` field NULL, so a member call named
`define` can never be classified by the callee field's type), so a grammar change fails loudly
instead of silently reclassifying calls. `exports-probe.json` is regenerated (5,094/5,094
cross-check, 0 failures); PHPD38 records the decision.

**And then the label was closed, not just measured.** The oracle
`script/m14/oracles/php-exports.ts` was written from PHP's resolution rules (no shared code with
the analyzer, which is what `php-oracle-independence` checks for the lane's other derivations),
imported and registered in the differential, and `exports` was added to php's compared-label set —
`rel-type-coverage-gate` now reads `php` in NO un-audited row, with `emitted` and `audited` both the
same ten labels and php's DERIVATION list **empty** (from three labels on 10-07, to one at the start
of this round, to none).

**A wave proves nothing here, which is why the proof is a cross-check.** `exports` is 58 edges over
18 files in 5,094, so a 60-file wave (and the two php waves both read it) can contain **zero rows**
of it: a label admitted with 0 truth and 0 comparable prints nothing and passes — the vacuous-zero
shape again. So `validation/m14/fixtures/php/exports-truth-crosscheck.mts` compares the oracle
against the ANALYZER (via `parseFile`, so a projection-layer loss would show) on **every file the
audit says carries the label**, with the harness's own `normTarget` imported rather than
re-implemented:

```
  files compared        18   (the audit's publication set, not a draw)
  truth edges           58
  analyzer edges        58
  MISSING (truth-only)  0
  unexplained (an-only) 0
  ok  the fully qualified `\define` file is on BOTH sides
  ok  control: a truth-only edge IS reported as MISSING
  ok  control: an analyzer-only edge IS reported as unexplained
```

That is the label verified in BOTH directions — with the comparator run on pairs one edge apart as
positive controls, because a comparator that cannot fail makes every 0/0 it prints worthless.

**The other half of the same day: `overrides`, which failed in the OPPOSITE direction.** It was
already COMPARED (php sits in the base overrides disjunct) while no php oracle derived it, so every
analyzer row met no truth and was counted as an unexplained **fabrication** — a worse reading than
"nobody wrote down what it should have produced", and a state the spec had DECLARED with a
`closes_when` rather than discovered late. `script/m14/oracles/php-overrides.ts` now derives it: a
method that re-declares a name its base class declares overrides it, unless the base's declaration
is `private` (PHP: a private member is not inherited, so the same name is a DIFFERENT method — the
fixture that found the analyzer's missing filter declares one on both sides on purpose, and the
corpus never exercised it). Bounded ON PURPOSE to a base **in the same file**, because php keys
every edge on the LEAF name and one repo holds three `TestSuite` classes and two `Assert` classes
(one vendored): a cross-file lookup is a guess, and the analyzer's own history records that guess
getting it wrong in BOTH directions. So the label is complete over its SUBSET, not over PHP — and
`overrides-truth-crosscheck.mts` builds its denominator from the TREE rather than from the analyzer
(a denominator taken from the analyzer would be blind to the very miss it exists to catch): 5,094
files swept with the local parser, 3,100 candidate files, then `parseFile` row by row against the
oracle — **2 truth edges, 2 analyzer edges, 0 MISSING, 0 unexplained**, with the analyzer's total
asserted equal to `perType.overrides.edges` in the census and the comparator run on pairs one edge
apart. The `declared_no_truth` entry is **withdrawn** (closure recorded at `label_coverage._closed`,
PHPD39 records the decision), because a declaration that outlives its defect hides the next one.

Both php waves were then re-run with the oracle registered: `covered 100% MISSING=0 |
unexplained=0 heuristic=0` on each, with no `COMPARED WITH NO TRUTH` line.

Two shared gates agree from outside this lane, and both are worth reading as they now stand:
`verify-label-coverage.ts` reads **`| php | phpunit | 25 | 217 | 217 | — | — |`** — every truth
edge compared, no undeclared gap for php (the gate's exit 1 is `35 undeclared gap(s) across 20
lane(s)`, all other lanes) — and the differential's own `COMPARED WITH NO TRUTH` guard, which fires
when a label has analyzer rows and no truth at all, does not print for php on either wave. **Both
items this paragraph used to leave open are closed, and the sentence is corrected rather than left
standing:** `exports` was admitted when `script/m14/oracles/php-exports.ts` was imported, registered
and added to php's compared-label set, and `overrides` got its own truth oracle
(`script/m14/oracles/php-overrides.ts`). `rel-type-coverage-gate` therefore lists php in **no
un-audited row at all** — `emitted` and `audited` are the same ten labels, DERIVATION empty — and
the spec's `declared_no_truth` list is empty. What remains is not a missing comparison but a
BOUND: `overrides` speaks only where the base is in the same file, which the oracle's header and
PHPD39 state.

## PHP round 5 (2026-10-08) — the ambiguity lever's precondition was FALSE, and it was a column

Round 2 priced php's one **sound** lever at **24,223 endpoints** (`owner+inherited`, section 3:
`$this->persist()` in a subclass whose parent declares `persist`). This round set out to implement it
and found it could not have been: the column an ancestor walk has to read was empty for php, not
thin.

### 1. The seam, and the empty column

The only thing that puts a project-wide hierarchy in the store is
`src/ast/parallel-indexer.ts:3590`, which binds `symbol.metadata.superTypes` into
`brain_symbol.super_types`. `src/ast/override-retarget.ts` reads it and opens with
`if (supertypes.size === 0) return out`. php published heritage as EDGES only — the class metadata
carried `baseClass`, `interfaces`, `extendedInterfaces`, `implementedInterfaces`, and never
`superTypes` — so the column was NULL on every php row and the pass returned before its first
query. php's inheritance was, to a consumer holding the store, **absent rather than thin**; same
defect class as the rest of this lane (a fact published and then dropped), except here there was no
fact to drop.

### 2. The payload, held to a MIRROR of the edges

`metadata.superTypes` is now published on class, interface and enum declarations, and it carries
**the same spellings and the same omissions as the heritage edges the same declaration emits**: the
base a PHPD10 `heritageTarget` could not separate from the class's own name is absent for the same
reason it emits no `extends` edge (no self-loop in the column that exists to be WALKED), a
same-leaf QUALIFIED base keeps its qualification, the enum branch's duplicated `heritageTarget`
derivation is now one list feeding both edges and payload, and the key is OMITTED rather than `[]`
when empty because the store's own test is `Array.isArray(...) && length > 0`. Traits are excluded
deliberately: this column is walked as a nearest-declaring-ANCESTOR chain and a trait is a flattened
mixin, not an ancestor.

### 3. Evidence, in the order that makes it evidence

Fixture authored first and read **FAIL** on six payload rows; `28/28` php fixtures after. Three new
mutants — payload dropped, base-only, and names-itself — all caught by that one fixture; lane
`mutant-check` **19 caught / 0 survived / clean baseline** (was 16) and the shared registry **71**
(was 68). A new store gate (`validation/m14/fixtures/php/store-heritage-roundtrip.mts`) stores four
committed fixtures through the real `storeResults` and reads the database back: the column is
non-NULL, the values are exact on every pinned shape, the stored hierarchy EQUALS the stored
`extends`+`implements` targets for every symbol (9 symbols / 12 edge rows), and the cross-file case
holds (`SubContract -> ["BaseContract"]`). Two negative controls plus the control that makes the
rest mean something: the same files with `metadata.superTypes` stripped store **NULL on every
symbol (0/58)**, which reproduces the pre-change state from the analyzer's own result.

### 4. What that gate found on its way in — reported, not edited

Re-storing the same project loses a row: **70 -> 69 relationships, the lost one being `extends
SubContract -> BaseContract`**, and it does not come back (a third store stays at 69). Cause is
`parallel-indexer.ts:2928-2929`, which before every file's inserts deletes every relationship from
ANY file whose `target_symbol_id` lives in the file being stored — on a cold store those cross-file
rows have a NULL target, so nothing matches; on the second store the previous run's resolution has
filled it, and the target file's turn deletes the inbound edge that the earlier-stored source file
is never asked to re-emit. **Order experiment, run not argued:** with the defining file stored LAST
the count goes 12 -> 11 -> 11; with the defining file stored FIRST it stays 12 -> 12 -> 12. Nothing
is lost when the target is stored before the source, which is why it has gone unnoticed; it bites
permanently in the direction the file walk orders late. `parallel-indexer.ts` is shared machinery
(§8) and is **not edited**; the gate prints the row and keeps the probe's own operation asserted so
it cannot report "no loss" from an empty read.

### 5. What this round does NOT claim

Not that the walk is sound — the existing consumer keys its map on the bare `name` and this lane's
own fixture set declares `FeaturesForm` in two files, which a name-keyed consumer merges. Not that
the lever moved: zero edges and zero symbols changed, the census still reads `owner+inherited`
24,223, and the census's ancestor map is built from EDGES, which were already there. What changed
is that the column is no longer empty, so the walk is possible at all. One asymmetry is recorded and
not fixed: the class and interface branches skip an unresolvable same-leaf parent and the ENUM
branch never had that guard, so `enum Foo implements \Foo` would emit a self-implements edge —
removing an edge is differential-visible and needs its own before/after.

## PHP round 6 (2026-10-08) — the store was answering member reads with the alphabetically first declaration

Round 5 ended with the census's one **sound** lever priced at **24,223 endpoints** (`owner+inherited`)
and named as the next piece of work. This round went to implement it and found something worse
standing behind it: for a member read, the store was not leaving the row ambiguous. It was
**resolving it, confidently, to the alphabetically first declaration of that name in the project.**

### 1. Two halves, and neither is visible from the analyzer

**(a)** php published no qualified name for a member, so the store's FIRST resolution strategy — an
EXACT `qualified_name` match through an index built `MIN(id)` per qualified name — was a NAME index,
and `MIN(id)` was doing the identifying for `persist`, `render`, `handle`. **(b)** the insert-time
resolver (`resolveTargetStmt`, `src/ast/parallel-indexer.ts:2726`) answers a bare member target before
any post-index pass runs, ranking `(s.file_id = current) DESC, s.id`, i.e. same file first and then
`s.id` compared as TEXT (`${fileId}:${name}:${line}`) — the alphabetically first line of that name.
Both halves publish a WRONG answer as a RESOLVED edge, silently, and in the expensive direction: a
reverse walk from `AlphaStore::persist` reports callers in files that never mentioned it. The lane's
ambiguity census could not see either half by construction — it measures the ANALYZER's endpoints
against the analyzer's own symbols (169,156 read "ambiguous") and never asks what the store BOUND the
row to. An instrument cannot find a defect in a layer it does not read.

### 2. The two changes

**Member identity** — `publishMemberIdentity` sets `qualifiedName` to `Owner.member` on every symbol
whose owner is class-like (class, interface, trait, enum): methods, properties, class constants, enum
cases. A bare member target no longer matches a member's qualified name, so an unprovable read stays
NULL instead of being attached to the first declaration, and a target already spelled `Owner.member`
— which is how `overrides` has always spelled its targets — now matches exactly, which is also the
first time `retargetCrossFileOverrides` has found anything for php. Deliberately NOT set when the
owner is a NAMESPACE: `metadata.fqn` is already php's own `Namespace\name`, and a dotted second
spelling for one declaration is the aliasing the rule exists to remove.

**The owner channel** — `src/ast/member-owner-resolution.ts`, wired into `storeResults` after the
override retarget. It implements exactly the two stages the census calls SOUND (`ownerResolved`,
`inheritedResolved`) and refuses all five it calls preferences (`same-file` 20,368, `namespace`
10,188, `emptied-by-kind` 3,129, `filters` 2,756, `emptied-by-owner` 1,179) — each of those REPLACES
a resolution rather than narrowing one, so each would move the number without a rule. It only ever
fills a NULL `target_symbol_id`, resolves the receiver by IDENTITY when its name collides, and
declines with a counted reason (`ambiguousOwner`, `notDeclared`, `ambiguousInChain`,
`ownerNotInPopulation`).

### 3. Evidence

`validation/m14/fixtures/php/owner-resolution-gate.mts` indexes four committed files whose member
names collide project-wide — so every name-keyed strategy must decline — and separates the claim from
the defect. The defect half is PINNED BY NAME (the day the store stops mislanding those rows, the gate
must go red): `$this->persist()` written in `GammaStore` is stored RESOLVED against
`AlphaStore::persist`; a read off a LOCAL VARIABLE is stored RESOLVED against a real class; a read
whose TWO ancestors declare it, and one whose base name two classes carry, are each stored RESOLVED
against one of them. The claim half runs the pass against the input it DECLARES (NULL targets, cleared
in the store first — a resolver whose caller gets there first has no other way to be measured) and
reads the results back: direct -> the declaring class, inherited -> ONE ancestor, colliding owner name
-> by identity, five negatives -> NULL. Three stores, one signal removed from the analyzer's OWN
result in each: with `metadata.owner` stripped NOTHING resolves (so the resolutions are caused by that
signal); with `super_types` stripped the DIRECT row still resolves and the INHERITED one does not (so
the walk is load-bearing, not a second reading of the owner). Plus idempotency and `dangling=0`.

At the analyzer layer, `validation/m14/fixtures/php/member-identity.{php,expectation.json}` pins the
spelling across all four owner kinds, the same member name under four owners as FOUR declarations, and
the ABSENCES that make the rule falsifiable: no member of a class-like owner may carry no qualified
name, and no namespace-owned declaration may acquire one. Two mutants revert it in the two directions
it can fail — `php/member-identity-dropped` (the exact pre-fix state) and
`php/member-identity-on-namespace-scope` (the rule one level too far, two spellings for one
declaration) — both caught by that fixture alone. **29/29 fixtures (was 28), 21 mutants caught / 0
survived (was 19), 73 in the shared registry (was 71), PHP_MUTANTS 21 WIRED, tsc clean, both php
differential waves `MISSING=0 | unexplained=0`, oracle-independence PASS, and php appears in no
un-audited row.**

### 4. What this round does NOT claim

**Not that the lever moved.** 24,223 counts ANALYZER endpoints, and no edge the analyzer emits
changed. What changed is the STORE's behaviour, and **how many stored rows move is not measured
here** — the gate is four files and the population effect needs a full-project store comparison. The
honest reach of the pass TODAY is bounded by §1(b): the insert-time resolver claims those rows first,
so the pass sees only what it left NULL. The fix that gives the pass its population is a change to
that shared ranking, not to the pass. **Not that everything landable now lands**: the pass reads
`metadata.owner`, so a read off a local variable, parameter, return value or property is outside it by
construction — that is the type-inference wall the census calls still-ambiguous (107,313 endpoints).
Both the insert-time ranking and round 5's re-index row loss are shared machinery (§8), reported with
the exact rows and the experiments, not edited.

## Totals today

- Outgoing at `10/10 applicable`: **3 of 23** (`dart`, `fsharp`, `php`).
- Outgoing at `N/N applicable` **with incoming resolving**: **0 of 23**.
- Ruleable lanes: **23 of 23 — 20 by a corpus-measured table, 3 by a SPEC prose ruling
  (`hcl make yaml`)**, from `script/m14/verify-ruling-tables-registered.ts`'s own two lists.
  Unadjudicated: **0** (was reported as 4; refuted above with the command that says zero).
- **php's outgoing is `unexplained = 0` as a RE-RUNNABLE ARTIFACT, not a session result**: of
  350,368 endpoints, 115,661 resolve uniquely, 169,156 are ambiguous (the cause-A axis, untouched),
  44,641 are variables in their own file, 10,644 name a bare name no admitted file declares, 8,457
  name php internals, 1,536 a namespace outside the population, 204 a path, 19 a dynamic callee, 45
  a language keyword, 13 a construct, **5 an M37.13 anonymous-class member**, and **0** are in a
  class the census cannot name — target defect 0, source defect 0, source unexplained 0. Round 1's
  two fixes moved 1 orphan `contains` endpoint to 0 and 19 declared-but-unpublished `calls` edges
  to 0; round 2's nested-function fix moved 3 declarations into the store (+3 symbols, +3
  `contains`, +3 resolved) and emptied the last defect class; round 4's `exports` fix moved +1
  symbol and +1 `exports` edge and **exactly the fields that follow from it** (PHP round 4). **No
  bucket was ever moved by inventing an edge**: `calls` 103,190 and `uses` 155,016 are unchanged
  across all three rounds, to the digit. Caveat that cost a re-run: the first version of this table was measured SINGLE-PASS, i.e.
  each file classified against the store as it stood when reached, and it read 29,181 more
  bare-name and 5,142 more namespace-outside endpoints than the two-pass run does; the corrected
  numbers are the ones that agree with the lane's independent audit to the digit.
- **php's INCOMING is measured over the whole population**: of 40,267
  declarations, 21,145 are reached by a resolving edge and **14,371 are named by edges that never
  arrive**, and every one of those 14,371 is named by `ambiguous:multiple-declarations` and nothing
  else. The incoming hole is the outgoing ambiguity seen from the declarations, not a second
  defect and not a missing reverse walk — and round 4's added edge did NOT grow it.
  `bun validation/m14/fixtures/php/reason-census.mts` · artifact
  `validation/m60/php/reason-census.json` · **29 fixtures pass / 0 fail · 73 mutants caught / 0
  survived** · precision 1.000 over a truth file that covers all ten types · PHPD36–PHPD40 and
  rounds 3–6 record the decisions (round 6 added the member channel: member identity plus the owner
  and ancestor stages, with the store's arbitrary member landing pinned by name rather than
  asserted absent). Note that this census — like every number in the bullets above — measures the
  ANALYZER's endpoints; the store's own binding of those rows is a separate layer, and round 6 is
  the first instrument this lane has that reads it.
- Zero regexes: **yes** (18 → 0; laptop A's handoff records they have not matched this).
