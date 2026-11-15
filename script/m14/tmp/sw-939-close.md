**CLOSED — the climb traverses the unwrap wrapper, on both sides and in BOTH rows of the issue's own table.**

The pinned grammar puts a force unwrap inside a `postfix_expression`, and the SCD1 climb listed only `directly_assignable_expression | navigation_expression | navigation_suffix`. From the INNER navigation the first parent is the wrapper, so the walk stopped, `a` was never the `assignment`, the LHS-span test never ran, and a WRITE was published as a read.

Fixed in all three analyzer gates (`handleSelfUse`, `handleBareUses`' `isWrite`, `handleMemberUses`) and in the oracle's two mirror climbs (its `bare-uses` gate and its member-read gate), so the LHS-span rule decides on both sides from the same span.

The issue's table had **two** rows, and the round closed both:
- the NESTED row (`x.a!.b += 1`) — the analyzer over-read where the wrapper interrupted the climb;
- the FLAT row (`x.a! = 1`, the wrapper AS the whole assignable path) — which had been **published as a read by BOTH sides**, because the oracle's own suppression worked by blocking descent and therefore agreed by accident in the nested case and not at all in the flat one.

Fixture `swift/unwrap-write-gate` pins the nested write, the flat write (added after this issue's table was re-read) and the two positive reads through the same wrapper (`readThroughUnwrap`, `readOuterThroughUnwrap`) so the fix cannot be widened into blanket suppression; distinct-scope near-misses forbid the method-sourced spellings. Mutants `swift/unwrap-inner-write-as-read` (all three injections) and `swift/unwrap-outer-write-as-read` are CAUGHT. Full extent before: 2 rows among the six findings; after: `swift-nio` 554/554 `0/0`.
