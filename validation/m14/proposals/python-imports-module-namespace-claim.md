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
