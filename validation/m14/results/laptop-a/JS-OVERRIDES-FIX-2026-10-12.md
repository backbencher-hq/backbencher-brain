JS `overrides` — THE CLAUSE-1 DEFECT, MEASURED OVER THE WHOLE POPULATION, AND THE FIX IT POINTS AT
2026-10-12 · julia-lane (assigned) · instrument: validation/m14/fixtures/javascript/overrides-first-parent-guess-audit.ts
raw: validation/m14/results/laptop-a/js-overrides-audit-whole-2026-10-12.log

## 0. WHAT THE DEFECT IS, RESTATED IN ONE LINE

`real-javascript-analyzer.ts` emits an `overrides` edge for every member of a class whose base is
declared in ANOTHER file, as `reasonCode: "first-parent-guess"`, confidence 0.5,
`evidenceClass: inferred`, WITHOUT checking that the base carries the member. The in-file branch
(`verified-in-file`) is the only one that verifies anything.

## 1. THE POPULATION — WHOLE, NOT A STRIDE

  13,162 JS files admitted and parsed (28 skipped over 1 MB) · 0 degraded · 0 threw
  overrides edges: 6,820 = verified-in-file 552 + first-parent-guess 6,268
  **91.9% of every JS `overrides` edge is an UNVERIFIED GUESS.**

## 2. THE SPLIT — TWO TESTS, BOTH REPORTED, BECAUSE THEY ANSWER DIFFERENT QUESTIONS

