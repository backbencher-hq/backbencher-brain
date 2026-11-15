# make lane — the declaration, the counts behind it, and what is owed

**Lane**: `make` (`src/ast/real-makefile-analyzer.ts`, spec `script/m14/spec/make-completeness.json`).
**Row today**: `make 7/7 from=spec coverage block`.
**This doc is a claim, not a source** (§5y). Every number below is one run at a named revision; the
revision is on the line with the number, and the artifact is the one cited.

---

## 1. The 6-vs-7 disagreement, and which half was wrong

The board read `make 6/7` with `overrides` in `corpusUnexercised`; the firing log read `7 types fired`.
Two numbers about one type, and neither instrument can say which of them is stale. Three measurements
settled it, one run each.

**(1) The firing stride, re-confirmed by this lane** at `HEAD 78518a75c`
(`NFILES=120 bun script/m14/firing-check.mjs MAKE`, instrument self-test **PASS**), verbatim:

```
MAKE           7 types fired   120/120 parsed of 349 admitted (even stride)  [corpus=otp]
   calls:14  contains:1092  exports:313  imports:367  overrides:2  references:1467  uses:2157
   SILENT (constructible but produced nothing): extends implements instantiates
```

**(2) The whole ROUTER-admitted population**, production path, new instrument
`validation/m14/fixtures/make/tools/construct-census.mts` → `construct-census.current.json`
(697/697 parsed, 0 degraded, 0 failed, 65 repos):

| type | grammar (whole-word) | edges | files | `otp` edges |
|---|---|---|---|---|
| calls | – | 174 | 25 | 14 |
| uses | – | 10,328 | 551 | 5,900 |
| contains | – | 11,146 | 679 | 3,733 |
| imports | – | 1,210 | 257 | 1,165 |
| references | – | 16,621 | 528 | 4,655 |
| exports | – | 5,044 | 516 | 1,104 |
| extends | **absent** | 0 | 0 | 0 |
| implements | **absent** | 0 | 0 | 0 |
| **overrides** | **PRESENT** (`override` token, `override_directive` node) | **3** | **2** | **2** |
| instantiates | **absent** | 0 | 0 | 0 |

`override_directive` **SITES** 5 in 4 files · **EDGES** 3 in 2 files · **REFUSED** 2, because their only
declaration *is* the override (base = command line / environment):

```
site    otp/make/target.mk:48        TARGET              EDGE  baseLine=29
site    otp/make/target.mk:60        TARGET              EDGE  baseLine=29
site    redis/deps/xxhash/Makefile:66  DISPATCH          EDGE  baseLine=61
site    boundary/Makefile:91         LINT_DIFF_BRANCH    refused
site    tree-sitter-clean/Makefile:24  CFLAGS            refused
```

**(3) The lane's own corpus** (`otp` subset of the same run): `overrides` 2 edges in **1** file.

**VERDICT: the DECLARATION was stale; the firing log was right.** The earlier `overrides 0` census was
taken before the emission existed (`63c28f2dd`) on the same corpus. The superseded declaration is kept
quoted in the spec as `coverage._fromSuperseded`, and the superseded MAKE-D1 ruling is kept quoted inside
MAKE-D1, because a reader who sees only the corrected version cannot tell that a work item moved.

### Two claims in the brief that measurement refuted

* *"the extra fired type is `calls` (14 edges), which the declared set does not carry"* — **both halves are
  false**: the extra type is `overrides`, and `calls` has been in `coverage.implemented` all along. The
  brief took its SILENT list from the **committed** log (`6 types fired`, `overrides` silent) while taking
  the header from the **working-tree** log (`7 types fired`) — two revisions of one file, mixed.
* *"the board reads `make 6/10`"* — it read **`6/7`** (measured before the change:
  `make  6/7  from=spec coverage block`), because the block already declared three grammar-absence
  exclusions. `6/10` would be the row of a lane with no exclusions.

---

## 2. The contract column and the evidence class behind every exclusion

```
implemented 7 + corpusUnexercised 0 + gaps 0  ===  10 − 3 grammar-absence − 0 unclassified = 7
```

`extends` · `implements` · `instantiates` are excluded as **`grammar-absence`**, each carrying its own
counts in its own `from` — never one citation substantiating another type (§5bb):

