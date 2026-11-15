**CLOSED — fixed at `12da50ee`, and its first use is the measurement that was impossible before it.**

`coldPoolPick` now keys on the corpus-relative path (`path.relative(repoDir, f)`), with membership accepting the older absolute spelling so in-place lanes are not reset. Regression evidence is the round's own full-extent work, which could not have been stated before the fix:

- a PRIVATE pool (`BB_M14_WORK`) plus the relative key made five successive 500-file draws **disjoint** — chunks 1–4 drew 2,000 never-sampled files and chunk 5 drew the remaining 211 + 289 warm;
- every drawn path is printed under `BB_F5_SHOW_FILES`, and the union is verified: **corpus 2,211, distinctDrawn 2,211, undrawn 0** (`script/m14/tmp/dt-depth-coverage.ts --logs`);
- before the fix the same lane reported `2211/2211 fresh` on a pool that already held 2,631 paths for it, across four freeze prefixes — i.e. the disclosure line certified a freshness that did not exist.

Lane-neutral machinery, so every lane measured on a dirty/moved corpus was sampling blind; the fix also stops the pool growing without bound (2,631 → bounded by the corpus).
