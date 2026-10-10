# Relationship-ontology programme — verified progress

**Branch:** `analyzers/relationship-ontology` · **Contract:** `ONTOLOGY-WORKSTREAM.md`

Every number below was **re-derived from the analyzer source and the engine
enum** on each lane's own branch, by `script/m14/verify-lane-claims.sh` and
`.tools/verify-fleet.sh`. Nothing an agent wrote about itself is trusted. A lane
is only called 10/10 if the source constructs all ten relationship types and the
module typechecks.

## Starting point

325 of 470 (analyzer × type) slots filled; 145 missing. 5 families already at
10/10. The `tier` label that governed this had no definition in `src/` and was
anti-correlated with measured quality.

## Batch 1 — verified results

| Lane | before | after | verdict | notes |
|---|---|---|---|---|
| Perl | 6/10 | **10/10** | VERIFIED | 8 further defects the four new labels exposed; mutant runner added |
| Elixir | 5/10 | **9/10** | VERIFIED | 4 gaps closed, `extends` ruled with a measurement, DERIVATION cleared |
| Clojure | 7/10 | **10/10** | VERIFIED | the `overrides` ruling was **falsified and overturned** |
| C++ | 7/10 | 9/10 | VERIFIED | ten verdicts, two new types, five measured defects |
| Java | 9/10 | **10/10** | VERIFIED | doc stopped claiming an unsettled latency |
| Kotlin | 8/10 | **10/10** | VERIFIED | measured +6.0% wall for +9.1% edges, ratio 1.167× |
| Scala | 8/10 | **10/10** | VERIFIED | two gaps closed + three R7 defects |
| Groovy | 8/10 | **10/10** | VERIFIED | R7: refuses empty-named declarations |
| C# | 8/10 | **10/10** | VERIFIED | one spelling per type; nested namespace no longer doubles its prefix |
| Rust | 8/10 | **10/10** | VERIFIED | caught its own census reporting 0 files per type, fixed before trusting it |
| Swift | 8/10 | **10/10** | VERIFIED | all ten types have a verdict with a number behind it |
| TypeScript | 10/10 | 10/10 | VERIFIED | already complete; **DERIVATION paid and the incoming declaration round closed 2026-10-09** — see the closure entry below |
| Go | 8/10 | 8/10 | landed | gaps remain — queued as `GO2` |
| Ruby | 8/10 | 8/10 | landed | probe measured `imports` at 12,133 occurrences — a real gap, not a ruling |
| Visual Basic | 7/10 | 7/10 | landed | instrument landed; analyzer untouched — queued as `VB2` |

All fifteen: typecheck clean, no retired false claim surviving in any lane doc.

## Where it stands now — 14 lanes at a verified 10/10

Re-derived from source on each lane's own branch after batch 2:

    TYPESCRIPT SWIFT SCALA RUST PYTHON PERL OBJECTIVE_C KOTLIN
    JAVA HASKELL GROOVY GO CSHARP CLOJURE

Since the table above, **Go closed both its gaps** (was 8/10, exports and
overrides) and **Python closed `implements`** (was 9/10). Elixir, C++ and
JavaScript sit at 9; Ruby and Erlang at 8; Visual Basic and C at 7.

Svelte 4, Vue 6 and HTML 2 are **delegation lanes** and these figures understate
them: each earns `calls` by running inline scripts through the real JS/TS
analyzers. HTML's honest native coverage is 2/10 — 3,016 calls across 400 corpus
files, every one from the delegate, none from HTML itself. The denominator that
matters for those lanes is applicable coverage, not a flat 10.

## What the agents found that the counts do not show

- A **census that reported 0 files for every type** (Rust) — a green-looking
  measurement that was measuring nothing.
- An **`overrides` ruling that was falsified** (Clojure) — the ontology gate's
  founding premise, working: absence is not acceptable without a measurement.
- **R7 placeholder-literal defects** (Groovy, Scala, Java: 4 registered sites).
- A **doc claiming a latency that was never settled** (Java).
- A **payload regression quantified rather than assumed** (Kotlin).

## Batch 2 — queued (18 deep)

Two kinds of work, because a lane at 10/10 is not the same as a verified lane:

1. **Close the remainder.** `GO2` (exports, overrides), `RUBY2` (exports,
   imports — 12,133 measured occurrences), `VB2` (exports, instantiates, uses),
   `CPP2` (implements).