| space | instrument | count | matches |
|---|---|---|---|
| grammar (declared names) | `construct-census.current.json` ← `node-types.json` | 44 named types + 91 tokens + 24 field names | **0** for each of the three |
| corpus keys | `key-space-census.json` | 2,604 bindings / 743 distinct key names (349 `otp` files) | **0** whole-key |
| corpus node types produced | `key-space-census.json` | 37 distinct | **0** |
| production emission | `construct-census.current.json` | 697/697 files | **0** edges in **0** files for each |

**The grammar half is now ENUMERATED, not unavailable.** `key-space-census.json` records
`grammar.declaredNodeTypeCount: 0` with the honest note that the wasm binding exposes no node-type
enumeration; the new instrument reads the pinned `grammars/tree-sitter-make/src/node-types.json` instead,
and the spec's own `grammarPin.sourceVsWasm` proves the wired wasm agrees with that file in **both**
directions (0 missing, 0 named-only-in-wasm).

**The ruling predicate is WHOLE-WORD, and substring hits are adjudicated candidates.** This is not
fastidiousness: the substring form made the new instrument report **`extends PRESENT`** via
`anon:basename`. An unadjudicated substring candidate makes the census **exit 3** — it did, on
`node:override_directive`, which is why the adjudication table carries a `means` flag rather than a note.

---

## 3. Self-refutations in this lane's record

1. **The +44-line uncommitted change had already been committed.** `git status`, `git diff HEAD` and
   `git diff --cached` are all empty for `src/ast/real-makefile-analyzer.ts`; the lines are `63c28f2dd`
   ("Recovered and committed after sitting uncommitted across two sessions with no verdict"), an ancestor
   of HEAD. Nothing was discarded and nothing was left to be swept.
2. **That commit's evidence did not exist.** Its `overrides` block cited
   `validation/m14/fixtures/make/mk-override-probe.mts` and `…-base.mts`. Neither file is in the tree and
   neither is in git history (`git log --all --diff-filter=A` returns nothing). *A citation to a missing
   file is worse than no citation — it reads like evidence.* The comment now names the artifact that
   exists.
3. **Its count was wrong.** It read *"5 `override_directive` sites in 3 files"*; measured, it is **5 sites
   in 4 files**.
4. **This lane's own new instrument had three defects, all caught by running it** and all recorded in it:
   membership was a copy of a rule (`.make` is admitted by the lane's census copy and refused by the
   production router); the substring predicate inverted a ruling; and the site walk lost **every** site
   after `engine.ts` recycled its parser at 500 files (**1** site found against **3** emitted edges) —
   §5r's *"a collector that cannot read the name it is looking for reports a defect in the code."* The
   walk now re-acquires its parser per file and **refuses (exit 3)** unless every emitted edge's own line
   is found as a site.

---

## 4. What is owed, named rather than folded in

**(a) POPULATION — the largest item, and it is in a SHARED file, so it is routed and not fixed.**
`incoming-gate.ts`'s `admitByExtension` matches a *trailing dot-plus-ext*, and the make lane's set is
`mk,mak,makefile`, so it **cannot admit a bare `Makefile`** — the gate's own comment says so. Measured
over the same tree by the census artifact, the four rules give four populations:

```
router (detectLanguageFromPath === "make")   697
lane-census copy (Makefile|.mk|.make)        683   (.make is NOT routed: 2 files fail to parse)
firing-check rule (Makefile|.mk)             681   (misses .mak/.makefile/GNUmakefile)
incoming-gate rule (.mk|.mak|.makefile)      129   = 18.5% of the router's population
```

