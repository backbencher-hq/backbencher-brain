# firing-check v2 — Rust, at three sample sizes, on this branch

Measured 2026-10-05 on branch `analyzer/R7_AUDIT_FLEET`.

## Which instrument, and why not the master one verbatim

The brief's command is
`cd $HOME/backbencher-brain && NFILES=200 bun script/m14/firing-check-v2.mjs R7_AUDIT_FLEET`.
Run verbatim on 2026-10-05 it prints:

```
FIRING-CHECK v2: no lane matches "R7_AUDIT_FLEET".
Known lanes: RUST GO TYPESCRIPT JAVA KOTLIN SCALA GROOVY HASKELL SWIFT CLOJURE VB RUBY ERLANG ELIXIR C CPP OBJ_C JAVASCRIPT VUE SVELTE HTML
```

and exits 2 without measuring anything — `R7_AUDIT_FLEET` is a LANE NAME, and
`resolveLane` matches on the language key. The lane key for Rust is `RUST`. Two
separate defects, both reported to master, both unrepaired here because
`script/m14/**` is MASTER-owned:

1. **No `R7_AUDIT_FLEET` lane key.** Every ontology lane that ran this
   instrument under its own lane name hit this. It is the loud-failure guard
   working as designed (an unmatched lane must not print an empty table and
   `unmeasured: none`), so the instrument is right and the invocation is wrong.
2. **The root is hard-coded**: `firing-check-v2.mjs:36`
   `const REPO = "$HOME/backbencher-brain"`. Even with the right lane
   name it imports the analyzer from the MAIN checkout, so it would measure
   `main`'s `src/ast/real-rust-analyzer.ts` and not this branch's. That matters
   from commit `762dd6927` on, where the two differ.

So the number below comes from `script/incoming-rust/firing-check-v2-rust.mjs`,
a lane copy whose ONLY differences are the repo root (derived from
`import.meta.url`, not written down) and a header line. Sampling rules, the
`SIGNAL` table, the code-bearing filter, the two-channel split and the lane
resolver are byte-identical to the master instrument, because an instrument that
differs from the arbiter in its SAMPLING produces a second number nobody can
reconcile. Raw output: `firing-check-v2-rust.txt`.

Corpus population: `ripgrep` @ `3fce3b5`, 110 tracked `.rs` files, of which
**108 carry code** under the `SIGNAL[".rs"]` filter. At `NFILES=200` the sample
therefore saturates at 108 — 200 exceeds the population, which is stated here
because docs/M14-HONESTY-CONTRACT.md §"an instrument must declare the population
it covered" treats a printed count without its denominator as a defect.

## The number

**10/10 — all ten production relationship types fire, at every sample size tried.**

| NFILES | sampled | relationship types fired | silent | imports[] (separate channel) |
|---|---|---|---|---|
| 25 | 25 | 10 | none | 76 in 19 files |
| 50 | 50 | 10 | none | 175 in 42 files |
| 200 | 108 (of 110; 2 non-code-bearing) | 10 | none | 449 in 98 files |

`fired:` `calls extends implements uses imports exports contains references
overrides instantiates` — identical at 25, 50 and 200.

Counts at NFILES=200 (relationship channel):

| type | edges |
|---|---|
| calls | 16733 |
| contains | 3809 |
| uses | 3171 |
| references | 2928 |
| overrides | 1011 |
| imports | 614 |
| instantiates | 613 |
| implements | 252 |
| exports | 140 |
| extends | 7 |

`extends` is the thinnest at 7 edges over 108 files and is the one type whose
verdict turns on a construct census rather than on this tally; see
`r7-ripgrep-before.md` and the per-type table in the lane report.

Two notes on the instrument's own vocabulary, both measured not assumed:
`in types.ts but NOT produced: (none)` and `produced but NOT in types.ts: (none)`
— `src/ast/types.ts` and `src/ast/engine.ts`'s `ASTEngine.RelationshipType`
agree for Rust at this commit, and the denominator is the 10-type production
vocabulary.

## Direction of the edges

**OUTGOING ONLY.** Every edge is emitted by the analyzer run on the file being
analyzed, so `source` is a symbol in (or nominally from) that file. Resolving
which symbols point AT a given symbol — the reverse direction — is a separate
subsystem that does not exist in this codebase. `src/ast/real-rust-analyzer.ts`
is instantiated per file with no companion index, so it cannot answer it, and
`bb_graph`'s incoming-edge question is out of reach of any analyzer in
`src/ast/real-*`. Counts here are therefore a statement about what each file
points at, never about what points at it.