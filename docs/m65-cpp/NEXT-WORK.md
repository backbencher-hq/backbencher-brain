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

---

## 6 · CORRECTION — my own `part_of` number was measuring the wrong thing

`validation/cpp-audit/census.json` reports `part_of` at **17.5% "resolved"**, and I listed
"part_of target = stem vs declared module name" as work item #3 on the strength of it. **That
reading is wrong, and the correction matters more than the number.**

`part_of` is a FILE-level relation: source = the including unit, target = the part's module symbol
(its file STEM). Its target is *supposed* to be a file stem, not a declared symbol. So resolving it
against an index of **symbols** measures a category error — a stem is not a symbol name.

Measured correctly, against the set of **file stems that exist in the corpus**:

| measure | value |
|---|---|
| `part_of` rows | 360 |
| target **IS a file stem present in the corpus** | **351 (97.5%)** |
| target not present as a file here | 9 |

The 9 absent ones are headers outside the checkout (`failure_signal_handler`, `stacktrace`,
`symbolize`, `str_cat`) plus four **std C++ headers** whose stems collide with project headers
(`any`, `optional`, `string_view`, `variant` — e.g. `"absl/types/any.h"` vs `<any>`).

**⇒ Work item #3 is WITHDRAWN.** `part_of` is 97.5% correct and the residual is a missing-file
artifact, not a target-shape defect. This is the third time in this campaign that a headline number
measured the wrong thing (`0/134 unresolvable`, `39 fixtures`, now `17.5%`), which is the argument
for stating what a resolution rate is measured AGAINST, not just its value.

## 7 · Full unresolved-target decomposition, every type

`X unresolved of Y` where "unresolved" = target is neither declared in the file nor anywhere in the
corpus (so cross-file resolution is excluded, not counted as a defect).