The gate's own run prints its population and agrees: `POPULATION — 129 parsed of 129 sampled · corpus 129
files across 7 repos`. **So every incoming figure for this lane is a figure about 129 files**, and the
third `overrides` edge (`redis/deps/xxhash/Makefile:66`) is invisible to it for exactly this reason.
Same defect class as xml's `.xml`-only admission (18% of its corpus). **Fix site: `admitByExtension`,
shared** — a basename clause, of the kind `detectLanguageFromPath` already implements.

**(b) THE OPEN RESIDUAL, on the population that exists today** (`npx tsx script/m14/residual-gate.ts
--lane make`, `HEAD 11583b483`, whole admitted population, one run):

```
type        edges  resolved  ofWhich  amb(decl)  unresolved  extOK ext? extFAIL bindFAIL causeFAIL  residual%  intended twin noDecl
uses         2196       261       0        310        1625      0    0       0        0         0      88.1%         0  575  1621
references   2437      2370       0         67           0      0    0       0        0         0       2.7%         0    0     0
exports       446       416       0         30           0      0    0       0        0         0       6.7%       444    0     0
imports        14         2       0          0          12      0    0       0        0         0      85.7%         0    1    12
calls          25        22       0          0           3      0    0       0        0         0      12.0%         0    5     3
contains     1106      1106     143          0           0      0    0       0        0         0       0.0%       971    0     0
overrides       2         2       0          0           0      0    0       0        0         0       0.0%         0    0     0
------------------------------------------------------------------------------------------------------------
TOTAL        6226      4179     143        407        1640      0    0       0        0         0      32.9%
resolved 67.1%   residual 2047 of 6226   extFAIL 0  bindFAIL 0  causeFAIL 0
```

**The promoted type's incoming side is clean on this population**: `overrides 2 edges · 2 resolved ·
0 ambiguous · 0 unresolved`, and all three MUST-BE-ZERO columns are 0. **The lane is NOT complete** and
7/7 is a TYPE-COVERAGE statement, not a resolution one. The two named causes, largest first:

* **`uses` 1,625 unresolved (88.1% of its edges, 79% of the whole residual)** — `uses` is this lane's
  external class: a prerequisite is usually a FILE, a variable is often set on the command line or by the
  environment, and Make ships builtins no file declares. The lane's MAKE-D3 already labels each end
  `builtin` / `external` / `external_prerequisite` / `local_binding` / `shell_variable`, and **none of
  those labels is one of the arbiter's claim kinds**, so nothing the project can check is attached. This
  needs either a claim mechanism (a namespace/basis claim of the kind authorized in §5j) or a RULED
  boundary with a count and a falsifier — **not** a marker attached on `unresolved` alone (§5l: on a bare
  target that claim is unfalsifiable). NOT STARTED.
* **`contains` 1,106 at 0 ambiguous / 0 unresolved, with `ofWhich 143` and `intended 971`** — so 135 of
  1,106 are not "own file AND own line". `ofWhich` is an UPPER BOUND on tie-break bindings, not a count of
  wrong ones, so this is a RISK to be split on the store before it is priced — the hcl/xml pattern (§5f,
  §5gg), not a defect established. NOT STARTED.

**(c) Fixtures** — `npx tsx script/m14/run-fixtures.ts --lang make` at `HEAD 78518a75c`, verbatim:
`summary: {"make":{"pass":8,"fail":2}}` with `fixture baseline gate: no regressions`. The two failures are
`make/recipe-eof-no-newline` (2 ERROR/MISSING nodes at line 27) and `make/recipeprefix` (6 ERROR/MISSING
nodes at lines 26/31/34, plus the missing `clean` symbol and its `contains`/`exports` edges). Both are
`expectNoParseErrors` **grammar** findings in recipe parsing, identical to the two `63c28f2dd` recorded,
and the harness labels them "honest defect findings, not harness errors". **They are unchanged by this
lane's work and are the lane's next correctness item**, not a declaration problem.

---

## 5. Reproducing this page

```bash
NFILES=120 bun script/m14/firing-check.mjs MAKE                            # the stride (self-test must PASS)
bun validation/m14/fixtures/make/tools/construct-census.mts               # 697 files: grammar + emission + sites
npx tsx script/m14/run-fixtures.ts --lang make                            # 8 pass / 2 fail
npx tsx script/m14/coverage-block-gate.ts                                 # make yes 7 7 3 -
BB_BOARD_FIRING=validation/m14/results/firing-laptop-b.current.log \
  bun script/m14/language-board.ts --coverage                             # make 7/7 from=spec coverage block
npx tsx script/m14/residual-gate.ts --lane make                           # the table in §4b
```

`npm run typecheck` exit 0 at `11583b483`. **Not this lane's, reported**: `script/m14/no-regex-gate.sh`
exits 1 at HEAD on `real-yaml-analyzer.ts:3289,3362` (2 regex literals — the make analyzer contributes 0,
and the new fixture instrument is outside the gate's `src/ast` scope).
