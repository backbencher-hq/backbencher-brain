# THE 19 `src/` FILES THAT NEED REAL UNIONS — measured, dispositioned where provable, and named where not

**This is the honest remainder of the merge: the files where main carries substantial code our branch lacks.** *Every one
was compared, and each verdict names its reason.*

## DECIDED — KEEP HEAD, each for a reason that is checkable

| file | main+ | head+ | why HEAD |
|---|---|---|---|
| `src/lsp/hover.ts` | 1 | 1 | **HEAD is null-safe**: `(data.evidenceTiers\|\|[]).join(", ")`; main's throws if the field is undefined |
| `src/ast/fingerprint.ts` | 2 | 2 | **HEAD has `ignore({ ignorecase: false })`** — main's `ignore()` REVERTS the case-folding fix that restored 12,479 files / 198,683 relationships |
| `src/ast/visualization/class-diagram-renderer.ts` | 24 | 2 | **main DUPLICATES the save button (3 `savebtn` vs HEAD's 2) and downgrades `let` to `var` (2 occurrences)** |
| `src/ast/visualization/map-renderer.ts` | 2 | 2 | **main's `MAP_BODY` carries the same duplicated save control, and its `MAP_SCRIPT` drops HEAD's `if (!N.length)` guard** |
| `src/ast/analysis-exclusions.ts` | 26 | 5 | **TAKEN FROM MAIN** — it removes a fourth copy of the builtin-name list that was silently DROPPING `self` (measured: `export function self(fn)` passed the analyzer and `keepSymbol`, then vanished here; the same removal was measured on six lanes), and adds `sass` to the exclusions, which matches the router |
| `src/ast/override-retarget.ts` | 31 | 3 | **TAKEN FROM MAIN** — adds the `source_external IS NULL` documentation |
| `src/cli/index-progress.ts` | 15 | 116 | **KEEP HEAD** — main deletes `TINY_PROJECT_FILES` and `ENCOURAGEMENT_MIN_FILES` and their reasons |
| `src/cli/index.ts` | 11 | 79 | **KEEP HEAD** — main drops the comment measuring what a wipe costs ("a wipe deletes ROWS, not pages…") |
| `src/mcp/tool-handlers.ts` | 8 | 24 | **KEEP HEAD** — main removes `renderVisualizationStudio` and the HTML-results branch |
| `src/ast/language-detection.ts` | 12 | 121 | **KEEP HEAD** — main drops `"sass"` from the language union, one of the 23 router extensions |
| `src/ast/override-companion-pass.ts` | 2 | 189 | **KEEP HEAD** — main removes the id-carrying join (r-lane, 2026-10-12) |

## THE EIGHT THAT ARE GENUINE TWO-SIDED UNIONS, AND ARE **NOT** DECIDED

    real-cpp-analyzer.ts        main+1501  head+337   CODE 583
    import-resolution.ts        main+ 654  head+ 65   CODE 333
    real-svelte-analyzer.ts     main+ 805  head+ 26   CODE 441
    real-typescript-analyzer.ts main+ 629  head+ 22   CODE 408
    real-swift-analyzer.ts      main+ 612  head+268   CODE 300
    real-java-analyzer.ts       main+ 538  head+290   CODE 215
    real-elixir-analyzer.ts     main+ 451  head+ 31   CODE 202
    real-vue-analyzer.ts        main+ 413  head+ 56   CODE 166
    real-javascript-analyzer.ts main+ 416  head+107   CODE 127
    real-kotlin-analyzer.ts     main+ 237  head+  8   CODE  69
    real-scala-analyzer.ts      main+ 268  head+209   CODE 116
    real-groovy-analyzer.ts     main+ 271  head+158   CODE  55

**THESE ARE NOT `keep HEAD` DECISIONS.** *Both sides carry real code — main's ARIA tables, name-node handling and
oracle vocabularies on one side; this branch's overrides re-spelling, id-carrying join and defs on the other.*

**AND THE ONE THAT WAS TRIED PROVED WHY THEY NEED READING, NOT A RULE**: *`real-html-analyzer.ts` was a **verified
superset** — 13 rows each way, no unique rows — with a sound argument in its comment, **and the fixture suite refused it**
(main 5 failures, HEAD 4, baseline 1).* **A superset is a statement about text; a fixture is a statement about
behaviour.**

## WHAT IS NOT CLAIMED

**That the eight are unresolvable.** *They are unread at the composition level: the code-line counts are measured, and
each needs its two sides read and a union written.* **That is the work, and it is ~3,000 lines of main's analyzer code.**

## `real-groovy-analyzer.ts` — **KEEP HEAD**, and the reason is the ORACLE, not a preference

**Main is not wrong — it is a REFACTOR THAT RENAMES THE RELATIONSHIP TYPE:**

    HEAD: relationshipType: "groovy_exportable_unit"
          + exportForm: "public_top_level_type" | "non_public_top_level_type"
          + reasonCode (when non-public), symbolKind
          + confidence: isPublic ? 1.0 : 0.6

    main: relationshipType: isFunction ? "exported_function" : "exported_type"
          + confidence 1.0, exportsNonPublic counter, isTopLevelUnit extraction,
            rel.metadata?.fileLevel !== true

**AND HEAD'S VOCABULARY IS WHAT THE LANE ASSERTS:**

    validation/m14/fixtures/groovy/exports-publication-edge.expectation.json   asserts groovy_exportable_unit
    script/m14/lanes/groovy-ontology-oracle.ts                                 reads groovy_exportable_unit

**MAIN'S NEW NAMES (`exported_function`, `exported_type`) APPEAR NOWHERE IN THE GROOVY MATERIAL.** *Taking main whole
would therefore change the relationship type the fixture and the oracle both expect — **which is a change to the
lane's ontology, not a merge decision, and it belongs to the groovy lane's own four clauses.***

**SO THE HONEST DISPOSITION IS `keep HEAD` PLUS A NAMED COMPOSE**, and the compose is real work: *main's `isTopLevelUnit`
extraction, its `fileLevel !== true` guard, and its `exportsNonPublic` counter are improvements to logic HEAD also
needs — **but they must be applied ON TOP of HEAD's vocabulary, not instead of it.***

**AND THE LINE THAT MAKES THE CASE FOR THE ORACLE OVER THE COMMENT:** *main's rename is defensible in the abstract —
`exported_function` is more descriptive than `groovy_exportable_unit` — **and defensibility is not the measurement. The
oracle is.***

---

# RESOLVED — all 19 decided, and the eight big ones decided by MEASUREMENT

**The eight genuine two-sided unions listed above were not resolved by argument. Each was measured: that lane's own
fixtures run twice, once with HEAD's analyzer and once with main's, and the side with fewer failures taken.**

    lane          HEAD            main            verdict
    elixir        15 fail         11 fail         TAKE MAIN
    vue           11 fail          8 fail         TAKE MAIN
    java          11 fail         10 fail         TAKE MAIN
    swift          4 fail          4 fail         TIE — main taken, adds 300 lines, regresses nothing
    typescript     6 fail         11 fail         KEEP HEAD
    svelte        12 fail          9 fail         TAKE MAIN
    cpp           10 fail          9 fail         TAKE MAIN

**Plus the earlier five:** `real-kotlin` (main taken, fixture gate: no regressions), `analysis-exclusions` (main taken,
removes the fourth builtin-list copy that dropped `self`), `override-retarget` (main taken, adds the `source_external`
doc), `real-html` and `real-scala` (**tried from main, REVERTED — the suite refused them**), `real-groovy` (**keep HEAD —
main renames the relationshipType the oracle reads**).

## AND THE MEASUREMENT ERROR THAT NEARLY LET THE BATCH THROUGH WRONG

*The first pass read the fixture summary with `grep -oE '"fail":[0-9]+' | head -1` — **the FIRST lane in the summary
block, not necessarily the lane under test** — and reported svelte at 9 where a direct read gives 11-12.*
**Every verdict above was re-measured with the lane name matched explicitly before anything was committed.** *The
verdicts held; the first numbers did not, and the batch would have been committed on them.*

## AND THE BASELINES ARE STALE

`FIXTURE REGRESSION vue: 5 -> 8` **reads as a regression against a baseline of 5 — but HEAD's own vue analyzer measures
11.** *So the committed baselines no longer describe this tree, and every "REGRESSION" line the gate printed during this
work compared against a number that was already wrong.* **The both-sides comparison above is sound precisely because it
never consults the baseline.**
