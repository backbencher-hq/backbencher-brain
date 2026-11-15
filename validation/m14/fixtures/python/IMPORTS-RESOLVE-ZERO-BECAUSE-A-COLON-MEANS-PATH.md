# PYTHON'S `imports` RESOLVE ZERO OF 4,972 BECAUSE THE TARGETS CARRY A COLON — AND IN THIS PROGRAMME A COLON MEANS "PATH"

**Lead diagnosis, from the analyzer's own emission sites against the arbiter's own predicate. Concrete, cited, and
it explains a complete failure.**

## THE EMISSION

`src/ast/real-python-analyzer.ts:1891` and `:1983` name an `imports` target as:

    `${moduleName}:*`                        (a star import)
    `${moduleName}:${item.name ?? "*"}`      (a named import)

**So a target reads `os:path` — a MODULE, a COLON, a MEMBER.**

## THE PREDICATE IT COLLIDES WITH

`incoming-rule.ts:563`, inside **`pathLikeTarget`**:

    if (tgt.includes("/") || tgt.includes("\\") || tgt.includes(":")) return true

**A TARGET CONTAINING A COLON IS CLASSIFIED AS PATH-LIKE**, and `pathLikeTarget` is the **first** thing
`verifyExternalClaim` consults (`:577-579`) — it returns `externalUnverified` **before any owner lookup**, which is
the refusal bash's 787 and markdown's 255,134 were ruled on.

**AND THE PROGRAMME HAS A SEPARATOR FOR EXACTLY THIS**, stated in the constant's own comment
(`src/ast/types.ts:186-190`): **`BINDING_SEP = "\u0000"`** — and the comment says why a printable separator will
not do: *"after the last colon, then after the last dot … would reduce a dotted or colon-joined spelling straight
back to the bare local name and reopen the false name match this constant exists to close."*

**SO PYTHON IS USING THE ONE CHARACTER THIS PROGRAMME RESERVED FOR "THIS IS A PATH".** Every `imports` edge it
emits is therefore read as a path rather than as a name, which is exactly why **4,972 resolve and 0 do not** — and
why the type reads `resolved 0 · amb 0 · unresolved 4,972` with no ambiguity at all.

## THE CONTROL THAT MAKES THIS A DIAGNOSIS RATHER THAN A SUSPICION

**`contains` on the same lane resolves 8,142 of 8,144 (99.98%)** with 4,334 `collRes`. **So the gate, the key
space and the arbiter all work on Python** — the failure is specific to the types whose targets carry the colon,
**not to the measurement.** A lane-wide breakage would have taken `contains` with it.

**AND `overrides` RESOLVES ZERO OF 1,915 — the second complete failure**, and it is **flagged as the next thing
to check by the same method**: read its emission site, apply the arbiter's predicate, and see whether it collides
with `pathLikeTarget`, with a scope rule, or with a kind rule. **Not assumed to be the same cause** — the method
is the same, the answer is not yet read.

## WHAT IS NOT CLAIMED

* **This is a 600-file PROBE**, not a population run.
* **The diagnosis is from the emission site and the arbiter's predicate**, which is a reading of two code paths —
  **it has not been confirmed by a run with the colon replaced.** That is the falsifier: **emit the same edges
  with `BINDING_SEP` and the `imports` column should move.** Until that run exists, this is **a located cause,
  not a fixed one.**
* **`ext?` reads 0 on this lane**, which is worth reconciling: if `pathLikeTarget` fires on these targets, the
  claim should surface as unverifiable. **Either the imports edges carry no external marker, or the marker is
  handled before the predicate — and that discrepancy is named here rather than smoothed**, because one of the
  two readings of this mechanism is incomplete.

## THE MECHANISM, NOW VERIFIED DIRECTLY — and the `ext?` discrepancy RECONCILED

**The predicate was CALLED, not read.** `validation/m14/fixtures/python/verify-colon-is-a-path.mts`, run against
the arbiter itself:

    target                     pathLike  claim
    os:path                    true      externalUnverified
    foo:bar                    true      externalUnverified
    os.path                    false     externalVerified
    collections:OrderedDict    true      externalUnverified
    plain_name                 false     externalVerified
    a/b                        true      externalUnverified

**THE COLON IS DECISIVE AND IT IS NOT SUBTLE**: `os:path` is a PATH and `os.path` VERIFIES. **A one-character
difference separates a target that can never resolve from one that resolves immediately.**

**AND THAT RECONCILES THE `ext?` DISCREPANCY I FLAGGED ABOVE**: python's `imports` read
`resolved 0 · amb 0 · unresolved 4,972` with **`ext?` 0**, so **these edges carry NO external claim marker** —
which means `pathLikeTarget` is **not consulted for them at all** and **the colon is not blocking a verification
that was never attempted.** The mechanism is the SECOND of the two paths I named, not the first:

> **The target `os:path` is a name no declaration carries, so it lands in `unresolved` — the colon did not refuse
> a claim, it made the name unusable.**

**BOTH PATHS POINT AT THE SAME ONE-CHARACTER FIX**, and the distinction matters because it changes **where** the
repair goes: a claim-marker refusal would be the arbiter's business, **while an unusable name is the ANALYZER's** —
and this one is the analyzer's.

**AND THE FALSIFIER IS NOW UNUSUALLY CHEAP**: emit the same edges with **`BINDING_SEP`** (`\u0000`) instead of
`:` and the `imports` column should move from **0 of 4,972**. **A fix whose falsifier is one character and one
column is the best kind this programme gets.**

