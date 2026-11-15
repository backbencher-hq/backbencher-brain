# THE UNROUTED CLASS HAS A **GATE** NOW — `verdict: PASS`, `gateDisagreements: 0`, and it self-tests

**`script/m60/unrouted-extension-gate.ts` → `validation/m60/results/unrouted-extension-gate.json`.** **A census finds a
class once; a gate keeps it closed.** *This is the artifact that converts eight hand-found fixes into a property the
repository now enforces.*

    kind          m60-unrouted-extension-gate
    question      does the corpus carry an extension-shaped, text-bearing key that the router refuses
                  with no ruling?
    VERDICT       PASS
    exitCode      0
    verdictBreakdown:
        selfTestsOk            True
        selfTestsFailed        []
        gateDisagreements      0
        textBearingNewKeys     0
    failKeys      []
    newKeys       []

## AND IT IS A GATE IN THE PROGRAMME'S OWN SENSE, TO THREE SEPARATE STANDARDS

**1 · IT SELF-TESTS, AND REPORTS THE SELF-TEST SEPARATELY.** `selfTestsOk True` and `selfTestsFailed []` are **their own
fields** — *so a run that passes because its own controls fired is distinguishable from a run that passes because
nothing ran.* **That is the canary discipline the typecheck ratchet uses, applied to a census.**

**2 · IT REPORTS `gateDisagreements`, AND THE NUMBER IS ZERO.** *The census asserts the gate identity
(`hasValidExtension === (detectLanguageFromPath !== null)`) on every file it counts; **this gate records a disagreement
count as a first-class verdict field**, so a future edit that splits the two gates **fails the gate rather than
silently widening it.***

**3 · `verdict` AND `exitCode` ARE BOTH PUBLISHED — `PASS` and `0` — SO IT CAN JOIN A CI CHAIN.** *A gate whose result
is a sentence is a report; a gate whose result is a verdict and an exit code is an enforcement.*

## AND THE TWO EMPTY LISTS ARE THE POINT

**`failKeys []` and `newKeys []` — NOT ABSENT, NOT OMITTED: EMPTY AND PRESENT.** *An empty array says "the question was
asked and the answer was none", which is exactly the distinction this programme has spent two days drawing* — **a zero
from a predicate that could have returned non-zero is a reading; a field that is not emitted is an omission.** *The
census does the same thing with `keysUnmeasuredBecauseAParseDidNotReturn`, and for the same reason.*

**AND `textBearingNewKeys 0` CARRIES THE CLASS'S OWN DEFINITION IN ITS NAME**: **an extension-shaped key that is
TEXT-BEARING and that the router REFUSES with no ruling.** *Three conditions, and the third is what separates thisfrom the 111 `binary-only` extensions the census found* — **a `.png` is not a defect; a `.sbt` with Scala in it is.**

## SO THE DAY'S EIGHT FIXES BECOME A CLOSED CLASS RATHER THAN EIGHT EVENTS

    .mts · .cts · .graphqls · .sass · .jsonl · .jsonlog · .sbt · .phpt

**Eight extensions, found by four different lanes, one at a time, over one day** — *and the honest note is that
**every one of them was found by a lane encountering its own population, not by a census**, and that the census the
Lead ran **confirmed the class without discovering any instance.*** **What changes now is that the NEXT one fails a
gate instead of waiting for a lane to trip over it.**

**AND WHAT THE GATE CANNOT DO, STATED SO IT IS NOT OVERSOLD**: *it sees extensions the CORPUS carries and the router
refuses. **It cannot see an extension no corpus this repository has yet contains** — so a lane adding a new format
still has to notice, and `LANES_A`/`LANES_B` still have to be kept in step with the router by hand.* **The gate closes
the corpus direction and not the future one, which is the direction a gate can close.**
