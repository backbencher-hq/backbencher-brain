# src/ast UNION — classification of the 61 divergent paths

Method: for each path, `git show HEAD:<p>` and `git show origin/main:<p>` were both read, then every
hunk was classified as (a) HEAD-only, (b) main-only, (c) a REPLACEMENT (both sides changed the same
region). `triage.py` then asks, for each main-only line, whether it has a NEAR-MATCH among HEAD's
additions (difflib ratio >= 0.6): if it does, main's line is the PRE-REWRITE form of a line HEAD
rewrote (HEAD supersedes it); if it does not, main carries content HEAD does not have (a real union).

## RESULT
  HEAD-SUPERSEDES  20 paths — main's unique lines are all near-matches of HEAD's rewrites
  MAIN-DELETED      7 paths — main deleted the file; HEAD's copy is kept (deletion loses no work)
  NEEDS-UNION      33 paths — main carries content HEAD lacks (the residual, sized below)
  NO FREE-STANDING MAIN ADDITIONS anywhere: every one of the 49 differing files has REPLACEMENT hunks,
  i.e. both sides rewrote the same regions. There is no file where main's work can simply be appended.

## UNIONED (2)
  src/ast/real-c-analyzer.ts      HEAD had CORRUPTED COMMENT TEXT ("boundary; me", "`union U` is  mea
                                  union"); main had it clean -> main's two lines restored, everything
                                  else HEAD's. `npx tsc --noEmit` -> 0.                      (3963f67c4)
  src/ast/pool-worker.ts          main exports `importBindingNames` (0 occurrences here) and its
                                  `filterNoiseRelationships` takes a FOURTH parameter `boundNames` used
                                  at one place (`!(boundNames && boundNames.has(leaf))`). THIS BRANCH'S
                                  BODY IS NEWER (binding-separator fix, `!declaredTarget` exemption), so
                                  main's parameter and hatch were PORTED INTO it and the helper taken
                                  verbatim. RESULT: the ratchet's THREE errors clear (TS2305 + 2x
                                  TS2554); 1 file / 5 errors remain elsewhere.                (ec32ebf30)

## HEAD-SUPERSEDES (20) — verified by reading the hunks, not by the ratio alone
  override-companion-pass.ts · override-context.ts · project-index.ts · real-clean-analyzer.ts ·
  real-clojure-analyzer.ts · real-csharp-analyzer.ts · real-graphql-analyzer.ts · real-hcl-analyzer.ts ·
  real-makefile-analyzer.ts · real-markdown-analyzer.ts · real-perl-analyzer.ts ·
  real-powershell-analyzer.ts · real-protobuf-analyzer.ts · real-r-analyzer.ts · real-sql-analyzer.ts ·
  real-zig-analyzer.ts · types.ts · visualization/map-renderer.ts
  Spot-verified examples: `fingerprint.ts` (main `ignore().add(...)` vs HEAD
  `ignore({ ignorecase: false })` — HEAD carries the ignorecase fix); `real-rust-analyzer.ts` and
  `real-perl-analyzer.ts` (main's dotted `Base.member` target vs HEAD's leaf — HEAD carries the overrides
  fix); `map-renderer.ts` (main's MAP_BODY has a DUPLICATED save button and its MAP_SCRIPT lacks HEAD's
  `if (!N.length)` guard).

## MAIN-DELETED (7) — keep HEAD's copy; a deletion loses nothing
  file-claim.ts · index-space.ts · julia-binding-collapse.ts · member-owner-resolution.ts ·
  project-scoped-identity.ts · visualization/studio-renderer.ts · watchdog-policy.ts

## THE RESIDUAL — 33 NEEDS-UNION paths, by unmatched main-only lines
  real-cpp-analyzer.ts 907 · real-svelte-analyzer.ts 756 · real-typescript-analyzer.ts 595 ·
  import-resolution.ts 579 · parallel-indexer.ts 573 · real-swift-analyzer.ts 441 ·
  real-elixir-analyzer.ts 422 · real-java-analyzer.ts 372 · real-vue-analyzer.ts 351 ·
  real-javascript-analyzer.ts 333 · pool-worker.ts 271 (a SECOND layer: main's remaining lines include
  `import { isDenylistedSymbolName } from "./symbol-name-rules"`) · real-groovy-analyzer.ts 232 ·
  real-kotlin-analyzer.ts 216 · real-scala-analyzer.ts 171 · real-html-analyzer.ts 92 · python 40 ·
  override-retarget.ts 26 · analysis-exclusions.ts 21 · class-diagram-renderer.ts 21 · fsharp 19 ·
  dart 13 · php 13 · toml 6 · scss 5 · yaml 5 · json 4 · css 3 · language-detection.ts 2 ·
  julia 2 · lua 2 · bash 1 · rust 1 · xml 1

  NONE OF THESE WAS TOUCHED. They are named residuals rather than guessed unions, which is the
  instruction: "an untouched path is a named residual; a wrongly merged one is a lost line."
  The dependency worth naming first: `pool-worker.ts` still lacks main's `symbol-name-rules` import,
  and `parallel-indexer.ts` (573) is the hot file the batch was called for.


