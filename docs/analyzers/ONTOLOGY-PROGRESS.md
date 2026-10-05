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
| TypeScript | 10/10 | 10/10 | VERIFIED | was already complete; DERIVATION still owed |
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
2. **DERIVATION paydown.** TypeScript emits `exports`, `imports`, `references`
   and `uses` that **no oracle audits**. So do several other lanes. An edge that
   is stored and compared against nothing ships a bug invisibly — a worse
   failure than a missing type, because nothing goes red. `DERIV_*` lanes make
   the differential audit each emitted type and report
   missing/unexplained/fabricated per type.

## Still to do at integration

- Regenerate `website/src/data/brain-languages.ts` — its `emits` arrays are
  **derived**, and must follow the code, never lead it.
- Re-run `script/m60/rel-type-coverage-gate.ts` for the DERIVATION ledger.
- Re-run the m14 grammar, mutation, differential and fixture gates per lane.
