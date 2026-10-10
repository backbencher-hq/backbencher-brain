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

One arbiter note: `script/m14/ontology-coverage-gate.ts typescript` reports "no
RULING SOURCE" and exits 2 — not a TS gap but the gate's documented blind spot for
a lane with **no un-emitted type to rule**. Its `--coverage` mode says so itself:
"A lane with no RULING TABLE gets no verdict here at all, which is the same blind
spot wearing a different hat." The emission claim for this lane is carried by the
firing check and the coverage gate above, both of which measure it.

## Still to do at integration

- Regenerate `website/src/data/brain-languages.ts` — its `emits` arrays are
  **derived**, and must follow the code, never lead it.
- Re-run `script/m60/rel-type-coverage-gate.ts` for the DERIVATION ledger.
  **Done 2026-10-09 for TypeScript**; the ledger shows typescript at 10/10 with 0
  findings, and the fleet run still fails on other lanes' 91 NEW findings against
  a recorded debt of 104 (69 repaid) — that baseline is theirs to refresh.
- Re-run the m14 grammar, mutation, differential and fixture gates per lane.