---

# parallel-indexer.ts — the hot file, and TWO VERIFIED FALSE POSITIVES of the heuristic

The heuristic ranked 69 unmatched main-only blocks (856 lines). **Reading the two the Lead named shows
BOTH are PRE-REFACTOR forms of code this branch restructured, not missing work:**

* **main:3230-3238 `enclosingStoreableId`** is an INLINE closure over `storeableSpans` (with the
  "scanning backwards returns the INNERMOST holder first" comment). **This branch has hoisted exactly
  that logic into the shared helper `enclosingSpanId(storeableSpans, line)`** (plus
  `enclosingSpanIdByName` for the by-name variant) and calls it at `:3650`/`:3668`. **Porting main's
  block would DUPLICATE the logic**, and the comment it carries is already the helper's documented rule.
* **main:3142-3214 (JS_FAMILY + the inline `SYMBOL_NAME_DENYLIST` builder)**. This branch has
  `JS_FAMILY` at module scope (`:3048`) and builds the denylist through
  **`makeStoreableName(...)`** (`:3630`), which returns `{ denylist, isStoreable }`. Main's block is the
  INLINE form that this branch factored out.

**SO THE HEURISTIC'S FAILURE MODE IS AT REFACTOR BOUNDARIES, AND IT ERRORS IN BOTH DIRECTIONS**: it can
call a superseded inline form "unmatched" (the two above), and it called main's
`import { isDenylistedSymbolName } from "./symbol-name-rules"` unmatched in `pool-worker.ts` when this
branch has the equivalent import spelled differently. **The 573/856 figure is therefore an UPPER BOUND
on missing work, not a count of it** — and the two blocks the Lead asked to check both fall on the
"already here, restructured" side, which is the answer that matters most for this file.

**AND ONE BLOCK IS A GENUINE MAIN-ONLY FEATURE, VERIFIED BY ABSENCE**: main:6752-6782 — *"Put back the
target POINTER of every snapshot row that the store re-stored… it must NOT go through name resolution:
a name match can pick a DIFFERENT same-named symbol… 187 of 10,171 rows stored a different payload after
a re-index"*. **This branch has ZERO occurrences of `target_pointer`/`targetPointer`** while main carries
the repair statement (`UPDATE brain_relationship SET target_symbol_id = i.target_id …`). It touches the
STORE REPAIR path rather than the insert path, and it is left UNPORTED deliberately: it is the one block
worth a careful read before it goes anywhere near the production write path, and a wrongly merged line
here is a lost line in the hot file.

Blocks by feature that DO exist here, so they are not missing work: `repaired` (HEAD 18 mentions),
"imported name" (6), `snapshot` (21).

---

# THE INSTRUMENT'S BOUND, RE-RUN AFTER THE REPAIRS — AND IT IS NOT MONOTONE

    file                     main-only before -> after   unmatched before -> after
    parallel-indexer.ts            964 -> 778                 573 -> **688**
    import-resolution.ts           656 -> 637                 579 -> **612**
    real-c-analyzer.ts               1 ->   0                   1 ->   **0**

**THE REPAIR WAS ABSORBED — `parallel-indexer`'s main-only count fell by 186, which is main's 178-line
repair plus its doc — AND THE UNMATCHED COUNT ROSE BY 115.** The reason is structural rather than a
contradiction: absorbing a block RE-ALIGNS the diff around it, and lines that previously found a
near-match among HEAD's additions now find none because those additions moved. `real-c-analyzer.ts`,
whose union was pure line-restoration with no alignment shift, went 1 -> 0 in both columns.

**SO THE UNMATCHED COUNT IS ALIGNMENT-SENSITIVE AND MUST BE READ WITH THE MAIN-ONLY COUNT BESIDE IT,
PER FILE — never as a single total across a batch whose alignment has changed.** The honest calibration,
and the reason the Lead's question ("report the new bound beside the old one") was worth asking: a bound
that moves in the opposite direction from the residual is a bound nobody should quote alone.

---

# real-typescript-analyzer.ts — THE EXTERNAL-TARGET MARKING SUBSYSTEM: INVENTORIED, NOT YET PORTED

