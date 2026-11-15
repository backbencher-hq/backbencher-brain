# PROPOSAL — a fail-closed project-absolute refiner for python's import-bound external claims

**Lane: python · owner: direction-matrix · 2026-10-17 · status PROPOSED, NOT LANDED.**
**`script/m14/incoming-rule.ts` is LEAD-OWNED; nothing here is applied to it.** Read-only measurement,
instrument `.tmp-dm/py-falsifier3.mts` (gitignored), sample
`validation/m14/fixtures/python/census-2026-10-17/claim-audit-sample.tsv` (10,649 claimed edges, the other
writer's own audit sample), analyzer mtime **2026-10-17T12:37:06** at every reading.

## §1 THE MEASUREMENT — THE HOLE IS REAL, AND THE OBVIOUS TEST IS VACUOUS

**FIRST, THE VACUITY CORRECTION.** The obvious form of the test — *does the specifier root match a
same-repo TOP-LEVEL directory or module stem?* — returns **0 of 10,649**, but **it is not evidence**: the
sample's three repos (`Grace` 10,545 claims · `Fabulous` 57 · `Flux.jl` 47) have **0 top-level python
directories and 0 top-level module stems at their root**, so the detector's input set was empty. A zero over
an empty set is not a zero. (§6.11, in my own instrument this time.)

**SECOND, THE CORRECTED TEST — ANY DEPTH, against every python package directory in the repo:**
```
ANY-DEPTH PROJECT-ABSOLUTE:   1,131 of 10,649 claims (10.6%)
  specifier root names a python package directory ANYWHERE in the same repo
  e.g.  target=get_default        spec=grace_generated_openapi_probe.api_client
        target=InlineObject2      spec=grace_generated_openapi_probe.models.inline_object2
        target=ApiResponse        spec=grace_generated_openapi_probe.api_response
detector input: Grace (9 package names, 650 py files) · Fabulous (1, 6) · Flux.jl (1, 1)  <- NON-EMPTY, so the
zero above could have been non-zero and the corrected test's 1,131 could not have been manufactured
```
**THE CLAIM IS TRUE AND STILL WRONG.** *"The project key space does not answer this name"* holds (the key
space publishes SYMBOLS; `grace_generated_openapi_probe` is a DIRECTORY), and the edge is labelled external
while **it imports the project's own generated code.** This is the shape java refuses (`org.`/`com.`:
*"in a multi-module build `com.acme` IS project source"*).

**THIRD, THE CROSS-FILE DECLARATION HOLE — measured over ALL 10,649 claims, not sampled:**
```
CROSS-FILE DECLARATION:       860 of 10,649 claims (8.1%)
  the TARGET is declared as `def`/`class` in ANOTHER file of the same repo
  e.g. target=InlineObject2 (declared in models/inline_object2.py) · ApiResponse · get_default
```
**The verifier did not refute these, which means the gate's project declaration space is NARROWER than the
repository** — most likely because the "project" the loader assigns these generated-SDK files to is a
subdirectory, not the repo root. **That is a project-scope question, not a claim-shape question, and it is
flagged for the Lead's decision below.**

**FOURTH, THE TYPE_CHECKING HOLE: 0 of 10,649 claims come from an import inside an `if TYPE_CHECKING:` block**
on this sample — the sample is generated pydantic/openapi code with no typing blocks, so this zero is about
THIS SAMPLE and does not clear the class.

## §2 THE PROPOSED RULE — FAIL-CLOSED, NEVER REFUTES, ONE SHARED CHANGE

**Where:** `script/m14/incoming-rule.ts`, in the external-claim verification (`classifyEdge`'s external
branch, before `verifyExternalClaim` returns a VERIFIED verdict). **The data it needs is the project's file
set, which the gate already builds (`ProjectIndex`) — the same facts the `projectFile` claim uses.**

**Rule (design):** an `owner`-kind external claim whose evidence names an IMPORTED MODULE (`externalSpecifier`)
is **downgraded to `externalUnverified` (`ext?`)** when the module's ROOT names a python package in the
project's own file set — i.e. when the project carries a directory containing `.py` files whose basename
equals the root, anywhere under the project root. **Never `externalRefuted`** — so `extFAIL` cannot rise by
construction, the fail-closed direction the task requires.

```ts
// PROPOSED (lead-owned file; exact placement must match the existing branch order):
// in the external-claim branch of classifyEdge, BEFORE returning externalVerified:
const spec = String(md?.externalSpecifier ?? "")
const root = spec.split(/[.:]/)[0]
if (claim.kind === "owner" && root.length > 0 && projectModuleNames(facts).has(root)) {
  return { outcome: "externalUnverified", decls, kinds: kindText,
           verifiedBy: undefined, downgraded: "project-absolute-module" }
}
// projectModuleNames(facts): every basename of a directory that contains *.py under the project root, plus
// every *.py stem. Built once from the same file list `projectFile` verification already uses.
```

**Second, smaller rule for the cross-file hole (Lead's decision, not mine):** the same branch should consult
**the project symbol space for the TARGET** before verifying — the verifier already does (`declCount`); the
860 show the `declCount` it receives is scoped narrower than the repo. **Either widen the project scope fed
to `declCount`, or downgrade to `ext?` when the target is declared anywhere under the repository. The
fail-closed version is the downgrade; the correct version is widening the scope — that is your call because
it changes every lane's project scope, not python's claim.**

## §3 THE ACCEPTANCE AXES (what I will measure after you land it)

```
SAMPLE (first-150 admitted files, 10,649 claims)
  extOK                        7,748 -> ~6,617   (-1,131: the project-absolute claims become ext?)
  ext?                             0 -> ~1,131   (fail-closed, NOT refuted)
  extFAIL                          0 -> 0         BY CONSTRUCTION
  collRes / arbitraryTwin   BYTE-IDENTICAL         a claim is not a resolution
WHOLE POPULATION (one run, mtime recorded)
  imports unresolved 64,462 · the recall number RE-MEASURED, never assumed; the corrected figure will be the
  one I report — 10.6% of the import-claim win is a mislabel, and the STATE's "27.1% unresolved reduction"
  must be restated with the corrected extOK.
```

## §4 WHAT THIS MEANS FOR THE RECALL NUMBER, STATED BEFORE ANYONE ASKS

**The other writer's `unresolved` reduction is real (−27.1% on the cap-400 row, collRes/arbitraryTwin
byte-identical) — but its `extOK` attribution is overstated by 1,131 of 10,649 claims (10.6%) in this
sample.** A claim that moves an edge out of `unresolved` and into a WRONG external label is better than
`unresolved` only if "no answer" is the worse failure; the bar says a claim must be one the project
**verifies**, and these 1,131 are claims the project's own files contradict. **The fix is cheap and
fail-closed; the recall number should be reported net of it.**

## §5 WHAT I DO NOT CLAIM

* Not that all 1,131 are wrong in the same way — the detector names the mechanism (project package root), and
  a per-row read of ten of them is in §1's examples; I did not hand-read all 1,131.
* Not that the 860 cross-file rows are claim defects — they are evidence the gate's PROJECT SCOPE is narrower
  than the repository, which may be a loader question rather than a claim question.
* Not that the TYPE_CHECKING class is absent fleet-wide — only that it is 0 in this generated-code sample.
