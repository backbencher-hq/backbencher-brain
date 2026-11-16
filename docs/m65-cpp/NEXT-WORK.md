# C++ analyzer — what to do next, measured

**Evidence:** `validation/cpp-audit/census.json` (523 files, 17,597 symbols, 78,088 edges)
plus the probes recorded below. Corpus: `.cpp-corpus/fmt` (10.2.1) + `.cpp-corpus/nlohmann-json` (v3.11.3).

---

## The one-paragraph answer

**Fix the 544 macros the grammar never produces.** One measurement decides it: **9,004 of the 13,407
genuinely-unresolved `calls` rows (67%) target a macro the source `#define`s and the analyzer never
publishes**, and **541 of the 544 lost macros live in a single file** — `doctest.h`, which the
tree-sitter-cpp fork cannot parse (672 `#define` lines → 131 `preproc_*` nodes, 2,627 ERROR nodes).
`CHECK` alone accounts for **6,734** unresolved rows. That is the largest, cheapest, and most
defensible win available, and it is the same class the C lane already solved (`extractMacro`).

---

## 1 · Resolution, measured

Target resolves against an index built from the analyzer's own output (the population `bb_graph` binds).

| type | rows | share of edges | target resolved | source resolved |
|---|---|---|---|---|
| calls | 59,374 | 76.0% | 45,967 (77.4%) | 59,374 (100%) |
| contains | 10,660 | 13.7% | 10,660 (100%) | 10,657 |
| uses | 4,580 | 5.9% | 4,351 (95.0%) | 4,580 (100%) |
| imports | 1,968 | 2.5% | 205 (10.4%) — external by design | 1,968 (100%) |
| extends | 478 | 0.6% | 435 (91.0%) | 478 (100%) |
| part_of | 360 | 0.5% | 63 (17.5%) — stem vs declared name | 360 (100%) |
| references | 206 | 0.3% | 76 (36.9%) — namespace target | 206 (100%) |
| instantiates | 182 | 0.2% | 167 (91.8%) | 182 (100%) |
| overrides | 134 | 0.2% | 134 (100%) | 134 (100%) |
| exports | 112 | 0.1% | 112 (100%) | 112 (100%) |
| implements | 34 | 0.0% | 34 (100%) | 34 (100%) |

**Source endpoints are 100% resolved for every type** — the M65 `::` fix closed the last one.
The work is now almost entirely about **targets**.

---

## 2 · The unresolved `calls` targets, decomposed

```
39,817  unresolved calls targets (in-file)
-26,410 (66%) RESOLVE ELSEWHERE IN THE CORPUS  <- cross-file, NOT a defect
───────
 13,407  genuinely unresolved corpus-wide
  -9,004  (67%) target a #define'd-but-unpublished MACRO   <- THE FIX
   -862   in the ISO-cpp-stdlib citation vocabulary (18 distinct: vector, max, min, ...)
   -331   "other" (quiet_NaN, ...)
   -rest  external/platform (Win32, libc), correct to leave unresolved
```

### 2.1 The macro class, in detail

| quantity | value |
|---|---|
| `#define` lines in the corpus source | 3,483 |
| `preproc_def` / `preproc_function_def` nodes the grammar produced | 2,939 |
| **macros the grammar never produced** | **544 (15.6%)** |
| of those, defined in a file with ≥1 ERROR node | **543 of 544** |
| `calls` rows targeting one of those macros | **9,004** |
| top target | **`CHECK` — 6,734 rows** |
| next | `CHECK_THROWS_WITH_AS` 1,079 · `CHECK_NOTHROW` 145 · `TEST_CASE` 124 · `CHECK_FALSE` 69 |

Worst file: `.cpp-corpus/nlohmann-json/tests/thirdparty/doctest/doctest.h`
— **672 `#define` lines, 131 `preproc_*` nodes, 541 lost**, 2,627 ERROR nodes,
largest ERROR span `1-7107` (the whole file).

### 2.2 Why it is fixable rather than a grammar dead end

