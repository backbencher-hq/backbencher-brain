# C++ analyzer — what to do next, measured

> ## STATUS — READ THIS BEFORE QUOTING ANY NUMBER BELOW
>
> This page is a **dated log**, not a current report. Sections 1–5 were written *before* the
> macro-recovery arm (§11) landed; §6, §12 and §13 are corrections written *after* re-measuring; §14
> is the latest round. Where a later section contradicts an earlier one, **the later one is the
> measurement**; earlier text is left standing only as the record of what was believed.
>
> **Reproducible from committed code, today** (`bun run script/cpp-audit/census.ts --json`):
>
> | | |
> |---|---|
> | corpus | 523 cpp files (524 candidates; 1 routes to `c`), 0 engine parse failures |
> | symbols / edges | **17,912** / **78,403** |
> | relationship types emitting | **11** of the 14-value vocabulary (3 ruled absent with grammar evidence) |
> | `calls` target resolved | 54,971 / 59,374 = **92.6%** |
> | `part_of` target resolved | 347 / 360 = **96.4%** — §6 says 97.5%; §14.2 settles it |
> | `references` target resolved | 205 / 206 = **99.5%** (the miss is `::std::ostream`) |
> | `imports` target resolved | 205 / 1,968 = 10.4% — **external by design, must not be "fixed"** |
> | source endpoints | 100% for 10 of 11 types; `contains` **10,972 / 10,975** — §14.3 traces the 3 |
> | parse health | **172 / 523 files carry ≥1 grammar ERROR node**; 90.3% of symbols live in them — a disclosure, not a defect rate (§14.4) |
>
> **Evidence:** `validation/cpp-audit/census.json` — regenerated for this round, and it now carries
> the **post-M65** totals (17,912 / 78,403). So the "17,597 symbols / 78,088 edges" figures quoted in
> §1–§5 below are the *pre-M65* snapshot, not what that file contains today. Corpus:
> `.cpp-corpus/fmt` (10.2.1) + `.cpp-corpus/nlohmann-json` (v3.11.3).

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

> **⚠ PRE-M65 SNAPSHOT.** This table is what the probe said *before* the macro-recovery arm and before
> `resolves()` was made type-aware. Four of its cells are wrong: `calls` target (77.4% → **92.6%**),
> `part_of` (17.5% → **96.4%**), `references` (36.9% → **99.5%**), and the `contains` row count
> (10,660 → **10,975**). §12/§13/§14 carry the corrections; the current figures are in the STATUS
> banner. Kept because a lane's history is not its last writer's.

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

**Source endpoints: measured again, not assumed** (§14.3). The sentence here used to read "100%
resolved for every type". That is true for ten of the eleven, and **false for `contains`, which is
10,972 / 10,975** — the three misses are `AssertHelper -> constructor`, `-> ~AssertHelper` and
`-> operator=` emitted from `gmock-gtest-all.cc`, where the class is declared in another file and the
grammar lost that declaration to an ERROR cascade. The M65 `::` fix did close the last `overrides`
source; it did not make every source resolvable, and no check had ever asked.

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
| ~~3~~ | ~~`part_of` target = file STEM vs declared module name (17.5% resolve)~~ — **WITHDRAWN, §6.** The 17.5% measured a FILE relation against SYMBOLS. Measured in its own key space it is **96.4%** and the residual is headers outside the checkout. There is no work here. | — | — | — |
| 4 | `imports` 10.4% is **correct by design** (external module names) — document, do not "fix" | doc only | prevents a wrong fix | none |
| 5 | Grammar fork: the 544 lost macros are a symptom of ERROR recovery on large single-header libraries; a newer fork would reduce it | upstream | structural | high — byte-pinned fork, 22 fixtures depend on it |
| 6 | Re-cut the 1,282,777-row whole-population census | needs 31-repo corpus | corroboration only | not available here |
| **7** | **ERROR-span DECLARATION loss** (new, §14.3/§14.4) — 172 of 523 files carry ERROR nodes; in `gtest.h` one cascade from `GTEST_IMPL_CMP_HELPER_(NE, !=)` swallows the `AssertHelper` class and 3 `contains` sources go unbound. Recovery is possible but is exactly the "invent a declaration" failure mode this lane gates against | design + measurement | 3 unbound rows on this corpus; unknown on the 31-repo corpus | **high** — a loose ERROR-span recovery re-creates the D11/D15 defects |

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

