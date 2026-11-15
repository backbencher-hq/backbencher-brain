# HOW THE SEVEN WERE DONE — the repeatable method, not the verdicts

**Requested by the programme owner after asking the right question**: *"how are these languages done if julia has 62
percent, bash has 53 thousands, xml has 9131, css has 260, and yaml has 184?"* **The answer to the count is in
`PROGRAMME-STATUS.md` (accounted-for, NOT resolved). This is the METHOD — because it is the part that repeats.**

## THE FIVE STEPS EVERY ONE OF THE SEVEN FOLLOWED

**1 · MEASURE AT THE RIGHT SCOPE.** *Not a stride.* **json measured from TWO populations** and their agreement is part
of why its zero is believed. **bash fixed a class over the SAME population before and after** — *not a before on one
sample and an after on another.*

**2 · PARTITION SO THE BUCKETS SUM EXACTLY TO THE INSTRUMENT'S OWN TOTAL.** **yaml's 184 is 137 `amb` + 47 `unres`,
four classes summing exactly.** **julia's B-split sums to `ambSym` 18,202 exactly, on two different predicates.** *A
partition that does not close is a residual with somewhere to hide.*

**3 · NAME EVERY CLASS AND GIVE IT A COUNT.** **Not "miscellaneous".** *xml's 9,131 is 7,582 `references` amb + 991
`extends` + 279 `calls` — **and every one of the 279 was enumerated**, not sampled.*

**4 · RULE EACH CLASS WITH A FALSIFIER THAT WAS RUN — AND MEASURE THE FALSIFIER AT ZERO.** *This is the step that
separates a ruling from a shrug.* **css is the exemplar**: 180 edges ruled under **CSS-D17 with all four falsifiers
measured at ZERO** — `noAlt` **181/181** · CROSS-FILE-TWIN **0** · IN-FILE-MULTI **0** · DUP-EMISSION **0**. **xml's
279 `calls` each have exactly ONE declaration of the callee in its own file, and the falsifier was checked at 0 of
279.** *A falsifier at zero is a READING because the predicate could have returned non-zero.*

**5 · PROVE THE TEST CAN FAIL.** **json's `collRes 2` was measured `intended` ON THE STORE — with a control
(`duckdb` 27,536/6) proving the test can return the other answer.** **The one token's negative control is the same
move**: *two arms, one variable, and the arm that should not move moved nothing.*

## AND THE LINE THAT DISTINGUISHES ALL SEVEN, EACH FROM ITS OWN LANE

**Each refused the softer reading in writing, unprompted:**

* **yaml**: *"a ruled class is not a resolution."*
* **bash**: *"ruling it does not make it a resolution, and saying so is the difference between a ruled class and a
  laundered one."* — **and it moved its own number UP, taking the clause's side against its instrument by exactly the
  787 edges in `ext?`**
* **toml**: 13 ruled, **and `ofWhich` 0** — *the sub-question declared empty rather than left unasked.*
* **css**: `ofWhich` **0 per type** *and* **`ext?` 0**.
* **xml**: clause 1 met **with the whole residual ruled by class** — *not "mostly".*
* **julia**: clause 4 met with **`bindFAIL` 0 ON BOTH SIDES** of the binding change it armed.
* **json**: the only one that needed no qualifier, **and the only one whose residual is genuinely 0.**

> **THAT IS THE METHOD IN ONE SENTENCE: MEASURE AT POPULATION SCOPE, PARTITION UNTIL THE BUCKETS CLOSE, NAME EVERY
> CLASS, RULE EACH WITH A FALSIFIER YOU RAN AND MEASURED AT ZERO, PROVE THE TEST CAN FAIL — AND THEN SAY OUT LOUD WHAT
> YOU DID *NOT* PROVE.**
>
> *Every one of the seven did the last part without being asked, which is why the other six numbers are quotable and
> why the count is honest at 1 closed / 6 short rather than 7.*

## WHAT THIS METHOD COSTS PER LANE, WHICH IS THE PLANNING NUMBER

**The seven took the whole programme so far.** *The work is not the fix — most of the seven fixed almost nothing. **The
work is the partition, the enumeration, the falsifier runs and the controls.*** **That is why 16 Laptop B lanes and 23
Laptop A lanes are the real schedule, and why the fleet-wide fabricated-edge defect now outranks them**: *a lane can
pass all four clauses with fabricated edges inside it, because **the bar measures resolution, and a fabricated edge
resolves fine — to the wrong thing.***
