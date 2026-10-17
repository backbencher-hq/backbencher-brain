# PROPOSAL — an `imports` module-namespace claim (python), and why it cannot be landed in-lane

**Author: Muhammad Ishaq Khan. Lane: python. 2026-10-17. Status: PROPOSED, not landed.**
**It needs a change in `script/m14/incoming-rule.ts`, which this lane does not own. Nothing in this
document has been applied to the analyzer.**

## §1 THE CLASS, MEASURED

The whole-population gate at HEAD (`bun run script/m14/incoming-gate.ts python py 0`, log
`validation/m14/fixtures/python/PYTHON-gate-whole-before.txt`) reads:

```
imports   99,734 edges   resolved 26,255   amb(decl) 9,017   unresolved 64,462
```

That is **21.7% of the lane's whole residual** (64,462 of 297,485 unresolved) — the second-largest
unresolved class after `calls`, and the largest class with NO claimant: the analyzer emits the edge,
the module it names is a real dependency, and nothing the arbiter reads can say so.

The target spelling is `module:item` (`pathlib:Path`, `xml.sax.handler:ContentHandler`) and
`module:*` for a namespace import (`os:*`). The shape census
(`validation/m14/fixtures/python/imports-shape-census.mts`, first-400 admitted files, artifact
`census-2026-10-17/imports-shapes-400.json`) bins the slice's 6,661 `imports` edges:

