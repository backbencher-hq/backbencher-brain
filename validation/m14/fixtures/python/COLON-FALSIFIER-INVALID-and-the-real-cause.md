# THE COLON FALSIFIER IS **INVALID** — and the real cause is that Python's import targets name EXTERNAL modules

## WHAT WAS PREDICTED, AND WHAT CAME BACK

**Prediction, pre-registered in the artifact before the run**: *"imports.resolved must rise from 0. If it stays 0,
the colon is NOT the cause and the diagnosis is wrong — that is the falsifier, and 0 is a live outcome."*

**Result, same 600-file probe, same command, one character changed (`:` → `.`) at the two emission sites:**

    BEFORE   imports 4,972 · resolved 0 · amb 0 · unresolved 4,972      TOTAL 69,042 · 16,329 · 41,848
    AFTER    imports 4,972 · resolved 0 · amb 0 · unresolved 4,972      TOTAL 69,042 · 16,329 · 41,848

**EVERY ROW IDENTICAL, not just `imports`.** The change was reverted, and the file is byte-identical to its
committed revision (`git status` clean for it).

## BUT THE TEST **CANNOT DISTINGUISH TWO THINGS**, and that is the honest finding

**Identical output means either (a) the change was NEUTRAL, or (b) it never reached the analyzer.** The intended
discriminator — *do the unresolved targets now read `os.path` instead of `os:path`?* — **fails because the only
colon-target sample in the after-log is text from the artifact's OWN HEADER**, which I had written into it:

    Verified directly: os:path -> pathLike true/externalUnverified · os.path -> pathLike false/externalVerified

**So I searched for a string I had put there myself.** That is a tautology of exactly the kind this programme has
caught three times tonight — **a probe that pre-filters its own answer** — and it is the Lead's, not a lane's.

> **A TEST WHOSE OUTPUT CONTAINS ITS OWN QUESTION CANNOT ANSWER IT.**

**A valid version would have needed one of**: the target list printed **outside** any header, a **sha256 of the
analyzer** recorded in both arms, or a **metadata key on the emitted edges** read from the store. **None was done,
so the falsifier is recorded as INVALID rather than as a refutation** — and the diagnosis above is **neither
confirmed nor refuted by it.**

## AND THE REAL CAUSE IS NOW VISIBLE, from the numbers rather than from the code

**`imports` resolves 0 of 4,972 and `contains` resolves 8,142 of 8,144 on the same lane.** If the colon were
breaking resolution, the targets would be **unusable names** — but a target that names an **external module**
cannot resolve **whatever separator it carries**.

**PYTHON'S IMPORTS ARE `os`, `sys`, `collections`, `typing` — STDLIB NAMES, NOT CORPUS FILES.** **`os.path` names
nothing in the corpus either.** So this is **the same boundary shape as `r`'s PACKAGE names (760 of 787) and
`hcl`'s DIRECTORY targets (84 of 88)** — **a cause that is a property of the LANGUAGE's dependency model rather
than a defect in the analyzer.**

**THE COLON IS STILL WORTH FIXING** — it is the one character this programme reserved for "this is a path", and
the artifact records that `os.path` verifies while `os:path` does not. **But it is a CORRECTNESS issue, not the
cause of the 4,972**, and it must not be reported as the fix.

**WHAT THE 4,972 ACTUALLY NEEDS**: the same treatment `r` and `hcl` got — **a named cause with a measured count
and a shape split**, plus the **§6.11 control**: how many of the 4,972 name a module **the corpus actually
carries**, which is the population a claim could reach.
