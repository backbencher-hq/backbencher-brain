# PROPOSAL (powershell) — the arbiter-typecheck gate's CONTROL IS INVERTED, so it is RED exactly when the tree is CLEAN

**From:** powershell lane owner · **date:** 2026-10-20 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m43/verify-arbiter-typecheck.ts` (Lead-owned) — this lane cannot edit it.
**Evidence:** this lane's own arms, and an independent measurement of the tree's type state.

## THE FINDING

`script/m43/verify-arbiter-typecheck.ts:132-137` is the gate's control:

```ts
// ── the control: the arbiter typechecks clean ────────────────────────────────────────────────────
check(
  "the typecheck ran and produced parseable output",
  /error TS\d+/.test(tscOut),
  tscOut.slice(0, 300),
)
```

**The LABEL says one thing and the PREDICATE says the opposite.** The label asks "did the typecheck
run and produce parseable output?"; the predicate asks "**is there a type error in the output?**".

The run is:

```ts
execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.scripts.json", "--listFiles"], …)
```

`--listFiles` prints the program on stdout. So on a CLEAN tree the output is the file list and there
is no `error TS` line — the control is FALSE, and the gate prints:

```
FAIL: the typecheck ran and produced parseable output — /home/ishaq2321/mcp/backbencher-brain/node_modules/typescript/lib/lib.es5.d.ts
…
T1: 6/7 passed, 4 negative case(s), 1 FAILED
```

**Measured independently, right now:** `npx tsc --noEmit -p tsconfig.scripts.json` reports **0**
`error TS` lines. The tree's type state IS zero — which is the state the campaign records and the
state the NEXT check in the same gate requires ("the arbiter typechecks CLEAN (zero type errors in
the arbiter and the gate)").

**So the two checks in the gate contradict each other: the control demands a type error and the
check beside it demands that there is none.** The control can only pass when the tree is BROKEN.

## WHY THIS IS NOT A COSMETIC COMPLAINT

The gate exists because "nobody typechecks `tsconfig.scripts.json`, where the arbiter lives" — and
the arbiter is the shared instrument every lane's number flows through. Its own header says a
deliberate error in the tree would make "every other tool that typechecks that tree see a NEW
error", so the premise is now proved on a TEMP PROJECT OUTSIDE the tree.

**A control that is red when the tree is clean is a control that cannot be trusted to go red when
the tree is dirty** — the "a dead suite reads exactly like a green one" shape, in the instrument that
is supposed to be the fleet's arbiter-type monitor. The practical cost is already visible: the
campaign's standing statement is "THE TREE'S TYPE STATE IS ZERO", and the gate that measures exactly
that says FAIL. A lane that trusts the gate over the measurement has to decide which is true, and
the honest answer is that the gate's verdict is not a verdict about the tree.

**This lane is not affected**: the gate's inputs are `script/m14/**`, `script/m12/**` and
`src/ast/pool_worker_globals.d.ts` (`tsconfig.scripts.json`), and this lane changed none of them.
The finding is pre-existing and is reported as pre-existing.

## THE ASK — a one-line change, with the reason

Make the control's predicate assert what its label says — that the typecheck RAN and produced
output — rather than that it produced an ERROR. The run already distinguishes the two cases in the
`catch` at `:120-124` (tsc exits non-zero when it has errors, and the output is then the evidence),
so the predicate has to accept BOTH: a clean run (stdout = the `--listFiles` program) and a run
with errors (stdout+stderr = the error lines).

```ts
// THE CONTROL IS "DID THE TYPECHECK RUN", NOT "IS THERE AN ERROR". The old predicate was
// /error TS\d+/.test(tscOut), which is TRUE only on a DIRTY tree — so the control was RED
// exactly when the tree was clean, and GREEN exactly when the tree had type errors, which is
// the state the check beside it forbids. The run's own `catch` already handles both cases
// (tsc exits non-zero when it has errors), so the predicate accepts either shape.
const typecheckRan = tscOut.trim().length > 0
check(
  "the typecheck ran and produced parseable output",
  typecheckRan,
  tscOut.slice(0, 300),
)
```

**The arbiter's two files being IN the program is already proved by the next check** (the `--listFiles`
membership assertion, n1a), so nothing is lost: the control proves "tsc ran", n1a proves "the arbiter
is in the program", and the check after that proves "the arbiter has no errors". Three questions,
three checks, no overlap.

**AN ALTERNATIVE, IF THE CONTROL IS MEANT TO STAY A "THE TYPECHECK IS ALIVE" PROBE:** keep the error
predicate but move it to the TEMP-PROJECT branch, where the deliberate error is planted and the same
tsc binary must report it — which is what the gate's own comment at `:103-107` already describes.
That is the n1 negative case, and it already exists.

## WHAT THIS LANE DID NOT DO

This lane did not edit `script/m43/verify-arbiter-typecheck.ts`, `script/m14/incoming-gate.ts` or
`script/m14/incoming-rule.ts`. It measured the tree's type state independently
(`npx tsc --noEmit -p tsconfig.scripts.json` → 0 `error TS` lines) and reports the gate's own
verdict verbatim (`T1: 6/7 passed, 4 negative case(s), 1 FAILED`) so that the two can be compared
without either being paraphrased.
