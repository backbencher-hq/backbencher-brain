# THE REMAINING 369 — CLASSIFIED. **45 ARE DECIDED, 324 ARE GENUINE COMPOSES.**

**After `validation/m14` 262 · `script/m14` 69 · `src/ast` 53 · `script/m60` 23 — **407 of 776** — the remaining **369** were
classified by the same rule the whole union has used, applied to every one.*

    COMPOSE (both sides have unique lines)            324   <- THE REAL REMAINING WORK
    HEAD newer -> KEEP HEAD (candidate)                24
    HEAD-SUPERSET -> write nothing                     13   <- decided: the tree is already the union
    HEAD portable / MAIN literal -> KEEP HEAD           8   <- decided: the corpus-root migration
                                                      ---
                                                      369

## THE 45 DECIDED

**21 ARE DECIDED WITH NOTHING TO WRITE** — *13 whose HEAD side is a **strict superset** of main's, so **the working tree
already is the union**, and **8 where HEAD carries the portable `fileURLToPath` form while main hardcodes
`/home/ishaq2321/backbencher-brain`.*** **"A disposition that writes nothing is the one that cannot lose a line."**

**24 MORE ARE HEAD-NEWER CANDIDATES** — *readable, and each needs its diff quoted before it is taken.*

## AND THE 324 ARE NAMED BY AREA, WHICH IS WHAT MAKES THEM WORKABLE

    validation/m15   34 COMPOSE        docs/analyzers   21 COMPOSE + 6 superset + 2 HEAD-newer
    validation/m13   20 COMPOSE        validation/m48   20 COMPOSE
    validation/m25   19 COMPOSE        script/m22       13 COMPOSE
    script/m13       12 COMPOSE + 1    validation/m24   12 COMPOSE
    validation/m55   10 COMPOSE + 3    script/m12        8 COMPOSE + 2 + 1
    ...and the tail to 324.

**AND COMPOSE IS NOT A FAILURE MODE — IT IS THE UNION.** *A path where both sides hold lines the other lacks is exactly
what a per-file union exists for, and **the four rules apply unchanged**: read both versions · write a version holding the
work of both · **if genuinely incompatible, leave it untouched and NAME it** · never a verb that discards a side.*

**AND THE MEASUREMENT THAT MAKES COMPOSE TRACTABLE**: *of the 816 disjoint paths profiled at the start, **390 — 48 % —
differed by twenty lines or fewer**, 242 by 21–100, and only 184 by more than 100.* **So a large share of these 324 are a
read-and-take, not a rewrite.**

**AND THE DIRECTION RULE THE LAST BATCH PROVED**: *`git diff HEAD <main>` prints **`-` for lines only in HEAD** and **`+`
for lines only in main** — **so a positive count means MAIN has those lines, not HEAD.*** **That reading error was mine,
made once and corrected in the `validation/m14` disposition, and it is recorded here so it is not made again.**
