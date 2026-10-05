# Task 5 not done — the highest-value gap, what closing it costs, and why it was not landed half-way

Written by lane 6. This is a record of a **deliberate non-closure**, with the
analysis done so the next lane does not have to repeat it.

The instruction was: *close the highest-value remaining gap, with a gate, without
breaking the 50 ms warm p95 budget*. I did not. The reasons are below, and none
of them is "ran out of time" in the abstract — they are specific blockers with
specific unblocking steps.

## What the highest-value gap is

Measured, not guessed (the method is in `docs/HOVER-GAP-VERIFICATION.md`):

```
outgoing relationship rows the index holds across the 8 fixture symbols : 8
outgoing rows rendered WITH a verb on the card                          : 1   => 12.5%
```

**Outgoing `contains`.** `src/lsp/rich_hover.ts`'s `OUT_VERB`/`IN_VERB` tables
(`:89-106`) have no entry for `contains`, `uses`, `references` or `imports`, so
`connectedGroups()` at `:398-412` hits `?? null` and `continue`s. The fixture's
`Hub` holds **4** outgoing `contains` rows. For a class, "what does this contain"
is the first question a developer asks, and the card is silent.

`contains` is chosen over `uses` because it is the larger block (4 of the 8
outgoing rows) and the more useful one — `contains` is the parent-to-member edge,
so it is how a class's own API surface is described.

## Why it was not landed

### 1. An inherited gate deliberately forbids it

Two checks in `script/m42/verify-rich-hover.ts` exist specifically to keep
`contains` rows out of the connected summary, and both currently pass:

```
✓ H2/R6: contains rows never render as connection facts
✓ M2: contains rows leaked into the connected summary fail R6 [mutant]
```

Closing this gap means **deliberately breaking two passing mutant-backed checks**
that encode a decision I did not make and cannot see the reasoning for. §13.5
(*"File-level (imports/exports) and external rows live in declared, labeled
sections"*) points the other way for the file-level kinds, which suggests the
`contains` ban was a considered call about not turning the connected summary into
a member list — not an oversight.

Turning that decision around is a product decision with a visible surface change,
not a lane-local fix.

### 2. The obvious alternative collides with a different inherited check

The cheaper closure is raising `MAX_USAGE_LINKS` from 3 (`rich_hover.ts:81`),
which the audit itself names as the ceiling: *"It IS the ceiling on how much of
the relationship story one card can carry, and it is the reason a busy symbol's
hover reads as thin."* `hotPath` has 5 usage sites and renders 3.

But `verify-hover-coverage.ts:384` asserts:

```
check("M5: the render cap is VISIBLE (a >3-usage symbol renders fewer links than the index knows)", …)
```

Raising the cap above the fixture's maximum (5) makes that check unsatisfiable,
so closing *this* gap requires growing the fixture — adding a symbol with more
than the new cap's worth of usage sites — and re-establishing that the cap is
visible at all. That is a fixture change to a gate another lane may be reading,
plus a re-measurement.

Note the check is a *good* one: §13.4 forbids hiding a count, and a cap that is
invisible would be a lie. It is not the check that should go.

### 3. The p95 could not be certified cleanly at the time

§3 makes a budget miss a failed gate, and the honest way to land a hover change
is with a p95 measured on a machine whose state is stated. The machine ran
under load averages of 6.5–22 for most of this lane, with another lane's indexer
at 64% CPU. The hover-coverage gate's own §3 check produced **88.05 ms against
a 50 ms budget** under load average 12.41, and 34.4–36.29 ms when quieter.

Landing a change that *moves* the latency number, on a machine whose load swings
the number by 2.6x, would produce a measurement that cannot distinguish the
change from the weather. The clean runs are recorded in the commit message for
`b60e0a6f9`; a before/after pair under those conditions would not be evidence.

## What closing it needs, concretely

1. **The product decision**, stated once: does the connected summary carry
   `contains`? If yes, `H2/R6` and `H2/M2` are amended with the reasoning, and a
   mutant is re-pointed at the new contract. If no, the class's members need a
   **labelled section** of their own (§13.5's shape for "noise is labeled, not
   hidden"), with its own count that equals what it renders (§13.4).
2. **A named owner for the fixture.** Whoever does it also updates
   `verify-hover-coverage.ts:384`'s cap check and adds a symbol that exercises
   the cap at its new value, so "the cap is visible" stays falsifiable.
3. **A p95 measured on a stated-quiet machine**, before and after, n≥200, with
   `machine.loadAverage` recorded. If the after-number misses 50 ms, that is a
   failed gate and the change does not land.

## What *was* landed in this lane instead

The measurement work that makes the closure cheap:

- `docs/HOVER-GAP-VERIFICATION.md` — per-canonical-kind table, measured from the
  committed evidence rows, plus the finding that the audit's own `70.6%` row
  counts English words rather than kinds and cannot see `contains` at all.
- `docs/HOVER-COVERAGE-GATE-WEAKNESS.md` — the gate that would certify the
  closure cannot currently fail on a dropped relationship kind, so it could not
  have certified the fix either. **Closing this gap without first closing D1
  would have produced an unmeasurable change.** That ordering is the reason the
  closure waits on the gate work, and the gate work is now written up.

## Numbers not in this document

- A p95 for the closure. It was not built, so it is not measured.
- Whether the owner wants `contains` on the hover at all. That is the decision
  this document exists to hand over cleanly.
- Any editor render. Nothing here runs VS Code.
