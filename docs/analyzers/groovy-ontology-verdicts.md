# Groovy ontology verdicts — DERIV_EXPORTS_GROOVY4

One row per relationship type. `EMITTED` needs a count and the files it came
from; `RULED` needs a measurement that a probe can falsify; `GAP` gets
implemented. A verdict without a number is not a verdict.

Corpus: `$HOME/fixtures/repositories/groovy` (`groovy/website` @
`23e5e69`, 2,747 `.groovy` files, 96 MB).

## Handover baseline — re-measured, not inherited

`script/m14/firing-check-v2.mjs`, production path (`getParser` → `parse` →
`analyze`), `NFILES=200`, code-bearing sampling, run against the main checkout at
`455c02631` — the same tree as this branch's HEAD:

    8/10   GROOVY  200/200 parsed · imports[] 839 in 178 files
    silent: imports exports
    counts: calls:7604 contains:3809 uses:1246 references:863
            instantiates:840 extends:147 overrides:61 implements:28

So the handover claim "8/10, silent on imports and exports" is confirmed at
`NFILES=200` on this corpus. `imports[]` is non-zero in 178 of 200 files, which
is the separate channel and is *not* the `imports` relationship type.

### Instrument note (a defect in the shared harness, reported not fixed)

The command in the lane brief,

    NFILES=200 bun script/m14/firing-check-v2.mjs DERIV_EXPORTS_GROOVY4

exits non-zero with `no lane matches`. `resolveLane` step 4 tests
`want.startsWith(norm(key))` (`firing-check-v2.mjs:197-204`), and normalising
`DERIV_EXPORTS_GROOVY4` yields `DERIVEXPORTSGROOVY4`, which does not *start*
with `GROOVY`. Only a lane name that begins with the language key resolves.
`GROOVY` is used instead. The guard behaved correctly — it refused rather than
printing an empty table — but a lane key in the middle of a lane name does not
resolve.

## Verdict table

_(filled in as each verdict is reached; one commit per row)_

| type | verdict | count | evidence |
|---|---|---|---|
| calls | | | |
| uses | | | |
| contains | | | |
| references | | | |
| extends | | | |
| implements | | | |
| overrides | | | |
| instantiates | | | |
| imports | | | |
| exports | | | |
