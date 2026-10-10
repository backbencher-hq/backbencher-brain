
## Lead verdict — verified against the strict bar

verdict(toml): the FIRST lane verified against the strict bar — residual 13 of 25,531, and ZERO resolved edges resting on production's tie-break

Verified by the Lead, not reported by the lane. `npx tsx script/m14/residual-gate.ts --lane toml`,
whole admitted population (1,485 files), production scope, committed instruments only:

    type        edges    resolved  ofWhich  amb(decl)  unresolved  extFAIL  bindFAIL  causeFAIL
    imports        331         0        0         0          13        0        0         0
    contains    25,033    25,033        0         0           0        0        0         0
    references     167       167        0         0           0        0        0         0
    TOTAL       25,531    25,200        0         0          13        0        0         0
    resolved 98.7%   residual 13   extFAIL 0  bindFAIL 0  causeFAIL 0

WHY THIS SATISFIES THE OBJECTIVE'S BAR, clause by clause:

* EVERY APPLICABLE TYPE EMITTED AND REAL. `contains` 25,033 of 25,033 and `references` 167 of 167 —
  100%, zero ambiguous, zero unresolved. The three implemented types are covered; the six excluded
  ones are all `grammar-absence` with cited evidence in the block (a TOML document has no call
  site, no attribute-set, no class hierarchy), so they leave the denominator rather than hide in it.

* `ofWhich = 0` — **and this is the clause that makes the verdict strong rather than merely
  green.** Zero resolved edges were chosen by production's `s.id` tie-break among colliding
  candidates. The indexer's own control arm measures 37,318 of 49,729 such picks as the WRONG
  symbol, so a lane could have reached residual 0 with a large share of its "resolved" edges being
  arbitrary. This lane has none. Every resolved edge names exactly one declaration and nothing chose
  between rivals.

* INCOMING: `extFAIL 0`, `bindFAIL 0`, `causeFAIL 0`. No false statement about another repository,
  no unfalsifiable binding claim, no declared cause that fails its own check.

* THE 13 ARE RULED, NOT HIDDEN: TOML-G2, recorded in the spec with the count and the location —
  every one is cargo's own `cargo_add` fixture, where `path = "./dependency"` is written NOT to exist
  because the test asserts that failure. They carry no claim and are not marked external, because a
  false claim would shrink the number without making the graph truer. This is a domain boundary with
  evidence, which is what the bar accepts in place of zero.

* THE LANE'S OWN ACCOUNT IS HONEST ABOUT ITS SIZE. Its file-scoping fix was reported as "47 edges,
  not 18,971 — a robustness gain, not a count gain" after it refuted the Lead's premise by checking
  a log row's timestamp against the commit that changed the model. The claim change was cross-tabbed
  BEFORE emission: the analyzer's filesystem test and the arbiter's admitted-list verdict disagreed
  on ZERO edges in either direction. Fixtures 9/9; oracle diff unchanged at its pre-existing
  divergences; TOML-G1 (workspace inheritance, 1,269 sites / 138 documents) explicitly untouched and
  still recorded as an open gap.

WHAT IT DOES NOT CLAIM: the 13 edges are real residual, not zero. The verdict is that each is
attributed to a NAMED cause with a measured count and evidence, which is the bar's second arm.
