# fsharp — named-cause list (Lead measurement, 2026-10-10)

**POPULATION LABEL, FIRST, because it governs every number below**: `incoming-gate.ts fsharp
fs,fsi,fsx 150` — a **150-file STRIDE SAMPLE of 11,807** `.fs/.fsi/.fsx` files across 26 repos, **not**
the whole population. The whole-population `residual-gate --lane fsharp` was attempted first and
**exceeded a 40-minute budget without completing**, so this is the bounded run that replaces it, and
**nothing here may be compared with a whole-population figure from another lane**. The gate itself
prints the two caveats that make it honest: `stride sample`, and `project index: NOT USED — this is the
per-file population, which is NOT the one production parses`.

    type          edges  resolved  collRes  amb(decl)  amb(kind)  unresolved
    calls         8,940     2,032        0        358         89       6,223
    contains      4,890     4,890      565          0          0           0
    references    2,651       707        0         66         47       1,878
    exports       1,697     1,623        0         74         49           0
    uses            984        54        0         35          6         895
    imports         555        16        0         19         12         520
    instantiates    101        37        0         20         13          44
    implements       87        17        0         17          9          53
    overrides        51        22        0          4          0          25
    extends          49         4        0         20          6          25
    TOTAL        20,005     9,402      565        613        231       9,663

`extFAIL`/`bindFAIL`/`causeFAIL` all **0**, and `extOK`/`ext?` both **0** — this lane makes **no
external claims at all**, so it has no `extQ` question.

## Cause 1 — `calls` 6,223 unresolved: 64% of the lane's entire unresolved column

`calls` is 8,940 edges with 6,223 unresolved (69.6%), and **fsharp's `calls` are the largest single
population in the lane**. `amb(decl)` is only 358, so this is **not** an ambiguity problem — it is a
**resolution/claim** problem, and the fleet's split applies: **how many of the 6,223 name a candidate
ANYWHERE?** hcl measured 1,407 twin vs **12,054 no-candidate-anywhere**; zig measured **87.6% dotted,
external or file-shaped**. **F# is a functional language**: a bare call name is likely a module-level
function that the per-file population cannot see, which would put it in the "no candidate" class and
make it a **claim** question rather than a resolution one — **but that is a hypothesis and the split
decides it.**

## Cause 2 — `imports` 520 unresolved of 555 (93.7%) — the EIGHTH lane with this cause

    protobuf 1,574 · graphql 170 · clean 1,891 · scss 3,405 · r 1,871 · hcl 334 · lua 5,645 · fsharp 520
    = 15,410 edges

**One mechanism — a module or package path is not a declaration — in eight languages.** F#'s spelling is
`open Module` / `#load "file.fsx"`. `toml-lane` is pricing the claimable subset across the set; this
lane's 93.7% joins it, and **the label above means fsharp's figure is a SAMPLE contribution, not a
whole-population one** — the other seven are whole-population.

## `contains` IS ALL RESOLVED — 4,890 of 4,890, `collRes` 565, nothing ambiguous or unresolved

**Ninth lane with a clean containment.** The 565 `collRes` is the usual upper bound on arbitrary
bindings, and with `amb` 0 and `unresolved` 0 the type is closed. It is also the type with the **most
`collRes` relative to its size** among the clean lanes so far — worth a store-side intent split when one
is next pointed at a lane.

## Cause 3 — `references` 707 resolved / 1,878 unresolved of 2,651 (70.9%)

Second-largest unresolved column. Same treatment as Cause 1 and the same warning: the intent column is
silent for a read-site type by construction (`LINE_IS_TARGET_LINE` covers contains/exports only).

## And the one type that is nearly clean

**`exports` 1,623 of 1,697 resolved (95.6%)** — the best `exports` rate measured on any lane, with 74
`amb(decl)` + 49 `amb(kind)` and **0 unresolved**. F#'s `module`/`namespace` declarations publish
qualified names that the per-file population can see, which is why this type behaves while `calls` does
not — and that contrast is the lane's most useful clue.

## The process finding, recorded because it will recur

**The whole-population gate did not finish in 40 minutes** (killed, CPU freed for the eight active
lanes). The bounded/stride run above is the replacement, and it is the same shape `r-lane` used for
powershell. **A lane whose gate cannot finish needs the bounded approach as its FIRST instrument, not
as a fallback** — and its numbers must carry the sample label, as these do.