The analyzer's macro branch (`real-cpp-analyzer.ts:3317`, `preproc_def` | `preproc_function_def`)
is correct — it published 1,277 macros this run. What it cannot do is mint a symbol for a
`preproc_def` node the grammar **did not create**. So the fix is not "handle ERROR better"
in general; it is a **targeted recovery**: when a `#define` line falls inside an ERROR span,
the directive text is still unambiguous, and a bounded scan of that line can mint the symbol.
That is a new arm, not a rewrite — and it is the same conclusion the C lane reached and implemented.

---

## 3 · Ruled / correct / working — what NOT to touch

| area | status | evidence |
|---|---|---|
| D1 keywords (7 gates) | **0 violations** | 0/64,136 targets, 0/17,597 symbol names, independent keyword set |
| D2 self-extends | **0** | 0/478 |
| D3 duplicate pairs | **0** | contains/references/imports/part_of all 0 (after M65) |
| V3 name surface | **0** | 0/17,597 (macro-headings excluded as designed) |
| R7 placeholder endpoints | **0** | 0 rows |
| `overrides` source/target | **100%** | 134/134 both ends (M65) |
| `implements` | **emits 34 rows** | 34/34 resolve; the "0" in old tables is a small-corpus artifact |
| zero-regex claim | **TRUE** | D6 proper reads 0 |
| `part_of` oracle | **exists, 0 disagreements** | 2,328 rows |

Do not re-open: `decorates` / `renders` / `mixes_in` are correctly **absent** (each ruled with
grammar-absence evidence and a falsifier).

---

## 4 · Ranked work list

| # | work | size | payoff | risk |
|---|---|---|---|---|
| **1** | **Macro recovery for `#define` inside ERROR spans** — mint `Macro`/`Constant` from the directive line when the grammar produced no `preproc_*` node | ~1 new arm + fixture | **+9,004 resolved `calls` targets** (67% of the gap); `CHECK` 6,734 alone | low — bounded scan, and the analyzer already has the C-lane precedent |
| 2 | `.h`-by-content population in the M14 gate discovery (`incoming-gate.ts:314`) — 3,095 cpp-routed headers, 87,181 `#define`s sit outside the measured population | one-word/set change, **master-owned** | the lane's own largest residual (83% of `calls`) | touches shared gate; needs Lead |
| 3 | `part_of` target = file STEM vs the declared module name (17.5% resolve) — a header's module symbol is its stem only when stems are unique | design + measurement | makes `part_of` resolvable | medium — could re-introduce ambiguity |
| 4 | `imports` 10.4% is **correct by design** (external module names) — document, do not "fix" | doc only | prevents a wrong fix | none |
| 5 | Grammar fork: the 544 lost macros are a symptom of ERROR recovery on large single-header libraries; a newer fork would reduce it | upstream | structural | high — byte-pinned fork, 22 fixtures depend on it |
| 6 | Re-cut the 1,282,777-row whole-population census | needs 31-repo corpus | corroboration only | not available here |

**Do not** re-litigate the `.h` question through the residual gate: it is already measured as
"the fix landed in `incoming-gate.ts:219` but the residual gate's population did not move."

---

## 5 · What #1 looks like concretely

1. Pre-pass over the tree for `ERROR` nodes; for each, scan its **direct text lines** for
   `^\s*#\s*define\s+(NAME)(\(...\))?` — the same character-scan discipline the file already uses
   (zero regex).
2. For each match, mint `Macro` (function-like) or `Constant` (object-like) with
   `metadata.isMacro` / `isFunctionLikeMacro` / `nameLine`, owner `global`, exactly as the
   `preproc_def` branch does today (`real-cpp-analyzer.ts:3317-3389`).
3. Reuse the existing guards: skip a name the file already publishes (collision), and require
   `isCppSpelledName(NAME)`.
4. Pin it: a fixture with a macro inside an ERROR region whose `calls` target must resolve;
   prove it fails pre-fix.
5. Re-measure: expect `part_of`/`calls` resolution to move and the D1/V3 gates to stay at 0.

The expected blast radius is bounded and checkable: **+~544 symbols** on this corpus
(and `+9,004` resolvable `calls` targets), with no new relationship type and no change to
any emission rule already gated.