| measure | value | |
|---|---|---|
| `part_of` rows | 360 | |
| target **IS a file stem present in the corpus** | **347 (96.4%)** | ← reproducible figure (§14.2) |
| target not present as a file here | 13 | |

> **★ CORRECTED AGAIN (§14.2).** The table above first read "351 (97.5%) / 9 absent", and that figure
> **cannot be reproduced from committed code**. The committed probe (`census.ts`, `corpusStems` built
> from the 523 admitted files) says **347 / 360 = 96.4%**, and §13's independent table already said
> 347 — so this section and §13 disagreed about the same measurement and §13 was right. The earlier
> 351 counted four of the absent stems as present; the four are `any`, `optional`, `string_view`,
> `variant`, and **no file with any of those stems exists in the corpus** (checked by name). The
> arithmetic also did not close: it claimed 9 absent while listing 8.
>
> The 4-row difference is not an analyzer defect either way: **2 of the 13 target a file that IS in the
> corpus** but outside the probe's population (a `.h` the content router sends to the **C** analyzer —
> `FuzzerInterface.h`, correctly C, "WARNING: keep the interface in C" — and `FuzzerFlags.def`, an
> extension the probe does not admit). The other 11 are headers genuinely outside the checkout.
> So the analyzer-side figure is ≥ **349 / 360 = 96.9%**.

The absent targets are abseil headers outside the checkout (`failure_signal_handler`, `stacktrace`,
`symbolize`, `str_cat`) plus four **std C++ headers** (`any`, `optional`, `string_view`, `variant`).

**⇒ Work item #3 is WITHDRAWN.** `part_of` is **96.4%** correct (not 97.5%) and the residual is a
missing-file artifact, not a target-shape defect. This is the third time in this campaign that a
headline number measured the wrong thing (`0/134 unresolvable`, `39 fixtures`, now `17.5%`), which is
the argument for stating what a resolution rate is measured AGAINST, not just its value.

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
| part_of | 13 / 360 | abseil/std headers outside the checkout; 2 rows target a corpus file the probe's population excludes | **96.4% correct — see §6, §14.2** |
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

---

## 10 · VERIFIER AUDIT — because a green gate is not evidence

You asked the right question: the scripts and docs are authored by the owner or by agents, so a
passing test proves only that the test agrees with itself. This section audits the verifiers
themselves. Four things were checked, and **two real problems were found**.

### 10.1 The mutation harness — the strongest independent check, and it had a hole

`BB_MUTANT_ONLY="cpp/" bun run script/m14/mutate-analyzer.ts` mutates the analyzer and requires a
fixture to FAIL. That is the only check here that does not take the analyzer's word for anything.

**First run: 54 CAUGHT, 1 SURVIVED, exit 2.**

```
SURVIVED  cpp/last-sig-wins-overrides-respelled  (0 -> 0 failures)
```

Investigated rather than reported. `0 -> 0` does **not** mean "the suite missed a real defect" —
it means **the mutant never fired**. Its filter was `source === "Derived.f"` (dot), and the
analyzer now emits `Derived::f` after the M65 source-spelling fix. **My own change silently
disabled a mutant**, and the harness reported it as a survivor rather than as a broken test.

That is the exact class you described, one level deeper: the *replacement* for an earlier no-op
mutant had itself become a no-op. Both the retired `cpp/last-sig-wins-overrides` and its
replacement `cpp/last-sig-wins-overrides-respelled` were ineffective, and only the first was marked
`retired: true` with a reason.

**Fixed**: the filter now matches the declaration rather than one spelling of it
(`source === "Derived::f" || source === "Derived.f"`), and the comment states that any future
change to source spelling must re-check the filter rather than the count.

**Second run: `all 64 mutants caught`, 0 survived, exit 0**
(`CAUGHT cpp/last-sig-wins-overrides-respelled (0 -> 1 failures; new failures: cpp/ctor-and-overload-regressions)`).

The harness also reports **6 retired mutants not run**, each with a stated reason, and flags any
bare retirement as `BAD-FACT`. One such BAD-FACT exists (`sql/…-RETIRED-unfixtureable`) and is in
another lane. Both cpp retirements carry reasons and point to live replacements.