| type | unresolved | top target(s) | verdict |
|---|---|---|---|
| calls | 13,407 / 59,374 | `CHECK` 6,734 · `CHECK_THROWS_WITH_AS` 1,079 | **9,004 = macro class (#1)**; rest stdlib/Win32 |
| uses | 229 / 4,580 | `format_error` 28 · `hi_` 9 | small; names from headers — accept |
| extends | 43 / 478 | `integral_constant` 16 (`std::`) · `allocator` 4 | std bases, no in-project declaration — accept |
| instantiates | 15 / 182 | `stringstream` 3 · `CRITICAL_SECTION` 2 | std/Win32 types — accept |
| references | 130 / 206 | `nlohmann::literals` 46 · `std::string_view_literals` 9 | namespace targets (inline namespaces) — accept |
| part_of | 9 / 360 | std/adjacent headers | **97.5% correct — see §6** |
| imports | 1,763 / 1,968 | `functional`, `memory`, `vector` | **correct by design** (external modules) |

⇒ **After the macro class, no other type has a defect worth a change.** The remaining
unresolved rows are stdlib, Win32/libc, inline namespaces, or headers outside the checkout — all
correct to leave unresolved, and all would be *wrong* to "fix" by inventing declarations.

## 8 · Other verified properties (this round)

| property | result | how measured |
|---|---|---|
| **cross-file state leakage** | **NONE** | same analyzer instance, A→B vs B→A vs fresh: identical symbols, owners and `uses` edges in all three orders |
| **`.h` content routing** | **correct** | 40 local `.h`: 39 route to cpp (1,688 `#define`s), 1 routes to c (`FuzzerInterface.h`, genuinely C, 1 `#define`) |
| **exit-record discipline** | **sound** | 7 `scopeStack.push` sites; 4 fall through to the shared exit push (`:5364`), 3 push their own explicit `isExit` record before `continue` (`:3772`, `:4224`, `:4517`) — no branch leaks a scope |
| **regex-free** | **TRUE** | 0 regex literals in code (D6's algorithm, comments/strings stripped) |
| **spec vs code** | **1 CONTRADICTION** | `preproc_def` / `preproc_function_def` are listed in `cpp-completeness.json` → `internal_silent` (with no `_notes` entry) while `real-cpp-analyzer.ts:3317` reads both and published **1,277 macro symbols**. The spec says "not read"; the code reads them. |
| **population** | **router-correct, lane-narrow** | the canonical table `script/m14/language-extensions.ts:153` admits **11** cpp spellings (incl. `.h`, `.hh`); the M14 gate's command line passes **9**, so the lane's own 7,435-file denominator is a LOWER BOUND (the lane already records this in `cpp-census-denominators.ts:45-59`). My probe used 11 and is router-correct. |
| **`.cu` (CUDA)** | **routed but near-empty** | 2 files → 9 edges, 5 symbols total. Routed correctly, produces almost nothing. Note, not a defect. |

---

## 9 · Structural audit — the analyzer's own mechanics (measured, not read)

The walk's soundness was checked independently of edge counts, because a correct count with a
corrupting scope stack would still be wrong.

### 9.1 Exit-record discipline — SOUND
7 `scopeStack.push(` sites (`:3651, :3771, :3858, :4071, :4124, :4216, :4513, :4757`).
- **4 fall through** to the shared exit push (`:5364`) — they are the last statement of their branch.
- **3 push their OWN** `isExit` record before `continue` (`:3772, :4224, :4517`), and each says so
  in a comment ("the branch continues past the shared exit-record push below, so record the pop
  here"). The file has been bitten by exactly this (the D15 body-skip and the A2 sibling-scan bugs).
⇒ **no branch leaks a scope**, so `scopeStack` cannot corrupt sibling attribution.

### 9.2 Cross-file state leakage — NONE (empirical)
Same analyzer instance, two files, both orders, plus a fresh-instance control:

| order | result |
|---|---|
| A→B then B→A | symbols, `ownerName`, and `uses` edges **identical** in all three runs |
| B first, A second | identical to A-first |

`uses` resolved correctly in every order (`draw->value`, `render->size`). The header's claim that
state moved from `this` to per-`analyze()` locals holds.

### 9.3 Node identity — no wrapper-identity hazard
0 raw `===` comparisons on Node objects. All 5 identity checks use the span-based guards
(`sameExtent`, `sameTsNode`), which exist precisely because `web-tree-sitter` returns a **fresh JS
wrapper per access**, so `a === b` is always false for the same node.

### 9.4 Dead node-type branches — ONE, already removed
Authoritative test against the pinned parser's own inventory (`wasm/tree-sitter-cpp.wasm` exposes
**402 named + anonymous node kinds**; 548 total slots):

| measure | value |
|---|---|
| node types the analyzer tests | 84 |
| **tested but NOT declared by the parser** | **1** — `class_body` |
| live `class_body` comparisons in code | **0** (all 5 mentions are comments, `:571-579`) |

⇒ the one dead branch the lane documented (`deadLiterals: class_body`, 7 comparisons) is genuinely
gone; `field_declaration_list` is the only body node. **No other dead branch exists.**

### 9.5 Regex-free contract — TRUE
0 regex literals in code (D6's algorithm, which strips comments and string literals first).
The only `/…/` sequences in the file are comment prose documenting *removed* regexes.

### 9.6 Spec-vs-code contradiction — 1 (fixable)
`script/m14/spec/cpp-completeness.json` lists **`preproc_def` and `preproc_function_def` under
`internal_silent`** — meaning "the analyzer does not read these" — with **no `_notes` entry** and
**no `handled_verified` row**. The analyzer reads both at `:3317` and published **1,277 macro
symbols** this run. The spec is wrong; the code is right. Smallest fix: move the two types into
`handled_verified` (with the `:3317` emission site) or add the `_notes` entry the bucket's own
convention requires.

### 9.7 Population honesty — the lane's denominator is a lower bound
`script/m14/language-extensions.ts:153` admits **11** cpp spellings
(`cpp,cc,cxx,c++,hpp,hxx,hh,h,ipp,inl,cu`); the M14 gate's command line passes **9**
(omitting `h`, `hh`). The lane already records this in `cpp-census-denominators.ts:45-59`, and it
means every lane figure quoted as "7,435 admitted files" is a **lower bound over source spellings**.
My probe used the 11-spelling table and is router-correct; the difference is a measurement-model
difference, not a disagreement.

### 9.8 `.cu` (CUDA) — routed, near-empty
2 files → 9 edges, 5 symbols total. Correctly routed, produces almost nothing. Note, not a defect.