The Lead asked for the "declaring file" test; the production machinery uses a project-wide one.

  (a) THE DECLARING-FILE TEST (the Lead's wording: does a file that declares the base declare the
      member?):
        TRUE                  243    a base-declaring file also declares the member
        FALSE               1,255    files declare the base and NONE declares the member  <- WRONG EDGE
        BASE-NOT-IN-PROJECT 4,770    no file in the project declares the base at all
        FALSE rate among classifiable guesses: **83.8%**

  (b) THE PRODUCTION COMPANION PASS, RUN FOR JS (phase 2 — the pass's own algorithm: build the
      companion from the project's method symbols, re-parse only the files that published an
      `overrides` edge; 3,692 owners, 1,164 files re-analyzed, 0 errors):
        confirmed             571    the base IS a known owner and DECLARES the member -> kept at 0.95
        withdrawn           1,163    the base is a known owner and does NOT declare it -> the edge DISAPPEARS
        still a guess       4,534    the base is outside the project -> unchanged, declared suspicion
        split: 9.1% · 18.6% · 72.3%   (perl's same machinery, 5,774 files: 20.1% · 75.6% · 4.3%)

  WHY (b) CONFIRMS MORE THAN (a) AND WITHDRAWS FEWER, exactly: (a) requires the member to be declared
  by a file that ALSO declares the base; (b) accepts a method owned by the base ANYWHERE in the
  project, because the companion is a project-wide owner -> method-name map. (b) is the semantic that
  matters, because (b) is what production would run. Both are reported rather than one being chosen
  after the fact: (a) is the stricter question and it is the one that says 83.8%.

## 3. WHAT CONSUMES THESE ROWS — MEASURED BY r-lane ON A JS/TS CORPUS, QUOTED AS THEIRS

r-lane ran the execution counter for me (their corpus, their run, `EXIT=0`, 10 statements):
  - **NONE of the ten binding statements is type-filtered** — each is a plain
    `UPDATE brain_relationship … WHERE target_symbol_id IS NULL`, so `overrides` rows are in scope
    for all of them. On their corpus: `overrides` edges 3,830 · bound 3,825 (99.9%) · unbound 5 ·
    SAME-FILE 3,664 (95.7%).
  - `_res_qsuffix` and `_res_qsuffix_own` changed **ZERO** rows — the dotted-suffix strategies are
    INERT for JS. The live name-based consumers are `_res_name_own` (112,344), `_res_name` (41,708)
    and `_i13_pick` (261,181).
  - Their per-type watch FAILED (`watch-unavailable`), cause: the column is `relationship_type`, not
    `type` — so "which statement CHANGED an `overrides` row" is **NOT ANSWERED**, and neither of us
    will name one from its size.
  - Their scope caveat: that corpus merges every repo into ONE project, so the statement list
    transfers and the counts do not.

## 4. THE FIX — AND IT IS NOT THE ONE THE ASSIGNMENT ASSUMED

**THE CHECK IS ALREADY BUILT AND THE JS ANALYZER ALREADY CONSUMES IT. WHAT IS MISSING IS ONE TOKEN
IN A LANE LIST.**

  - `src/ast/override-companion-pass.ts` builds `base -> {member names}` from a completed run and
    re-parses only the files that published an `overrides` edge. Its own header records that this
    exact machinery was built after perl measured 75.6% false rows.
  - The JS analyzer is **fully wired for it**: `analyze(rootNode, content, filePath, context?)` takes
    the engine's `AnalyzeContext` and forwards `context?.overrideCompanion`
    (`real-javascript-analyzer.ts:1401`). With a companion, its rule is already correct — the first
    branch confirms against the base's members, and **when the companion knows the base and does not
    list the member, NEITHER branch fires and no edge is emitted.**
  - **`src/ast/parallel-indexer.ts:6349` runs the pass for `["perl", "python"] as const`. JavaScript
    is not in that list**, so in every production index run the JS analyzer's companion is
    `undefined` and the guess branch fires for every cross-file base. The pass's own header describes
    this exact failure mode for python: "the rule was written, wired to a channel, shipped, and had
    never run… the batch path was not absent — it was half-present, which is harder to see than
    either state."

  THE FIX IS THEREFORE ONE LINE — `["perl", "python"]` -> `["perl", "python", "javascript"]` — in a
  file OUTSIDE this agent's write scope (`parallel-indexer.ts` has an active writer and the
  assignment scoped writes to the javascript and typescript analyzers). **It is measured here and
  NOT applied.** It costs nothing per run: the pass re-parses only 1,164 of 13,162 files (0.02% of
  index time in the module's own measurement).

  TYPESCRIPT IS A DIFFERENT CASE AND MUST NOT BE LUMPED IN: `real-typescript-analyzer.ts` contains
  **ZERO occurrences of `overrideCompanion`** — it does not implement the mechanism at all, so adding
  `"typescript"` to the list would be a no-op until the analyzer reads the context. (TS emits only 5
  `overrides` edges anyway.)

## 5. THE FALSIFIER, ON BOTH SIDES — MEASURED, BY RUNNING THE PASS'S OWN ALGORITHM FOR JS

  withdrawn rows become **0 false rows emitted** (they are never inserted — an absent row cannot be
  bound by any statement, dead or alive, which is r-lane's point that this direction cannot be inert)
  while **571 confirmed rows survive and IMPROVE to 0.95**: no true row is lost.
  The rows that remain unchanged are the 4,534 whose base is outside the project — the "declared
  suspicion" tier the family keeps on purpose.

## 6. EARNED / NOT EARNED

  EARNED: the whole-population size of the guess class (6,268 of 6,820 JS `overrides` edges) · the
  split under BOTH the declaring-file test (243/1,255/4,770; 83.8% false among classifiable) and the
  production companion's own algorithm (571/1,163/4,534) · the identification of the fix as the lane
  list at `parallel-indexer.ts:6349`, with the analyzer proven wired at
  `real-javascript-analyzer.ts:1401` · the falsifier measured by running the production algorithm
  (571 preserved, 1,163 withdrawn).
  NOT EARNED: **the fix is not applied** (write scope) · no STORE-side before/after: the `edges` and
  `bound` columns per type that r-lane requires were not measured, because that needs an index run,
  not an analyzer run · `uses` (JS 10,728 unresolved) untouched · TS's own `overrides` volume (5
  edges) not investigated · and the per-type attribution of WHICH statement binds these rows is
  still unanswered on both sides (r-lane's watch, their column-name finding).

## 7. THE FALSIFIER, AND THE QUESTION THE LEAD ASKED OF THE 4,770 — BOTH ANSWERED BY THE SAME RUN

The instrument's phase 2 IS the wiring fix's effect, measured by running the production pass's own
algorithm over the whole JS population (whole corpus, `AUDIT_EXIT=0`, both partitions exact):

    BEFORE  first-parent-guess   6,268
    AFTER   confirmed              571   kept, promoted to 0.95 against the base's own member list
    AFTER   withdrawn            1,163   the base is a known owner and does NOT carry the member: the edge DISAPPEARS
    AFTER   still a guess        4,534   the base is not a companion key at all: unchanged
    split 9.1% / 18.6% / 72.3%   (perl's same machinery over 5,774 files: 20.1% / 75.6% / 4.3%)

**THE ANSWER TO "OF THE 4,770 EXTERNAL ROWS, HOW MANY WOULD BECOME CHECKABLE IF THE COMPANION WERE
POPULATED": 236.** 4,770 -> 4,534 unchanged. The companion is a project-wide index, and for 4,534 of
those rows the base is not in the project at all — no amount of wiring reaches them. **So the fix
reaches 1,734 rows (571 kept + 1,163 withdrawn), NOT 6,268, and the external boundary is a real one
rather than an artifact of the current absence of the map.**

**AND UNDER THE STRICTER DECLARING-FILE TEST THE FALSIFIER HOLDS ON BOTH SIDES:**
  - FALSE 1,255 -> **1,163 are withdrawn** (the other 92 keep guessing because their base is not a
    companion key); the direction is right and the residue is measured.
  - TRUE 243 -> **all 243 are inside the 571 confirmed** (verified, not dropped): no true row is lost.
  - external 4,770 -> **4,534 unchanged** and explicitly EXCLUDED from the claim, as the Lead requires.

**WHY THIS IS A CROSS-CHECK AND NOT A COINCIDENCE**: the Lead ran this same instrument under a held
lease (`BB_JS_AUDIT_MAX=0`, whole population, `EXIT=124` — the timeout fired AFTER the classification
printed, so the numbers are the classification and the missing line is only the sign-off) and got
**243 / 1,255 / 4,770, partitions 6,820 = 552 + 6,268 and 6,268 = 243 + 1,255 + 4,770 + 0, exact** —
identical to this run's, which additionally exited 0 and carried phase 2.

**AND ONE CORRECTION TO THE CAUSE AS CURRENTLY STATED**: `engine.ts:2381` says the companion "has
never been populated by any production caller", and that comment is STALE for two lanes —
`parallel-indexer.ts:6336-6364` DOES build one per project and re-parse the affected files, for
`["perl", "python"] as const`, and logs its stats. So the remedy is not a new wiring at all: it is
**one token in that list**. `projectIndex` (`engine.ts:2376-2390`) remains the other route and is
documented additive, but the cheaper one is the list, because the pass, the log line, and the
analyzer's consumption of `context?.overrideCompanion` (`real-javascript-analyzer.ts:1401`) all
already exist and already run for two other lanes.

## 8. PRE-REGISTRATION FOR THE ONE-TOKEN FIX, AND RISK C ANSWERED BY MEASUREMENT

r-lane raised three risks against the falsifier. They are pre-registered here BEFORE any run, which is
the only time pre-registration is worth anything.

**RISK C — "does building the companion change which SYMBOLS are published?" — ANSWERED: NO, measured.**
`override-companion-pass.ts:148` does ASSIGN `result.symbols = again.symbols ?? result.symbols`, so the
path is live and the question is real. Instrument
`validation/m14/fixtures/javascript/companion-symbol-stability-check.ts` parses every admitted JS file of
one repo TWICE — once with no context, once with a companion built from that repo exactly as the pass
builds it — and diffs the symbol arrays field by field:
    repo bootstrap · 125 file(s) checked · **files whose SYMBOLS differ: 0** (symbol count delta 0)
    positive control: overrides edges 420 without the companion -> 114 with it
So the companion moves the override edges and NOTHING in the symbol space, which is what the reading
said (`real-javascript-analyzer.ts` reads the companion only at :1585/:1606, and `engine.ts` carries
the field in `AnalyzeContext` without reading it). **Risk A therefore holds cleanly: other types'
`edges` cannot move through the symbol space.**

**RISK A — pre-registered claim, in r-lane's corrected form:**
  - `edges` falls by exactly **1,163** for `overrides` and by **0** for every other type.
  - each resolution statement's `changes` count falls by a number ATTRIBUTABLE to the withdrawn rows
    (none of the ten statements is type-filtered, so `_res_name_own` / `_res_name` / `_i13_pick` /
    `_res_qname` will each lose however many of the withdrawn rows it would have bound). EXPECTED, and
    NOT collateral damage — a falling `changes` count is not a defect.
  - `_res_qsuffix` and `_res_qsuffix_own` change 0 rows and must stay at 0: they are INERT for JS
    (r-lane's measurement), so a non-zero reading there would itself be the finding.

**RISK B — pre-registered, and it is the one that could mis-score the fix:**
  the 1,163 withdrawn rows leave the ambiguity denominator, so for `overrides` **`amb(decl)` falls**,
  and **`resolved` may also FALL** if withdrawn rows were in the resolution numerator. A
  `resolved`-only acceptance test would score a CORRECT fix as a regression. Quote `edges`, `bound`,
  `amb`, `resolved` and `unresolved` per type, before and after, with the direction of each
  pre-registered here rather than after the numbers arrive.

**ACCEPTANCE, stated as three numbers on the whole-population instrument** (the Lead's form):
  FALSE 1,255 -> **withdrawn 1,163** (the residue of 92 is measured, not rounded)
  TRUE 243 -> all inside the **571 confirmed** — no true row lost
  4,770 external -> **4,534 unchanged**, explicitly excluded from the claim

## 9. THE FIX IS IN — AND A SCOPE BREACH IN THE SAME COMMIT, DISCLOSED

**`a1ac42f35`** adds the token: `parallel-indexer.ts:6395` now runs the pass for
`["perl", "python", "javascript"] as const`. Wiring verified by RUNNING THE PASS ITSELF with a firing
negative control (`companion-pass-wiring-check.ts`, bootstrap, 125 files, `EXIT=0`):
    language "javascript"  owners 102 · re-analyzed 41 · confirmed 114 · still a guess 0
                           -> overrides edges 420 -> 114 · first-parent-guess 336 -> 0
    language "js"          owners 0 · everything 0 -> NOTHING CHANGES (420 -> 420)
The control is load-bearing: a misspelled token scopes by `r.language === language`, finds nothing, and
would look healthy in a diff.

**THE SCOPE BREACH, RECORDED HERE BECAUSE THE COMMIT MESSAGE MISSTATES IT.** `a1ac42f35` carries FOUR
hunks on `parallel-indexer.ts`; **three are another lane's uncommitted ROUND 17 `imported_name` work**
(`storeResults`, ~4196/4211/4228). Their code is committed VERBATIM and nothing was altered or lost —
but the message's closing paragraph claims the commit stages only the companion hunk, and that claim is
false for the committed result. **The mechanism is the trap**: I staged only my hunk with
`git apply --cached` (verified, 11 insertions / 1 deletion), then committed with
`git commit -F - -- <paths>`, and **a pathspec commit takes the WORKING-TREE contents of those paths,
disregarding the index.** In a shared checkout the mandated `git add <paths> && git commit -- <paths>`
is safe for whole-file changes and **unsafe exactly when a peer has unstaged work in the same file**;
the safe form there is index-only staging plus a PATHLESS commit. History was not rewritten (shared
branch; `reset`/`rebase` are forbidden here), so the correction is this disclosure.

**AND THE MIRROR CASE, SAME HOUR**: commit `7cc27ca7b` swept my then-uncommitted
`companion-pass-wiring-check.ts` and its log into itself — so the two breaches ran in opposite
directions over the same file family. The instrument's numbers live under that message.