2. **DERIVATION paydown.** TypeScript emitted `exports`, `imports`, `references`
   and `uses` that **no oracle audits**. So do several other lanes. An edge that
   is stored and compared against nothing ships a bug invisibly — a worse
   failure than a missing type, because nothing goes red. `DERIV_*` lanes make
   the differential audit each emitted type and report
   missing/unexplained/fabricated per type.

   **TypeScript's share is PAID (2026-10-09).** The differential now admits all
   ten for the lane (`calls contains exports extends implements imports
   instantiates overrides references uses`), and the measurements are:

   | check | command | result |
   |---|---|---|
   | firing (production `parseFile`) | `bun script/m14/firing-check-v2.mjs TYPESCRIPT` | **10/10**, 200/200 parsed, every type fired, `imports[]` 704 in 195 files |
   | relationship-type coverage | `bun script/m60/rel-type-coverage-gate.ts --langs=typescript` | **exit 0**, four checks clean, 0 NEW, 5 repaid; emits 10/10, audits 10/10, 0 lane findings |
   | oracle audit (rxjs, 60 files) | `bun script/m14/ts-deriv-oracle-audit.ts --files 60 --repo rxjs` | all ten labels measured; `imports` 501/501 and `exports` 61/61 at **100%**, `calls` 563/563, `contains` 376/376; `references` 83.1% and `uses` 64.8% with every disagreement family triaged |

   The canonical ledger `validation/m60/results/rel-type-coverage.json` was
   regenerated by the gate's own full run and now records typescript emitting and
   auditing all ten with **0 findings**. That fleet run still exits 1 on 91 NEW
   findings in **other** lanes' allowlists (against a recorded debt of 104, 69
   repaid) — pre-existing, listed here so the ledger refresh is not read as a
   clean fleet.

## TypeScript — the incoming declaration round, closed (2026-10-09)

The outgoing side was already complete; this closes the **incoming** side as a
declaration rather than a percentage.

