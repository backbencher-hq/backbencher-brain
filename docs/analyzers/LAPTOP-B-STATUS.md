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

> **yaml's `applicable` cell is stale (2026-10-10).** The grid's `4` is the 2026-10-07 seed; the
> lane's declared `coverage` block now reads **8** (`calls` and `exports` moved from
> `corpusUnexercised` to `implemented` on a whole-population count of 327 / 4,080 — see the ROUND 5
> bullet), and `language-board.ts` reports **`yaml 8/8 from=spec coverage block`** with no "coverage
> block does not close" note. The `AMB/UNRES` cell (135 / 225) is the 2026-10-07 `incoming-check`
> snapshot; the lane's current 60-file stride draw is `0 ambiguous / 0 unresolved`, a **PASS**.

**Two columns, two instruments — do not subtract them.** The `E` grid comes from the M60
coverage gate; `applicable` and `AMB/UNRES` come from `incoming-check` (30-file sample
for `applicable`, whole-corpus — 600 files per lane, `make` 129, `clean` 164, `r` 21 —
for `AMB/UNRES`). They **disagree for 11 of 23 lanes** (`json` 9 emitted vs 1 fired†;
`sql`, `nim`, `r`, `powershell` 10 vs 5–8). Reconciling them is open work.

† **`json` RESOLVED 2026-10-09, and both numbers were wrong.** The `1 fired` is a
120-file stride artefact of a corpus that is 97.2% `docs/**` theme data — over the whole
admitted population (13,951 files, 154 repos) **nine** types fire, and the 25
construct-bearing files of the stride corpus fall entirely outside the draw. The
`9 emitted` was wrong too, in the other direction: `implements` was excluded by a stale
ruling while it emits 113 edges. The lane is `9/10 applicable` with `instantiates` the
one true zero (`zero-sites`, so it stays in the denominator). See
`docs/analyzers/json.md`. **This is the general shape**: a firing-log row is a claim
about its stride and, for lanes whose `LANES` entry pins one repo, about that repo
alone — rows now print their corpus and admitted count (`c0b9bcdd5`).

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
7. ~~Waiting on nothing external.~~ **SUPERSEDED 2026-10-11:** one external item does exist and it is
   not a lane's — see 8.
8. **The indexer's `contains` DEDUP GUARD cannot fire for any analyzer whose `contains` targets are
   DOTTED QUALIFIED PATHS rather than colon-suffixed names — measured, with the fix priced and NOT
   applied (2026-10-11).** `parallel-indexer.ts` synthesizes a containment edge for every symbol with
   an owner and skips it when a pre-built `containsPairs` set says the analyzer already emitted the
   pair. That set's child half is `s.replace(/^.*:([^:]+):?\d*$/, "$1")` — a COLON-based reduction,
   written for the `:<line>` names xml's lane measured — so for yaml it leaves the FULL qualified path
   while the lookup uses `symbol.name`, the LEAF: on a real pair from a store this round built,
   build-site key `".golangci .golangci.linters"` vs lookup key `".golangci linters"`, `keys agree?
   false`. The guard therefore never fires and EVERY candidate is written: boundary holds **1,218
   duplicated pairs and exactly 1,218 rows beyond the first** (3,271 rows over 2,053 distinct pairs),
   and a 105-file two-repo draw holds **5,198 of 13,162 rows** — the store over-counts `contains` by
   ~1.65× for this lane, on a store whose *binding* is still correct (clause 4's store-side split
   reads 0 arbitraryTwin, 0 collisions). **It affects every lane with qualified containment targets,
   so it is reported rather than patched here:** the three lines are SHARED indexer code, the previous
   repair in them was landed by another lane with its own 300-file probe
   (`xml`, `b92ea6fda` → `f0b9b15c9`), and a change to them needs a store-scale re-measure this round
   cannot run. The repair is the same child-only one, extended to a colon-free child (reduce by its
   last dot segment); the owner reduction must stay untouched, because that is the half a "symmetric"
   repair got wrong. Reproduction: `validation/m14/fixtures/yaml/store-intent-split.mts` (its
   DUPLICATE STORE ROWS block), and `.tmp-probe/yaml-guard-mismatch.mts` for the two keys.
9. **Waiting on nothing external.** The three LSP branches are 0 commits ahead of `main`
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

## python round 1 (2026-10-10) — the lane's oracle was finished and wired to NOTHING, and four audit rows closed with it

php is closed and declared; this is the first round on the next lane. It opened by reading what
python's differential actually COMPARED, and the answer was worse than a red number: the harness
had a TRUTH that could not disagree with the analyzer.

### 1. The defect — a mirror wearing an oracle's name

`script/m14/differential.ts` imported exactly one thing from python's analyzer — `PYTHON_BUILTINS` —
and derived python's tree truth with an in-file function (`derivePythonEdges`, 455 lines) whose own
comment said it MIRRORED `RealPythonAnalyzer`. That file's header states the rule the whole apparatus
rests on: "a shared helper is not a second opinion; it is one function called twice." The lane's real
oracle — `script/m14/oracles/python-truth.ts`, **1,189 lines, zero imports**, every policy written
beside the code that applies it — was imported by NOTHING in the harness. Only
`script/m14/oracles/python-truth-diff.ts` consumed it.

The mirror derived six labels. The analyzer emits TEN. The four it could not see:

| label | state before |
| --- | --- |
| `contains` | registered DERIVATION finding — emitted, compared by nothing |
| `exports` | registered DERIVATION finding |
| `imports` | registered DERIVATION finding |
| `implements` | IN the compared set with NO truth behind it |

Measured baseline at HEAD, `npx tsx script/m14/differential.ts --lang python`: cython
`MISSING=9 | unexplained=158`, requests `MISSING=2 | unexplained=113`, and the harness's own guard
printed `COMPARED WITH NO TRUTH: implements (3 comparable, 0 truth)` on cython and
`(2 comparable, 0 truth)` on requests — i.e. every `implements` edge was filed as a FABRICATION
because no oracle backed the label.

### 2. `implements` is EMITTED, and the dossier said it emits ZERO

The three DERIVATION rows were a wiring debt. `implements` was not. The dossier
(`docs/analyzers/real-python-analyzer.md`) printed `| implements | RULED | 0 | 0 |` in its
emitted-type table and opened the section "The one type this analyzer does not emit". **That has been
false since 2026-10-09**, when the lane reversed its own instrument-A ruling (PY-27 → PY-34): the
conformance relation arrives INSIDE the base list (`class C(Mapping)`), the most specific true label
is `implements`, and the inheritance fact rides in `metadata.superTypes`. The analyzer's code says so,
two fixtures pin it (`python/interface-implements`, `python/implements-interface-bases`), and the
differential observed 3 + 2 such edges. Instrument A's "0 of 17 node-type names" is a true
measurement of the GRAMMAR and a false answer to "does python have the relation" — instrument B's 71
interface-declaring base entries were the right measurement all along. Corrected in the dossier and in
`script/m14/python-ruled.ts`, both of which now carry the reversal rather than the stale verdict.

### 3. What changed

- `script/m14/oracles/python-truth.ts` gained an independent `implements` derivation — the ruled
tiers: a proven stdlib marker read from the FILE'S OWN imports (dotted spellings root-proven, bare
names POSITIONAL) and an in-file interface base — and `extends` is now the else-branch of that test,
so one base publishes ONE edge (the additive reading is a forbid in two fixtures).
- `script/m14/python-truth.ts`, the shim the DERIVATION gate reads, gained `implements`.
- `script/m14/differential.ts` now imports the lane oracle, and python's compared set gained
`contains`, `exports`, `imports`.
- The oracle gained the tier the base list cannot express: `SomeABC.register(SomeConcrete)`, the
  one form of conformance with NO inheritance. It matters because the `.register(` SPELLING is a
  homonym — 493 `X.register(Y)` calls in 5,984 files, only ONE with a provably abstract receiver
  (`site.register` alone is 241) — so the rule proves the RECEIVER from this file's imports or a
  class it declares abstract, exactly as the base-list tiers prove a base.
- New lane-owned check `validation/m14/fixtures/python/oracle-interface-tiers.ts`: the five
  interface fixtures' own `expect`/`forbid` rows, read out of their JSON and held against the
  ORACLE in both directions. It is what found the register gap, and it is now what stops the
  oracle drifting away from the ruling.

### 4. Evidence (every line re-runnable)

- `npx tsx script/m14/differential.ts --lang python` — two consecutive runs over TWO cold-pool
  draws (cython rotates; requests is its whole 37-file corpus and is fixed), and both read
  `covered=100% MISSING=0 unexplained=0` with no `COMPARED WITH NO TRUTH` line:
  cython `rot 8 hash=5ac6017e` `tree-truth=16529` / `rot 9 hash=7529b0d8` `tree-truth=4896`,
  requests `hash=e3679fa2` `tree-truth=5326` on both. The counts MOVE WITH THE DRAW — that is
  what the hash is published for, and it is why two runs are quoted rather than one. The
  `heuristic` rows (164/146 for cython, 55 for requests) are the declared first-parent override
  guesses at confidence < 0.7 — declared suspicion on the contract's own terms, no fabrication.
- `npx tsx validation/m14/fixtures/python/oracle-interface-tiers.ts` — **PASS**, both directions,
  on all five interface fixtures (`interface-implements` implements=6/extends=3,
  `implements-interface-bases` 8/4, `interface-qualified-subscript-head` 2/3,
  `implements-proof-requires-binding` 1/7, `interface-declaration-needs-abc-meta` 10/6).
- `bun script/m14/verify-label-coverage.ts` — `| python | cython | 25 | 4857 | 4857 | — | — |`, no
  unaudited label. The dossier records this instrument as UNABLE to measure python; on this box
  `cython` and `requests` are top-level checkouts, so the pin resolves and the lane is measurable.
- `npx tsx script/m14/verify-python-oracle-labels.ts 400` — declared == observed in BOTH directions
  over 400 real files, shim identical to the canonical list, `implements` observed 40 times.
- `bun run script/m14/run-fixtures.ts --lang python` — **35 pass, 0 fail, no regressions**.
- `npx tsx script/m14/python-lane-census.mjs` over a derived 1,200-file draw of the whole box —
  `implements` **26 edges in 14 files, 80.8% with both endpoints resolved**.
- `npx tsc --noEmit --project tsconfig.scripts.json` — no error in any file this round touched.

### 5. Reported, NOT fixed

- **`bun` cannot transpile `script/m14/zig-ruled.ts`** — `error: Unexpected }` at 248:7, because the
  file names a local function `declare` and bun parses the TS contextual keyword as an ambient
  declaration. The file is valid TypeScript (`tsc` clean; `tsx` imports it and exports `ZIG_RULED`),
  so this is a BUN limitation rather than a lane defect — but the arbiter's documented command is
  `bun script/m14/ontology-coverage-gate.ts`, and under bun the gate dies on the import, for EVERY
  lane. A one-word rename fixes it. Another lane's file; not edited. **FIXED in round 2** — renamed
  to `declareName`, identical behaviour, and the gate now runs under its documented command.
- **The arbiter is still blind to python.** Under `tsx` the gate runs and admits python corpus from
  the flat checkouts, then prints `no RULING SOURCE for python` — `python: PYTHON_RULED` is not in
  `RULED_BY_LANG`. That is the one import + one line `script/m14/python-ruled.ts` names as
  supervisor-owned, and it is still not made. **FIXED in round 2** — registered, and the gate now
  reports the lane at `emitted 10/10`.
- **`derivePythonEdges` is now DEAD CODE** in `script/m14/differential.ts` (455 lines, no caller). It
  is marked superseded at its head; deleting it is mechanical and was left for a pass that can do it
  without racing other lanes' edits to that shared file.
- `validation/m14/fixtures/python/derivation-audit.ts` hardcodes a `python-corpus/` root that does not
  exist on this box and exits **0** with "no corpus" — a SILENT PASS, the exact shape the lane's own
  doctrine names. Its job is now done by `verify-label-coverage.ts` above.

### What this round does NOT claim

