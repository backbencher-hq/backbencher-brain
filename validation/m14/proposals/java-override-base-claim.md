# PROPOSAL (java) — owner-aware `overrides` resolution (or an `overrideBase` claim), because a name alone cannot name a base member

**From:** java lane owner · **date:** 2026-10-17 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/**` (arbiter) and/or `src/ast/parallel-indexer.ts` (store binding) — neither is
this lane's write scope.
**Evidence:** `validation/m14/verification/JAVA-STATE.md` §6, instrument `.tmp-java-state/iter1-intent.mts`.

## WHAT WAS MEASURED

The lane's `overrides` targets now spell the **member leaf** (the branch's fleet convention: `localEdgeName`,
commit `45b879423`; re-applied here after a file-level take reverted it). At cap 400 that moved the type
from `unresolved 1,182 / resolved 0` to `unresolved 0 / resolved 543 / amb(decl) 651`, `intent`
nothingAnywhere 1,194 → sameFileUnproven 1,194, **arbitraryTwin byte-identical at 3,960**.

Recreating the gate's project-scoped name key space over the same 400 files and asking whose declaration
each unique name binds to:

```
resolved 543:  owner matches the analyzer's resolving owner (`metadata.declaringType`) : 1
               owner DIFFERS (the declaration is the OVERRIDING method itself)       : 542
of the 542:    433  the intended base IS declared in the repo -> at whole population the leaf has
                    >=2 declarations, production's count==1 rule does not bind (honest ambiguity)
               109  the base is NOT in the repo -> UPPER BOUND on edges that bind to the override
                    itself (a false binding; <=9% of the type)
```
Ten hand-read edges confirm the intended declaration is reachable and nameable — e.g.
`clojure/.../asm/AnnotationWriter.java:190 AnnotationWriter.visit -> "visit"` is
`AnnotationVisitor.java:109 AnnotationVisitor.visit` — but the resolver is given only the string `visit`.

**THE ANALYZER-SIDE ALTERNATIVE WAS PRICED AND IS REJECTED.** Java methods publish
`pkg.Type.member` qualifiedNames and the gate indexes them as aliases, so targeting `pkg.Base.member`
resolves EXACTLY to the base member. It would push all 1,194 edges into `arbitraryTwin` at the gate
(`classifyIntent` finds the declaration in another file) — the one movement the owner forbids. So the lane
will not do it unilaterally; the fix belongs to the resolver.

## THE ASK

**Option A (resolver preference, smallest):** when the name has more than one declaration and the edge
carries `metadata.declaringType`, `resolveRelationships` prefers a declaration whose OWNER matches the
simple name (last segment) of `declaringType`; if exactly one does, bind to it. Same rule in the gate's
`classifyIntent`/`classifyEdge`: a unique owner match reads `resolved`, not `amb(decl)`. This turns the
433 honest-ambiguous edges into intended bindings and leaves the 109 external-base edges unbound (no owner
match) instead of self-bound.

**Option B (a claim kind, larger):** an `overrideBase` claim carrying `declaringType` + `member`, refutable
against the project's `typeMembers` (`ProjectIndex.typeMembers` already stores exactly "which members this
type declares"). Verified → counts like `extOK` but means "the base is outside this project"; refuted when
the named type IS declared and does NOT declare the member — which also catches a wrong hierarchy guess.

## ACCEPTANCE FOR EITHER

- the ten hand-read edges above resolve to the base's file:line, and the intent census's `ownerDiffers`
  count goes 542 → 0 (Option A) or the 109 unbound edges carry a verified claim / honest ambiguity
  (Option A leaves them ambiguous; Option B verifies the external ones).
- `arbitraryTwin` does not rise (it is 3,960 at cap 400 today).
- no edge count changes; `contains` and `imports` rows are a falsifier (must be byte-identical).

## WHY THIS IS NOT URGENT ENOUGH TO BLOCK THE LANE

The leaf spelling is still strictly better than the pre-fix state (unresolved 1,182 → 0, no twin rise, 6
fixtures recovered). The residual is bounded and named: at most 109 self-bindings out of 1,194 overrides.