**Why it matters**: an edge to a dependency's member, a Node builtin's or a runtime global's member
cannot bind to project source, and the fleet gate requires such an edge to be **MARKED**
(`metadata.isExternalTarget` + `externalReason`, four provable facts) rather than read as an unresolved
binding. **This branch has NONE of it**: `markExternalTargets` 0 occurrences, `warmProjectPackageFacts`
0, `isExternalPackageSpecifier` 0, `collectRequireBindings` 0, `workspaceRoot` 0.

**THE PORT IS FOUR PIECES, AND THE TWO BIG ONES GO IN DIFFERENT SCOPES — which is the whole difficulty
and the reason three attempts produced misplaced code that was reverted rather than shipped:**

1. **MODULE SCOPE — main 1177-1301 (125 lines)**: `RUNTIME_GLOBAL_RECEIVERS`, `GLOBAL_TYPE_NAMESPACES`,
   `boundImportNames`, `unquoteSpecifier`, `externalReceiverOf`. Insert before
   `const WHITESPACE_CHARS =` (verified unique; this insertion SUCCEEDED and typechecked).
2. **CLASS SCOPE — main 3998-4298 (301 lines)**: `markExternalTargets`, `collectRequireBindings`,
   `isExternalPackageSpecifier`, `workspaceRoot`, `warmProjectPackageFacts`. **Insert immediately after
   `class TypeScriptAnalysisRunner {` (HEAD:2365).** DO NOT anchor on `private findTypeAnnotation(` —
   that method is NOT in this class (the file has five classes: `ScopeManager` 480,
   `TypeScriptModuleResolver` 630, `TypeInferenceEngine` 1318, `TypeScriptAnalysisRunner` 2365,
   `RealTypeScriptAnalyzer` 7653), and anchoring there puts the subsystem in the wrong class.
3. **THREE STATIC CACHES — main 7489-7491**: `dependencyPackageCache`, `workspaceNameCache`,
   `workspaceRootCache`. **They must be class-ACCESSIBLE, not `private static`**: main declares them
   private while its MODULE-LEVEL cluster reads them, which is a type error under this tsconfig — the
   Lead's rule ("a file that compiles in one tsconfig is not thereby compiled by another") in reverse.
4. **CALL SITE — main 2336-2337**: after `this.classifyEvidenceTier(relationships)` (verified unique at
   HEAD:2204): `this.warmProjectPackageFacts(projectRoot)` then
   `this.markExternalTargets(relationships, symbols, rootNode, projectRoot)`.

**STATE: REVERTED TO HEAD, `npx tsc --noEmit` -> 0, file sha 72781ea71047 (byte-identical to HEAD).**
The three attempts each produced a red tree (subsystem at module scope twice, then a doc-comment walk
that swallowed the wrong boundary); **a green tree with a named residual beats a red tree with a
half-ported subsystem**, and the inventory above is what the next attempt needs — in particular the
scope split, which is the part that is not obvious from the diff.

---

# RE-CHECKED ON THE CORRECT BASIS (`git diff HEAD 1b71d837c`), AFTER THE REWRITE

**The basis moved under the instrument**: `origin/main` was pushed to a merge whose TREE IS OURS, so a
measurement against `origin/main` now reads ~6 paths and means nothing. Re-run against `1b71d837c`
(verified to be MAIN's side: `markExternalTargets` occurs **2** times there and **0** at HEAD):
**`HEAD-SUPERSEDES 20 · MAIN-DELETED 7 · NEEDS-UNION 33` — IDENTICAL to this file's original
classification**, which is the expected result: the original run was taken BEFORE `origin/main` was
overwritten.

**AND MY OWN RE-RUN REPRODUCED THE WRONG-BASIS ARTIFACT FIRST, which is the part worth recording**: the
`sed` that switched the ref matched `"origin/main"` in the path-list line but NOT the f-string
`f"origin/main:{p}"` that fetches the CONTENT — so the run listed the correct 60 paths and then compared
each against OUR OWN TREE, printing `main-only 0 · unmatched 0` for every path, including
`real-typescript-analyzer.ts` where `markExternalTargets` is provably main-only. **The falsifier that
caught it: a file known to differ must not read 0.** A refactor of the basis must be verified with a
marker, not with the absence of an error.

**THE CORRECT-BASIS RESIDUALS, ranked by unmatched main-only lines** (595 for `real-typescript`,
518 for `import-resolution`, and the rest as previously listed). The earlier "612" for
`import-resolution` came from the mis-based run and is WITHDRAWN; 518 is the correct figure.
