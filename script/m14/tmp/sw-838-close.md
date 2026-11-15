**CLOSED — the wave's own rulings judged it, and one of them turned out to be wrong.**

Acceptance items (same five as #836), re-read at HEAD:

- [x] **Claims probe-verified.** SW-G (init delegation) and SW-H (implicit/Self enum construction) are pinned by `swift/init-delegation` and `swift/enum-construction-splice`, each with a reverting mutant that is CAUGHT (52/52 swift mutants).
- [x] **F5 lanes.** FULL extent this round: `swift-nio` 554/554 files 0/0, `alamofire` 98/98 files 0/0 (see #836 for the hashes).
- [x] **Pins + mutants + F3/F4 green in-session.** swift fixtures 16/16; F6 swift PASS.
- [x] **Spec decisions recorded.** SW-G/SW-H are in `swift-completeness.json`; SW-G's resolution text is corrected where this round proved it wrong (below); SW-D21…SW-D25 added.
- [x] **reviews/swift complete; onboarding updated.** `reviews/swift/m60-closure.md` is the closure marker.

**What the wave got wrong, and it is the reason this issue stayed open.** SW-G's rule was written as *"Unresolvable stays silent"*, but the implementation published `parent?.ownerName ?? parent?.name` — and when the enclosing symbol IS the initializer, `parent.name` is the literal string `constructor`, so the analyzer invented the symbol's own name as a TYPE and published `instantiates constructor -> constructor`. The truth side had the mirror-image hole: its `consumed` flag was only set on the resolvable branch, so the unresolvable case fell through to the generic path and published a dangling `calls -> init` (constructors are literally `constructor` in this vocabulary — `init` is not a name). Both halves are now implemented as written: the owner is the parent's `ownerName` when the parent is a MEMBER symbol and the parent's own `name` only when the parent IS the type, and with no resolvable owner there is **no edge at all**. Filed and closed as **#941**, found by the full-extent draw.

Two more shapes this wave's rules could not see, both found by the same extent and closed in the same round: **#942** — the SW-B enum-construction conversion spliced "the first `calls` edge with this (source, leaf)", which deletes a DIFFERENT call site's genuine edge whenever two sites in one scope share a leaf name (measured on alamofire's full extent: `Endpoint.get` silently lost its call to `Endpoint.method`); the splice is now site-precise and re-lines the surviving edge onto a site that is still a call, per pool. And **#938** — a switch pattern's recovery publishes the reserved `case` keyword as a callee, which the SW-B post-walk then converted into a phantom construction on the truth side.
