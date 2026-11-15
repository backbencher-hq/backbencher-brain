**CLOSED — both halves fixed, each read from the token and never from text.**

**Half 1 (the fabricated pattern call).** `handleCall` now returns before any emission when the callee navigation's FIRST child is the reserved `case` token (`isCasePatternRecovery`) — structural, no text scanning — and the truth oracle carries the mirror in the same place. Measured at full extent (554 files of swift-nio): the three rows the issue names are gone, and they were the lane's only unexplained-by-truth edges.

**Half 2 (the source-blind splice).** The oracle's SW-B conversion no longer removes edges by target alone. It counts contributing call SITES per leaf (truth edges are (label,target)-deduped, so one conversion used to delete a different site's edge), decrements only its own contribution, and removes the `calls` edge only when no non-construction site remains. Same rule as the analyzer's, stated twice — which is the point: the two sides had drifted, so the two-sided blindness survived the wave.

Fixture `swift/case-pattern-recovery` pins both the absence (no `calls`, no construction for a pattern) and the positive half (the ARGUMENTS' own reads still emit), and mutant `swift/case-pattern-keyword-call` is CAUGHT. Full extent, after: `swift-nio` 554/554 files `MISSING=0 unexplained=0`; `alamofire` 98/98 files `0/0`.