`script/m14/ts-incoming-gate.ts` arbiter: **exit 0, PASS**, 771/771 parsed, 0
degraded, 84,111 edges, and the declaration is
`validation/m14/instruments/typescript/incoming-baseline.json` — **37 classes, each
with a kind, a sentence and a ceiling** (20 nonzero + 17 zero-locks). An edge
resolves when the pool publishes ONE declaration AND the edge's own file can name
it, by one of four rules, each printed per run: `leaf-unique 21,270` ·
`qualified-endpoint 4,201` · `lexical-local 796` · `lexical-import 166`. The three
scope rules added **3,189** bindings measured before the change (union, with 17
member-shape traps excluded by a guard that is a negative control in the
gate's self-test).

**The honest sentence, because the numbers are not all green:** of 84,111 edges,
**31.4% bind to exactly one declaring file and 52.0% bind or carry a declared
external reason**. The rest is declared and ratcheted: **28,417 ambiguous** (27,386
of them `calls` — a member call's receiver is a local variable the edge does not
name; the lever is carrying the receiver, an ontology decision), **4,626 by-design
module URIs** (`imports`, `<module>:<name>` is not a symbol), **7,335 not provable
from a single file** (test-runner globals, type parameters, member calls on local
variables). "All ten types covered" is TRUE and measured; "all edges resolve" is
NOT what this says, and the gate prints the backlog on every run rather than
letting a percentage stand alone. The failure path was exercised end to end (a
tightened baseline copy → exit 1 with `OVER CEILING` and `UNDECLARED CLASS`), and
`--update-baseline` is idempotent.

**The arbiter (2026-10-10) — and the population its verdict actually covers.**
`npx tsx script/m14/ontology-coverage-gate.ts typescript` used to exit 2 with "no
RULING SOURCE": `rulingFor()` had nothing to read because the lane has **no
un-emitted type to rule**, and a guard written for an empty ruling table fired on
that absence. The guard now separates the two cases — a lane with un-emitted types
and no ruling source still refuses — and says which verdict it gives: *"typescript
has no ruling TABLE and needs none on THIS walk — all 10 types are EMITTED … this
run adjudicates EMISSION, not rulings."* A ruling table is the lane's own corpus
probe; TS needs none, and the emission claim is carried by the firing check and the
m60 coverage gate, both of which measure it directly.

The pass that produced the verdict: walk **10,328/10,328 (100.0%)** — **2,167 files
parsed, 8,161 resumed** from the checkpoint — and the counts were over the 2,167 it
parsed: `emitted 10/10   FALSIFIED 0   ruled-without-justification 0`, exit 0.
**Both numbers belong in the sentence.** The walk's 100% is what the CHECKPOINT has
covered across runs; the emission table is a count over the files that pass itself
parsed. Three later passes that tried to re-walk every file in one process each died
mid-walk (exit 1, engine.ts's 120s hang guard) after ~4 minutes, so the 10,328-file
corpus **cannot be parsed in a single process** — the tree-sitter WASM module traps
after a few thousand parses. A whole-corpus emission verdict therefore needs the
per-file counts carried in the checkpoint across batched runs: recorded as open
work, not claimed as done.

Two changes make the wrong version of that sentence impossible rather than merely
discouraged: the walk line now prints *"the edge counts below are a count over the
N file(s) THIS run parsed"*, and a run that parsed **zero** files refuses to report
at all (`NOTHING MEASURED … exit 2`). Measured before the guard: with the checkpoint
complete, a fully resumed run printed `emitted 0/10   ruled-without-justification
9` on a walk line reading 100.0% — a lane at 10/10 filed as nine unjustified
rulings, because not one file was looked at. Verified after: an empty corpus root
exits 2 with `NOTHING MEASURED`.

**The walk reaching the checkpoint's 100% is itself a repair.** It had been stuck at
**4,230** files for two days. A tree-sitter WASM trap (`memory access out of bounds`
on a 32-line file that parses clean in isolation, 1.2 s, 16 relationships) corrupts
the module, the next parse hangs, and engine.ts's 120s guard answers a hang with
`process.exit()` — which can flush nothing. The checkpoint recorded a file only AFTER
its parse succeeded, so the file that killed the run was never recorded and every
re-run resumed into the same death. `script/m14/resumable-walk.ts` now writes an
**in-flight marker before** each parse, so a kill names the file it died on and the
next run abandons it instead of re-dying on it (cost, stated: up to `concurrency`
in-flight files per kill, all reported as `ABANDONED-AFTER-KILL`).
`script/m14/resumable-walk-selftest.ts` drives that path with a real child-process
kill — 7/7 checks.

## Java — the incoming declaration round, opened (2026-10-10)

Java had the measurement and not the contract: `incoming-gate.ts java java 200 --json`
exits 1 on the fleet's bar forever, and nothing per-type ratcheted, so the backlog
could grow silently. `script/m14/java-incoming-gate.ts` now does the ratchet — and
does **not** re-measure Java with a second instrument: it shells out to the same
`incoming-gate.ts` and declares THAT measurement, per type, in
`validation/m14/instruments/java/incoming-declaration.json` (200/200 parsed, 0
degraded, **26,389 edges**, `qualifiedNameAliases 3,040` — measured in a clean
worktree, see the guard below).

Five classes per type, a total partition whose identity the gate CHECKS:
`edges = resolved + ambiguous + otherUnresolved + external + unclassed`.
**resolved 5,322** and **external 3,283** are FLOORS; **ambiguous 5,156** and
**otherUnresolved 12,628** are CEILINGS; **unclassed 0** is an exact bound. The
first version of the gate derived `otherUnresolved = unresolved − external`,
assuming the marker was counted inside `unresolved`; the instrument increments the
two in mutually exclusive branches, and the assumption printed
**`implements otherUnresolved −10`** on the first full run. `unclassed` exists so
that impossible arithmetic cannot pass as a clean measurement — a `≤ 0` ceiling
would have accepted −1, because the first version of the check treated it as a
ceiling; the bound is equality, and 0 is the only admissible value.

Two measured moves came first, deliberately separated: the external marker reclassifies
3,283 edges as DECLARED EXCEPTIONS with zero edge churn; publishing each symbol's
file-scoped `qualifiedName` adds the alias key the pool was missing and **resolves
103 edges that were counted unresolved** (`imports +10`, `references +87`,
`implements +1`, `overrides +1`, `instantiates +4`) with `ambiguous` unmoved at
every type. The declaration is bound to the analyzer digest
(`sha256:2a275b904319f6ba`): a changed analyzer fails until re-declared on purpose.

A third move was a FIX, not a reclassification: the bare-read block sourced at
the enclosing TYPE while the dotted read beside it in the same body was
METHOD-sourced — the M49 W15 #814 owner ruling, the fixture pair and the mutation
battery all said method, and the block's "this lane's truth expects" comment was
unsupported (the java `uses` oracle wildcards the source as `(expr)`). Fixed:
**+301 `uses` edges, +169 resolved, +132 ambiguous, `otherUnresolved` UNCHANGED**.
The mutant `java/bare-read-type-attribution` had SURVIVED because mutant and live
code were the same shape; it is now caught, F4 is down to 15 survivors with ZERO
Java survivors, and F3's java row moved 52/63 → **53/63**.

The build produced one more lesson worth its paragraph: the first declaration
shipped `overrides 495`, and a clean checkout of the SAME commit measures 488 —
seven edges of another lane's uncommitted pool-worker/import-resolution work in a
shared tree, which would have read as a Java regression forever. The gate now
REFUSES (exit 3, naming the files) when `src/ast` is dirty: the declared numbers
come from pool-worker parsing and move without moving the analyzer digest, so a
dirty tree is not ratifiable. `--allow-dirty` exists for inspecting in-flight
work and says the numbers are not attributable to a commit.

**The honest sentence:** Java's declaration gate reads **PASS** and the fleet
gate still reads **FAIL** (5,156 ambiguous + 12,628 unresolved of 26,389). PASS
means every class is declared, no floor lost, no ceiling raised — not that the
ceilings are small. Six planted failures are the gate's own control, and the
end-to-end control was run: `calls.ambiguous` 2,143 → 2,142 → **exit 1**,
`calls: ambiguous ceiling 2142 violated — measured 2143 (1 REGRESSED)`.

**Evidence and bookkeeping.** F3's artifact now records java at **53/63
fixtures**. Both F3 and F7 were fresh before this lane's two commits and stale
after them — this lane's to regenerate — and they were regenerated **in a clean
worktree at `e462a3797`** because the shared tree was carrying another lane's
uncommitted JavaScript work: a first attempt in the shared tree reported fixture
regressions (vue 5→7, svelte 9→10, html 1→4) that the clean checkout does **not**
reproduce (0 regressions there), which is the control showing those belong to the
other lane's working tree.

The fleet round that followed regenerated the rest of the freshness set the same
way — every producer in a clean worktree of the commit it stamps: **F1 45/45
languages**, **F2** (whose input set is all of `script/m14/`, so it re-stales on
any script edit and was regenerated twice), and **F9 52/52 probes**. F9 had been
release-blocked by two probes, and neither failure was an analyzer defect: both
asserted contracts the lanes had already deleted by ruling — php's 0.5
external-base override guess (M12.PHP-OVERRIDE-AUDIT: 66.7% false, below the 0.7
publish threshold, so the expectation INVERTS and publishing one now fails the
probe) and clean's `instantiates -> Just` on a snippet that IMPORTS Just (the
lane's in-file-by-construction rule refuses it by design; the repaired probe
declares its constructor and still discriminates HEAD from BODY). A stale probe is
repaired against its ruling, never silenced.

**F4 was regenerated too** (a clean worktree, 1,836 mutants, ~13 min): 1,821
caught and **15 survivors** — the set is stable, zero regressions, and the Java
lane's sixteenth survivor died with the bare-read fix above. The survivors that
remain are other lanes' uncaught mutants, reported rather than hidden.

Still red and **not fixable on this machine**: F5 and F8 need corpora this
checkout does not have (`grails-core`, `Exposed`, `vue-core` — F8's 16 failing
rows are literally `corpus missing: <repo>`, and regenerating here would replace
canonical evidence with local "corpus missing" rows).

## The JVM family — three more declarations from one gate (2026-10-10)

The Java gate is now PARAMETERIZED, not copied: `java-incoming-gate.ts <lang> <ext> [sample]`
(defaults `java java 200`), one instrument, four lanes. Groovy, kotlin and scala each measure
clean (200/200 parsed, 0 degraded, instrument self-test PASS) and each is a total partition —
`unclassed 0` and the classes summing to the edge count on all ten types, checked by the gate:

| lane | edges | resolved | external | ambiguous | otherUnresolved | qualified-name aliases | analyzer digest |
|---|---|---|---|---|---|---|---|
| groovy | 10,323 | 2,502 | 0 | 555 | 7,266 | 0 | `sha256:df84d8c9b6ca6868` |
| kotlin | 8,895 | 1,959 | 0 | 1,604 | 5,332 | 1,417 | `sha256:8e0eaa2f0e2d3e28` |
| scala | 9,628 | 2,736 | 0 | 2,084 | 4,808 | 0 | `sha256:1a9de99c23c1c024` |

`external 0` on every type in all three lanes is a STATE, not a verdict: the provable external
marker exists only in the Java analyzer today, so every unbound target in these lanes is backlog
by construction and the ceilings carry the whole population. Marking is future work with the
Java proof obligation attached. The kotlin lane's 1,417 aliases bind dotted targets where the
spelling reaches a published name (groovy and scala publish none, recorded in their `meta`).

Wrong-lane substitution is impossible by construction and by control: an unknown lane refuses
(**exit 2**, naming the known lanes), and a declaration whose `meta.lang` differs from the lane
being run refuses too (**exit 2**, naming both). The end-to-end ceiling control on kotlin:
`calls.ambiguous` 352 → 347 → **exit 1**, `calls: ambiguous ceiling 347 violated — measured 352
(5 REGRESSED)`. All four lanes pass their own gate on the final revision, measured in the clean
worktree at `ae064f086` (the shared tree carries another lane's uncommitted `src/ast` work, which
the gate's own dirty-tree guard refuses to ratify).

One repair to the Java declaration came with this: its census note carried the pre-rerun
figures (third-party 3,542/897; 5+ ambiguity 2,846). A fresh census run (equality control PASS)
measures **third-party 3,535/893** and **5+ declarations 2,871 over 83 names**, and the note was
regenerated to those. The regeneration diff against the committed declaration is exactly that
one line — types, rules and meta byte-identical — which is the proof the parameterization
changed no Java number.

## Four more lanes — python, rust, go and csharp (2026-10-10)

The parameterized gate now declares **eight lanes**. The four added here each measured clean
(200/200 parsed, 0 degraded, instrument self-test PASS) and each is a total partition —
`unclassed 0` and the classes summing to the edge count on all ten types:

| lane | corpus | edges | resolved | external | ambiguous | otherUnresolved | digest |
|---|---|---|---|---|---|---|---|
| python | 6,145 `.py` / 1 repo | 18,893 | 5,397 | 0 | 2,511 | 10,985 | `sha256:5c8235348c0db9c7` |
| rust | 110 `.rs` / 1 repo | 55,474 | 17,705 | 0 | 19,384 | 18,385 | `sha256:3202b93bf77f143f` |
| go | 11,803 `.go` / 1 repo | 13,579 | 3,958 | 0 | 1,348 | 8,273 | `sha256:ae062d1d4f936760` |
| csharp | 18,237 `.cs` / 1 repo | 20,438 | 4,915 | 0 | 1,225 | 14,298 | `sha256:b54175839b7cb0c8` |

Two controls and one no-op proof bound the increment. The existing four declarations
**regenerate byte-identical** under the final gate revision (a full re-measure of each, empty
diff). A C# ceiling-tighten control: `calls.ambiguous` 512 → 507 → **exit 1**,
`calls: ambiguous ceiling 507 violated — measured 512 (5 REGRESSED)`. And the four new lanes
were each generated and re-verified with a plain verdict run whose ten-type tables are
byte-identical across the two runs.

The build closed a victory-lap hole the four new lanes exposed: a lane whose corpus is absent
measures zero of everything, and a declaration of zeros would pass forever while ratcheting
nothing. The gate now refuses **exit 3** before `--update` can write anything, when
`population.parsed` or `corpusTotal` is 0 — proven with `java zzz` (a real corpus, an extension
nobody has): `FATAL: lane 'java' admitted no corpus (parsed 0, corpus 0) — UNMEASURED, not a
pass.`

Zeros got prose because a row of zeros reads like a gap and here three different facts produce
one. **python `implements`** is RULED, with the falsification written out in its canonical doc.
**go `overrides`** fires 78 times over the whole corpus but 0 times in this 200-file stride
sample. **csharp `imports`** is a CHANNEL fact: the analyzer carries import SITES on its own
`imports[]` channel (`ImportInfo[]` → the `brain_import` table, mirrored as `references` edges
marked `isImport:true`), and the instrument's `imports` row counts relationship-channel rows
only. Each declaration lists its zero-edge types, the note says what a zero can mean, and the
ratchet locks all three at 0 until a deliberate re-declaration moves them.

## Seven more lanes — and two swift defects the ratchet found (2026-10-10)

The declaration set is now **fifteen lanes**. Batch three added swift, ruby, elixir, haskell,
clojure, erlang and javascript; every row below is a total partition (`unclassed 0`, classes
summing to edges on all ten types) verified with a plain verdict run at the commit:

| lane | edges | resolved | external | ambiguous | otherUnresolved | digest |
|---|---|---|---|---|---|---|
| swift | 3,626 | 1,466 | 0 | 1,125 | 1,035 | `sha256:49f77d9e2258c039` |
| ruby | 15,002 | 2,185 | 0 | 367 | 12,450 | `sha256:b3d78b8b11d69cb7` |
| elixir | 30,289 | 16,434 | 0 | 9,483 | 4,372 | `sha256:1bb09da71efff52a` |
| haskell | 5,380 | 3,250 | 0 | 591 | 1,539 | `sha256:2afacd33c90a30a2` |
| clojure | 29,810 | 7,097 | 0 | 336 | 22,377 | `sha256:ac2abea4e8411e90` |
| erlang | 48,611 | 20,112 | **8** | 11,699 | 16,792 | `sha256:e4d82411c4d927ae` |
| javascript | 23,100 | 4,284 | 0 | 3,373 | 15,443 | `sha256:a5084bea0f3e1830` |

**Erlang is the first non-Java lane with a provable external marker** — 8 edges, all on
`imports`, each carrying a recorded reason; the floor now binds them (a marker that stops
working is a regression) and the computed note in its declaration says exactly that.

**Swift found two defects, and the ratchet's own rules refused both.**

*(1) An unexplained edge, and the gate now refuses them at all.* Swift's `contains` emitter
published one edge with an EMPTY target, from swift-corpus's recovered `let:Boolean` in the
crasher test `27700-swift-modulefile-loadallmembers.swift` (a nameless declaration the parser
recovers). The fleet instrument counts that edge in `edges` and skips it in every class
(`incoming-gate.ts`'s `if (tgt.length === 0) continue`), so it landed in `unclassed` — and
swift's first declaration LOCKED it and PASSED, because the check was equality: measured 1 ==
declared 1. The class rule says 0, always, and now the gate enforces its own prose: `--update`
refuses (exit 3, naming the type) to write any nonzero value, a declaration locking one fails
(exit 1 — proven against swift's first declaration before it was replaced), and the self-test
gained the self-consistent-but-locked case that equality alone would pass. The analyzer guards
the emission at the ownership loop (`if (_owner && s.name && …)`), probed end-to-end: the
empty-target count over the same 200-file sample went 1 → 0 and swift's declaration now closes
at `unclassed 0`. Fixtures unchanged by the fix: **17 pass / 4 fail**, the same four before and
after.

*(2) The `imports` emission is dead code, and it is RECORDED rather than papered over.* The
emission reads `imp.metadata.module`; `handleImport` pushes the module at the TOP level
(`imports.push({ module, isExternal, range })`), so no `imports` relationship has ever fired and
the module dependency travels only on `references` (measured: `imports` 0 edges against 200
files that certainly import). Four authored fixtures pin the intended contract and fail on this
analyzer — `swift/imports-exports`, `swift/scoped-import-metadata`, `swift/reexported-import`,
`swift/exports-visibility` — and they disagree with each other about the target: the ontology
follow-up demands the MODULE as the target with the spelled path in `metadata.moduleSpecifier`
and calls a dotted target the R10 failure, while `imports-exports` expects
`imports root -> Swift.Optional` (the dotted path) for a kind-restricted import. Repairing the
surface therefore starts by reconciling those two pins, which is a written ruling, not a
re-run: the zero is LOCKED in swift's declaration and the note names the four fixtures, so the
repair is a deliberate re-declaration and never a silent change.

## Still to do at integration

- Regenerate `website/src/data/brain-languages.ts` — its `emits` arrays are
  **derived**, and must follow the code, never lead it.
- Re-run `script/m60/rel-type-coverage-gate.ts` for the DERIVATION ledger.
  **Done 2026-10-09 for TypeScript**; the ledger shows typescript at 10/10 with 0
  findings, and the fleet run still fails on other lanes' 91 NEW findings against
  a recorded debt of 104 (69 repaid) — that baseline is theirs to refresh.
- Re-run the m14 grammar, mutation, differential and fixture gates per lane.
- Refresh F5 (differential) and F8 (corpus census) on a machine that holds the
  pinned corpora — F8's `corpus missing` rows are an environment property, not a
  measurement, and must not be overwritten locally.