That python is done. It is not: the whole-corpus `implements` figure is not yet in the dossier's
emitted-type table (that row carries the 1,200-file draw and the fixture's 200-file frame), the mirror
is still on disk, the python mutants were not re-run for this change, and php's two store-wide defects
— the insert-time rank for rows with no published receiver, and re-store row loss at
`parallel-indexer.ts:2928-2929` — are python's too and are untouched here.

## python round 2 (2026-10-10) — the arbiter reports the lane, the incoming direction is measured, and a red mutant harness is repaired

Round 1 closed the oracle wiring. Round 2 does the three things that turn the lane's evidence into
a verdict: it puts the lane in front of the ARBITER, it measures whether the edges it emits actually
BIND, and it repairs the mutation harness the round-1 review left red.

### 1. The arbiter now reports python — and getting there took two fixes, one of them branch-wide

Round 1's `### 5` recorded both as reported-and-unfixed. Both are fixed and the record is amended
above rather than overwritten.

- **The wiring**, the one import + one line `script/m14/python-ruled.ts` names as supervisor-owned:
  `python: PYTHON_RULED` added to `RULED_BY_LANG` in `script/m14/ontology-coverage-gate.ts`.
- **A type error the wiring EXPOSED, which is the reason a lane cannot verify its own table.**
  `python-ruled.ts` declared `Ruled.type` as `string` while the gate's is the literal union of its
  ten ontology types — and nothing caught it, because `string` is only incompatible AT AN
  ASSIGNMENT SITE, and until `python: PYTHON_RULED` was registered this table had no consumer. It
  now declares the union the way the neighbouring `zig-ruled.ts` does, with the reason recorded at
  the declaration.
- **A bun transpile break in ANOTHER lane's ruling table, which took the arbiter down for EVERY
  lane.** `script/m14/zig-ruled.ts` names a local function `declare`; bun reads the TypeScript
  contextual keyword as the start of an ambient declaration and aborts with `error: Unexpected }`
  15 lines later. `tsc` accepted the file and `tsx` imported it fine, so the break was invisible to
  every check except the documented command — `bun script/m14/ontology-coverage-gate.ts <lang>`
  dies on the import before it can print anything. Renamed to `declareName` (behaviour identical),
  with the reason recorded at the definition so a future edit does not reintroduce it.

`bun script/m14/ontology-coverage-gate.ts python --fresh`:

```
walk: emitted population 11,488/11,488 files measured by the analyzer THIS run (0 settled by an earlier walk,
      0 degraded, 0 abandoned) — COMPLETE, so absence is certifiable in this run
emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0   ruled-unknown 0     exit 0
```

The corpus admission is **11,488 files**, not the 424 the dossier records — the flat layout admits
python from every top-level checkout. Whole-population counts, per type: calls 535,154 · uses
389,972 · contains 135,619 · imports 97,112 · references 63,498 · exports 3,043 · extends 20,954 ·
**implements 333** · overrides 33,492 · instantiates 13,134.

**The space attestation, answered by declaration rather than by a new artefact.** The arbiter refuses
to read a vocabulary-based ruling as SOUND in a language whose corpus writes key/value bindings, and
python writes **801,877** of them. `PYTHON_RULED` now carries `spacesProbed: ["node-types",
"attribute-keys"]`, a statement about what the lane MEASURED, and the instruments that back it are
`python-construct-census.mts` (the `metaclass=ABCMeta` keyword argument, its B3 row) and the probe's
`.register(` METHOD-NAME spelling (493 loose calls, 1 provable receiver). Two amendments from round 3
are folded in here rather than left standing: the sentence as first written credited the `metaclass=`
count to `implements-probe.ts`, which did NOT count it until round 3 added the counter — a claim about
an instrument is a claim, and it was wrong when written — and the closing sentence, that the gate
still prints `attestation python: none` with a real artefact listed as open work, is superseded by
round 3's `### 2`.

### 2. The incoming direction, whole population, for the first time

`npx tsx script/m14/python-endpoint-resolution.ts`, over the arbiter's 11,488 files: **205,928
symbols, 1,292,311 relationships**. `npx tsx script/m14/python-endpoint-defects.ts` names the classes
the census counts:

| class | whole population |
| --- | --- |
| `implements` UNRESOLVED | **0** (201 resolved · 104 external · 25 ambiguous · 3 virtual-registration) |
| D1 `contains` into a symbol the production path deletes | 0 |
| D2 `references` into an interpreter builtin outside the analyzer's 11-name primitive list | **7,687 in 1,732 files** |
| D3 empty / whitespace-only endpoints | 0 |
| D4a / D4b placeholder-literal endpoints (invented / present in the file) | 0 / 0 |
| D5 `uses` self-loops (target leaf == the reading function's own name) | **750 in 178 files** |
| D6a / D6b empty / placeholder-literal symbol names | 0 / 0 |
| D7 relationships the production path discards after `analyze()` | 0 |

Both non-zero classes are DECLARED with the measurement that decides them, not quietly fixed:

- **D2 is mostly a pinned design position.** `validation/m14/fixtures/python/type-usage-graph.expectation.json`
  pins `references -> dict` and `references -> list` as EXPECTED and `str`/`None` as FORBIDS — builtin
  CONTAINER names are deliberate edges, builtin SCALAR names are noise. The slice no fixture claims is
  the exception hierarchy (`Exception` 97, `BaseException` 180 of the 7,687). Closing it needs an
  analyzer change, a MIRRORED oracle change and a fixture, so it is named with its count instead.
- **D5 is a NAME COINCIDENCE, not a self-dependency.** `uses to_json -> to_json` is emitted inside
  `def to_json` by `if hasattr(self.actual_instance, "to_json") and callable(self.actual_instance.to_json)`
  — a read of ANOTHER object's member that shares the reading function's name (same shape as
  `ansible`'s `@property def changed` reading `loop_result.changed`). The edge is TRUE; the hazard is
  that a naive name-resolution walk binds the read to the reading scope. Dropping it would delete a
  true edge, which is the worse failure.

### 3. The mutant harness was RED and is now green

`python3 script/m14/python-implements-mutants.py` read **`0 surviving, 6 unapplied`** — and its own
header states that NOT APPLIED is a failure in its own right, because a mutant whose pattern no
longer exists is a claim of coverage that does not exist. Six anchors had gone stale against the
PY-25/PY-26/PY-27 revisions and against the deletion of the dead `Generic` clause: `branch-disabled`,
`spelling-proof`, `bare-route-on-dotted`, `dotted-root-unproven`, `generic-accepted`,
`enum-signed-numeric`. Each was re-anchored on the LIVE code that implements the same protection
(e.g. `spelling-proof` now mutates `pythonMarkerKindForBase` to key on the base's NAME rather than
this file's binding; `generic-accepted` now adds `Generic` to the names carried out of `typing`, which
is the mutation the forbid row exists to kill). Now:

```
13 mutants: 13 CAUGHT, 0 surviving, 0 unapplied, 0 equivalent     exit 0
ANALYZER RESTORED to the unmutated source
every mutant was applied and caught.
```

### 4. The spec file's written rulings are corrected, because the arbiter reads them

`script/m14/spec/python-completeness.json` carried the same stale `implements` verdict as the dossier
and `python-ruled.ts` (`PY-D8`: "every one of those 71 base entries is already published as an
`extends` edge" and `implements` "would add 71 edges duplicating 71 existing ones"). It now records the
2026-10-09 reversal (PY-27 → PY-34), the ONE-edge/most-specific-label ruling, the source shapes, and
the measured 333 edges / 97 files / **0 unresolved**. Two other stale claims went with it:
`gap._description` said the differential floor was `unexplained=2` (it reads 0 now, with the oracle
wired) and `label_coverage.declared_no_truth` declared `overrides` as having no oracle — which was
false on its own terms (the lane oracle derives it) — while the shared differential reported THREE
undeclared DERIVATION gaps (`contains`, `exports`, `imports`). That section now carries an explicit
`_closure_record` instead of two silent contradictions.

### 5. Reported, NOT fixed

- **D2's exception slice** (277 edges naming builtin exception classes) — priced above, needs
  analyzer + mirrored oracle + fixture together. — **CLOSED in round 3** (`### 5`): the question was
  the POSITION, not the name, so no analyzer or oracle change was needed; the slice is pinned by two
  fixtures and the defect axis (D2b) measures 0 of 7,687.
- **`derivePythonEdges` is still dead code** in `script/m14/differential.ts` (455 lines, no caller,
  marked SUPERSEDED at its head). Deletion is mechanical; it needs one uninterrupted pass over a file
  several lanes edit. — **FIXED in round 3** (`### 1`): deleted, and the harness re-run afterwards as
  the proof the 455 lines were never reached.
- **`script/m14/python-ontology-census.ts`** still appends `python-corpus` to the corpus root, so it
  cannot run on the flat layout; the arbiter's own table supersedes it for the emitted-type counts.
- **No `ruling-attestation.json`** for python — the spaces are declared on the ruling entry (which
  the gate accepts) but the artefact-with-pointers form the gate also supports does not exist.
  — **FIXED in round 3** (`### 2`): the artefact and the attestation exist, every pointer verifies,
  and the gate prints a real `VERIFIED` line instead of `none`.
- `firing-check.mjs` / `firing-check-v2.mjs` were NOT re-verified on this box; the dossier now says so
  instead of restating the 2026-10-05 failure as current.

### What this round does NOT claim

That python is done. The remaining shape is the same one php closed with: what is NOT resolved must be
enumerated and bounded (D2/D5 are now named, and the resolution census carries the rest), and the dead
mirror should be removed. — **AMENDED in round 3** (`### 3`): the claim that the lane has no seam gate
of php's kind was wrong when it was written. `validation/m14/fixtures/python/store-heritage-seam.mts`
(PY-35) is that gate — A analyzer-carries, B store-carries-through-the-real-worker-pool, C one label
per base — and it PASSES. What the lane still lacks is the *owner-resolution* half of php's pair
(`validation/m14/fixtures/php/owner-resolution-gate.mts`), which python cannot have yet because it
publishes no relation-level `owner` channel; that is reported by the seam's own `[report]` row rather
than asserted.

## python round 3 (2026-10-10) — the dead mirror is deleted, the attestation exists and VERIFIES, and the seam gate the lane was said not to have turns out to exist and pass

Round 2 left four items open. Round 3 closes three and corrects the fourth.

### 1. The 455-line dead mirror is deleted — and the harness was re-run as the proof it was dead

`script/m14/differential.ts` carried `derivePythonEdges`, a copy of the analyzer's python rules marked
SUPERSEDED whose header stated outright that it MIRRORED `RealPythonAnalyzer`. Round 1 replaced it
with the lane's own oracle but left the copy on disk "for one pass". It is gone: the function, its
SUPERSEDED header, and the `PYTHON_BUILTINS` import that became unused when the last caller went. The
file is 26,015 → 25,562 lines.

The deletion is not a claim, so it is measured. `npx tsx script/m14/differential.ts --lang python`:
cython `files=60 tree-truth=8664 covered=8664 (100%) MISSING=0 | analyzer-edges=2513 unexplained=0`;
requests `files=37 tree-truth=5326 covered=5326 (100%) MISSING=0 | 2552 unexplained=0`. The cold pool
rotated between runs (rot 10 / rot 9), so the absolute tree-truth figures are not the ones round 1
printed; the invariants — **covered 100%, MISSING 0, unexplained 0** — are, and they are what the
deletion had to preserve. A dead function cannot be proven dead by deleting it and looking at the
file; it is proven dead by the harness whose numbers do not move.

### 2. The attestation exists, and every pointer in it verifies

The gate supports a lane declaring its probed spaces in `validation/m14/fixtures/<lang>/ruling-attestation.json`,
backed by an ARTEFACT whose pointers hold the declared counts. Round 2 declared the spaces on the
ruling entry (`spacesProbed`) and left the artefact form as open work, which meant the gate printed:

```
attestation python: none — declare `spacesProbed` in the lane's Ruled table, or provide validation/m14/fixtures/python/ruling-attestation.json with an artefact that exists
```

It now reads (whole `--fresh` walk, 11,488/11,488 files measured this run):

```
key spaces: 801,877 key/value bindings observed over 11488 files (top node types assignment=367,331,
            keyword_argument=227,905, pair=137,326, typed_parameter=29,397)
attestation python: validation/m14/fixtures/python/ruling-attestation.json — spaces node-types, attribute-keys;
            artefact validation/m14/fixtures/python/construct-census.current.json;
            VERIFIED nodeTypes=203, attributeKeys=227330, implements.constructSites=204
emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0   ruled-unknown 0     exit 0
```

**The artefact** is `construct-census.current.json` — the `--json` output of the lane's own implements
probe over this box's FLAT corpus: 10,839 tracked `.py`/`.pyi` files at or under 512 KiB across 49
top-level checkouts. Three additions to the probe were required, and each is a case of the attestation
being only as strong as the thing it can point at:

- **`BB_PY_CORPUS` support.** The probe hardcoded `python-corpus/`, which does not exist on the flat
  layout, so the instrument the attestation rests on could not run where the gate runs. Same env var
  `python-construct-census.mts` already used.
- **The attribute-keys SPACE counters.** `keywordArgumentNodes` counts every `keyword_argument` node
  in the corpus — 227,330 over 7,913 files — and `classHeaderKeywordArguments` counts the 185 that sit
  in a class header. The attestation points at the FIRST: python spells this space as a
  `keyword_argument`, and a class-header-only number would verify while saying nothing about the space.
- **`implementsConstructSites`** = 204 (abcBase 22 + protocolBase 117 + virtualRegister 0 +
  metaclassArg 65), with its definition carried in the artefact as a string, because a JSON artefact
  has nowhere else to say what its number means.

The probe's self-test was extended with the new counters and still passes: `keywordArgumentNodes` 4
(two class headers plus `calibrate(alpha=1, beta=2)`), `classHeaderKeywordArguments` 2, `metaclassArg`
1 — so the two space counters cannot be the same number by construction.

**Two independent instruments agree, which is the point of the number.** The gate's own walk reads
227,905 `keyword_argument` nodes over the 11,488 files IT admits; this probe reads 227,330 over its
own 10,839. A 0.25% spread, fully explained by the admission rules (the gate admits untracked files
and files above the probe's 512 KiB cap). `metaclassArg` = 65 sites in 35 files is a construct the
analyzer keys on (`real-python-analyzer.ts` reads the `metaclass` keyword), so the counter is not
measuring a shape nothing consumes.

**Why a row for a type that is EMITTED.** `implements` IS emitted (PY-34), so the gate reads EMITTED
from observation and never reaches the row. The row is the REGRESSION TRAP: the attested count is 204
construct sites, so if a change ever stops the emission the gate reads FALSIFIED — present, derivable,
not emitted — rather than RULED-SOUND, which is the flattering direction the gate's own
attribute-keys block exists to refuse. POPULATION: 204 is counted over the whole box; the PY-34
ruling's 71 was counted over five pinned checkouts. The attestation says so, in the file, so the two
numbers are not read as the same measurement of the same thing.

### 3. The seam gate the lane was said not to have: it exists, and it passes

Round 2's closing paragraph recorded, as an unfixed gap, that "the lane has no owner-resolution gate
of php's kind — the store-side half is measured only through the census". That is wrong, and it is
amended above rather than quietly dropped: `validation/m14/fixtures/python/store-heritage-seam.mts`
(PY-35) is the python half of php's `script/m60/php-store-pipeline-seam.ts`, and it PASSES:

```
A  analyzer carries superTypes on 3 class-like symbol(s): impl.py:Base=["ABC"] impl.py:Child=["Base"] impl.py:UserRepo=["Repository"]
B  store holds super_types on 3 of 12 symbol(s): Base=["ABC"] Child=["Base"] UserRepo=["Repository"]
C  heritage edges: ["extends UserRepo -> Repository","implements Base -> ABC","implements Child -> Base"]
PASS — A analyzer carries, B store carries (interface base included), C one label per base
```

B is measured through the REAL pipeline (`indexProjectParallel`, worker pool included), because
measuring with the projected object would make the control part of the thing under test; A is measured
with `ASTEngine.parseFile`, the analyzer entry the fixtures use, for the same reason. C asserts the
label is the most SPECIFIC true one AND forbids the additive pair (`extends Base -> ABC`,
`extends Child -> Base`) in the same gate, so "close the heritage gap" cannot be satisfied by
re-introducing the edge PY-34 removed. The gate's fourth row — a member read through a base, printed
because python publishes no relation-level `owner` channel — stays REPORTED, NOT SCORED: a gate may
only assert what this change made true. What the lane still lacks is php's *owner-resolution* half
(`validation/m14/fixtures/php/owner-resolution-gate.mts`), and the seam's `[report]` row is the
measurement that says why it cannot have it yet.

### 4. Verified together

`npx tsc --noEmit --project tsconfig.scripts.json`: no error in any file this round touched.
`bun run script/m14/run-fixtures.ts --lang python`: **37 pass, 0 fail, no regressions** (the two new
fixtures in `### 5` included).
`bun script/m14/ontology-coverage-gate.ts python --fresh`: **emitted 10/10, exit 0**, attestation
VERIFIED. `npx tsx script/m14/differential.ts --lang python`: 100% / 0 / 0 on both pinned repos.
`bun validation/m14/fixtures/python/implements-probe.ts --self-test`: every asserted counter fired.

### 5. D2 stops being a defect class, and gets a defect axis that can actually fail

Round 2's `### 2` named D2 — **7,687 `references` into interpreter builtins** — as "mostly a pinned
design position" with the exception slice (`Exception` 97, `BaseException` 180, plus `type` 383)
unpinned and needing "analyzer + mirrored oracle + fixture together". Round 3 found that the slice
needed none of those, because the question was never the NAME.

**Where the edges come from, measured rather than argued.** A synthetic source containing every
candidate position: a return annotation (`-> Exception`), a typed attribute (`slot: Exception`), a
typed parameter, an isinstance check and a union each emit exactly one `references` edge;
`except Exception as ex:` and `raise ValueError("x")` emit **none**. So the analyzer's axis is the
POSITION — a type position names a type whether or not the interpreter defines it, which is exactly
the position `type-usage-graph.expectation.json` had already pinned for `dict`/`list` — and the 180
`BaseException` + 97 `Exception` edges are annotation and isinstance facts, not control-flow noise.

**So the rule is pinned at both ends, and the census stops calling a position a fault.**
`python/builtin-type-name-is-still-a-reference` asserts four firing rows (`Exception` × 2,
`BaseException`, `type`) and `python/builtin-type-name-is-not-a-control-flow-edge` FORBIDS the two
exception rows, so the pair fails in either direction. The defect axis moved to **D2b** — the same
reference arriving from a position outside `declared_type`/`return_type`/`instanceof_check` — and it
is measured, not assumed: `npx tsx script/m14/python-endpoint-defects.ts --workers 4` over the same
11,488-file population reads **D1 0 · D2 7,687 DECLARED · D2b 0 · D3 0 · D4a/b 0 · D5 750 · D6a/b 0
· D7 0**. D2's number is a population size with a named cause. `PY-D9` in
`script/m14/spec/python-completeness.json` records the decision with its evidence and its overturn
condition, `python-endpoint-defects.ts` states the position in its header and its report line, and
python fixtures read **37/37**. No analyzer or oracle change was needed, which is the finding: the
analyzer was already consistent with the position its own fixture pinned; the instrument that
disagreed was the census that called that position a defect.

### 6. Still open after round 3
- **D5** (750 `uses` self-loops over 178 files) — declared as a name coincidence, not a self-edge.
- **`script/m14/python-ontology-census.ts`** still appends `python-corpus` to the corpus root, so it
  cannot run on the flat layout; the arbiter's table and now the attestation artefact supersede it.
- `firing-check.mjs` / `firing-check-v2.mjs` were NOT re-verified; their `LANES` pins still name
  `python-codesql`, a path this box does not have.

## python round 4 (2026-10-10) — the member channel exists, and its boundary is the whole design

Round 3 closed the OUTGOING side and the `implements` resolution story. Round 4 is the first half of
this lane's incoming-member problem: python published **no relation-level `owner` at all** (measured
over the whole admitted corpus: 0 of every `calls`/`uses` edge), so every member edge fell to the
store's name-keyed ranking — same file first, then lexicographic `s.id` compared as TEXT — which is a
tie-break and not a fact about python. `render` is a method on many classes at once; the ranking bound
the bare name to whichever declaration sorted first, and the row was stored RESOLVED anyway.

### 1. The channel, and why it is narrow on purpose
`real-python-analyzer.ts` now publishes `metadata.owner` on a member-position edge when the receiver is
EXACTLY the implicit first parameter, spelled `self` or `cls`, with a SINGLE dot (`memberOwnerOf`).
That is the same spelling the `dispatch-on-parameter` reason code already trusts, and it is the case
the store's rule 0 answers by IDENTITY (the source method's own class), never by a name that could
collide. The store's `resolveMemberTargetsByOwner` (`src/ast/member-owner-resolution.ts`) is
language-agnostic and scoped by the DATA (presence of the key), so this activates php's PHPD42 lever
for this lane with no language switch. **The boundary is the design, not a tidy-up:**
`self.store.save` (two dots) carries NO owner, because `save` belongs to the VALUE of `self.store`,
whose type nothing in the parse states — labelling it with the ENCLOSING class would let the store
bind `save` to a method of the outer class, a confident wrong edge. A local receiver (`other.save`)
and a module-level `def f(self)` carry none for the same reason.

### 2. Four instruments, because one does not settle a channel
- `python/member-owner-channel` (fixture) pins the ANALYZER's signal: three positive rows (`calls
  draw -> render`, `uses draw -> host`, `calls make -> text` for `cls`), TWO `meta.owner: null`
  negatives (`self.store.save`, module-level `self.thing`), and a forbid for the wrong value.
- `python/owner-resolution-gate.mts` (NEW) measures the store PASS IN ISOLATION on five crafted
  files, with php's three-store structure: as-is / no-owner / no-`super_types`. It pins DIRECT
  (receiver's own class), INHERITED (through one ancestor), and COLLIDING (`self.solo()` in one of
  two classes called `Twin` resolves by IDENTITY); CONTROL B shows that removing `metadata.owner`
  resolves NOTHING (so the resolutions are caused by that signal), and CONTROL C shows the ancestor
  walk is load-bearing. PASSES.
- `store-heritage-seam.mts` section D (was a REPORTED-NOT-SCORED row) now measures it through the
  REAL pipeline (`indexProjectParallel`), including a CROSS-FILE ancestor walk: `UserRepo.read_all`'s
  `self.record` resolves to `Repository`'s own attribute in `base.py`. PASSES.
- `python/owner-channel-census.mts` (NEW) prices the lever on a real repo through the real index.
  `requests`: 375 owner-carrying rows of 3,325 member rows (11.3%), **195 RESOLVED** (188 direct +
  7 inherited), 180 declined.

### 3. The declines are DECLARED, not hidden
162 of the 180 declines are rows where the owner's OWN class declares the target name TWICE — the
python shape where an attribute is declared both as a class-body annotation (`x: T`, PEP 526) and as
an instance assignment (`self.x = ...`). That is two `contains` edges and two members, which the
INDEPENDENT ORACLE deliberately corroborates (`walkClassBody` / `instanceAttrSeen` in
`oracles/python-truth.ts`: an annotation IS a member, and in a TypedDict it is the only one there
is). The pass refuses to pick between two genuine declarations rather than guess — php's gate states
the same rule. Resolving them would lift the channel's share from 52% to ~94%, but it needs either
collapsing two oracle-corroborated symbols (the differential reads that as a LOSS) or widening the
SHARED store pass to treat same-owner/name/kind candidates as one member — a change to php's closed
pass. **Registered as `PY-D10`, measured, not taken unilaterally.**

### 4. Verified together (all this run, analyzer = the shipped source)
- python fixtures **38/38** (the new fixture included), baseline gate: no regressions.
- differential `--lang python`: cython 100% covered / MISSING 0 / unexplained 0; requests 100% / 0 / 0.
- arbiter `python --fresh`: **emitted 10/10, FALSIFIED 0, ruled-without-justification 0**; edge counts
  IDENTICAL to round 3 (calls 535,154 · uses 389,972 · contains 135,619 · …), so the metadata added
  no edge and removed none; attestation **VERIFIED**.
- mutants **16/16 CAUGHT** — the 13 `implements` mutants plus THREE new `owner/*` mutants that fail
  the boundary the moment it widens (`owner/deep-chain-widened`, `owner/spelling-only`,
  `owner/uses-owner-dropped`).
- `python/owner-resolution-gate.mts` PASSES; `store-heritage-seam.mts` PASSES (sections A–D).

### 5. Still open after round 4
- The same-owner/name/kind duplicate case (`PY-D10`): resolved to a DECLARED position; a deliberate
  next step, not a silent gap.
- Round-3 items unchanged: **D5** (750 `uses` self-loops), `python-ontology-census.ts` corpus-pin
  staleness, `firing-check*.mjs` pins.
- The `ambiguousInChain`/`notDeclared` split is the pass's own counter; the census now re-derives the
  same-class member count so the decline causes are printed rather than inferred.

## python round 5 (2026-10-10) — the owner channel's declared limit is closed, and php is provably untouched

Round 4 shipped the owner channel but declared a limit: 162 of its 180 declines on `requests` were
rows where the owner's class declares one member TWICE — a class-body annotation (`x: T`, PEP 526)
beside an instance assignment (`self.x = ...`). The analyzer and the independent oracle BOTH publish
those as two members, so neither symbol may be dropped; the pass simply refused to pick between two
genuine declarations. Round 5 widens the pass on a rule about the CANDIDATES, not about a language.

### 1. The rule, and why it is a truth and not a tie-break
`src/ast/member-owner-resolution.ts` now resolves a candidate set whose members share the owner's
IDENTITY (`owner_symbol_id`), the member NAME and the KIND — binding to the smallest id so the answer
is stable across runs. That is not the guess the pass exists to refuse: unlike `ambiguousInChain`,
where the choice is between DIFFERENT declarations, these candidates are the SAME member, so any of
them lands the edge on the same node. A set with MORE THAN ONE KIND still declines — a name a class
carries as both a method and a property is two different members — and the new `sameKindDuplicateResolved`
counter keeps the duplicate resolutions visible instead of folding them into `ownerResolved`.

### 2. php-neutrality, PROVEN rather than argued
php is a CLOSED lane and the pass is SHARED, so the change was measured against php before it was
claimed:
- `validation/m14/fixtures/php/owner-resolution-gate.mts` — **PASSES**, every pin identical
  (`ownerResolved=2 inheritedResolved=1 ambiguousOwner=1 notDeclared=2`).
- `validation/m14/fixtures/php/store-resolution-census.mts --out .tmp-py/php-census-after.json` —
  **PASSES**; on its 600-file whole-population sample the new branch fires **ZERO** times
  (`sameKindDuplicateResolved=0`), owner-resolved rows are **unchanged at 3,354**, `ambiguousInChain`
  **unchanged at 152**, `resolved:ancestor` 0. php never reaches the same-kind branch for a single
  class (it forbids two properties or two methods of one name), which is exactly why the rule is
  stated as a fact about the candidates.

### 3. The gain, measured
`python/owner-channel-census.mts` on `requests`, same corpus, same pass input:

| | round 4 | round 5 |
| --- | --- | --- |
| owner-carrying rows | 375 | 375 |
| RESOLVED | 195 (52.0%) | **357 (95.2%)** |
| — direct | 188 | 350 (`sameKindDuplicateResolved=162`) |
| — inherited | 7 | 7 |
| DECLINED | 180 | **18** |
| — class declares no such member | 14 | 14 |
| — genuinely multi-kind | 166 | **4** |

The residual 18 are honest: 14 names the owner's chain does not declare (inherited-or-foreign), and
4 real multi-kind ambiguities the pass still refuses to pick between.

### 4. Verified together (analyzer UNTOUCHED this round)
- `python/owner-resolution-gate.mts` **PASSES**, now with a DUPLICATE case (`value: int` + `self.value = 0`)
  that resolves and reports `sameKindDuplicateResolved=1`.
- python fixtures **38/38**, no regressions. `tsc` clean for every file touched (the remaining project
  errors are other lanes' m12 probes and `fsharp-mutants.ts`, none of them this lane's).
- The ANALYZER did not change, so the arbiter's `10/10` and the differential's `100% / 0 / 0` from
  round 4 still describe the emitted graph by construction — this round moved only the store's
  binding rule, which the arbiter walk does not invoke.

## python round 6 (2026-10-10) — the incoming direction gets a VERDICT, and the verdict found a fabrication the differential was blind to

Rounds 4–5 gave python a member-resolution mechanism. Round 6 asks the harder question the lane had
never been able to answer: of every UNRESOLVED incoming target, WHY is it unresolved, and how much of
that is the lane's own doing? The answer needed a new instrument, and the instrument immediately
convicted the analyzer of one published slice that was never true.

### 1. The verdict — an axis per unresolved target, and only the last axis is a defect
`script/m14/python-endpoint-resolution.ts` now classifies every UNRESOLVED incoming target by the
fact that explains it, preferring the analyzer's own statement (`reasonCode`, `qualified`) over the
census's inference, and asking the interpreter (`dir(builtins)`) only where nothing else answers:
`declared-dynamic` (the lane itself says the target is chosen at runtime — `dispatch-on-receiver`,
`dispatch-on-parameter`, `member-read`, `first-parent-guess`), `declared-external`
(`external-member-call`), `qualified-external` (a dotted `qualified` spelling whose root the file
imported or the population declares), `builtin` (a leaf the interpreter owns), and **`UNEXPLAINED` —
the only axis that names a defect**. The point of the axes is that "unresolved" is not one thing: a
`self.x` read whose receiver's type nothing knows is DERIVED unresolved, while a bare name that
binds to nothing is a possible fabrication, and averaging the two reports a rate that means neither.

Whole population (11,488 files, 205,928 symbols, 1,290,877 relationships):

| label | outgoing UNRESOLVED | incoming UNEXPLAINED | declared axes it is distributed over |
| --- | --- | --- | --- |
| calls | 0 | **4,837** | dynamic 27,580 · external 31,196 · builtin 3,062 |
| uses | 0 | **0** | dynamic 21,376 |
| contains | 0 | **0** | — |
| imports | 0 | **0** | — |
| references | 0 | **1,332** | qualified-external 514 · builtin 374 |
| exports | 0 | **9** | — |
| extends | 0 | **105** | qualified-external 306 · builtin 72 |
| implements | 0 | **0** | — |
| overrides | 0 | **0** | — |
| instantiates | 0 | **0** | — |

**Outgoing UNRESOLVED is 0 for all ten labels** — the round-3 property, re-measured. The incoming
hole is 6,283, and every one of those is now attributed rather than merely counted.

### 2. PY-D11 (FIXED) — a keyword argument's name was published as a type
`Annotated[str, Field(min_length=1, strict=True, max_length=2048)]` holds a CALL inside an
annotation, and `collectTypeNodes` descended into it and published `references … -> min_length`,
`-> strict`, `-> max_length` — the keyword NAMES of a validator. Those names are parameter labels,
not types, and they bind to nothing; they were a measured slice of the verdict's
`unexplainedTargetNames`. The rule that fixes it is the one this lane already applies everywhere
else: the NAME is the label, the VALUE is the expression — so the walk now skips the `keyword_argument`
name and still recurses into its value (`TypeVar("T", bound=Base)` must keep `Base`).
**`references` 63,498 → 62,064 (−1,434 edges)**, and a new fixture
(`python/references-do-not-name-keyword-arguments`; 2 expect, 5 forbid) pins both directions.

**The lesson is the more useful half: the differential COULD NOT see this.** The oracle's own
`collectTypeNodes` carried the same walk and the same mistake — the two sides agreed, so
`MISSING=0 unexplained=0` held while both published the same fabrication. A mirror written in
lockstep is a consistency check, not a truth check. What named the defect was the verdict's
`unexplainedTargetNames` histogram, i.e. an instrument that asks the INTERPRETER and the POPULATION
whether a name is anything, rather than asking the analyzer whether it agrees with its twin. Both
`collectTypeNodes` were fixed together, and that is stated as a hazard, not a victory.

### 3. PY-D12 (DECLARED) — the verdict is an artefact, not a session result
`validation/m14/fixtures/python/resolution-verdict.current.json` is the committed measurement, and
`python/resolution-verdict-gate.ts` re-checks it against pinned ceilings: **10/10 emitted**, outgoing
UNRESOLVED `== 0`, and a per-label `UNEXPLAINED` allowance no higher than round 6's own numbers. The
gate REFUSES (exit 2) if the artefact is absent rather than passing vacuously, so a future round
cannot drift the lane's verdict by deleting the evidence. Note the honesty clause: an allowance is a
CEILING on a known hole, not a claim that the hole is correct, and the gate says so in its output.

### 4. PY-D13 (DECLARED, OPEN) — the bound alias never crosses the worker boundary
`import typing as t` parses correctly: the analyzer's `ImportInfo` carries `alias: "t"`. Through the
REAL pipeline the store's `brain_import` row is `{imported_name: "typing", imported_as: NULL,
import_type: "named"}` — `src/ast/pool-worker.ts`'s `parseFile` import projection emits
`{name, path, type, isExternal, line}` and DROPS `alias` (there is no `importType` either, so the
indexer's `imp.alias ?? imp.localName` reads nothing and namespaces become `named`). `from X import
Z as W` is the same shape one layer down: the analyzer pushes the imported name `Z` into `items` and
never records the bound `W`. **Consequence, measured:** the `references` 1,332 and `extends` 105
unexplained are dominated by exactly this spelling — `t.Callable`, `t.Self`, `t.Protocol`, `nn.Module`
— where the `qualified` root is a name the FILE bound by an alias the store never received. This is a
shared, master-owned surface (the projection and the indexer's import insert are read by every
language), so it is DECLARED with its measurement rather than changed unilaterally.

### 5. Verified together (analyzer = the shipped source)
- python fixtures **39/39** (round-6 fixture included), baseline gate: no regressions.
- mutants **17/17 CAUGHT** — 13 `implements` + 3 `owner/*` + the new
  `references/keyword-argument-name-is-not-a-type`, which fails the moment the walk descends into a
  validator call again. The harness restores the source on exit (verified on disk).
- arbiter `python --fresh`: **emitted 10/10 · FALSIFIED 0 · ruled-without-justification 0**,
  attestation VERIFIED.
- differential `--lang python`: cython and requests both 100% covered / MISSING 0 / unexplained 0 —
  unchanged by PY-D11, which is the point of §2 (both sides moved together).
- `tsc` clean for every file this lane touched.

### 6. Still open after round 6
- **calls 4,837** — the largest honest hole, and the top names name its cause: `run_eval` is a NESTED
  `def` inside `main` (a scope-local binding this lane deliberately does not publish as a symbol),
  and `django_capture_on_commit_callbacks` is a pytest-INJECTED PARAMETER. The callee is bound in the
  ENCLOSING FUNCTION's scope, so there is no project declaration for it to bind to. The lever is a
  distinct `local-callee` axis the analyzer can state as a fact; until it exists these are correctly
  counted as unexplained rather than waved away.
- **exports 9** — `__all__` names provided lazily (`dialects/__init__.py` via `__getattr__`,
  `celery_app`, `instrument_declarative`). Honest and small.
- **PY-D13** (§4) — the alias gap, gated on a shared-surface change.
- Round-3 items unchanged: **D5** (750 `uses` self-loops), `python-ontology-census.ts`/
  `firing-check*.mjs` flat-corpus pins.

## python round 7 (2026-10-10) — the incoming hole drops 6,283 → 755 with ZERO edges added, because both fixes state what the source already bound

Round 6 gave the lane a verdict: 6,283 incoming targets it could not explain, each now carrying the
axis that explains or fails to explain it. Round 7 works the two levers the verdict itself named,
and the shape of the result is the point — **the population's edge counts do not move at all**
(1,290,877 relationships before and after, every label identical to the digit), because neither
change adds, removes or retargets an edge. Both make the analyzer SAY something the source already
said and the lane was throwing away.

### 1. Both levers were measured independently BEFORE any code changed
A CPython-`ast` classification of the round-6 verdict's own dumped unexplained edges (`--dump-unexplained`, added to the instrument this round):

| lever | claim | measured | residual, and what it is |
| --- | --- | --- | --- |
| the callee is bound in the **enclosing function** | a nested `def`, a pytest-injected parameter, a local | **4,230 of 4,837** calls | **607** — `from X import *` (a star import binds every public name of a module, unbounded by construction: cython's deliberate `from dataclasses import *` test, duckdb's `from pyspark.sql.types import *`) plus two corpus files CPython refuses to parse at all (a test file with deliberately invalid syntax; an ASN.1 spec named `.py`) |
| the route root is an **`as`-bound import** | `import typing as t`, `from x import Z as W` | **1,035 of 1,446** references+extends rows | the rest are names whose binding is undecidable FROM THE FILE (a TypeVar in a star-imported module, a generated protobuf module) |

The measurement is CPython's, not the analyzer's, which is why it could disagree with the analyzer —
and it did, in exactly the place worth knowing: the analyzer's own tree-based check answers for the
two files CPython cannot parse, so the analyzer moved **4,280** where CPython could only see 4,230.

### 2. What changed
- **`local-callee`.** A pre-pass (`collectFunctionLocals`) records each function's OWN bindings —
  parameters, nested `def`/`class` NAMES, and assignment / for-target / `with as` / `except as` /
  walrus TARGET names — and the call site asks by walking the CALLEE LEAF's ancestors, so the answer
  is lexical and no scope state has to be threaded. **CORRECTED IN ROUND 10: the `with as` and
  `except as` half of that list was DEAD CODE.** Both cases read field names this grammar does not
  have (`with_item.alias`, `except_clause.name` — null on every real node; the alias lives inside an
  `as_pattern`), so neither ever fired, and for nine rounds the documentation claimed a binding
  collection that did not happen. See round 10 §4 — the same class of failure round 9 removed a
  fabrication with, caught this time by a probe rather than by a corpus number. The verdict gained the matching `declared-local`
  axis. The rule is a statement about the language, not a guess about intent: Python's LEGB rule
  resolves such a name to that binding, and a module-level name of the same spelling is SHADOWED for
  the whole body — so "no project declaration exists" is the correct answer, not a failed lookup.
- **the import's bound name.** The analyzer parsed the alias all along and published it on NO
  relation; `from X import Z as W` was lossy one layer deeper, recording only the imported `Z`. Both
  now ride the `imports` edge as `metadata.importedAs`, and only when the binding DIFFERS from the
  imported name — a key that merely repeats it is noise a consumer has to filter.

### 3. The boundaries are the design, and two of them are traps worth recording
- **What is deliberately NOT collected, each for a reason:** a nested function's BODY (its bindings
  are its own — walking in would mark a call in `outer` to a name bound only in `inner` as local,
  the over-claim direction); lambda and comprehension targets (their own scopes);
  `attribute`/`subscript` targets (they bind a member or an element, not a bare name); a parameter's
  DEFAULT or ANNOTATION expression (only the `name` field is read, so `def f(x=SOME_DEFAULT)` does
  not make `SOME_DEFAULT` local); and any name a `global`/`nonlocal` statement declares, which is
  **subtracted** — a write to it targets another scope, and that is the one shape where a naive
  collector over-claims.
- **A `Node` can never be a Map key.** The first version keyed the pre-pass on the
  `function_definition` node, and EVERY call in the file then read `bare-name-callee` — the probe
  showed it immediately, because all the reason codes were one value. web-tree-sitter hands back a
  fresh wrapper on every `.parent`/`.namedChild()` access (the lane already says so at
  `extractMemberUses`: "identity never holds, every `.parent` is a fresh object crossing the WASM
  boundary"), so a `Map<Node, …>` is a map no lookup can hit. It is keyed on the function's START
  POSITION now.
- **A name, once referenced, is not a diagnosis.** Neither lever invents an edge and neither
  converts a resolution into a label it has not earned.

### 4. The verdict, re-measured over the same 11,488 files
| label | edges | round-6 UNEXPLAINED | round-7 UNEXPLAINED | round-7 axes |
| --- | --- | --- | --- | --- |
| calls | 535,154 | 4,837 | **344** | declared-local **4,280** · dynamic 27,580 · external 31,196 · builtin 3,062 |
| references | 62,064 | 1,332 | **389** | qualified-external 894 · builtin 374 |
| extends | 20,954 | 105 | **15** | qualified-external 324 · builtin 72 |
| exports | 3,043 | 9 | **7** | — |
| uses / contains / imports / implements / overrides / instantiates | — | 0 | **0** | — |
| **total** | **1,290,877 (unchanged)** | **6,283** | **755** | — |

Two of those movements are not reclassification at all. **563 `references` rows and ~213 `calls`
rows left the UNRESOLVED set entirely** — they now bin EXTERNAL, because the name they target IS one
this file imported (`from x import f as g; g()`), which is the bin's own definition ("binds to a
name this file IMPORTED and to nothing in the corpus"). That is resolution, and it is the half of
this round that is worth more than the label.

### 5. The residual is NAMED, and one axis was deliberately NOT invented
The 344 remaining `calls` are wildcard imports and the two unparseable files; the 389 `references`
are names whose binding is undecidable from the file; the 15 `extends` are bases the SOURCE holds in
a VARIABLE (`dump_cls`, `mixin_cls`) and binds only at runtime; the 7 `exports` are `__all__` names
provided lazily. **The lane did not add a `wildcard-import` axis, and that is the deliberate
choice**: a star import binds every public name of a module, so a per-name claim that `make_dataclass`
came from `dataclasses` would be a guess dressed as a fact — the exact fabrication this arc exists
to remove. The number stays where the evidence is.

### 6. Verified together (analyzer = the shipped source)
- python fixtures **41/41** (two new: `local-callee-is-a-binding-not-a-guess`, whose forbid rows are
  the over-claim direction, and `import-alias-is-published-as-a-binding`, whose control rows pin that
  an UN-aliased import does NOT get an `importedAs`), no regressions.
- mutants **23/23 CAUGHT** — six new: `local-callee/{axis-removed,global-not-subtracted,nested-body-leaks}`
  and `import-alias/{namespace-alias-dropped,from-item-binding-lost,invented-for-plain}`. Each of the
  three over-claim mutants fails a FORBID row, which is what makes the negative direction falsifiable:
  the harness includes the fabrication directions, not only the loss ones.
- `python/resolution-verdict-gate.ts` **PASSES** with every ceiling TIGHTENED to round 7's numbers
  (calls 4,900→400, references 1,400→420, extends 120→20, exports 12→8), 10/10 emitted, outgoing `0`.
- differential `--lang python`: cython and requests both `covered=100% MISSING=0 unexplained=0` —
  unchanged by both levers, which is the expected result for a change that touches only metadata.
- arbiter `python --fresh`: complete 11,488/11,488 walk, `emitted 10/10 · FALSIFIED 0 ·
  ruled-without-justification 0`, attestation VERIFIED.
- `tsc --noEmit` clean for every file this lane touched.

### 7. Still open after round 7
- **PY-D13's store half** — the alias is now on the RELATION, but `pool-worker.ts`'s projection
  (`{name, path, type, isExternal, line}`) still drops it, so `brain_import.imported_as` stays NULL
  and the store cannot resolve `t.Protocol` itself. Shared, master-owned, measured, declared.
- The wildcard-import residual (§5) — deliberately left as evidence.
- Round-3 items unchanged: **D5** (750 `uses` self-loops), the flat-corpus pins in
  `python-ontology-census.ts` / `firing-check*.mjs`.

## python round 8 (2026-10-11) — the reference side gets the callee side's treatment: 755 → 548, `extends` reaches ZERO, and the residual is priced with CPython instead of the analyzer

Round 7 taught the CALLEE axis one fact — a name bound in the reference's own enclosing scope is not a
dangling target, it is a local — and moved 4,280 `calls` rows to `declared-local` without adding,
removing or retargeting a single edge. Round 8 asks the same question of the REFERENCE side (a type
name in an annotation, a base in a class header) and gets the same answer plus a second one that is
more interesting: a PEP-695 type parameter is a BINDING, not a class.

### 1. Both reference-side populations were priced with CPython's own `ast` BEFORE any code changed
`--dump-unexplained` (added in round 7) dumps every unexplained edge as `label \t file \t src \t tgt \t why \t route`. A separate classifier asks CPython's parser what each dangling name is bound to in its own file, i.e. an answer the analyzer cannot influence:

| axis | population | measured composition |
| --- | --- | --- |
| `references` | 389 | **232 local-binding-target** · 64 files CPython cannot parse · **52 PEP-695 inline type parameter** · 26 wildcard-import names · 12 generated module handles · 3 member-reads off a dynamic receiver |
| `extends` | 15 | **14 local-binding-target** (`class Row(dump_cls)`, `class Sub(TemplateIter)` — a base held in a variable) · 1 unparseable |

Two of those populations are the SAME fact the callee axis had already named, so the fix is a
statement about the language, not a new heuristic.

### 2. What changed
- **`local-binding-target`** — the reference-side sibling of `local-callee`, emitted by a SEPARATE helper (`dynamicTypeBindingReason`), not by widening the callee one. A call's target is a callee and its code is `local-callee`; a reference's target is a type and its code is `local-binding-target`. Merging them would put one vocabulary on two axes — the same mistake `external-member-call` is deliberately separated from `dispatch-on-receiver` to avoid. The check walks the LEAF's ancestors and asks the round-7 `collectFunctionLocals` pre-pass, so it is lexical and needs no scope state.
- **`inline-type-parameter` (PY-D16)** — `def first[U](items: list[U]) -> U` references `U` twice and `U` is declared, by the def's OWN signature. `U` is not a class the project defines and never will be, so it can neither resolve nor honestly sit in the unresolved bucket. The clause is one `type_parameter` node whose named children are `type` nodes; the parameter's NAME is the FIRST identifier inside it (`TValue` is `type -> identifier`; the bounded `T: str` is `type -> constrained_type -> type -> identifier`, with `str`, the BOUND, following), so reading the first identifier names every grammar shape without enumerating them and can never mistake a bound for a name.
- **the `extends` emitter now asks too.** Rounds 1–7 emitted `extends` rows with NO reason code at all, so `class Row(dump_cls)` could only ever be a raw unresolved target. It now carries `local-binding-target` when the base is a local binding — which is why the axis reads 0 rather than 15.

### 3. The boundaries are the design, and one of them is a trap the lane had already sprung
- **The LOCAL check comes first, then the type-parameter check.** Python's function scope is one namespace, so a def that both declares `[T]` and assigns `T = 5` binds a local when the body runs; reporting the type parameter there would name the signature's binding for a name the body rebound. A name that is ONLY a type parameter is in no `functionLocals` set (the pre-pass reads `parameters`, never `type_parameter`), so the second check is reached exactly when the first cannot answer.
- **A `Node` can never be a Map key** — round 7 already paid for this lesson, and round 8 reuses its answer (`functionLocalsKey`, keyed on the function's start POSITION) rather than rediscovering it.
- **What is still deliberately NOT claimed:** a name a function declares `global` and binds stays unclaimed (the pre-pass SUBTRACTS it, and §5 shows that is exactly the residual that remains), and a bound (`[T: str]`'s `str`) is never read as a name.

### 4. The verdict, re-measured over the same 11,488 files
| label | edges | round-7 UNEXPLAINED | round-8 UNEXPLAINED | round-8 axes |
| --- | --- | --- | --- | --- |
| calls | 535,154 | 344 | **344** (unchanged) | declared-local 4,280 · dynamic 27,580 · external 31,196 · builtin 3,062 |
| references | 62,064 | 389 | **197** | declared-local **193** (new) · qualified-external 893 · builtin 374 |
| extends | 20,954 | 15 | **0** | declared-local **15** (new) · qualified-external 324 · builtin 72 |
| exports | 3,043 | 7 | **7** | — |
| uses / contains / imports / implements / overrides / instantiates | — | 0 | **0** | — |
| **total** | **1,290,877 (unchanged)** | **755** | **548** | — |

The edge counts are identical to the digit on all ten labels, which is the check that the change is
metadata-only and honest: 207 rows moved from UNEXPLAINED to a NAMED axis, and nothing else moved.

### 5. The residual, priced with `ast` and named class by class
Of the 197 remaining `references`: **92** are names a function declares `global` and binds there (89 of them in two sqlalchemy typed-mapping test modules, where a `@testing.fixture` does `global _GenericPep695` and assigns it, and a module-level class then annotates with it — a module-scope name created at RUN time), **64** sit in files CPython cannot parse at all (ASN.1 specs named `.py`), **26** come from `from dataclasses import *`, **12** are generated protobuf module handles (`helloworld_pb2`), **3** are member reads off a dynamic receiver. The 344 `calls` break down as 164 in files carrying a wildcard import, 135 in files CPython cannot parse, **13 the same `global`-in-function shape** (`global run_python` inside cython's `run_benchmarks.check_gnu_time`, then called from two other functions), and the rest names bound nowhere in their file at all (py2 `xrange`, semgrep sample stubs).

**The `global`-in-function shape is now the single largest named residual on both axes and is the
obvious next round** — and it is NOT the same thing as the local case: `global X` + a write is an
explicit declaration that X lives in the MODULE namespace, so a project-scope binding is the correct
reading and the analyzer currently records none.

### 6. The store seam, and two wrong pins that became the instrument
`python/import-bound-name-seam.mts` drives the REAL pipeline (`indexProjectParallel`, worker pool included) over a generated project, so the near side (`ASTEngine.parseFile`) and the far side (`brain_import` / `brain_symbol` / `brain_relationship`) are measured in one process. It has four rows: A the analyzer carries the binding; B the store holds it — PINNED AT THE DECLARED GAP (PY-D13's store half: `imported_as` NULL, `import_type` `named`); C the control that keeps B meaningful; D the route.

**Row D was wrong twice, and the wrongness is the useful part.** Pin 1 pointed the route at the one class the project declares — the leaf was project-unique, the store's leaf fallback bound it, and the row read RESOLVED, saying nothing about routes. Pin 2 declared the leaf TWICE expecting ambiguity to force a decline — also wrong, because the pass's strategy 3c RANKS dotted candidates and takes the best, so an ambiguous leaf resolves too, silently. Both pins asked a one-row question with more than one cause. The rule the folder now follows: **A PIN THAT ASSERTS "THE ROUTE WAS NOT USED" MUST OBSERVE TWO ROUTES THAT WOULD GIVE DIFFERENT ANSWERS.** So the project carries two references to the SAME leaf through two DIFFERENT alias-bound modules (`models_alias.ProductVariant` and `v.ProductVariant`, aliases 2 binding different modules that each declare the name) and asserts they land on the SAME symbol. They do — measured, `via_models` and `via_vendor` both → `models.py` — which is the proof the route is unread, and the flip signal is exact: a route consumer would split them and turn the gate red.

### 7. Verified together (analyzer = the shipped source)
- python fixtures **43/43** (two new: `reference-binding-is-not-a-guess`, which pins the CONTROL directions too — a module-level name at `isinstance` keeps `instanceof-check`, `Child(NormalBase)` extends with NO code, and ONE local pins BOTH readings: `kind: type` keeps `annotation-type` while `isinstance(obj, kind)` gets `local-binding-target` — and `inline-type-parameter-is-not-a-class`, where `U`/`V`/`W` are not symbols, a module-level `T = typing.TypeVar("T")` IS, and the bounded `W: int` names `W` and never `int`).
- mutants **28/28 CAUGHT** — five new, and two of them are the OVER-CLAIM direction: `reference-binding/claimed-for-everything` and `inline-type-parameter/bound-read-as-the-name` must be caught by a FORBID row, or the negative direction is not falsifiable.
- `python/resolution-verdict-gate.ts` **PASSES** with the ceilings TIGHTENED to round 8's numbers (calls 400→350, references 420→210, **extends 20→0**), 10/10 emitted, outgoing `0`, artifact re-copied from the fresh run.
- `python/import-bound-name-seam.mts` **PASSES** with A/B/C/D all green (B is a declared-gap pin, not a failure).
- differential `--lang python`: cython and requests both `covered=100% MISSING=0 unexplained=0` — unchanged, as expected for a metadata-only change.
- arbiter `python --fresh`: **COMPLETE 11,488/11,488** walk (0 settled by an earlier walk, 0 degraded, 0 abandoned), `emitted 10/10 · ruled-sound 0 · FALSIFIED 0 · ruled-without-justification 0 · ruled-unknown 0`, attestation VERIFIED against `construct-census.current.json` (nodeTypes 203, attributeKeys 227,330) — and every label's edge count in its table is IDENTICAL to the verdict's, which is the second, independent confirmation that rounds 7+8 added no edge.
- `tsc --noEmit` clean for every file this lane touched.

### 8. Still open after round 8
- **The `global`-in-function shape** (§5) — the largest named residual on two axes, and the next round's subject.
- **PY-D13's store half** — unchanged and now pinned by a green gate instead of a paragraph.
- The wildcard-import residual — deliberately left as evidence, not closed by a guess.
- Round-3 items unchanged: **D5** (750 `uses` self-loops), the flat-corpus pins in `python-ontology-census.ts` / `firing-check*.mjs`.

## python round 9 (2026-10-11) — a FABRICATION found on the reference side: a parameter published as a type, and the parser's own verdict as the rule

Rounds 7 and 8 both ADDED metadata and moved not one edge. Round 9 DELETES edges, because what it found
was not an unexplained target but a **confidently-wrong one**: a reference in which a function's own
parameter is claimed to be a type. The arc's rule puts that below an honest NULL, so the round's whole
output is a refusal.

### 1. The finding, minimized under CPython in the room
It began as one residual row: `references optional_memoryview -> o` in `cython/tests/errors/e_typing_optional.py`. `o` is that function's SECOND PARAMETER. Minimized against the analyzer's own parser to two lines:

```python
def f(d: double[:], o: Optional[double[:]]):
    pass
```

and the tree explains it exactly. `double[:]` is **VALID CPython** — an annotation is an arbitrary expression, and `double[:]` is a slice of the name `double` — while tree-sitter's python grammar rejects a slice in that position, so the entire parameter list collapses into ONE `typed_parameter` that swallowed `, o: Optional[...]` and presented `o` inside a synthesised `constrained_type`. The analyzer then read that garbled shape and published `references f -> o`. Same class as **PY-D11** (a keyword argument's NAME published as a type) and as the empty-identifier guard this collector already carried: a wrong edge, dressed as a statement about the source.

### 2. The rule is the parser's verdict, not a heuristic about names
A type clause whose subtree CONTAINS an error (`hasError`) names no type at all — one line in `collectTypeNodes`, and it needs no enumeration of garbled shapes. The same rule applies to the CALL emitter, in two forms: a call whose own subtree was flagged, and a call the parser SWALLOWED into an `ERROR` node. Both are the parser's verdict rather than a guess, which is what makes the rule auditable.

### 3. The declared cost, and the over-correction direction, pinned in the same fixture
The fix refuses the whole clause, so `double` and `Optional` inside the garbled clause go with `o`. That is stated rather than hidden — **a name read out of a structure the parser got wrong is luck, not reading** — and the fixture forbids all three so a later round cannot narrow the guard to just the embarrassing identifier. The other direction is pinned harder: `def slice_alone_keeps_its_type(d: double[:]) -> None` KEEPS `double`, because in its tree the `type` clause is `(type (identifier))` and the ERROR is a SIBLING of it, and a rule that refused every clause in an erroring file would trade a fabrication for a silent loss. `clean_subscript -> Optional`/`-> list` and `clean_union -> Mapping`/`-> dict` are the same control on ordinary annotations.

### 4. The oracle had to change WITH it, and that was PROVEN by falsification rather than argued
The differential derives its truth from the same tree, so a one-sided fix would show up as MISSING — and without the mirrored guard the oracle derived the same fabricated `references f -> o`, i.e. the differential read AGREEMENT, which is precisely the two-derivations-of-one-unstated-assumption trap PY-D11 named. Rather than assert that, it was measured: with the oracle's guard ALONE removed and the analyzer's left in place, cython reports **`MISSING=1`**, and that one missing edge IS the fabrication. Restored, both lanes report `MISSING=0 unexplained=0`.

**A caveat this round also learned, and it invalidated a claim drafted before it was checked:** differential TOTALS are NOT comparable across runs. The cold-pool rotation deliberately draws never-sampled files each wave (its own comment: *"reproducible, but every wave sees fresh files"*), so `tree-truth` moving between two runs is a change of FILE SET, not an effect — the rotation counter incremented 14 → 15 → 16 across this round's three runs. Only the within-run relationship (`covered` / `MISSING` / `unexplained`) and the result hash mean anything across runs. An earlier draft of this section reported `tree-truth 34,663 → 34,505` as evidence; that comparison was between two different file sets and was withdrawn. The `MISSING=1` falsification above is the evidence that survives, because it is a single run.

### 5. The verdict, re-measured over the same 11,488 files
| label | round-8 edges | round-9 edges | Δ edges | round-8 UNEXPLAINED | round-9 UNEXPLAINED | round-9 axes |
| --- | --- | --- | --- | --- | --- | --- |
| calls | 535,154 | 535,006 | **−148** | 344 | **238** | declared-local 4,280 · dynamic 27,579 · external 31,196 · builtin 3,062 |
| references | 62,064 | 61,955 | **−109** | 197 | **145** | declared-local 193 · qualified-external 893 · builtin 374 |
| extends | 20,954 | 20,954 | 0 | 0 | **0** | declared-local 15 · qualified-external 324 · builtin 72 |
| exports | 3,043 | 3,043 | 0 | 7 | **7** | — |
| uses / contains / imports / implements / overrides / instantiates | — | — | 0 | 0 | **0** | — |
| **total** | **1,290,877** | **1,290,620** | **−257** | **548** | **390** | — |

257 edges were REMOVED and 158 of those were also unexplained. This is the first round in this arc whose
edge count moves, and it moves in the only direction that can be defended: out.

### 6. What was measured BEFORE choosing the lever, and what is deliberately still there
Pricing that preceded the code change, with CPython's own parser and with the analyzer's error report:

| measurement | value |
| --- | --- |
| `.py` files in the corpus | 11,312, of which **56** CPython cannot parse at all |
| distinct files carrying the round-8 residual's 548 edges | **72**, of which **24** carry analyzer-visible syntax errors — **22 of them ASN.1 documents named `.py`** under `otp/lib/asn1/test/asn1_SUITE_data/` |
| residual edges sitting in an analyzer-flagged tree | **198** (calls 132, references 66) — the largest single bucket, and the one this round took |
| `global`-in-function population, whole corpus | **381** `(file, name)` pairs, **311** distinct names; blast on the residual = **90 refs + 8 calls** |

Two things are measured and **NOT** fixed, deliberately:
- **The ASN.1 remainder.** 14 references and 29 calls survive in those 22 files because their OWN clauses parse cleanly even though the document is not python — the errors are simply elsewhere in the file. Refusing more would need a file-level verdict ("this is not python") and that is a corpus/file-classification decision, not the analyzer's to take unilaterally. `call`-side `BitStr -> SIZE` is still in the graph and is named here so it is not mistaken for a clean bill.
- **The `global`-in-function shape**, which is now **the largest named residual on the references axis (90) and appears on the calls axis too (13)**. It is the obvious next round, and it is NOT the local case: `global X` plus a write is an explicit declaration that `X` lives in the module namespace, so a project-scope binding is the correct reading and the analyzer currently records none (the pre-pass SUBTRACTS `global` names from the local set, which is right, and then nothing claims them at all).

### 7. Verified together (analyzer = the shipped source)
- python fixtures **44/44** (one new: `parser-error-region-is-not-a-type`, whose forbid rows pin the fabrication AND the declared cost, and whose keep-rows pin three clean clauses plus the module-level call that the call guard removes).
- mutants **31/31 CAUGHT** — three new: `parser-error/type-clause-claims-again` (the revert), `parser-error/no-clause-is-trusted` (**the over-correction** — refusing every clause must fail the keep-rows) and `parser-error/call-in-error-region` (the call side). The first version of the call-side guard had NO falsifier and the harness said so — `SURVIVED` — which is why the fixture gained the module-level call before the guard was allowed to ship.
- differential `--lang python`: `covered=100% MISSING=0 unexplained=0` on BOTH cython and requests with the mirror in place, and **`MISSING=1` on cython when the oracle's guard alone is removed** — a single-run falsification that the paired edit is what keeps the two derivations agreeing. (Cross-run totals are not evidence; see §4.)
- `python/resolution-verdict-gate.ts` **PASSES** with the ceilings TIGHTENED again (calls 350→245, references 210→150, extends 0, exports 8), 10/10 emitted, outgoing `0`, artefact re-copied from the fresh run.
- `tsc --noEmit` clean for every file this lane touched (the remaining errors in the tree are the pre-existing `script/m12/*-probe.ts` and `script/m14/fsharp-mutants.ts` ones, untouched by this round).
- arbiter `python --fresh`: **COMPLETE 11,488/11,488** (0 settled by an earlier walk, 0 degraded, 0 abandoned), `emitted 10/10 · ruled-sound 0 · FALSIFIED 0 · ruled-without-justification 0 · ruled-unknown 0`, attestation VERIFIED (nodeTypes 203, attributeKeys 227,330) — and its own table reads calls **535,006**, references **61,955**, extends **20,954**, identical to the verdict's, so the two independent measures agree on the 257 removable edges rather than one confirming the other's arithmetic.
- **A process rule this round earned:** the first arbiter attempt was DISCARDED, not reported, because it ran CONCURRENTLY with the mutant harness, which rewrites the analyzer between cases — a measurement taken while the artifact is being edited is not a measurement. **Never run the arbiter, the verdict or the differential while anything mutates the analyzer.** The clean re-run is the one above, and the discarded log was left in `.tmp-py/arbiter-round9.log` rather than deleted so the mistake stays visible.

### 8. Still open after round 9
- **The `global`-in-function shape** — the largest named residual, statically decidable, next round's subject.
- **The 22 ASN.1 documents named `.py`** — 14 refs + 29 calls remain; needs a file-level verdict that is not this lane's to take alone.
- **PY-D13's store half** — unchanged and pinned by a green gate.
- Round-3 items unchanged: **D5** (750 `uses` self-loops), the flat-corpus pins in `python-ontology-census.ts` / `firing-check*.mjs`.

## python round 10 (2026-10-11) — 390 → 119 UNEXPLAINED with the edge count UNMOVED: the module namespace a `global` write proves, and a wildcard import's binding route

Round 9 took the residual down by REMOVING dishonest edges. Round 10 takes it down by DECLARING
things the source already says, and the difference is visible in the graph: **the edge count does not
move at all** — 1,290,620 on both sides, every one of the ten labels identical to the digit — while
UNEXPLAINED incoming targets go **390 → 119**. Nothing was added, nothing was removed, and no symbol
was invented for a name the source does not bind.

### 1. Two mechanisms, PRICED with CPython's own `ast` before a line was written

| mechanism | population (whole corpus) | residual rows it could carry |
| --- | --- | --- |
| **A. `global X` in a function + a CREATING write in the same body** | 397 `(file, name)` pairs, 140 already module-bound → **257 matter pairs** | **98** (8 calls + 90 references; every call `bare-name-callee`, every reference `annotation-type`) |
| **B. `from M import *` (the file's wildcard binding route)** | every file with a wildcard import; gate = EVERY star module out of view | **171** (163 calls + 8 references), **0 blocked** by the gate, **zero overlap** with A |
| **C. `with … as X` / `except E as X` local bindings** | 14 refs already module-bound, 43 rows in CPython-unparseable files | **1 call** |
| not claimed by either | — | 43 rows in files CPython cannot parse + 78 neither |

98 + 171 + 1 + 43 + 78 = **391** against a 390-row dump: the price OVER-counted by one on purpose —
mechanism C's single row is the one the two bigger mechanisms do not touch — and the arithmetic closed
before the code existed, which is what makes the post-hoc attribution (§5) a verification rather than
a story. The pricing also fixed the ORDER: A is a declaration of a binding, B is a declaration of a
route, and a route cannot be declared for a name the file itself binds.

### 2. PY-D18 — `global X` plus a creating write IS a module-scope binding, so publish it

`global X; X = value` inside a function binds `X` in the **module namespace** (CPython: the name is in
`globals()` afterwards), and the module namespace is THIS FILE's scope — a place the ontology can hold.
The analyzer published no declaration for it unless the module also assigned `X` at top level, and the
PY-D14 pre-pass deliberately SUBTRACTS a `global`-declared name from the function's locals, so the name
was neither local nor declared: it dangled. The fix publishes an ownerless module-scope Variable at the
line of the earliest creating write (`metadata.isModuleVariable` + `boundByGlobalWrite`), so the edge
**resolves** instead of being excused.

The precision rules were re-measured against CPython rather than taken from the price, and two of them
DIFFER from it because the price was an upper bound: a creating write needs a VALUE (`exec("x: int",
m.__dict__)` adds no namespace entry, so a valueless annotation does not create — the price counted it),
`X += 1` requires the binding and `del X` removes it, and only the function's OWN body counts (a nested
`def` has its own `global` statements, and an outer `global` plus an inner write is NOT a pair — CPython
makes the inner assignment a local). The dedupe is half the rule: a name already declared at module
scope, or bound by an import, gets no second declaration.

Measured: symbols **205,928 → 206,169** (+241 module-scope bindings); on the callee side
`bare-name-callee` UNRESOLVED **3,300 → 3,291**; on the reference side `annotation-type` UNRESOLVED
**876 → 786** (−90, the priced half to the digit) and `local-binding-target` resolved **50 → 92** — a row
can now resolve to a real symbol while its reason code still describes the route.

### 3. PY-D19 — `from M import *` is a binding rule, and the store's projection cannot carry it

`from M import *` binds M's public namespace into THIS module, so a bare name in such a file has a
binding route that lives in M. Two facts hid the shape: the analyzer spells BOTH `from M import *` and
`import M` as the endpoint `M:*`, and the store's per-item projection (`pool-worker`: `{name, path, type,
isExternal, line}`) flattens both to `{name: "*", type: "namespace"}` — a two-way loss, so nothing below
the analyzer could tell a wildcard from a module handle. The fact therefore gets a home on the surface
the verdict reads — `metadata.starImport: true` on the analyzer's OWN `imports` edge, the same doctrine
as PY-D13's `metadata.importedAs` — and the verdict gains the axis **`star-import-external`**, placed
after `qualified-external` and before `builtin`.

**THE GATE IS THE HONESTY, AND THE CORPUS CONVICTED ITS FIRST VERSION.** The excuse is handed out only
when EVERY module the file star-imports is OUT OF VIEW, because an in-view star module is CHECKABLE (the
row being residual already proves that module's public namespace does not declare the name). The first
implementation asked "is any file in the population SPELLED like that module" — file stems — and over
the round-9 residual it blocked **169 of the 171 priced rows**, every one of them a name collision
between UNRELATED repositories: cython deliberately stars the STANDARD LIBRARY `dataclasses`
(`Tools/dataclass_test_data/test_dataclasses.py`), and some other repo in the 199 has a file spelled
`dataclasses.py` somewhere in its tree, which is not evidence that the stdlib module is this project's.
The implemented rule is the one the price was measured with — the population's **DOTTED module paths**
(`pyspark/sql/types.py` declares `pyspark.sql.types`), plus a PACKAGE PREFIX test (a path UNDER `M.`
declares the package `M`) — and `validation/m14/fixtures/python/star-import-axis-gate.mts` pins all ten
directions, including that collision row (`2d-scope-collision`), so the blocking regression cannot return
unnoticed. The axis fired on **173 calls + 8 references**.

### 4. A third change, and it CORRECTS this lane's own documentation: `with … as` / `except E as`

Round 7's PY-D14 documented its collected bindings as "parameters, nested `def`/`class` names, and
assignment / for-target / `with as` / `except as` / walrus targets". The two `as` cases read
`childForFieldName("alias")` on `with_item` and `childForFieldName("name")` on `except_clause` — **both
null on every real node**: this grammar puts the alias inside an `as_pattern`
(`with_item value → as_pattern → as_pattern_target`, measured with a probe before anything was changed).
Neither case ever fired, so for nine rounds the lane's documentation claimed a binding collection that
did not happen — a claim with no falsifier, the same failure mode §3's predecessor had and the same one
round 9 removed a fabricated reference with. The fix reads the shape the grammar produces; the fixture
(`with-except-as-binds-a-local`) pins the **reason code** rather than the endpoints, so a revert cannot
pass by coincidence (same endpoints, `bare-name-callee`/`annotation-type` instead of
`local-callee`/`local-binding-target`), and its mutant restores the dead reads. Corpus footprint:
`local-callee` **12,989 → 12,998**.

### 5. The verdict, re-measured over the same 11,488 files

| label | round-9 edges | round-10 edges | Δ edges | round-9 UNEXPLAINED | round-10 UNEXPLAINED | round-10 axes |
| --- | --- | --- | --- | --- | --- | --- |
| calls | 535,006 | 535,006 | **0** | 238 | **65** | star-import-external 173 · dynamic 27,579 · external 31,196 · declared-local 4,280 · builtin 3,053 |
| references | 61,955 | 61,955 | **0** | 145 | **47** | star-import-external 8 · qualified-external 893 · builtin 374 · declared-local 146 |
| exports | 3,043 | 3,043 | **0** | 7 | **7** | — |
| extends | 20,954 | 20,954 | **0** | 0 | **0** | declared-local 15 · qualified-external 324 · builtin 72 |
| uses / contains / imports / implements / overrides / instantiates | — | — | **0** | 0 | **0** | — |
| **total** | **1,290,620** | **1,290,620** | **0** | **390** | **119** | — |

### 6. The 119, split by CPython's own parse of each file

- calls 65 = **28** in files CPython cannot parse (the ASN.1 documents named `.py`: `BitStr -> SIZE`,
  `-> sunday`, `-> monday`; nvim-treesitter's `quit_game`) + **37** a bare name bound by nothing in its
  file (a py2 `xrange` in a dart-sdk build script, semgrep sample stubs like `do_something`, cython's
  `frozendict` where the binding really is dynamic, ansible's `handler_type`).
- references 47 = **14** in those same unparseable files + **33** bare names bound by nothing
  (`helloworld_pb2`-style generated protobuf handles, `frozendict`, `_self_owner`).
- exports 7 — UNCHANGED in rounds 8, 9 and 10: `__all__` names the module provides LAZILY, and the
  wildcard axis is deliberately NOT applied here (an export is a name the module ITSELF declares, so a
  wildcard import in another file cannot supply it).
- Attribution of the 271 that moved, re-derived with CPython over the dumped rows: **98** are A's priced
  population (0 remain), **171** are B's (0 blocked by the gate), and **2** more went with B in shapes the
  CPython price could not classify (one in an unparseable file, one whose file CPython parses differently).

### 7. A dead literal removed, found by the fixture-coverage gate

`verify-fixture-coverage.ts` flagged `typed_pattern` in the newly-extracted target walker as a **DEAD
LITERAL**, and the measurement agreed: the eight source shapes that could plausibly produce such a node
(`def f(a: int)`, `with … as (a, b)`, `except E as e`, `match`/`case` with and without `as`,
`for (a, b) in x`, a lambda default, a bare `x: int`, `(a): int = 1`) all parse as `typed_parameter` /
`as_pattern` / `tuple_pattern` instead, and a walk of the whole corpus — **11,309** `.py`/`.pyi` files —
found **0** occurrences. A branch that can never fire is a claim with no evidence, so it was removed
rather than left in place as decoration. The four node types this round genuinely READS moved from
`internal_silent` to `handled_verified` in the spec (`with_item`, `as_pattern`, `as_pattern_target`,
`global_statement`), and the gate is now green with `deadLiterals=0`.

### 8. Verified together (analyzer = the shipped source)

- python fixtures **47/47** (three new: `global-write-creates-module-binding`, whose zero-symbol rows pin
  the valueless/RMW/del/scoping precision AND both dedupe directions; `with-except-as-binds-a-local`,
  whose ONLY job is to fail if the `as` read is reverted; `star-import-is-a-binding-rule`, which pins the
  fact, its control and the fact that no symbol is invented).
- mutants **37/37 CAUGHT**, 0 survived, 0 not applied — six new: the PY-D18 symbol disabled, the
  valueless annotation counted as creating, the nested body read as its parent's, the module-scope dedupe
  dropped, the `as` read reverted, and the `starImport` fact dropped. Each was anchored on a string the
  harness verifies is UNIQUE before use, so an inert mutant cannot report as coverage.
- fixture-coverage gate **python PASS** (`handled=66 fixtureTypes=149 uncovered=0 ambiguous=0
deadLiterals=0`); `tsc --noEmit` exit 0 with zero diagnostics.
- verdict `--fresh` over 11,488/11,488 files; `resolution-verdict-gate.ts` **PASSES** with the ceilings
  TIGHTENED again (calls 245 → **70**, references 150 → **50**, exports 8 at a measured 7), 10/10 emitted,
  outgoing UNRESOLVED **0 for all ten**, artefact re-copied from the fresh run.
- `star-import-axis-gate.mts` **PASSES**: all ten decision directions, plus the artefact carrying the axis
  (calls 173, references 8) so a run that silently stopped classifying cannot pass.
- arbiter `python --fresh`: **COMPLETE 11,488/11,488** (0 settled by an earlier walk, 0 degraded, 0
  abandoned), `emitted 10/10 · ruled-sound 0 · FALSIFIED 0 · ruled-without-justification 0 ·
  ruled-unknown 0`, attestation VERIFIED (nodeTypes 203, attributeKeys 227,330) — and its own table reads
  calls **535,006**, references **61,955**, extends **20,954**, IDENTICAL to the verdict's, so the two
  independent measures agree on an unchanged graph rather than one confirming the other's arithmetic.
- differential `--lang python`: cython `covered=34162 (100%) MISSING=0 · analyzer-edges=6824
  unexplained=0`, requests `covered=5326 (100%) MISSING=0 · analyzer-edges=2552 unexplained=0` (cold-pool
  rotation 18/17 — cross-run totals are still not evidence; only the within-run numbers are).
- seam gates unchanged and green: `owner-resolution-gate` PASS, `store-heritage-seam` PASS,
  `import-bound-name-seam` PASS (PY-D13's store half is still the DECLARED gap, pinned by name), and
  `owner-channel-census` reads 357/375 owner rows resolved — the same numbers round 5 measured, so the
  member channel was not touched.
- **php neutrality, measured rather than argued** (the round changed no shared file, but the lane's rule is
  to measure): `php/owner-resolution-gate` PASS; `php/store-resolution-census` PASS. ~~with every number
  identical to the round-5 artefact except its timestamp.~~ **CORRECTED IN ROUND 11 — that sentence was
  wrong when it was written:** two `phaseA_storeBinding` keys differ from the round-5 artefact
  (`no-declared-receiver` 17,665 → 17,698; `no-declared-receiver:NULL` 12,082 → 15,514) and they had
  ALREADY moved by the time of this round's run, so the only sound neutrality claim is the round-over-round
  identity (round 11 vs round 10: identical but for `generatedAt` and the two timing fields). See the §7
  bullet of round 11 for the window and the other lanes' commits it contains.
- **A process mistake this round earned, kept visible:** the corrected verdict was launched while the
  first one was still alive, so TWO instances wrote the same log and the same output path. The duplicate
  was identified by PID and killed, the surviving instance's artefact is the one pinned, and the
  interleaved log was left at `.tmp-py/verdict-round10.log` rather than deleted.

### 9. Still open after round 10

- **42 rows in files CPython cannot parse** (the ASN.1 documents named `.py` and nvim-treesitter's
  `quit_game`) — they need a file-level "this is not python" verdict, which is a corpus/file-classification
  decision rather than the analyzer's to take alone.
- **70 bare names bound by nothing in their file** (37 calls + 33 references) and **7 exports** provided
  lazily by `__all__` — each named with examples in §6.
- **PY-D13's store half** — unchanged and pinned by a green gate.
- Round-3 items unchanged: **D5** (750 `uses` self-loops), the flat-corpus pins in
  `python-ontology-census.ts` / `firing-check*.mjs`.

## python round 11 (2026-10-11) — 119 → 96 UNEXPLAINED on two more bindings the source writes, and the one label that moved (`contains` +15) is the one whose MEMBERSHIP changed

Round 10 declared facts the source states and left every edge count on the floor. Round 11 does the
same thing one layer down, and the graph moves in exactly one place — because one of the two
mechanisms publishes DECLARATIONS (which add `contains` edges) and the other publishes only a REASON
CODE (which adds nothing to any count). Every number below is a delta against the round-10 fresh run
over the same 11,488 files.

### 1. Two mechanisms, PRICED with CPython's own `ast` before a line was written

| mechanism | population (whole corpus) | residual rows it carries |
| --- | --- | --- |
| **A. a MULTI-TARGET assignment binds every name in its pattern** (`a, b = f()`, `(a, (b, c)) = f()`, `[a, b] = f()`, `a, *rest = f()`) | the analyzer published **276** symbols carrying `metadata.multiTargetForm`, and **270 of them are CONFIRMED name-by-name against CPython's own `ast`** (`.tmp-py/verify-multitarget-census.py`, per-symbol and scope-aware — see §9 for the 6 it does not confirm). The price's own module count on the verdict's population is **182 names in 58 files** (`.tmp-py/tuple-targets-price.json`; an earlier draft of this row quoted 255 in 78 from the UNRESTRICTED v1 run, which the saved artifact does not carry) | **12** — every one a `references` row (**10** to `helloworld_pb2`, **2** to `helloworld_pb2_grpc` — re-read from the price's own `blast` list) |
| **B. a comprehension's `for` TARGET / a lambda's PARAMETER is its own scope's binding** | 13,247 comprehensions and 3,348 lambda scopes; **24,578** such reads in 2,621 files | **11** (10 calls + 1 reference) |
| neither mechanism — the rows STILL on the dump | — | **96** = 42 in files CPython cannot parse + 47 bare names + 7 lazy `__all__` exports (measured on the round-11 dump, and 42 + 47 + 7 closes on 96) |

**12 + 11 = 23 is the whole drop** (119 → 96: a row that resolves LEAVES the dump), and the 96
that remain are the 42 + 47 + 7 above. An earlier draft of this paragraph wrote `12 + 11 + 73 = 96`
with 73 = 42 + 24 + 7 — that subtracted the 23 twice (96 − 23 = 73, then 47 − 23 = 24) and is
corrected here rather than left as a tidy sum over the wrong partition. The drop itself is measured
row-by-row against round 10's dump (23 removed, 0 added): A is 12 references (10 `helloworld_pb2` +
2 `helloworld_pb2_grpc`; 7 `annotation-type` + 5 `return-annotation`) and B is 10 calls (`comp` ×2,
`selector` ×2, `registerable`, `handler_type`, `is_excluded`, `key_fn`, `comb_fn`) + 1 reference
(`allowed_err`). The two mechanisms have ZERO overlap: A's rows are all references in `pb-grpc`'s examples,
B's are calls in wagtail/cython/ansible/sqlalchemy plus one saleor reference.

**The symbol delta is attributed by measurement, not by addition.** The analyzer published **+276**
symbols (206,169 → 206,445). A population-wide census run of the analyzer itself
(`.tmp-py/round11-symbol-census.mts`, `.tmp-py/round11-multitarget-census.txt`) counts the symbols
carrying `metadata.multiTargetForm`, split by scope, so the +276 is a number the ANALYZER states and
the CPython price (270 + 4 = 274) is the independent cross-check — the price's remaining shadow is
recorded in §9 rather than rounded into the story.

### 2. PY-D21 — a target is a target, whatever shape it is written in

`extractAssignment` gated on `left.type === "identifier"` and RETURNED for everything else, so a
multi-target assignment published nothing at module scope and nothing at class scope. The names it
binds are ordinary bindings of the scope the statement is written in, and the corpus shape is not
hypothetical:

```python
helloworld_pb2, helloworld_pb2_grpc = grpc.protos_and_services("helloworld.proto")
```

at module scope in `pb-grpc/examples/python/auth/async_customized_auth_client.py`, with every
annotation naming `helloworld_pb2` in that repo's examples published as an UNEXPLAINED reference to a
name the file binds twenty lines above. The fix reads the target with the SHARED pattern walker
(`patternTargetNodes`, the node-returning face of round 10's `addPatternTargets`) and publishes one
Variable per name at the name's own position — a Property per name with the class as owner in a class
body — each carrying `metadata.multiTargetForm` (the spelling: `pattern_list` / `tuple_pattern` /
`list_pattern`).

**The walker gained ONE literal and the fixture-coverage gate is why it is allowed to.** MEASURED
(`.tmp-py/round11-shapes.mts`): `a, *rest = f()` puts the splat in a `list_splat_pattern` element
holding one identifier, and the walker did not descend it — so `rest` bound nothing at module scope
AND was not a function local either. `typed_pattern` was DELETED in round 10 for being a literal no
source produces; `list_splat_pattern` is the mirror case (a literal 28,136 function-body targets
contain and the reader did not handle), and it is kept because a fixture now contains it — which is
the condition the deleted one failed.

**SCOPE is pinned in the negative direction, because a rule this easy to widen fabricates.** A tuple
target inside a `def` binds LOCALS, which are not symbols on this family's contract: the fixture
pins `m`/`n`/`sb`/`tail` at **0 symbols** and their call reads at `local-callee`. The class-scope
half is pinned with `kind: property` + `ownerName: Holder` rather than by a count, so a fix that
published class members as module Variables would fail on the identity and not only on the number.

### 3. PY-D22 — the under-claim that was called "safe" until someone read the count

The sentence this round removed has been in `isLocalCalleeName`'s docstring since round 7, and it is
quoted rather than paraphrased: *"Under-claiming is deliberate and safe: a lambda's or a
comprehension's own parameters are not collected, so a call inside one stays `bare-name-callee` and
is counted, never mislabelled."* The skip is right about SCOPE — a comprehension's bindings are not
its enclosing function's, and it stays right — and wrong about the CONSEQUENCE. `bare-name-callee` is
not a weaker answer than `local-callee`; it is the WRONG one: it says the name may be a project-wide
declaration, when python resolves the read to the comprehension's own target four characters to the
left. The corpus rows are all one shape — `[comp(page) for comp in comparison]` (wagtail), `any(is_excluded(testname) for is_excluded in self._excluders)` (cython),
`[handler_type(...) for handler_type in handlers]` (ansible), `comb_fn(getter(arg)) for getter, comb_fn in fns` (sqlalchemy).

**The fix is the SAME ancestor walk, asked of one more kind of scope.** `scopeOwnBindings(scope)`
returns a comprehension's `for` targets (all its clauses are DIRECT children, measured with three
chained `for`s, and a pattern target goes through the shared walker so `for k, v in ...` binds two
names) and a lambda's parameters (under `lambda_parameters`, NOT `parameters` — which is why the
parameter reader was EXTRACTED as `addParameterNames` and shared with PY-D14 rather than copied: two
readers of one shape is how a dead case survived nine rounds in this file). `locals.size === 0` was an
early exit that answered `false` for a whole module-scope comprehension in a file with no `def`, and
it is gone.

**THE PRECISION IS LEXICAL, AND IT IS THE HALF A NAME-KEYED RULE WOULD FAIL.** The fixture prints
both directions of the same name: `[comp(page) for comp in comparison]` reads `local-callee` while
`return comp(comps)` AFTER the comprehension reads `bare-name-callee` (python 3 gives a comprehension
its own scope, so nothing binds it there), and a call to a name the comprehension never binds stays
`bare-name-callee` too. The cheap wrong fix — adding comprehension targets to the enclosing
FUNCTION's local set — passes every positive row and fails exactly those two, and it is pinned as a
mutant (`round11/comprehension-locals-cheap-fix`) so it cannot land quietly.

**The lambda half is fixed with no corpus row of its own.** The price found 4,002 lambda-parameter
reads and ZERO on the residual dump: it is the same fact with a different spelling, and the honest
report is that the lambda case is fixed because the fact is the fact, not because a row demanded it.

### 4. The graph moved by ONE label, and by exactly the amount the price named

| label | round-10 edges | round-11 edges | Δ |
| --- | --- | --- | --- |
| contains | 135,619 | **135,634** | **+15** |
| calls · uses · imports · references · exports · extends · implements · overrides · instantiates | 535,006 · 389,972 · 97,112 · 61,955 · 3,043 · 20,954 · 333 · 33,492 · 13,134 | identical to the digit | **0** |
| **total** | **1,290,620** | **1,290,635** | **+15** |

The +15 is the CLASS-SCOPE half of PY-D21 and nothing else: 15 class-body multi-target names, each
getting the `contains` edge a member gets. The module-scope half adds SYMBOLS and no edges — a
declaration with no containment is exactly what a module Variable is — and mechanism B adds neither,
because a reason code is not an edge. That asymmetry is the check: a fix that had invented or moved
edges would have moved `calls`, and `calls` is unmoved to the digit.

### 5. The verdict, re-measured over the same 11,488 files

| label | round-10 UNEXPLAINED | round-11 UNEXPLAINED | round-11 axes |
| --- | --- | --- | --- |
| calls | 65 | **55** | star-import-external 173 · dynamic 27,579 · external 31,196 · declared-local **4,290** · builtin 3,053 |
| references | 47 | **34** | qualified-external 893 · builtin 374 · declared-local **147** · star-import-external 8 |
| exports | 7 | **7** | — |
| extends | 0 | **0** | declared-local 15 · qualified-external 324 · builtin 72 |
| uses / contains / imports / implements / overrides / instantiates | 0 | **0** | — |
| **total** | **119** | **96** | — |

The move is visible on the EXCUSE axis as well as on the defect axis, which is what makes it a
re-classification rather than a deletion: `declared-local` rose **4,280 → 4,290** on `calls` and
**146 → 147** on `references`. A row that left UNEXPLAINED landed in a named category, and the
categories' totals are printed beside the number rather than summed into it.

### 6. The 96, split by CPython's own parse of each file — three different verdicts behind one word

The dominant cluster is unchanged and every row of it is now NAMED (`.tmp-py/price-unparseable-rows.py`,
run on the round-11 dump):

| file group | rows | what CPython says |
| --- | --- | --- |
| 13 `otp/lib/asn1/test/asn1_SUITE_data/*.py` ASN.1 documents | **40** (26 calls + 14 refs) | **11 of them are rejected at LINE 1** — `BitStr DEFINITIONS ::=`, `From DEFINITIONS IMPLICIT TAGS ::=` — one at line 2, one at line 2085. The file's FIRST BYTE is not a python statement |
| `dart-sdk/build/mac/change_mach_o_flags.py` | **1** (`xrange`) | rejected at line 107, `raise MachOError, \\'` — a PYTHON 2 file, and `xrange` is a python 2 BUILTIN, so the row is a builtin of the version the file was written for, not a dangling name |
| `nvim-treesitter/tests/query/highlights/python/pattern_matching.py` | **1** (`quit_game`) | rejected at line 49, `x, match: str = 2, "hey"` — a syntax-highlighter FRAGMENT, not a module; the name it calls is defined nowhere on purpose |

So the 42 rows in CPython-unparseable files are not one fact but THREE (40 + 1 + 1 = 42, re-counted
from the price's own `unparseable_rows` list), and a single "unparseable-file" excuse would have
hidden all three behind one word. The axes are independent and a row is counted ONCE: the dart-sdk
row also carries `bare-name-callee` (its `xrange` is bound by nothing in the file), and it is counted
here, in the unparseable group — the **27 bare calls** are the rows in files CPython PARSES.
That is also why this round
does NOT take the file-level verdict: (a) and (c) are corpus classification, which the round-6 note
in this file already says is not this lane's to take alone, and (b) is a language-VERSION fact that
belongs in the builtin axis rather than in an exception. What the round does instead is name each
file, each line CPython gives up on, and each row's count — so the next round inherits a measurement
and not a phrase.

The other 54: **27 calls and 20 references are a bare name bound by nothing in its file** —
semgrep's sample stubs (`do_something` 10 + `do_something_else` 4 = 14 rows), cython's
dynamically-bound `frozendict` (9 — 3 calls + 6 annotations), sqlalchemy's deliberately-undefined
typing-test names (`Bogus` ×2, `UnavailableUser` ×2, `Lisst`, `Frobnizzle`), cython's PEP-563
`this_cant_evaluate`, libxslt's C-extension-injected `stylesheet`/`transformCtxt`, wagtail's `mixin`
and `field.related_model`, ansible's `gdb`-injected `SignalEvent`, `reveal_type` (3), and one file
each for Cython's cdef'd `multiply_by_10_in_C`, `_encVarInt` and a benchmark that calls `urlparse`
with no import at all — **and 7 exports
UNCHANGED in rounds 8–11** (`__all__` names the module provides LAZILY; the wildcard axis is
deliberately not applied to `exports`, because an export is a name the module ITSELF declares).

### 7. Verified together (analyzer = the shipped source)

- python fixtures **49/49** (two new: `multi-target-assignment-binds-names`, whose every shape comes
  from the grammar probe and whose zero-symbol rows pin the local scope; `comprehension-target-is-a-local`,
  whose positive rows and SAME-NAME precision pair are the whole argument).
- mutants **45/45 CAUGHT**, 0 survived, 0 not applied — eight new: the target walker disabled (round
  10's gate restored), the splat literal dropped, the provenance field dropped, each of PY-D22's two
  readers dropped separately, the lambda case dropped, the first-clause-only read, and the cheap wrong
  fix that would put comprehension targets in the enclosing function's locals.
- fixture-coverage gate **python PASS** (`handled=71 fixtureTypes=151 uncovered=0 ambiguous=0
  deadLiterals=0`) — `handled` rose 66 → 71 because the five node types this round READS moved out of
  `internal_silent` (`for_in_clause`, `lambda_parameters`, `pattern_list`, `tuple_pattern`,
  `list_pattern`), and `deadLiterals=0` says the new walker literal is covered rather than asserted.
- `tsc --noEmit` exit **0**, zero diagnostics.
- verdict `--fresh` over **11,488/11,488** files; `resolution-verdict-gate.ts` **PASSES** with the
  ceilings TIGHTENED AGAIN (calls 70 → **55**, references 50 → **34**, exports 8 at a measured 7),
  10/10 emitted, OUTGOING UNRESOLVED **0 for all ten**, artefact re-copied from the fresh run.
- `star-import-axis-gate.mts` **PASSES** (all ten decision directions, incl. the corpus-convicted
  collision row, plus the artefact carrying the axis).
- arbiter `python --fresh`: **COMPLETE 11,488/11,488** (0 settled by an earlier walk, 0 degraded,
  0 abandoned), `emitted 10/10 · ruled-sound 0 · FALSIFIED 0 · ruled-without-justification 0 ·
  ruled-unknown 0`, attestation VERIFIED (nodeTypes 203, attributeKeys 227,330,
  implements.constructSites 204) — and its own independent table reads `contains` **135,634**,
  identical to the verdict's, so two instruments that share no code agree on the moved graph.
- differential `--lang python`: cython `covered=34162 (100%) MISSING=0 · analyzer-edges=6824
  unexplained=0`, requests `covered=5326 (100%) MISSING=0 · analyzer-edges=2552 unexplained=0`. Those two
  edge counts are IDENTICAL to round 10's, which is the second independent confirmation that the
  round added no edge to the differential's corpora (neither has a class-body multi-target).
- seam gates unchanged and green: `owner-resolution-gate` PASS, `store-heritage-seam` PASS,
  `import-bound-name-seam` PASS (PY-D13's store half is still the DECLARED gap, pinned by name),
  `owner-channel-census` **375 owner rows, 357 resolved** — identical to rounds 5 and 10, so the
  member channel was not touched.
- **php neutrality, measured rather than argued**: `php/owner-resolution-gate` PASS;
  `php/store-resolution-census` PASS, and this round's artefact is identical to **round 10's** on all 34
  non-timing keys — `generatedAt` and the two `timingsMs` fields are the only differences in the whole
  file. That is the comparison that isolates THIS round's work, and it is the honest one.
- **CORRECTED IN ROUND 11 — the round-10 sentence carried forward from round 5 was wrong when written.**
  Against the ROUND-5 artefact (`.tmp-py/php-census-after.json`) the file is NOT identical: two
  `phaseA_storeBinding` keys have moved — `no-declared-receiver` 17,665 → **17,698** and
  `no-declared-receiver:NULL` 12,082 → **15,514** — and they had already moved BEFORE round 10's run
  (`.tmp-py/php-census-after-round10.json`, 16:00, carries the new values), so round 10's own "every number
  identical to the round-5 artefact" was false too. The window between the two runs contains other lanes'
  committed php/store work — `a2915d26e` (fix(php): a `$variable` read is a BINDING, 10-11 12:34),
  `e1c15d0fe` (fix(pool-worker): the leaf extractor did not split on the BINDING SEPARATOR, 12:41) and
  `f9ed0c5d3` (php fixture re-spelling) — so the movement is a fact about a window with several candidate
  commits, not a commit pinned by measurement. Every pin the round-5 claim actually rested on is unchanged
  to the digit across all three artefacts: `phaseA_storeBinding.resolved:owner` 3,354 · `null` 4,797 ·
  `null:receiver-name` 96 · `null:receiver-identity` 2,521 · `null:receiver-absent` 2,178 ·
  `null:receiver-ambiguous` 2 · `phaseB.ownerResolved` 3,354 · `ambiguousInChain` 152 · `notDeclared` 2,465 ·
  `sameKindDuplicateResolved` 0.

### 8. The price is a verification, not a story: it was re-run against the shipped analyzer

Both mechanisms were priced BEFORE any code existed and the prices were re-run against the shipped
analyzer, so the post-hoc numbers (12 · 11 · 96 · +15) are a verification of the price rather than a
story told afterwards. The verification of mechanism A is now PER SYMBOL rather than a sum
(`.tmp-py/verify-multitarget-census.py`): of the 276 published `multiTargetForm` symbols, **270 are
confirmed by CPython**, 4 sit in the nvim highlighter fragment CPython rejects, and the remaining **2**
are the `(x): int` form-label question recorded in §9. The earlier "274 accounted / 2 unknown" split
came from the v1 price run and is superseded by the per-symbol check, not repeated here.

### 9. Still open after round 11

- **Every one of the 276 `multiTargetForm` symbols is accounted for — 270 confirmed, 6 named one
  by one.** Every symbol carrying
  `metadata.multiTargetForm` was checked against CPython's own `ast` scope by scope
  (`.tmp-py/verify-multitarget-census.py`, `.tmp-py/verify-multitarget-census.json`): **270 confirmed**,
  **4 in the nvim highlighter fragment** CPython rejects at line 49 (`a`, `match` ×2, `x` — a genuine
  same-name-twice row), and **2 the check itself found**, in `cython/tests/run/pep526_variable_annotations.py`:
  `(x): int` (line 174) and `(y): int = 0` (line 175). `.tmp-py/paren-target-probe.mts` pins the shape —
  tree-sitter spells `(x)` as `tuple_pattern` wrapping ONE identifier, CPython spells it an annotated
  `Name`, and the analyzer reads the spelling, so both carry `multiTargetForm: "tuple_pattern"` although
  the source writes no tuple. The SCOPE is right (both ARE module-scope names, and bare `z: int` is
  published the same way — pinned in the same probe); it is the FIELD that over-claims. Two honest
  fixes, neither taken this round because a field label must not be changed after a verified run
  without re-running it: (i) stamp the field only when the pattern binds more than one name, or
  (ii) keep the spelling and document it as tree-sitter's node type, not the source's semantics.
  This replaces the earlier "255 module-scope in 78 files + 15 class-body, so 274 of 276 are priced and
  2 are unknown" — which was the v1 price run's stdout, a number no artifact on disk carries.
- **42 rows in files CPython cannot parse**, now split into three named verdicts (§6) — the file-level
  decision (corpus classification) is still not taken, and the py2 half wants a language-version fact
  in the builtin axis (`xrange` is 1 row).
- **47 bare names bound by nothing + 7 lazy `__all__` exports** (the 54 non-broken rows are 27 calls
  + 20 references + 7 exports), named with examples in §6.
- **PY-D13's store half** — unchanged and pinned by a green gate.
- Round-3 items unchanged: **D5** (750 `uses` self-loops), the flat-corpus pins in
  `python-ontology-census.ts` / `firing-check*.mjs`.

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
- **php round 7 (PHPD41): the hierarchy never crossed the worker boundary.** Round 6 left the owner
  pass's ancestor stage "load-bearing" and the column it reads was NULL on **0 of 4,940** class-like
  symbols in a production-path store — while the analyzer published `metadata.superTypes` on every
  one it could resolve and the lane's roundtrip fixture proved the COLUMN writable. The drop was
  `src/ast/pool-worker.ts`'s per-symbol metadata allowlist (CSS + markdown + four bash keys +
  `isDeclaration`, under its own rule "only keys a READER CONSUMES belong here"), which did not name
  `superTypes`; every instrument in the lane calls `ASTEngine.parseFile` and so structurally cannot
  see the seam (MD-5's "unpinnable", not "unpinned"). `script/m60/php-store-pipeline-seam.ts` is the
  missing case: it indexes through `indexProjectParallel` and asserts analyzer-carried vs
  store-carried per fact. It read **8 carried / 0 stored** before the fix and 8/8 after; removing
  exactly the one widened line returns it to 0 and FAIL. Full-population effect, on one frame and one
  commit with the line as the only variable: `classLikeWithSuperTypes` **0 → 3,805 of 4,940**,
  resolving distinct parent names **0 of 0 → 221 of 332**, phase-B `inheritedResolved` **0 → 3,506**,
  `mislandings repaired` **4,698 → 5,964** — and `override-retarget.ts`, which returned at its first
  line for every php store ever built, now runs. **A 537-row drop in `resolved:owner` looked like a
  regression and is not this change**: a third run with the line removed reproduced the committed
  artifact only on that key, proving the baseline had drifted across ~3.5h of indexer commits
  (`4c072d50b`, `028be23b7`, `886bfb069`) — so the census artifact's `resolved:owner`/`null:*` split is
  not comparable across 2026-10-08 12:30, and every key this round claims is, because OFF and ON share
  a commit. Not claimed at that commit: that the store's own binding improves (phase B gives the pass
  its whole input; the insert-time ranking still claimed those rows first), nor that 3,805 is a
  shortfall (NULL is the honest "declares no supertypes"). **The first of those was superseded the next
  day — see round 8.**
- **php round 8 (PHPD42): the owner channel is AUTHORITATIVE for the rows that state their receiver.**
  `resolveTargetStmt` attaches a bare member name to the LEXICOGRAPHICALLY SMALLEST id when the citing
  file does not declare it, and stores the row RESOLVED — so `SubWidget::run` calling `$this->act()` was
  answered `ZetaStore::act`, a confident false statement about which method the call reaches. That is
  the exact shape that makes an agent hallucinate rather than abstain, and both honest answers were
  available. `claimOwnerCarryingTargets` (`src/ast/member-owner-resolution.ts`) now withdraws every row
  carrying a relation-level `metadata.owner` from whatever bound it and lets the owner+ancestor rule
  decide — declining to NULL rather than handing the row back. Called at BOTH resolution sites
  (`storeResults`' inline strategies AND `resolveRelationships`' linear plan), each immediately before
  the cross-language pass, and idempotent because a real run reaches both. Scope is by the DATA, not a
  language switch: php is the only lane publishing a receiver (`withMemberOwner`), so the blast radius
  is php today and widens by itself if another lane publishes the same fact. **The gate came first and
  was RED**: `php-store-pipeline-seam.ts` CHECK D landed `$this->act()` on `UpsilonStore.act` for both the
  inherited read and the unresolvable-base read; after the change it lands on `WidgetBase.act`, on the
  receiver's own declaration, and on an honest NULL respectively, with the wrong-answer symbols asserted
  present so a NULL is a refusal and not an absence. Population, on a 1,500-file stride frame (29% of the
  5,094 admitted files — the whole-population run needs ~7 min and did not complete on a loaded box,
  twice): **phase A equals phase B to the digit, `resolved:MISLANDED` and `resolved:not-a-member` gone
  entirely, `mislandings repaired 0 of 0`** — 9,712 owner rows resolved, 10,457 refused. Artifact
  `validation/m60/php/store-resolution-census.owner-channel.json`; the committed whole-population
  artifact is still the PRE-claim measurement and regenerating it is outstanding work, not an open
  question. `owner-resolution-gate.mts` §2 went red by design (it pinned the defect) and now pins the
  answers a rule can defend — while KEEPING the one row the rank still decides (`goPlain`, no published
  receiver) pinned to its old wrong answer, so the scope of the change is visible in a gate rather than
  in a paragraph. Not claimed: that owner-LESS member reads resolve (the type-inference wall, 107,313
  endpoints, now the population's largest honest-unknown class), nor that the resolved COUNT is the
  headline — the headline is that 6,114 rows stopped asserting a receiver they do not have.
- **php round 9 (PHPD43): the final review.** Run adversarially over the lane's own invariants rather than as
  a re-run of its gates, because every gate was already green. It found one **false-claim path**: PHPD10's
  guard against a heritage clause that resolves to the declaration's OWN name was in the class and interface
  branches and had **never been added to the enum branch**, so `enum Foo implements \Foo` published
  `implements Foo -> Foo` and mirrored `Foo` into `metadata.superTypes` — a self-loop in the column that
  exists to be WALKED. **The blind spot is the more useful half**: the differential's oracle already had the
  rule, so the two sides disagreed only on an input the pinned 60-file draws never contain — a gate that
  agrees with the implementation on every input it is given is not evidence about the inputs it is not given.
  Reading the shapes showed the guard was also under-specified: it caught the QUALIFIED route
  (`implements \Foo`) and missed the BARE one (`implements Foo`, where `raw === target` made it false), and
  the two are now ONE condition — a clause whose resolved target is the declaration's own name is dropped —
  mirrored into the oracle's `heritageOrSkip` in the same commit. The separable case is untouched, which is
  the whole reason it is one condition rather than "drop when the leaf repeats".
  **Population price: ZERO.** A new re-runnable counter (`script/m60/php-self-heritage-count.ts`, same
  admission rule as the census) reads 0 self-referencing of 497 heritage edges on a 600-file frame — and 0
  on the same frame with the PRE-fix analyzer checked out, a real A/B — and 0 of 1,213 on a 1,500-file frame.
  So the fix removes no edge that exists today: it closes a latent fabrication path, whose cost of being
  wrong is a confident lie and whose cost of being closed is a fixture. Two mutants, one per direction
  (`php/self-heritage-emitted`, caught by 2 fixtures; `php/self-heritage-over-reach`, caught by 3 — the third
  being `same-leaf-inheritance`, unpredicted, which is what a control-of-controls is for). **30/30 fixtures ·
  23/23 mutants · differential green on both draws.** No third defect found by reading the analyzer against
  its invariants.
- **php — DECLARED DONE (2026-10-09).** The declaration is in `docs/analyzers/real-php-analyzer.md`, at the
  end, written as nine exit criteria each with the command that shows it — a reader who disagrees has
  something to run. In one line: every emitted type is compared against truth (php `217/217`, no
  un-audited row), both pinned draws are `MISSING=0 unexplained=0`, the oracles are independent, 21/21
  mutants are caught (23/23 after the final review), no `contains` target is orphaned, analyzer facts
  survive the worker (proved falsifiable), a member read is bound by a rule wherever one exists, a heritage
  clause naming the declaration itself is not published as heritage, and what is NOT resolved is
  enumerated and bounded. NOT claimed: that every edge resolves — 107,313 endpoints are the
  type-inference wall, and the honest answer there is "not known" rather than a guess. Two store-wide
  defects remain reported-and-unfixed (the rank deciding rows with no published receiver, pinned by name so
  it cannot drift silently; and re-store row loss at `parallel-indexer.ts:2928-2929`) — the second is next,
  and it is the absence-shaped failure rather than  the false-claim-shaped one this arc removed.
- **fsharp — DECLARED DONE (2026-10-09).** The declaration is at the end of `docs/analyzers/real-fsharp-analyzer.md`,
  written as eight exit criteria each with the command that shows it. In one line: every emitted type is compared
  against truth (`5386/5386`, un-audited column empty — the last two, `imports` and `uses`, got oracle arms in
  pass 19, and `script/m60/rel-type-coverage-gate.ts` now prints **no fsharp row at all**), the differential agrees
  on two draws (99.9% covered; the residual is `calls` — no calls oracle exists for this language, declared — and
  `overrides`' bare-target spelling when the base is not in the same file, also declared), the oracle has **zero
  imports** so independence is structural rather than promised, the fsharp mutants are 36/36 caught, fixtures are
  15/15 with `no regressions`, the project index is registered AND read (600 refined edges on `Argu`, 471 of them
  attached to a symbol), and what is NOT resolved carries a reason and a `closes_when`. The part worth keeping is
  that pass 19's own claim is FALSIFIABLE: disabling the two arms makes the harness's own guard fire —
  `COMPARED WITH NO TRUTH: imports (115 comparable, 0 truth), uses (44 comparable, 0 truth)` — because a label
  compared against nothing reads from the outside exactly like a label with nothing wrong, and that is the
  asymmetry cost this programme four `contains` losses. NOT claimed: that every edge resolves (59.1% of the
  non-file classes need a CLAIM rather than a wider index — the one candidate rule was priced at 72% refuted and
  refused), that the graph is complete (`.fsi`/`.fsx` excluded from the incoming key space by decision, 604
  zero-symbol files = 123 of 150,114 unresolved edges), or that the incoming gate PASSES — its FAIL reason is the
  fleet's `#` binding-separator contract, which F# hits only because its backtick identifiers legally contain `#`.
  Two store-wide defects remain reported-and-unfixed (the insert-time leaf lookup, which makes every lane's
  qualification work invisible — 274 of 274 dotted `calls` attached by leaf, 0 by exact qname — and re-store row
  loss at `parallel-indexer.ts:2928-2929`). Next reachable work is ranked by `docs/analyzers/INCOMING-WORKLIST.md`:
  **yaml** is 20 ambiguous edges and 0 unresolved from a PASS, and json (22,256 edges) and sql sit behind the SAME
  root cause — a module symbol published under its basename, colliding across files.
- **yaml — the basename collision, fixed and measured (2026-10-09).** *(SUPERSEDED BY THE ROUND 5 BULLET BELOW: the "20 ambiguous edges from a PASS" reading and the "2 `!include <path>` `imports` edges / GATE gap" conclusion are both closed — the 60-file stride draw is now a clean PASS. Kept as the record of what was true on 2026-10-09.)* The incoming gate read the lane at
  **78 ambiguous + 0 unresolved of 1,512 edges** on a 60-file stride, and the cause was ONE function: a
  document's identity was its filesystem basename. A basename is not unique in a project — `hostports0.yaml`
  occurs **156 times** in one repo (Kubernetes pod-security-admission testdata) and `Chart.yaml` **243 times** —
  so `hostports0.spec.containers[0]` had 156 declarations and the `contains` edge asserting that containment
  could be walked in neither direction. Scoping the identity by the file's PROJECT-RELATIVE directory chain
  (basename last, so the store's leaf matching is unchanged; dot-joined, so no second path convention enters
  the key space) takes the gate to **0 ambiguous, 0 unresolved, resolved 1,432 → 1,510**. The +78 with ZERO
  movement in `unresolved` is the clause the fleet worklist asked to be checked rather than assumed: it is the
  evidence that nothing in this corpus spells a document by its basename. It needed one additive field
  (`AnalyzeContext.projectRoot`, filled by the worker from the `projectPath` it already received) and the gate
  handing the analyzer the repository it actually resolves against (`repoOf(f)`, where it had been passing
  `dirname(f)` — a project the verdict does not measure). Measured twice: with a scratch heuristic scoped by the
  last two directories, then with the shipped rule deriving the full chain from the real root — identical
  numbers, because a heuristic that clears one corpus is not a rule. The lane's remaining verdict reason is
  **2 `!include <path>` `imports` edges, and that is a GATE gap rather than a lane defect**: a path-shaped
  target has no bucket (an owner claim needs an identifier-shaped owner, a declared cause needs an
  identifier-shaped reason EQUAL to the target's owner, and the project-facts claim verifies only `package:`
  and `dart:` shapes), so no lane emitting file-path imports can PASS whatever it does. The edge is real —
  `dependencies.ts` reads `imports` for file-to-file dependencies precisely because `resolved_symbol_id` is
  routinely null — so deleting it to buy a verdict would hide a dependency. The shared fix (a path claim
  verified against the project's own file list, which the gate already builds per repository) is priced in the
  lane doc and not yet built. `real-css-analyzer.ts:2098-2104` declines this same convention on the ground that
  a per-lane disambiguator would be invented; the conflict is on the record with the measurement that
  distinguishes the two cases (css's premise is about incoming references spelling basenames, which  for yaml is measurably false), and adopting it fleet-wide would clear css/bash/html/javascript for the same price.
- **yaml — ROUND 5: 82% of the lane's `extQ` was a FALSE CLAIM, and fixing it moved `extQ` 1,903 →
  343 (2026-10-10).** The fleet ruling on `externalUnverified` (`HANDOFF.md` §5v) says to split by
  emitting site FIRST, "because a subset will be a claim the lane should stop making rather than a
  claim nothing can check", and the split — the whole admitted population, arbiter's own rule,
  `validation/m14/fixtures/yaml/extq-census.ts` — was exactly that: **681** cross-file `$ref`s spelled
  `"./Responses.OpenAPI.yaml#/400"` plus **675** spelled `"Shared.Components.OpenAPI.yaml#/…"`
  (one repository's OpenAPI set) and **208** local reusable-workflow calls
  (`uses: ./.github/workflows/build.yml`) all said `isExternal` **about a file their own project
  has**. Two sites each: the `$ref` site's `isExternal: !pointer.startsWith("#/")`, and the
  workflow-call branch routed through `actionUseClaim`, which asked a FILE for
  `<file>/action.yml`. Both now state the claim the project can check (the pointer's file part, the
  workflow path) through the same `relativePathCandidates` + `statSync` rule every other file claim
  in the lane uses. The same census found **48 `steps[].with.needs`** edges — an action INPUT emitted
  as a job dependency, 46 of them sitting in the VERIFIED column — and **31 Compose long-form
  `depends_on`** edges naming `condition: service_healthy` instead of the services; both fixed
  (`isDependencyPosition`, `dependencyTargets`, measured over 1,938 dependency edges by position).
  Measured: **`extQ` 1,903 → 343 · `extOK` 9,208 → 10,701 · `extFAIL` 0 → 0 · edges 1,414,847 →
  1,414,804 · residual 232 → 231**, and the 200-file stride draw — the one whose verdict named
  `310 published key(s) contain the binding separator` before the separator moved, then
  `185 ambiguous + 47 unresolved …; 1903 external claims unverifiable` — now reads `resolved 6579 ·
  amb 0 · unresolved 0 · extOK 12 · ext? 2 · extFAIL 0` with `FAIL — 2 external claim(s) …`, i.e.
  **`bad === 0` for the first time and only the 2 ruled-shape claims standing between the draw and a
  PASS**. The **whole-population** incoming scope, run for the first time this round
  (`incoming-gate.ts yaml yaml,yml 0`, 18,364 of 18,364 files, 189 repos, separator tripwire 0),
  reproduces the residual model to the edge: **`FAIL — 184 ambiguous + 47 unresolved of 1,414,804 …;
  343 external claim(s) unverifiable (10,701 verified + 343 unverifiable)`** — so the run's only
  non-PASS reason IS the 343 ruled claims. Two new controls (`document-claim-control.ts`, 29 assertions;
  `workflow-needs-control.ts`, 14) each **shown failing (exit 3, 7 and 2 red)** by reverting the fix
  they pin; fixtures 33 pass / 0 fail. **NOT claimed: a PASS.** The 343 that remain are the RULED
  CLASS — split by shape, with a mechanism and a falsifier per row in `docs/analyzers/yaml.md` — and
  the biggest piece of it (88 `package:`/`dart:` includes) is a FACT-BUILDING question for the Lead,
  not a lane defect.
  **The four-clause answer** (`docs/analyzers/yaml.md`, mirroring json.md): clause 1 **fails by 231**
  (184 ambiguous + 47 unresolved, every edge attributed to a named cause and ruled); clauses 2, 3 and
  4 **met** (`extFAIL`/`bindFAIL`/`causeFAIL` 0 · every remaining edge attributed · `ofWhich` 4, all
  `contains`, `intended` 1,380,046/1,380,046 — the store-side intent split is the one thing json has
  and yaml does not yet). **§7's five "done" criteria are all five MET**: coverage block 8/8 with
  evidence-classed exclusions; silent types ruled by grammar inventory + whole-corpus site counts;
  both incoming scopes measured (60-file PASS, 200-file `bad === 0`, whole-population gate); `extFAIL
  0` on the lane's own marks; and the lane corrected its own `calls`/`exports` reading when the whole
  population (327 / 4,080) contradicted the ansible-only sample (`_corpusUnexercised_retraction`).
  So: **done by §7; clause-1-short by 231; and it fails clause 2 by 343 only if the owner forbids any
  unverifiable external claim.** No PASS, and every number here is a re-runnable artifact.
- **yaml — ROUNDS 7–9: four more FALSE-EDGE classes removed (222 net edges), `extQ` 343 → 255,
  residual 231 → 185, and the biggest ruled class' own falsifier FIRED on one edge (2026-10-10).** Round 7 asked the
  harder question of the *residual* — how much of it is the lane's own over-emission — with the
  arbiter's own rule over the whole admitted population. Three answers were defects:
  **(1)** an include-family tag (`functions: !include "…/functions.yaml"`) was read as naming a TYPE,
  so every such site emitted a `references` edge targeting the literal string `include` — **10 edges,
  all AMBIGUOUS against 3 unrelated declarations**; `tagTypeName()` is now the one definition every
  `declared_type` site reads. **(2)** a QUOTED include path was refused for containing a space
  (`tables: !include "s 3/tables/tables.yaml"` names a file the repo HAS); quoting is now the evidence
  that a space is literal, and the two hasura edges moved from a false `declared_type` to a VERIFIED
  file claim. **(3)** Azure Pipelines' `trigger`/`pr` `branches`/`paths` **`include:` is a BRANCH
  FILTER, not an import** — `include` is in `FILE_IMPORT_KEYS` for ansible's sake — and it was emitted
  as **12 imports in one file** alone (docker's vendored `sdk/azcore/ci.yml`), the globs going straight
  into `extQ` and `main` into AMBIGUOUS against 11 declarations. The guard is the KEY'S POSITION plus
  the document's own `trigger:`/`pr:` claim (31 such files), never the value's shape, because a filter
  list and a real glob include have the same shape. The narrow guard was then generalised by MEASUREMENT rather
  than intuition: a new instrument (`include-key-position-census.ts`) reads the emitting KEY'S OWN PATH
  off all 928 `yaml_keyword_include` edges in the admitted population and groups them by parent chain,
  shape and claim, and it found **five more selector positions** — **semgrep** rule `paths.include`
  (26 glob edges), Dart build_runner **`sources.include`/`generate_for.include`** (25), **ffigen**
  Selector lists `objc-interfaces`/`objc-protocols`/`enums` (34), a GitHub Actions **`outputs.include`**
  (1) and Spring Boot **`exposure.include`** (1). The guard is now ANY ANCESTOR segment of the key's
  path MINUS THE DOCUMENT SEGMENT — that exclusion is the sharp edge, because a file named `paths.yaml`
  would otherwise lose every top-level `include:` it has (the defect the older `matrix` guard already
  had to state). New `include-selector-control.ts`, 12 assertions, SIX in each direction, with falsifier
  runs: revert the guard ⇒ **6 red / exit 3**; over-reach it (count the document segment) ⇒ **3 red /
  exit 3**. Measured whole-population: **edges 1,414,804 → 1,414,582 (−222 net) · residual 198 → 185
  (138 amb + 47 unresolved) · `references` amb 141 → 131 · `imports` amb 10 → 7 · `extQ` 335 → 255 ·
  `extOK` 10,743 → 10,616 · `extFAIL`/`bindFAIL`/`causeFAIL` 0 · 0 · 0**; the 200-file stride draw is
  unchanged at `bad === 0` with the same 2 ruled-shape claims. **28 of the removed edges had been
  sitting where no residual column shows them** — 26 in `extOK` as VERIFIED claims about Objective-C
  class names that resolve to nothing, and 2 reported as RESOLVED (`imports` resolved 4 → 1), which is
  the direction this programme treats as worst.
  **The new instrument is the finding: `validation/m14/fixtures/yaml/name-collision-falsifier.ts`
  REFUTED the lane's own ruling before it was recorded.** The biggest remaining class is a bare
  relation-object name not declared in the edge's own file (`secretName: test`,
  `serviceAccountName: default`, `include_role: name=dnf`), and the proposed ruling was that the count
  model, which resolves BY NAME across the project, cannot discriminate it from an ordinary key of the
  same spelling. The falsifier reads the KIND off the REFERRING KEY and looks for that kind and name in
  **the project's own text** (a text oracle, so it cannot inherit the defect it tests) — kind-blind
  would have been wrong, since `test` IS declared 8 times in kubernetes, as Pods and CRD examples, and
  none is the Secret the edge asks for. Over the 142 ambiguous edges: **1 FALSIFIED (SAME DIRECTORY)** —
  `serviceAccountName: apiserver` in `staging/src/k8s.io/sample-apiserver/artifacts/example/deployment.yaml`,
  with `…/example/sa.yaml` declaring `kind: ServiceAccount` + `name: apiserver`: a REAL missed
  resolution in one manifest set; **0** by a role directory; **117** same-kind names ELSEWHERE in the
  project (another manifest set is another cluster — not this referent); **24** with no same-kind
  referent at all (6 role imports whose `roles/<name>/` the project lacks, 10 kind-asked-and-absent, 8
  no-kind-axis). **So the ruling holds for 141 of 142 and FAILS for 1**, and that 1 is reported with
  the exact file pair rather than smoothed: resolving it needs a project-wide or same-directory resource
  index, which a per-file analyzer has no channel for (it sees one file plus a `statSync`) — an
  architecture item for the Lead. **NOT claimed: a PASS.** Fixtures 33/0 · FOUR controls exit 0 ·
  **24/24 yaml mutants caught** · `tsc --noEmit` clean. The whole-population `residual-gate`
  re-run did NOT complete in this session; the lane's own enumerator (the arbiter's own rule) is
  the artifact, and the gate re-run is the next thing to run rather than a number claimed unrun.
  **And the criterion-2 arbiter can now adjudicate the lane — it previously REFUSED.**
  `ontology-coverage-gate.ts yaml` printed `no RULING SOURCE for yaml … Refusing to report`, because
  (a) its `rulingFor` reads `design_decision.decisions[].resolution` and YAML-D9..D12 never carried
  one, and (b) yaml is a key-bearing language with no space attestation. Both fixed LANE-SIDE:
  YAML-D10/D11 gained a `resolution`, and a new `validation/m14/fixtures/yaml/ruling-attestation.json`
  attests `node-types + block-types + attribute-keys` (18,368 distinct attribute keys over 296,009
  sites) against the verified artefact `ontology-census.json`. On a COMPLETE walk the two
  grammar-absence types read **`RULED-SOUND`** (proven on ansible, 2,082/2,082); over the whole
  population (`18,354/18,364`) the verdict is `8/10 emitted · FALSIFIED 0 · ruled-unknown 2`, and the
  ONLY reason is a **SHARED defect** — 10 files come back DEGRADED with `[BB-PARSE-ERR] memory access
  out of bounds` at the gate's `concurrency: 8` walk (`script/m14/ontology-coverage-gate.ts:661`),
  which makes the walk PARTIAL so the gate withholds the ABSENCE certification. Those files parse
  clean in isolation through the same production path, and the incoming gate parsed all 18,364 with 0
  failures — so it is the shared walk, not the corpus. **This bounds EVERY lane's certification, not
  just yaml's**: any lane whose walk hits the same WASM trap gets `RULED-UNKNOWN` for a genuinely
  absent type, and the fix belongs in the walk's parser/concurrency, not in the lanes.
- **yaml — ROUND 10: the `extQ` ruling's own falsifier was made to NAME its edges, and it found the
  LAST fixable one (2026-10-10).** *(SUPERSEDED by the ROUND 11/12 bullet below — the residual moved
  185 → 184 and `extQ` 254 → 253, and the "no current number comes from a round-old tree" claim is
  corrected there.)* The ext-Q class carried a `claimable` column from Round 5 — "would a
  file claim on this target have been VERIFIED?" — and it read **1** at every revision. A count is a
  lead, not a ruling, so the column was changed to print each such edge with its emitting file
  (`CLAIMABLE EDGES`) and it named exactly one edge in the whole 18,364-file population:
  `steps[].uses: ./.github/workflows/test-failure-notification.yml @
  nomad/.github/workflows/test-scheduler-prop.yml:45` — GitHub's **step-level reusable-workflow call**,
  a file the project HAS (it declares `on: workflow_call`), which `actionUseClaim` asked for an action
  manifest (`<file>/action.yml`, which cannot exist inside a file) and therefore called
  `isExternal: true`. **The Round-5 defect class in the one spelling that fix did not cover.** Fixed in
  `actionUseClaim` with the lane's two existing evidence gates — the spelling must be an admitted
  spelling (`.yaml`/`.yml`, the arbiter's whole evidence base) AND `statSync` must find the candidate —
  so the change can only ADD a verifiable claim. Four new arms in `include-claim-control.ts` (§8), three
  of them negative (absent file → `isExternal`; `./dir` → still the MANIFEST; a carried non-`.ya?ml`
  file → still no claim); **falsifier run: reverting the three lines turns 4 assertions red, exit 3.**
  MEASURED whole-population: **`extQ` 255 → 254 · `extOK` 10,616 → 10,617 · edges 1,414,582 and residual
  185 UNCHANGED · `extFAIL`/`bindFAIL`/`causeFAIL` 0 · 0 · 0 · CLAIMABLE EDGES now NONE** ("every ext-Q
  edge in this population is unverifiable by every spelling a file claim could use") — i.e. no claim the
  project could check is left unclaimed. Fixtures 33/0 · FOUR controls exit 0 · **24/24 yaml mutants
  caught** · `tsc --noEmit` clean. **Two of this document's own numbers were wrong and are corrected
  here, not dropped:** the `claimable` flag was attributed to `./.github/codeql/queries` (a guess read
  off the group's 3 samples — the flag lives on the `11 imports yaml_action_use shape=path-like
  claim=owner` row, whose samples are `./security-scanner`, a path an earlier step checks out at run
  time), and the round-9 totals were cited to the round-7 artifact, which reads 1,414,637 / 282. Both
  corrections carry the artifact that refutes the old reading. **BOTH whole-population instruments were
  then re-run on the frozen tree, and they agree to the edge: `incoming-gate.ts yaml yaml,yml 0` reads
  `FAIL — 138 ambiguous + 47 unresolved of 1414582 edges …; 254 external claim(s) unverifiable
  (10617 verified + 254)` with separator tripwire 0 and `instrument self-test: PASS`, and
  `residual-gate.ts --lane yaml` reads `TOTAL 1,414,582 · resolved 1,403,526 · ofWhich 4 · amb(decl)
  138 · unresolved 47 · residual 185 · extFAIL 0 · bindFAIL 0 · causeFAIL 0`.** The gate's `extFAIL 0`
  is the test the fix had to pass (it converts an `isExternal` claim into a FILE claim, and a file
  claim that misses is REFUTED), and both committed "after" artifacts were rotated to these runs, so no
  "current" number in `yaml.md` comes from a round-old tree. **Still NOT claimed: a PASS** — clause 1
  is short by 185 (138 amb + 47 unresolved) and clause 2 by 254 if unverifiability is forbidden.
- **yaml — ROUND 11/12: the one SAME-DIRECTORY MISS the falsifier proved was FIXED by a cross-file
  resource index, PRICED before it was applied and MEASURED on the whole population (2026-10-11).**
  The Round 7 falsifier's single FALSIFIED edge — `serviceAccountName: apiserver` in
  `staging/src/k8s.io/sample-apiserver/artifacts/example/deployment.yaml`, with `…/artifacts/example/sa.yaml`
  declaring `kind: ServiceAccount` + `name: apiserver` in the SAME directory — was a real missed
  resolution, not a ruling, so the rule it implied was PRICED by the falsifier's own output BEFORE it
  was applied: **CEILING 1** ambiguous edge a same-directory, same-kind rule can reach · **CONTROL 0**
  in a directory declaring that kind+name TWICE · **CONTROL 117** MORE that a PROJECT-WIDE version
  would bind, every one REFUSED (another manifest set is another cluster). Clean control, so
  `resolveSameDirectoryResource` was applied as the third fallback in `resolveSiblingReferences`: a
  `yaml_resource_ref` whose referring KEY maps to a KIND (`KIND_FOR_RESOURCE_KEY`, ONE source of truth
  the falsifier imports so application cannot drift from pricing) resolves against a sibling
  `.yaml`/`.yml` in the referring file's own directory declaring `kind: <K>` and a top-level
  `metadata.name: <target>`, targeting that sibling's DOCUMENT IDENTITY; it refuses rather than guesses
  (project root required; a SECOND matching sibling → null). **THE MEASURED PAYOFF — the number the
  request asked for: the rule converts 1 ambiguous edge** (`amb(decl)` 138 → **137**, residual 185 →
  **184**). **Its real reach is 22 edges, not 1** — it ALSO re-claimed **20** references that were
  passing as VERIFIED EXTERNAL CLAIMS and **1** as unverifiable, every one a reference to an object the
  same directory declares, so the old claim was simply false (`extOK` 10,617 → **10,597**, `ext?` 254 →
  **253**, `references` resolved 19,053 → **19,075**). The falsifier now reads `RULING HOLDS on this
  population` — **0 falsified, CEILING 0** — and the rule is falsifiable in BOTH directions by
  `same-directory-referent-control.ts` (**10 assertions ALL PASS**: same-directory RESOLVES to `a.sa`;
  a same-kind name in ANOTHER directory does NOT bind — the 117's shape; a WRONG kind in the same
  directory does NOT bind; TWO matching siblings REFUSE; an in-file declaration still resolves). The
  TEXT read the synchronous analyzer is forced to use was then MEASURED rather than defended:
  `same-directory-candidate-set-probe.ts` finds **3,124 of 3,124 candidate sets IDENTICAL to a parse's,
  0 misses, 0 extras** — a synchronous parser accessor would buy nothing (§5v). **The current numbers,
  three instruments agreeing:** the four-clause gate (`residual-yaml-whole-corpus-after.txt`) reads
  `TOTAL 1,414,582 · resolved 1,403,548 · ofWhich 4 · amb 137 · unresolved 47 · residual 184 ·
  extFAIL 0 · bindFAIL 0 · causeFAIL 0` — **re-run UNCHANGED at HEAD `bd2335f52`**
  (`residual-yaml-whole-corpus-round13.txt`), the only later shared change being the gate's worklist
  PRINTER, which touches no count; that run also prints a POPULATION caveat — **141 content-bearing
  files returned nothing**, so its counts describe evidence MISSING rather than evidence wrong, and the
  184 is a residual of the population AS PARSED (the 141 stated as an open item, not folded in);
  the enumerator (`census-yaml-whole-corpus-after.txt`) reads
  `amb 130 + 7 · extOK 10,597 · ext? 253 · extFAIL 0 · CLAIMABLE EDGES NONE`; the falsifier reads
  `137 ambiguous`. **And the ext-Q URI row is now PRICED instead of guessed, correcting a wrong
  ground:** `pubspec-package-price.ts` measures the 86 `package:`/`dart:` includes against the
  corpus's own pubspec packages (the arbiter's own `verifyImportClaim`) — **83 would move `ext?` →
  `extOK`, 3 would REFUTE** (`package:flutter_lints/flutter.yaml` in `flutter-packages`, whose
  `flutter_lints` package that repo DECLARES). The doc's old reason for deferring ("`package:lints` IS
  declared") was WRONG — **0** pubspecs declare `lints`. NOT wired: the 3 refutations are TRUE and a
  per-file analyzer has no pub-resolution channel to resolve the include to its in-repo file.
  Fixtures 33/0 · FIVE controls exit 0 · **24/24 yaml mutants caught, 0 survived** ·
  `tsc --noEmit` clean. **Still NOT claimed: a PASS** — clause 1 is short by **184** (137 amb + 47
  unresolved) and clause 2 by **253** if unverifiability is forbidden; §7's five criteria remain MET.
- **yaml — ROUND 14: the `./security-scanner` class was a DEFECT, not a ruling — a local `uses:`
  re-routed to what the RUNNER materializes, PRICED from the text first and MEASURED whole-population
  (2026-10-11).** The RULED CLASS's 10 `imports yaml_action_use` edges whose target is a `./…` path
  the repository does not contain were not naming an external action at all: each is a path a PRIOR
  STEP OF THE SAME JOB creates — `actions/checkout@<sha>` with `with: {repository: R, path: D, ref: F}`
  and then `uses: ./D`. §5v says a site making an unsupportable claim is a FIX, and the referent IS
  supportable (`R@F` is a `remoteRef` the arbiter VERIFIES). PRICED BEFORE THE EDIT, by a line oracle
  that never imports the analyzer (`materialized-action-price.ts`, verdict = the SHARED
  `verifyRemoteRefClaim`): **523** local `uses: ./…` sites over the whole admitted corpus, **10**
  matched to a prior same-job checkout, **9 convertible — 7 `./security-scanner` →
  `hashicorp/security-scanner@main` (boundary, consul ×4, nomad, vault) and 2 nimony
  `./ci-actions/.github/actions/setup` → the project's OWN `.github/actions/setup/action.yml`** (a
  checkout WITHOUT `repository:` materializes the CALLING repo, and nimony's own comment says so) —
  and **1 left unverifiable honestly**: waypoint's `./integration-release-action`, whose checkout pins
  **no `ref:`**, and the shared rule refuses a ref-less remoteRef. The refusals are half the rule and
  the rest of the control: ONLY EARLIER STEPS (runner order), ONLY THE SAME JOB (another job is another
  machine), ONLY `actions/checkout@…`, ONLY `./…`, and a MATERIALIZED repo WINS over an in-repo
  `action.yml` of the same name because the checkout REPLACES that directory at run time; a subpath of
  a NAMED repo, a `../` target and an exact match on the calling repo are **0 corpus sites each** and
  are stated as refusals rather than implemented unmeasured. **MEASURED, both runs at the same working
  tree (HEAD `27062400f`), 18,364 files · 189 repos · 0 failed · 0 degraded:** before `TOTAL 1,414,582 · resolved 1,403,548 ·
  ofWhich 4 · amb 137 · unresolved 47 · extOK 10,597 · ext? 253 · extFAIL 0`; after `… · extOK 10,606 ·
  ext? 244 · extFAIL 0 · bindFAIL 0 · causeFAIL 0` — the Δ is the price EDGE FOR EDGE (`imports`
  `extOK` 8,148 → 8,157, `imports` `ext?` 210 → 201), the enumerator agrees (`EXT-Q INVENTORY 244`,
  `CLAIMABLE EDGES NONE`, path-like group 10 → 3), and a repo-scoped draw over the six affected repos
  reads `ext? 1 · extFAIL 0`, and the four-clause instrument (`residual-gate.ts --lane yaml`) re-run
  reads `resolved 1,403,548 (99.2%) · ofWhich 4 · amb(decl) 137 · unresolved 47 · extOK 10,606 ·
  ext? 244 · residual 184 · extFAIL 0 · bindFAIL 0 · causeFAIL 0`, every type `CLOSED`, exit 0 — three
  instruments, one revision. **The shared instruments were re-measured FIRST:** four commits (+312
  lines) landed on `incoming-gate.ts`/`incoming-rule.ts` since Round 13, and the pre-fix whole-population
  walk reads IDENTICAL to the edge (137 / 47 / 253 / 10,597), so the Δ belongs to this lane. **Falsifiable
  both ways:** `materialized-action-control.ts` (10 crafted arms × 3 assertions, production path) exits
  0 — re-route, five refusals, key order (`with:` before `uses:`), the calling-repo file claim, and the
  PRECEDENCE with its falsifier (without the checkout the in-repo manifest is claimed again);
  `yaml/materialized-action` fixture PASSES (the first fixture in the lane to pin a re-route this way);
  `yaml/materialized-action-reverted` is **CAUGHT** by it; fixtures **34/0**; **SEVEN controls exit 0**;
  **25/25 yaml mutants caught, 0 survived**; `tsc --noEmit` clean. The population caveat travels: **141
  content-bearing files returned nothing**, so 244 describes the population AS PARSED, stated as an open
  item. **Still NOT claimed: a PASS** — clause 1 is short by **184** (137 amb + 47 unresolved) and
  clause 2 by **244** if unverifiability is forbidden; §7's five criteria remain MET.
- **yaml — ROUND 15: `$` was being read as a GitHub OWNER; and the completion package's LAST open
  item, clause 4's STORE-side split, is measured (2026-10-11).** A step-level `uses:` that is not
  `docker://` and does not begin `./`/`../` fell to `actionUseClaim`'s last line,
  `return { remoteRef: true }` — so `uses: $/.github/actions/go-cache-restore` claimed an external
  remote action under OWNER `$`. `$` is not an owner and the target is a path in the checked-out
  tree: over the whole admitted population the `$/` spelling occurs in exactly **18** `uses:` sites
  (all terragrunt: 15 × `go-cache-restore`, 3 × `go-cache-save`) and
  `terragrunt/.github/actions/go-cache-{restore,save}/action.yml` are FILES THE PROJECT CARRIES. A
  FIX per §5v, and unconditional: a leading `$/` is rewritten to `./` where the site is captured, so
  the target, the claim, the `addImport` external flag and the materialization check all agree, while
  the written text travels in `metadata.actionSpelling`; a `$/…` action with no manifest in the
  project still falls back to the pre-existing `isExternal: true`, so the change can only CONVERT an
  unsupportable remote claim into a local one. **MEASURED, whole admitted population: `extOK 10,606 →
  10,624`, `ext? 244 → 226`**, with `amb(decl) 137`, `unresolved 47`, `extFAIL 0` and the clause-1
  residual **unchanged at 184**. Falsifiable both ways: `root-anchored-action-control.ts` (25
  assertions, exit 0) pins the rewrite with `action.yml` AND `action.yaml`, the no-manifest refusal
  (no fabricated claim, no invented remote ref), a non-workflow file keeping its `unverified` role, a
  job-level `$/` staying a `calls` edge, and the BOUNDARY — an ordinary external action keeps
  `remoteRef` with no spelling recorded, a target that only CONTAINS `$/` is untouched, `../` is
  untouched — with the falsifier arm asserting the re-routed edge and a real remote action disagree on
  BOTH keys; fixture `yaml/root-anchored-action` (forbids both raw targets) PASSES;
  `yaml/root-anchored-action-reverted` is **CAUGHT**; fixtures **35/0**;
  **EIGHT controls exit 0**; **26/26 yaml mutants caught, 0 survived**; `tsc --noEmit` clean. **Clause 4's store-side split, previously NOT done:** a real store per repository through the PRODUCTION indexer
  (`store-intent-split.mts`) reads `contains` **13,162 rows · 13,160 intended (own file, edge's own
  line) · 0 sameFileOffLine · 0 arbitraryTwin · 0 collision rows · 2 unbound**, `imports 395`,
  `references 247`, `calls 40` — determinism holds STORE-side as well as model-side. And the store
  itself is NOT faithful, both findings counted and reported-not-fixed: **5,198 duplicate rows** over
  **7,964 distinct pairs** (boundary `.github/workflows/build.yml` alone is **637 rows over 381
  pairs**; `consul/.github/workflows/go-tests.yml` **725 / 392**) — the same
  `(source_symbol_id, target_symbol_id)` pair stored under two row ids in the same millisecond, one
  naming the node by its LEAF and one by its qualified path — and **67 distinct pairs LOST**
  (`7,964` against the model's `8,031` = 0.83 %), the pre-existing re-store loss reported since
  Round 9. Arithmetic closes: `8,188 − 157 = 8,031`; `8,031 − 7,964 = 67`; `7,964 + 5,198 = 13,162`.
  **A phantom the first run of that instrument produced, kept because the correction is the finding:**
  it reported a `-10,964 STORE LOSS` that was entirely its OWN population — it parsed files
  production's discovery REFUSES, so `ui/pnpm-lock.yaml` read `model 15,785 · store 0` (the indexer
  never wrote a `brain_file` row for it). The instrument now applies production's OWN admission and
  REPORTS the refusals instead of dropping them silently. **That exposed a population-scope item left
  OPEN:** production's built-in `skipPatterns` refuse **53 of 18,364 admitted yaml files (0.29 %)**
  that the gate's and this lane's admission keeps — but those files carry **101,658 `contains` edges,
  ~7.4 % of the lane's 1,380,046**, essentially all `pnpm-lock.yaml` (vault 17,151 · consul 15,785 ·
  nomad 15,292 · gql-graphql-eslint 14,974 · element-plus 13,470 · shadcn-svelte 9,993 · vue-core
  5,610 · svelte 4,424).  So the lane's figures describe a population ~7.4 % LARGER in `contains` edges
  than the graph the product can build. **THE ALIGNED RUN WAS THEN MADE, AND IT REVERSED THE
  RECOMMENDATION** (`lane-residual-census.ts` with `BB_CENSUS_PRODUCTION_ADMISSION=1`, artifact
  `census-yaml-whole-corpus-round15-production-admission.txt`): **18,311 files · 188 repos ·
  `TOTAL` 1,312,693 · `resolved` 1,301,689 · `amb 137` · `unresolved 47` · `extOK` 10,592 · `ext?` 225 ·
  `extFAIL` 0 → 3.** The −101,889 edges and the −32 `extOK` (exactly the 28 `imports` + 4 `overrides`
  that lived in refused files) are the lockfiles; **the 3 are the finding**: `extFAIL` stops being 0
  because ONE target in ONE repository is refused — `3 imports "./.github/actions/build/ci"
  claim=projectFile`, candidates `.github/actions/build/ci/action.yml`, from powershell's
  `linux-ci.yml`/`macos-ci.yml`/`windows-ci.yml`. **That file EXISTS and is hand-written**
  (`name: CI Build`, composite) and production refuses it because its skip list holds `/\/build\//` and
  the directory is named `build` — the same false-positive class as `redis/deps/jemalloc/.travis.yml`
  (`/\/deps\//`). So production's admitted list omits files the project demonstrably carries, and
  since a FILE-claim MISS REFUTES, `extFAIL` becomes a function of the IGNORE LIST, not the analyzer.
  **Recommendation reversed and the prerequisite named:** do NOT align this lane's population until
  that false-positive class is fixed, because alignment would move three PROVABLE claims from `extOK`
  to `extFAIL` — a lane cannot buy a cleaner denominator by manufacturing a refutation. The product
  consequence is stated too: the graph is missing a real action node three workflows depend on.
  **Still NOT claimed: a PASS** — `ext?` is **226**, not 0; clause 1 is short by **184** (137 amb + 47
  unresolved) and clause 2 by **226** if unverifiability is forbidden; §7's five criteria remain MET,
  and the board's incoming columns are still left stale (`--board-log` overwrites the WHOLE shared
  log).
- **yaml — ROUND 18: the row ROUND 15 named "NOT implemented" is now priced and LANDED — the
  marker-name guard, `ext?` 226 → 223.** The 3 `references yaml_depends_on` edges whose target is the
  kube-api-linter MARKER `k8s:optional` (a Go-comment annotation `+k8s:optional`, published as a
  symbol by no analyzer in any lane — so the claim was structurally unverifiable) are refused by a
  VOCABULARY-FREE shape rule: a colon-bearing, template-free value at a dependency position names no
  member any of the four loaders admits. **Priced before a line changed, over every one of the 1,895
  `yaml_depends_on` targets counted UNTRUNCATED** (`.tmp-probe/yaml-depends-position-r16.txt`):
  **1,892 colon-free · 3 `k8s:optional` · 0 collateral**, all three under `dependenttags.rules[]` in
  kubernetes' `hack/golangci{,-hints}.yaml` + `hack/kube-api-linter/kube-api-linter.yaml`. The
  `{{` exclusion keeps template values (`${{ parameters.dependsOn }}` ×17) as RULED external claims;
  the lookup-first variant was measured equivalent (`k8s:optional` is a KEY in 0 of the 3 files) and
  shape-first chosen for walk-order independence. **MEASURED, whole admitted population:** `TOTAL`
  1,414,582 → **1,414,579** · `references` 21,417 → **21,414** · `ext?` 226 → **223** · `extOK`
  10,624 unchanged · `amb 137` · `unresolved 47` · residual **184 unchanged** (the class was never in
  the residual) · `extFAIL 0`; artifact `census-yaml-whole-corpus-round18.txt`. Evidence: fixture
  `yaml/dependency-marker-name` PASSES and the suite reads **36/0**;
  `dependency-marker-name-control.ts` — 3 REAL corpus files + 5 crafted arms through the production
  path, **20 assertions, exit 0**, including the falsifier (the predicate refuses `k8s:optional`,
  keeps the template spelling and bare names) and the symbol-still-published arm; **28/28 yaml
  mutants caught**, both new ones by the new fixture (`dependency-marker-guard-removed`, a
  disclosed-divergence revert in the `volumeSourceScannedAsNames` tradition, and
  `dependency-marker-guard-overfires`, the `{{` exclusion deleted); `tsc --noEmit` clean. Also
  adjudicated with NO change: the last path-like row (`../../analysis_options.yaml` in riverpod) — the
  target is carried by neither `git ls-files` nor the disk, so `ext?` is the correct disposition
  (refuting would blame the reference for the checkout's gap). **SHARED defect found by the re-run:**
  the whole-population `incoming-gate` DIED `GATE_EXIT=134` — `JavaScript heap out of memory` — at
  the default node heap while building a repo's DART index (33,739 files); re-launched with
  `--max-old-space-size=4608` (`.tmp-probe/yaml-gate-r16.txt`, in flight), the lane's own two
  instruments complete at the default heap because they walk one language. The four-clause gate
  CONFIRMS at the same revision (`residual-yaml-whole-corpus-round18.txt`, rotated into `-after`):
  `TOTAL 1,414,579 · residual 184 · ext? 223 · extFAIL 0 · bindFAIL 0 · causeFAIL 0`,
  `RESIDUAL_EXIT=0`. **AND ONE ATTRIBUTION IS CORRECTED (ROUND 17 §route's `−3`):** that section
  read the sharded-vs-walk `references` `−3` as an instrument call-shape effect (missing
  `ProjectIndex`); the census moves 21,417 → 21,414 on ONE call shape (no index) across this round's
  guard, while the gate WITH an index read 21,417 pre-guard — so the index moves ZERO edges and the
  whole `−3` is the guard. All completed routes now read 21,414/1,414,579 to the digit; ROUND 17's
  depth-degradation finding itself is untouched. **Still NOT claimed: a
  PASS** — `ext?` is **223**, not 0; clause 1 is short by **184**; §7's five criteria remain MET.
- Zero regexes: **yes** (18 → 0; laptop A's handoff records they have not matched this).
