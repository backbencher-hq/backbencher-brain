**CLOSED — the splice is site-precise on both sides, which is what the issue's own table says it needs.**

The old splice removed *"the first `calls` edge with this (source, leaf)"*, which belongs to a DIFFERENT call site whenever two sites in one scope call the same leaf name. In alamofire's `Tests/TestHelpers.swift` that is exactly line 152's genuine `Endpoint.get -> Endpoint.method` losing its edge to line 286's `Path.method(.get)` construction.

What is implemented:

- Every call site increments a per-(source, leaf) **site count** — the relationship list is (source,label,target)-deduped, so sites, not edges, are what a conversion has to retire.
- The conversion decrements exactly its own contribution and the `calls` edge is removed only when **no non-construction site remains**. Two sites, one converted, one genuine → the call survives.
- The surviving edge is then **re-lined** onto a site that is still a call, per POOL and never globally: two different pools can share a source LINE (a `MemoryLayout.size(ofValue: Level1.case1(...))` puts a size call and a case conversion on one line), and a global line set would re-line or delink an unrelated edge.
- The truth oracle carries the same rule (its old version spliced on TARGET alone, which is why the loss was two-sidedly invisible), so the mirror is now stated once per side.

Fixture `swift/enum-construction-splice` pins both halves (the surviving call AND the converted construction, with the near-miss scopes); mutants `swift/enum-splice-first-edge` and `swift/enum-splice-no-conversion` are CAUGHT. Full extent, before/after: **alamofire** 98/98 files — the `MISSING Tests/TestHelpers.swift :: calls -> method` row is gone, tree-truth 3,550 → 3,549 and analyzer-edges 3,491 → 3,490 move together (the fabricated duplicate of the same pair), `MISSING=0 unexplained=0`; `swift-nio` 554/554 files `0/0`.

This is a completeness fix, not an accounting one: the restored edge is a real call from `Endpoint.get` to `Endpoint.method`.
