# cpp `imports` — 99.5% unresolved because an `#include` names a FILE and the resolution key space is symbols

**Author:** Muhammad Ishaq Khan · **branch:** `analyzers/ontology-laptop-b` · **date:** 2026-10-17
**Status:** PROPOSAL + DIAGNOSIS. I checked the in-scope options and they cannot move this number;
the evidence is below so the Lead can rule rather than re-derive it.

## 1 · The number, and what it is not

`CPP-RESIDUAL.md` §1 (whole population, 2026-10-16): `imports` **45,829 edges · 228 resolved
(0.5%) · 0 collRes · 510 amb(decl) · 45,091 unresolved (99.5%)**, of which 43,646 have no
declaration anywhere (`noDecl`) and 2,143 name a declaration that resolves to an arbitrary twin.
§2(c) named it "the second carrier" and deliberately did not diagnose it. This is that diagnosis.

**The 228 "resolved" are not a working mechanism.** The analyzer emits the include's written path as
the edge target (`real-cpp-analyzer.ts:2769-2788`, `target: includePath`, metadata
`{relationshipType: "include_dependency", isSystem, module, fileLevel, ...}`). A path equals a
symbol's NAME only by coincidence (`#include "distance"` and a symbol named `distance`), so 228 is
noise, not headroom.

## 2 · Measured target shape (the input to any decision)

Method: 400 cpp files, one per-repo stride (40/repo × 10 repos that carry cpp), every
`^\s*#\s*include\s*[<"]([^>"]+)[>"]` directive parsed, 1,987 directives. Re-runnable with the loop
quoted in §5.

```
quoted (")   990     literal path resolves to a repo file        202
                     basename exists ELSEWHERE in the repo        722
                     names no file in the repo                     66
angle  (<)   997     basename exists in the repo                  225
                     names no file in the repo                     772
```
**924 of 990 quoted includes (93.3%) name a file the project actually contains** (202 by the
literal written path, 722 by basename under include-path conventions), and only 66 name nothing.
225 angle-bracket includes are also project headers (include-path-configured builds); 772 are
genuinely outside. So the edges are mostly **real, resolvable dependencies on FILES** — the problem
is that the relation model has no file endpoint.

## 3 · Why no analyzer-only change can fix it (three measured dead ends)

1. **Retarget the include to a symbol name** (e.g. the stem `core` for `fmt/core.h`) would bind to
   whatever symbol happens to carry that name — fabrication. Rejected.
2. **Mark the include external.** All generic external markers (`isStdlib`, `isSystem`, …) route
   through `verifyExternalClaim`, whose path branch is:
   `pathLikeTarget(tgt)` → project file? `externalRefuted` : **`externalUnverified`**
   (`incoming-rule.ts:762-790`). A PASS requires `externalUnverified === 0`, so marking the 45,091
   paths external converts `unresolved` into `extUnverified` and the lane still cannot pass. It is
   not a fix, it is a move.
3. **Emit the file claim `importProjectFile`** (`FILE_CLAIM_KEY`). Polarity is the one we want:
   `verifyFileClaim` returns `externalVerified` when a candidate IS in the project's admitted file
   list and `externalRefuted` when it is not (`incoming-rule.ts:559-588`). But (a) an analyzer
   processing one file cannot know the project's file list, so the 66-of-990 (6.7%) quoted includes
   that name nothing — plus every angle include of a non-repo file — would be REFUTED, and
   `extFAIL` must be 0; (b) even when verified it lands in `extOK`, **not in `resolved`** — the edge
   still does not resolve to a declaration, because the intent is a file. It buys a cleaner column,
   not the bar's requirement.

## 4 · The two changes that would actually close it (Lead decision)

**Option A — a FILE-RESOLUTION outcome (the correct model).** `imports` is the one relationship
type whose endpoint is a file: the store already has `brain_import` with source/target file ids, and
the gate already builds `facts.files`. Add to the arbiter an outcome `resolvedFile`:
an `imports` edge whose target resolves to an admitted project file — literal path relative to the
importing file's directory, then a UNIQUE basename match — is RESOLVED, with the target file named
in the report. Externals (no match) then need a verifiable claim, which for a path is exactly the
`importOutsideProject`/`projectFile` polarity that already exists.
*Cost:* `script/m14/incoming-rule.ts` (one outcome + one matcher), `incoming-gate.ts` (column and
`facts`), and a decision that a file can be a relationship endpoint in the residual model. Measured
upside on this sample: at least 924/990 quoted and 225/997 angle = **~58% of imports become
resolved-to-file** before any name-space question. `collRes` cannot rise (no symbol binding).
*Risk:* a duplicate basename must NOT be picked — uniqueness is the condition, same rule the symbol
side uses.

**Option B — reclassify `imports` as a file-dependency fact with its own columns (the cheap,
honest one).** Keep the symbol-resolution bar for the nine symbol-target types and report `imports`
as `fileDeps`: resolved-to-file / external / dangling, with the same additive-closure discipline.
This is what the lane document already says ("0% by design — the target is an EXTERNAL module
name"), but the gate currently forces that statement into `unresolved`, which reads as a defect and
inflates the residual by 45,091 (13.3% of the whole population's unresolved mass).
*Cost:* reporting only, no analyzer change; but it changes the fleet's column meaning, so it is a
Lead call.

**Recommended staging:** B now (it corrects a mislabelled 45,091 immediately and needs no model
change), then A when a file endpoint is wanted in the graph. `imports` is not fixable inside
`real-cpp-analyzer.ts`; the loop's rule is "if doable, do it; only if not doable may we say
otherwise, with evidence" — this is the evidence.

## 5 · Re-running §2

```bash
cd /home/ishaq2321/bb_tests/repositories   # 400-file per-repo stride; see CPP-STATE.md I2
python3 - <<'EOF'
# loop: for each repo with cpp files, take every len//40-th cpp file, read it, match
# ^\s*#\s*include\s*([<"])([^>"]+)[>"] and classify: quoted/angle, literal-path hit against
# `git ls-files`, basename hit, or no file. Counts in §2 were produced exactly this way.
EOF
```
