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

1. **The enum blocker — affects every lane, both laptops.** `src/ast/types.ts` declares
   `Imports = "brain_import"` while sixteen analyzers emit the literal `"imports"`, which
   is not a value of the enum, and ~50 call sites compare against
   `RelationshipType.Imports`. Import edges are invisible to every consumer and nothing
   turns red. Queued: `ENUM_HARD_FIX`, then `ENUM_SWEEP`. **No lane can reach a verified
   ten before this lands** — it is why `imports` shows `E` in the gate's grid and still
   delivers nothing.
2. **Four unadjudicated lanes**: `clean`, `graphql`, `r`, `scss`.
3. **83 emitted-but-never-audited type-instances** (table above).
4. **Incoming resolves in 0 of 23 lanes.** Whole-corpus, the worst are `f#` 40,791
   ambiguous, `zig` 19,962, `powershell` 18,665, `nim` 12,491, `lua` 7,409, `xml` 6,007.
   This is a *scoping* problem, not coverage: an ambiguous edge is one edge attributed to
   N declarations, so it cannot be reduced by emitting fewer edges.
5. **`calls` unresolved is real, not sampling** — on `sql` it stayed 36% at both 30 and
   400 files, while `uses` (71% → 5.0%) and `references` (32% → 1.3%) were sampling bias.
6. **Two instruments disagree on 11 of 23 lanes** (see the note under the grid).
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

## Totals today

- Outgoing at `10/10 applicable`: **3 of 23** (`dart`, `fsharp`, `php`).
- Outgoing at `N/N applicable` **with incoming resolving**: **0 of 23**.
- Ruleable lanes: **19 of 23**. Unadjudicated: **4**.
- Zero regexes: **yes** (18 → 0; laptop A's handoff records they have not matched this).