| shape | edges | module root in `sys.stdlib_module_names` (300 names) |
|---|---|---|
| `from M import X` (target `M:X`) | 3,100 third-party/local | 2,576 |
| `import M` / `import M as A` (target `M:*`) | 7 third-party | **978** |
| relative/local bare item (round 18's retarget) | 0 in this slice | — |

So **3,554 of 6,661 (53.4%) name a STDlib module** — a closed, language-defined fact. If that share
holds at whole population, **≈53,000 of the 64,462 unresolved `imports` edges (17.8% of the lane's
whole residual)** could be certified by the same kind of claim the builtin round already landed.

## §2 WHY NO EXISTING CLAIM VERIFIES A COLON TARGET — checked kind by kind

| claim kind | check | verdict on `pathlib:Path` |
|---|---|---|
| `namespace` (`languageNamespace`) | `namespaceMatchOf(tgt, roots)`: `tgt.split(".")` prefixes | **fails**: `"pathlib:Path"` has no dot before the colon, so the only candidate IS `"pathlib:Path"` — no `"pathlib"` entry can match. |
| `owner` (`isExternal`, `isExternalTarget`, …) | `verifyExternalClaim` → `pathLikeTarget(tgt)` first | **unverified, not verified**: the colon makes `pathLikeTarget` true, and `URI_SCHEME` `/^[a-z][a-z0-9+.-]*:/i` matches `pathlib:` → `externalUnverified` (`ext?`), which BLOCKS a PASS rather than excusing the edge. |
| `importPath` (synthesized for `imports`) | `DOTTED_MODULE_TYPE` = dotted path ending in a capitalised type | **fails**: the colon is not a dot. |
| `projectFacts` (`importOutsideProject`) | `verifyImportClaim` handles `package:` / `dart:` only | **unverified**. |
| `sourcePath` | target must contain `/` (or a scheme) | **fails** (a module name is not a path). |
| `binding` | target must carry `BINDING_SEP` | **fails**. |
| `cause` (`baseBeyondRunScope`) | reason must equal `targetOwner(tgt)` | **refuted**: `targetOwner` splits on the last `.`, the colon target has none in the module half, and the claim's base cannot be a colon spelling. |

Every door is closed by the SHAPE of a target the lane's own fixtures pin. That is the definition of
"needs a shared-rule change", not "needs an analyzer marker".

## §3 THE PROPOSED CHANGE (Lead-owned file, additive)

**Add a claim kind that reads the module half of a `module:item` endpoint and matches it against a
DECLARED list, exactly as the namespace claim does for `a.b.C`.**

* **Analyzer side (this lane, after the rule lands):** publish `metadata.moduleNamespace = [...300
  `sys.stdlib_module_names`...]` on `imports` edges whose module's first dot-segment is in that
  list. The list is the claim, one command to regenerate:
  `python3 -c "import sys; print(' '.join(sorted(sys.stdlib_module_names)))"`.
* **Rule side (`incoming-rule.ts`):** a new `ModuleNamespaceClaim` read by `externalClaimOf` from
  that key, and a verifier built like `namespaceMatchOf` with ONE extra step — split the target at
  the FIRST `:` (keeping only the module half when one exists), then match the module's
  dot-segments on boundary, longest first. A target with no colon is unaffected, so no existing
  lane's behaviour changes.
* **Refutability, the property that decides whether a claim may exist:** an edge whose module root
  is not in the declared list reads `externalRefuted` and is charged to the lane (clause 4). The
  analyzer cannot shelter a non-stdlib dependency with it. That is the same two-sided check the
  builtin namespace claim has, applied to a different closed vocabulary.
* **It can never raise `resolved`**: the claim is read only where the target names nothing, so it
  cannot move `collRes` (the class the indexer measures 37,318 of 49,729 wrong).
* **Known limitation, stated rather than hidden:** a project that ships its own `os.py` cannot
  refute this claim, because the namespace family's property 1 says the LIST is the sole authority.
  That is why the list is restricted to `sys.stdlib_module_names` — a language fact — and why
  third-party roots (`torch`, `pydantic`, `grace_generated_openapi_probe`) are NOT claimed by it.

## §4 THE LANE-SIDE ALTERNATIVE, PRICED AND REFUSED

The other way to make the existing namespace claim reach these edges is to change the TARGET:

* `import os` → target `os` (instead of `os:*`), and `from pathlib import Path` → target
  `pathlib.Path` (instead of `pathlib:Path`). Then `namespaceMatchOf` matches `os` / `pathlib`
  against a stdlib list with no rule change at all.

**Refused, for two measured reasons:**

1. **It breaks six fixtures at least** — `decorator-column-lines`, `framework-surface-pins`,
   `import-alias-is-published-as-a-binding`, `import-surface-is-a-set`, `payload-and-complexity`,
   `star-import-is-a-binding-rule` all pin `module:item` targets by name (`os:*`, `typing:Protocol`,
   `django.db:models`, `__future__:annotations`, …). The lane's endpoint spelling is a stated
   contract, and the prior round's rule applies: a fixture break means revert and report.
2. **It is the false-binding direction for the STORE.** The colon is not an accident: the store's
   import path refuses a colon *on purpose* so a `module:item` target is not name-resolved to a
   project symbol that happens to share the spelling (the same measured reason commit `d0f2ea19b`
   kept external items on the colon while retargeting LOCAL ones to the bare item). A dotted
   `pathlib.Path` target would enter the store's qualified-name/suffix strategies and could bind to
   a project symbol named `Path` — the 5-false-binding class that commit measured and rejected.

## §5 WHAT WOULD CHANGE, IF LANDED

The lane's gate rows would move `imports` unresolved → `extOK` (verified), with `collRes`, `resolved`
and the binding-intent columns untouched by construction. The exact numbers are NOT claimed here:
they require the rule change first, and a proposal that predicts its own effect without the
instrument is the shape this programme refuses.

---

# ADDENDUM (direction-matrix, 2026-10-17) — THE EXACT DIFF, RE-BASED ON THE LANDED REFINER AND ON THE LEAD'S FIVE CONDITIONS

**This supersedes §3's verification design.** §3 proposed a narrow, refutable STDLIB-LIST claim. The Lead's
conditions 3 and 4 supersede it: **keep the broad shape** (third-party is as external as stdlib) and **verify
against the SAME file-derived project module space the landed refiner uses** — not a stdlib list, not
`ProjectIndex.complete`. The landed refiner (`8def4a5d5`) already provides the two primitives this needs:
`projectModuleNames(facts)` (`incoming-rule.ts:1070`) and `externalSpecifier` captured on the claim
(`incoming-rule.ts:463`).

## A · ANALYZER HALF (mine — `src/ast/real-python-analyzer.ts`, additive metadata, target untouched)

A post-pass over the emitted `imports` edges (same shape as java's `markExternalTargets`):

```ts
// MODULE-NAMESPACE IMPORT CLAIM. An `imports` edge whose target is `module:item` names a package/module
// this file imports; the target's colon is the lane's pinned contract and is NOT rewritten. The claim
// says "the PROJECT'S OWN FACTS do not answer this module" — verified by the arbiter against the project
// module space, never against a stdlib list (a third-party root is as external as a stdlib one).
// GUARDS: non-relative module (no leading '.'), non-empty module and item, no path separator, not
// `__future__`, and the file itself must not declare a symbol named the module's first segment.
const MODULE_ITEM = /^([A-Za-z_][A-Za-z0-9_.]*):([^:\\/]+)$/
for (const rel of relationships) {
  if (rel.type !== ASTEngine.RelationshipType.Imports) continue
  const m = MODULE_ITEM.exec(String(rel.target ?? "")); if (!m) continue
  const module = m[1], root = module.split(".")[0]
  if (root === "__future__" || declaredInFile.has(root)) continue
  const md = (rel.metadata ??= {} as any)
  md.isExternalTarget = true
  md.externalReason = "module-namespace"
  md.externalSpecifier = module          // the SAME field the landed refiner reads
}
```

## B · RULE HALF (Lead-owned `script/m14/incoming-rule.ts`) — extend the landed refiner block

The refiner already runs on `owner` claims carrying a specifier (`incoming-rule.ts:1242`). **One branch is
added inside it, before the existing downgrade:** a claim whose reason is `module-namespace` verifies the
MODULE (the part before the FIRST colon) against the project module space.

```ts
// ... in the external-claim branch, where `claim.kind === "owner"` and `specifier` is in scope:
if ((md as any)?.externalReason === "module-namespace") {
  // SPLIT AT THE FIRST COLON. `pathlib:Path` -> module `pathlib`; `xml.sax.handler:ContentHandler` ->
  // `xml.sax.handler`, root `xml`. The colon is why the ordinary verifier can only return ext?
  // (`pathLikeTarget` + URI_SCHEME match), so this branch IS the verification path for this claim.
  const colon = tgt.indexOf(":")
  const module = colon > 0 ? tgt.slice(0, colon) : ""
  const root = module.split(".")[0] ?? ""
  // VERIFY, NEVER REFUTE (Lead condition 1): absent from the project's module space -> verified;
  // present -> ext?; empty/odd spelling -> ext?. extFAIL cannot rise by construction.
  const inProject = root.length > 0 && projectModuleNames(facts).has(root)
  return {
    outcome: inProject || root.length === 0 ? "externalUnverified" : "externalVerified",
    decls, kinds: kindText,
    verifiedBy: inProject || root.length === 0 ? undefined : "module",
  }
}
// ... then the existing project-absolute downgrade for `owner` claims follows unchanged.
```

**Why no stdlib list is needed (condition 4):** the claim's statement is *"the project's own facts do not
answer this module"* — for `pathlib` (stdlib), `torch` (third-party) and a sibling package alike, the
verification is the same lookup in the project's module space. **A project's own module is caught by the same
check that caught the 3,744 mislabels**, so this class cannot repeat the project-absolute hole.

## C · ACCEPTANCE AXES (measured after the Lead lands B; analyzer half A is mine)

```
imports unresolved (whole)  64,462 -> extOK by the share whose module root is NOT in the project's module
                                      space (stdlib half + third-party half; the shape census measured
                                      53.4% stdlib on the first-400 slice — RE-MEASURED, not assumed)
resolved / collRes / arbitraryTwin   BYTE-IDENTICAL   (a claim never resolves)
extFAIL                      0 -> 0                    (never refutes, by construction)
ext?                         rises only for project-absolute module roots — the honest outcome
```
**Materials ready on my side:** the analyzer half is a ~20-line additive post-pass; the measurement plan is a
cap-400 stride then ONE whole-population run with both file mtimes recorded. **Nothing here is applied until
the Lead lands B.**