**⇒ This is the most trustworthy signal in the whole audit, and it was the only one that could
have caught my own regression. It did.**

### 10.2 The `part_of` oracle — independent in code, but ONE RULE IN TWO FILES

| check | result |
|---|---|
| imports the analyzer / its helpers | **0 imports** — genuinely independent |
| mentions `cppPartSymbol` / `isCppSpelledName` / `stripIncludeChars` / `RealCppAnalyzer` | 4, all **inside the doc comment** declaring what it does not do |
| multiset agreement with the analyzer | 2,328 rows, 0 disagreements |

**BUT**: its `stemOf()` is **character-identical in logic** to the analyzer's `cppPartSymbol()`
(verified over 11 inputs: 0 differences). It is the same rule written twice, which is the
`CONNECTED-BUG` class this codebase names (#916: "a second copy of a rule is a second answer, and
the two sides cancelling out of every count is how a wrong edge survives a year of gates").

**⇒ What the oracle CAN and CANNOT prove.** It can catch: a lost `preproc_include` node, a wrong
`path` field read, a dropped or extra row, a dedup regression, a type/kind flip. It **cannot**
catch: a wrong STEM rule, because it would compute the same wrong stem. That is a real limitation
and it is now stated rather than implied.

A secondary probe found a **synthetic-only** edge case — `stemOf("\"q.h\"")` → `"q` (quote leaks
into the stem when the quote is stripped *after* the stem). Verified NOT reachable in the real
pipeline: the `path` node's `.text` carries no quotes, and both sides agree on all five live shapes
(`"a/b.h"`→`b`, `"c.h"`→`c`, `<sys/types.h>`, `<vector>`, `"d.e.h"`→`d.e`). Recorded as a
limitation of the oracle's own helper, not a live defect.

### 10.3 The fixture suite — 1,077 assertions, and the "2.4% exact" was itself a proxy

> **★ CORRECTED (§14.6).** This section first reported "873 assertions, 21 exact = 2.4%" and called
> that the suite's ability to fail in the over-emission direction. Measured again by enumerating every
> assertion key in the 55 suites: **1,077 assertion entries**, and the 21 was `expectRelationshipCount`
> only — it ignored 38 `expectSymbolCount` (`equals`) and 88 `forbidSymbols`. So the ratio was
> measuring *relationship* exactness while presenting itself as the *suite's* exactness.

| measure | value | can it fail on an EXTRA row/symbol? |
|---|---|---|
| cpp expectation suites | **55** | — |
| total assertion entries | **1,077** | — |
| `expectRelationships` | 284 | **NO** — "≥1 match"; a duplicate satisfies it |
| `expectRelationshipCount` (`equals`) | 21 | **YES** |
| `expectSymbols` | 303 | **NO** — existence only |
| `expectSymbolCount` (`equals`) | 38 | **YES** |
| `forbidRelationships` | 268 | **YES**, for the specific rows named |
| `forbidSymbols` | 88 | **YES**, for the specific symbols named |
| `expectImports` / `forbidImports` | 12 / 6 | existence / directed negative |
| everything else (`expectReturnType`, `expectDecorators`, `forbidErrors`, `expectSymbolRanges`, `expectQualifiedCalls`, `expectParameters`, `forbidParameters`, `forbidExports`, `forbidDecorators`, `expectVisibility`, `crossFileOverride`, `expectComplexity`) | 57 | mixed; mostly field/range checks |

**The honest reading is two-sided, and the old section only stated one side.**

* **Weakness (real, unchanged):** 284 of 305 relationship assertions are **"at least one match"**, so a
  *duplicated* or *unspecified extra* edge is invisible to them. Likewise 303 `expectSymbols` rows
  cannot see an extra symbol. `expectRelationships` was never able to catch the D3 duplicate class —
  which is exactly why D3 needed `equals` blocks of its own.
* **Strength the old number hid:** 356 of the 1,077 entries (33%) are **directed negative**
  assertions (`forbidRelationships` 268 + `forbidSymbols` 88) that fail if a named row reappears, and
  59 are exact counts. So the suite is not "2.4% capable of catching over-emission"; it is *fully*
  capable for every row a fixture explicitly forbids, and *blind* for rows nobody named.

That distinction is what determines the next work: adding more `equals` only helps where the fixture's
own contract implies a number ("one edge per pair", "exactly two overrides"), not everywhere.

The mutation harness compensates in the other direction: 65 mutants each prove some fixture CAN fail.
But no mutant can prove a fixture would catch an extra row it never asks about.

### 10.4 The spec — one contradiction, restated
`script/m14/spec/cpp-completeness.json` lists `preproc_def` / `preproc_function_def` under
`internal_silent` (no `_notes`, no `handled_verified`) while `:3317` reads both and published 1,277
macro symbols. The spec is wrong; the code is right.

### 10.5 Summary — is the research complete?

| verifier | trustworthy? | why |
|---|---|---|
| mutation harness | **YES, after the fix** | 64/64 caught, 0 survived; it is the only check that mutates the subject |
| `part_of` oracle | **PARTLY** | independent in code, but shares the stem rule — cannot catch a wrong stem |
| fixture suite | **PARTLY** | 1,077 assertions (§14.6), but 284 of 305 relationship assertions are "≥1 match"; blind to an unspecified extra row, strong on the 356 rows it explicitly forbids |
| census probe | **YES for row counts**, with the corrections in §6/§7 | row counts are mechanical; *resolution* percentages must state what they resolve against |
| docs | **NO, not on their own** | 8 claims were false at HEAD when measured (§7 of the audit page); docs are a claim, never evidence |

---

## 11 · DONE — the macro-recovery arm, test-first, with the numbers

### 11.1 What shipped
A pre-pass (`recoverSwallowedMacros`) that mints a `Macro`/`Constant` for a `#define` the pinned
grammar did not produce a `preproc_def`/`preproc_function_def` node for, plus a helper
(`recoveredMacroParams`) that reads a function-like macro's parameter tokens.

**Why a pre-pass:** the walk is a stack over the tree, and a directive inside an ERROR region has no
node to branch on — the shape the `preproc_def` branch keys on does not exist. The directive has to be
recovered from source text before the walk, which also makes it independent of where the ERROR region
falls.

**Deliberately narrow** (a guessed declaration is the fabrication this lane exists to prevent):
anchored at line start after whitespace, block comments tracked, name must pass `isCppSpelledName`,
a name the file already publishes gets nothing (the branch's own collision guard), and the KIND comes
from the directive's own shape (`NAME(` → function-like, else object-like) — **never from the name's
spelling**, because `NLOHMANN_JSON_NAMESPACE_BEGIN` is a multi-line *object-like* define that a
spelling test would mis-kind.

### 11.2 The measured result

| measure | before | after | delta |
|---|---|---|---|
| symbols | 17,597 | **17,912** | **+315** |
| relationships | 78,088 | 78,403 | +315 |
| `contains` | 10,660 | 10,975 | +315 (exactly one per new symbol) |
| **`calls` target resolution** | **45,967 / 59,374 (77.4%)** | **54,971 / 59,374 (92.6%)** | **+19,004 resolved, +15.2 pts** |
| genuinely-unresolved `calls` targets | 13,407 | **4,403** | **−9,004 (−67%)** |
| `CHECK` (was 6,734) | 6,734 | **0** | gone from the top |
| `CHECK_THROWS_WITH_AS` (was 1,079) | 1,079 | **0** | gone from the top |

`calls` ROWS are unchanged (59,374) — correct: the arm adds no rows and removes none. It only makes
existing reads resolvable, which is exactly what the pre-fix comment said a macro declaration is for.
Every other type is byte-identical. **No fabrication gate moved**: D1 (targets and symbol names),
D2, D3 (all four types), V3, R7 all still **0**.

### 11.3 The test-first discipline, and what it caught in my own work
Committed in this order, deliberately:

1. **fixture + mutant first**, with the analyzer still failing → `cpp 58 pass / 1 fail`, the single
   failure being `expected 1 symbol(s) named "NLOHMANN_JSON_NAMESPACE_END" ... got 0`. That proves the
   defect is detectable *before* any code changes; a fix written first and a fixture written to match
   it would prove only that the two agree.
2. **then the fix** → `cpp 59 pass / 0 fail`.
3. **then the mutant run** → `CAUGHT cpp/macro-recovery-in-error-spans (0 -> 9 failures)` and
   `all 65 mutants caught`, 0 survived.

**The fixture was wrong twice and the analyzer was right both times**, which is the useful part:
- I claimed `NLOHMANN_JSON_NAMESPACE_BEGIN` is `macro`; the grammar classifies it object-like, so it
  is `constant`.
- I claimed the recovered `NLOHMANN_JSON_NAMESPACE_END` is `macro`; its directive has no parameter
  list (the body follows on continued lines), so it is `constant` too.

Both were assertions about *spelling* where the rule is about *shape*. An earlier attempt also wrote a
**synthetic** macro-decorated class to force an ERROR region; it did not reproduce (ERROR spans
appeared, but no `#define` fell inside one), so it would have pinned nothing while reading as if it
did. That attempt is recorded in the fixture rather than deleted, and the shipped fixture is real
code: nlohmann/json's `include/nlohmann/detail/abi_macros.hpp` (v3.11.3), selected by walking every
candidate file to find the smallest one with a directive inside an ERROR span (22 defines, 21 nodes,
exactly one short).

### 11.4 Remaining unresolved `calls`, re-measured (4,403)
`vector` 333 · `max` 312 · `check_double` 157 · `Json` 146 · `patch` 141 · `assert` 116 · `min` 113 ·
`memcmp` 96 · `check_float` 84 · `back_inserter` 77 · `memcpy` 73 · `TEST_DOUBLE` 66.

These are stdlib/Win32 names, test-framework macros not `#define`d in the corpus (doctest's `CHECK`
family IS now resolved; `TEST_DOUBLE` is gtest's, header absent), and template-id spellings. **No
further analyzer change is justified by them** — resolving `vector` or `max` would require declaring
standard-library symbols, which is the fabrication this lane refuses.

---

## 12 · THE THIRD WRONG NUMBER — and the probe fixed rather than its output

`overrides` "source leaf is declared MORE THAN ONCE in its file = 134/134" was wrong, and this time
I caught it by re-deriving instead of re-reading. **All 134 `overrides` sources resolve EXACTLY by
their full string; 0 resolve to nothing.**

**What the bad check did.** It built `declCount` from `s.name` only, so a file declaring
`void f(int)`, `void f(double)` and `void f()` in three classes read as "leaf `f` declared 3x ⇒
ambiguous". But the resolver (`parallel-indexer.ts:5239-5247`) matches the edge's **source string**
against `name`, `qualifiedName` and `metadata.fqn` first, and only falls back to the bare leaf when
none answers. An `overrides` source is now `${cls}::${method}` (M65), which **is** a published
`qualifiedName` — so it resolves exactly and the leaf count is irrelevant.

**The corrected measurement** (523 files, using the store's own key space):

| resolution path | rows |
|---|---|
| bind EXACTLY by full source string | **120** |
| bind via endsWith to a unique key | 0 |
| bind only via bare leaf, ambiguous | 14 |
| bind only via bare leaf, unique | 0 |
| **resolve to nothing** | **0** |

The 14 are genuine C++ — a declaration plus an out-of-line definition of the same method
(`iterator_buffer::grow` 4×, `Mutex::Lock` 2×, `OsStackTraceGetter::CurrentStackTrace` 2×) — not a
spelling defect. **That is a legitimate ambiguous-by-name case, and no resolver can do better without
a key that distinguishes declarations of the same member.**

**Three times is a pattern, so the check was fixed rather than its output.** `0/134 unresolvable`
(wrong: it resolved), `part_of 17.5%` (wrong: 96.4% — §6 said 97.5%, itself unreproducible, §14.2), `overrides 134/134 ambiguous` (wrong: 120
exact, 14 genuine). Each time the cause was the same: **the number measured a proxy — a name count,
or symbol resolution for a file-level relation — instead of the question the consumer actually asks.**
The check now measures against the key space the store receives, which is the thing that decides
whether an edge binds.

**⇒ The honest summary of `overrides` after M65:** 134 rows, all resolving, 120 uniquely and 14 to a
declaration shared by a same-named member (recorded in `metadata.overriddenOwner`, which is the
machine-readable answer to "which declaration did the resolver intend"). **No further analyzer change
is warranted** — the residual is a property of C++ member names, not of the emission.

---

## 13 · THE FOURTH WRONG NUMBER — `resolves()` was measuring every type in one key space

`references` reported **36.9% resolved (76/206)**. The true figure is **99.5% (205/206)**. The one
miss is `::std::ostream`, whose ROOT namespace `std` is not declared in the corpus — correct by
design, since `std` is the standard library.

**The cause was structural, not a typo.** A single `resolves()` tested every target against
**symbol names** (plus a unique-bare-name fallback). That is the right key space for `calls`, `uses`,
`extends`, `instantiates` and `overrides` — and the wrong one for three other types:

| type | its target is | the key space that decides it |
|---|---|---|
| calls / uses / extends / instantiates / overrides | a declared name | symbol names + `qualifiedName` |
| `references` | a **namespace** name (`using X = Y;`) | namespace names, and the ROOT of a `::` path |
| `part_of` | a **file stem** (file-level relation) | file stems present in the corpus |
| `imports` | an external **module** name | nothing in-corpus — external by design |

**So this was one defect producing four headlines.** Measured with the correct space per type:

| type | before (symbol-name space) | after (its own space) |
|---|---|---|
| `references` | 76/206 = 36.9% | **205/206 = 99.5%** |
| `part_of` | 63/360 = 17.5% | **347/360 = 96.4%** |
| `overrides` | "134/134 ambiguous" | **120 exact + 14 genuine, 0 unresolved** |
| `imports` | 205/1,968 = 10.4% | 205/1,968 = 10.4% (unchanged — external by design) |

**The four wrong numbers of this campaign, together, because they are one lesson:**

| # | the claim | the truth | the proxy that misled |
|---|---|---|---|
| 1 | `overrides` "0 of 134 unresolvable" | all 134 resolved | resolver leaf-matching on `.` was unread |
| 2 | `part_of` "17.5% resolved" | 96.4% (§6 said 97.5%, unreproducible — §14.2) | a FILE relation measured against SYMBOLS |
| 3 | `overrides` "134/134 ambiguous" | 120 exact + 14 genuine | a NAME count, not the store's key space |
| 4 | `references` "36.9% resolved" | 99.5% | symbol names for a NAMESPACE target |

Every one came from the same mistake: **printing a rate without stating what it was measured against.**
`resolves()` now takes the relationship type and answers in that type's own space, and any rate this
probe prints names its space. That is the structural fix; the four numbers above are just where it bit.

**Consequence for the work list: two items are now closed and one is confirmed correct-by-design.**
`part_of` (96.4%) and `references` (99.5%) need **no analyzer change** — their residuals are a file
outside the checkout and `std` itself. `imports` (10.4%) is external-module by construction and must
**not** be "fixed". The remaining honest resolution gap is `calls` at 92.6% (4,403 rows), which is
stdlib/Win32/test-macros and was analysed in §11.4.

---

## 14 · The round after the restore — the instrument itself was reverted, and re-measuring corrected §6

**Start here:** §13 ended by claiming "`resolves()` **now** takes the relationship type and answers in
that type's own space". That claim was **false at HEAD** when this round began. A release commit
(`ce3b2a95d`, "Release 0.1.5") had silently reverted the fix: `script/cpp-audit/census.ts` was cut from
537 to 456 lines and the type-aware resolver, the corrected `overrides` check and the corrected
`census.json` all went with it. The earlier restoration commits (`02ec6c6b5`, `ff67d9610`) put back the
analyzer, the fixture, the mutant, the doc and the spec — **they missed the probe and its evidence.**

So the first act of this round was to restore `census.ts` from `ac1352830` (the commit titled "the
fourth wrong number — `resolves()` measured every type in the symbol-name space") and then
**re-run it against the current analyzer**, rather than restoring its old output: evidence for today's
tree has to come from today's tree.

**What the restore proved.** With the type-aware resolver back, the committed census reproduces §13
exactly — `references` 205/206, `part_of` 347/360, `overrides` 134/134 with 120 exact — and the four
"corrected" numbers in this document are now checkable from committed code instead of only stated.

### 14.1 · The probe was extended, because a probe that measures one type cannot adjudicate

Two gaps were closed in `census.ts`, both structural:

1. **Every type now reports its residual target AND its residual source**, each in its own key space,
   with that space printed in the check name. The old loop covered `imports`/`references`/`exports`
   only, which is precisely why §6's `part_of` number sat next to §13's different `part_of` number
   with nothing to settle it.
2. **Every rate names its space.** `perType[type].targetResolvedSpace` carries it, and the non-JSON
   output prints it on its own line under each type.

### 14.2 · §6 vs §13 — same measurement, two numbers, and §13 was right

| | claim | reproducible? |
|---|---|---|
| §6 | `part_of` 351 / 360 = **97.5%**, 9 absent | **NO** — not from any committed code |
| §13 | `part_of` 347 / 360 = **96.4%** | **YES** — `bun run script/cpp-audit/census.ts` |

Measured: **347 / 360 = 96.4%**, 13 residual rows. The 13 decompose as:

* **2 rows** target a file that **is** in the corpus but **outside the probe's population**: `FuzzerInterface`
  (the one `.h` whose content correctly routes to the **C** analyzer — its own text says
  "WARNING: keep the interface in C") and `FuzzerFlags` (`#include "FuzzerFlags.def"`, an extension the
  probe does not admit). These are **probe-population artifacts**, and the analyzer-side figure is
  therefore ≥ **349 / 360 = 96.9%**.
* **11 rows** target headers genuinely outside the checkout: abseil (`failure_signal_handler`,
  `stacktrace`, `symbolize`, `str_cat`) and `std` (`any`, `optional`, `string_view`, `variant`). Correct
  to leave unresolved; inventing declarations for them would be the fabrication the lane gates against.

§6's supporting detail was also wrong in a way worth recording: it said "the 9 absent ones are …" and
then listed **8** names, and **no file with any of those four std stems exists in the corpus** (checked
by name), so they could not have been "present". A stale number wearing a plausible explanation is
harder to catch than a bare wrong number — which is why the explanation is corrected too.

### 14.3 · A check no one had run: the SOURCE endpoint is not 100%

§1 asserted "source endpoints are 100% resolved for every type". Measured in each type's own space:

| type | source resolved | note |
|---|---|---|
| 10 of 11 types | **100%** | incl. `overrides` 134/134 after the M65 `::` fix |
| `contains` | **10,972 / 10,975** | 3 misses |

The three are `contains AssertHelper -> constructor`, `-> ~AssertHelper`, `-> operator=`, emitted from
`fmt/test/gtest/gmock-gtest-all.cc`. The members are published with `ownerName: "AssertHelper"` and a
proper `qualifiedName`, but **the class symbol is not published anywhere in the corpus**, so those three
sources bind to nothing. Traced to the cause:

* `class GTEST_API_ AssertHelper { … }` lives at `gtest.h:11673`, and the grammar's tree there is
  **not** the D15 `function_definition` shape (that fix is intact and its mutant still fires). It is an
  **ERROR cascade**: `GTEST_IMPL_CMP_HELPER_(NE, !=)` at `:11527` — a namespace-scope, function-like
  macro invocation whose argument is an **operator token** — desyncs the parse, and one `ERROR` node
  runs from `:11527` to `:11684`, swallowing the whole class declaration. The nested
  `struct AssertHelperData` survives but is re-owned to `internal`.
* `gtest.h` is therefore published with **1,858 symbols and no `AssertHelper`**, which is a *grammar*
  limitation, not an emission rule. The lane cannot fix it by relaxing an analyzer rule; it would have
  to recover declarations from an ERROR span, which is the D11/D15 failure mode this lane gates
  against. **Recorded as ranked item #7, not attempted.**

### 14.4 · Parse health — the lane's "0 parse failures" was hiding a third of the corpus

`corpus.parseFailures: 0` counts only files where the **engine threw**. It says nothing about the
grammar tree, and `gtest.h` proves the difference. The engine already discloses this (`errors[]` from
`rootNode.hasError`, `engine.ts:1879`); the probe simply never read the array. It does now:

| measure | value |
|---|---|
| files whose parse result carries ≥1 ERROR node | **172 / 523 (32.9%)** |
| files with a clean tree | 351 |
| symbols living in ERROR-carrying files | **16,175 / 17,912 = 90.3%** |
| edges living in ERROR-carrying files | **72,798 / 78,403 = 92.9%** |
| files at the engine's 50-entry disclosure cap | 35 |

**Read this as a disclosure, never as a defect rate.** tree-sitter is an error-*recovering* parser: one
ERROR node can be a single unparseable macro region in a 12,000-line header and the other 2,600 lines
can be exact. So "90.3% of symbols" does **not** mean 90.3% of the output is wrong — the fixture suite,
this census and the differential are what measure correctness. What it means is: **a reader who sees
"0 parse failures" must not infer "clean parses"**, and every one of the lane's coverage figures is a
measured *floor* over a population where a third of the files exercised error recovery.

### 14.5 · Verifier trust, unchanged and still the weakest link

Nothing in this round strengthens the fixture suite's structural weakness recorded in §10 — and
that section's own headline ("873 assertions, 21 exact = 2.4%") turned out to be another proxy, so it
is corrected in §14.6. The measured position:

* **284 of 305 relationship assertions are "≥1 match"** — they cannot fail on a duplicated or
  unspecified extra row. That is the real blindness, and nothing here changes it.
* but the suite is **not** 2.4% capable of catching over-emission: **356 of its 1,077 assertions are
  directed negatives** (`forbidRelationships` 268, `forbidSymbols` 88) and **59 are exact counts**
  (21 relationship + 38 symbol).

So the census can catch a fabricated row (it did — that is how the 3 unbound `contains` sources were
found), the mutants can catch a reverted rule, and the forbid/equals fixtures can catch the rows they
name. What remains uncovered is the **unnamed extra row**, and closing that is the next thing worth
doing in this lane — ahead of item #7.

### 14.6 · §10.3 was measuring relationships and calling it the suite

§10.3 said "873 assertions, 21 exact = 2.4%" and used that as the fixture suite's over-emission
capability. Re-derived by enumerating every assertion key in the 55 suites — committed as
`script/cpp-audit/fixture-assertion-census.ts` so it can be re-run instead of restated:

```
bun run script/cpp-audit/fixture-assertion-census.ts
```

| measure | value |
|---|---|
| suites | 55 |
| **total assertion entries** | **1,077** |
| `expectSymbols` (exists only) | 303 |
| `expectRelationships` ("≥1 match") | 284 |
| `forbidRelationships` (directed negative) | 268 |
| `forbidSymbols` (directed negative) | 88 |
| **`expectSymbolCount` (`equals`)** | **38** |
| **`expectRelationshipCount` (`equals`)** | **21** |
| `expectImports` / `forbidImports` | 12 / 6 |
| all other keys | 57 |

| capability | count | share of 1,077 |
|---|---|---|
| exact counts — can fail on an extra row/symbol | **59** | 5.5% |
| directed negatives — fail if a NAMED row/symbol reappears | **356** | 33.1% |
| "exists / ≥1 match" — **cannot** see an extra row/symbol | **587** | 54.5% |

Of the 305 **relationship** assertions, **21 (6.9%) carry a count** and 284 (93.1%) are "≥1 match".
That 6.9% is what §10.3's "21" was; the "2.4%" denominator (873) was also wrong — it counted only
four of the arrays and missed 1,077's real total.

**Both directions of the old claim were wrong, and the correction matters for the work list:**

* The suite's over-emission blindness is **real but scoped**: it applies to the 284 "≥1 match"
  relationship assertions and the 303 existence-only symbol assertions — i.e. it cannot see an
  *unspecified extra row*. That is exactly why D3 (duplicate pairs) was invisible to the suite before
  `equals` blocks were added.
* It is **not** "2.4% capable": 356 assertions (33%) are directed negatives that fail the moment a
  named row or symbol returns, and 59 are exact counts. The suite is strong on what it names and
  blind on what it does not.

So the next fixture work is **not** "add `equals` everywhere" — most fixtures have no contract that
implies a number, and pinning a count with no contract is just golden-testing. It is: find the
fixtures whose own documented invariant IS a count ("one edge per pair", "exactly two overrides",
"one `part_of` per include"), and give those an `equals` block. The rest should stay as they are and
be understood as existence checks.
