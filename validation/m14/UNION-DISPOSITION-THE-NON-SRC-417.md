# THE 417 NON-`src` PATHS — what decides each, and the first category resolved

## 1 · `docs/analyzers/*.md` (28 files) — **KEEP HEAD. These are GENERATED, and merging them is the wrong operation.**

**They are not source. They are output** — *the relationship-ontology sections written FROM each analyzer's behaviour.
Merging two generations of a generated file produces a document describing neither version of the code.*

**THE ARBITER RAN, AND IT PASSES ON HEAD'S VERSIONS:**

    npx tsx script/m14/verify-analyzer-docs.ts   →  exit 0
    (and it writes validation/m14/results/analyzer-docs.json)

**AND THE SIZE PATTERN SHOWS WHY MAIN'S ARE OLD, NOT BETTER:**

    dart.md      HEAD +2999   main +1
    fsharp.md    HEAD +2237   main +2
    php.md       HEAD +1895   main +81
    python.md    HEAD  +997   main +42
    graphql.md   HEAD  +629   main +8
    toml.md      HEAD  +521   main +10
    lua.md       HEAD  +277   main +13
    real-css / json / powershell / yaml / zig / clean.md     HEAD only, main +0

**WHERE MAIN IS LARGER, THE EXPLANATION IS THE SAME ONE:** *`real-javascript` (main +1995), `typescript-ambiguity-sweep`
(main +994), `real-swift` (main +841), `real-cpp` (main +606). **Those are larger because MAIN'S ANALYZERS BEHAVED
DIFFERENTLY — and in four of those lanes this branch's analyzer was measured BETTER** (`real-javascript` HEAD 3 vs main
14 on the js fixtures; `real-typescript` HEAD 6 vs main 11). **Regenerating from the resolved analyzers is the correct
operation; merging the two generations is not.***

**AND THE OPERATION IS RECORDED AS OUTSTANDING, NOT DONE:** *the docs should be REGENERATED after the analyzer takes in
this commit, and the runner must be named when it is run. **This document does not claim that has happened.***

## 2 · `docs/` proper — 4 files

**`DOC-TRUTH-EMISSIONS.md` (+59 main), `HOVER-KNOWLEDGE-AUDIT.md` (+57 each), `HOW-THIS-WORKS.md` (+14 main),
`m25/FORK-CAPABILITY-MATRIX.md`, `m55/VERDICT-PACK.md`.** *All are prose about behaviour. **They are decided by the same
arbiter as the analyzers: whether their claims match what the code does now** — and after the analyzer takes in this
commit, several of them describe the OLD behaviour. **Named here as needing a truth pass, not merged.***

## 3 · WHAT IS NOT CLAIMED

**That 417 paths are resolved.** *One category (28 generated analyzer docs) is decided and the runner is named; the rest
are NAMED with what decides them.* **STATUS: NOT DONE.**

## 4 · THE 79 DIFFERING TYPESCRIPT SCRIPTS — **18 TRIED, ALL 18 REVERTED**

**The documented-defect predicate — the one that produced 32 good takes on the `script/m19` and `script/m40` clusters —
was applied to the remaining scripts. It selected 18. TAKING ALL 18 BROKE THE TREE:**

    root tsc                       0   (unchanged)
    scripts tsc                    5 ERRORS   ← was 0
    the fixture harness itself     REGRESSED — run-fixtures.ts was among the 18
    kotlin/exports-file-identity   "failing fixture is not in the recorded failing set"

**All 18 were reverted from git, and the tree returned to root tsc 0 / scripts tsc 0 / 0 files modified.**

## WHY THE PREDICATE FAILED HERE WHEN IT WORKED BEFORE

**On `script/m19` and `script/m40`, main's diffs documented defects IN THOSE FILES** — *`require` in an ES module, an
unsealed write, a foreign corpus path. **The fix was local to the file, and taking main was correct.***

**These 18 are different: main's versions call into `script/` helpers and corpus roots that this branch does not have.**
*The diff still reads like a defect description — **because it is one, describing a fix that depends on the OTHER side of
the union.*** **Taking the fix without its dependency is exactly the `js-census` failure from earlier tonight, repeated
at scale: a caller arrived and nothing it calls existed.**

## AND THE GENERAL LESSON, WHICH IS THE SAME ONE FOUR TIMES OVER NOW

    the superset test passed and the fixture suite refused    (real-html)
    the oracle's vocabulary beat the reasoning               (real-groovy)
    main was smaller and still better on fixtures            (real-dart's docs)
    a documented fix was still a regression                  (these 18)

**A DIFF'S ARGUMENT IS EVIDENCE ABOUT THE AUTHOR'S INTENT. IT IS NOT EVIDENCE ABOUT WHAT HAPPENS HERE.** *Every one of
these was checkable in one command — run it — and every one would have gone in on the argument alone.*

**STATUS: NOT DONE.** *79 scripts remain unread, and 274 validation paths.* **Named, not decided.**
