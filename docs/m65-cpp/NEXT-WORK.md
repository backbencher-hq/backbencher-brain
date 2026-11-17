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
| receiver facts in the DEFAULT analyzer (2-repo) | **2,863** rows carry `metadata.owner` from the index-free arm, 0 failing the census's file-symbol re-check (§14.18 — the wall is NOT closed by it) |
| index consumption | **SHIPPED DEFAULT-ON** (§14.19) — with a complete index the 2-repo gate reads resolved **51,034** vs **51,741** per-file; `BB_CPP_INDEX_CONSUME=0` reproduces the per-file numbers EXACTLY |
| whole-population corpus | **RECONSTRUCTED, REPRODUCIBLE** (§14.21) — `script/cpp-audit/reconstruct-corpus.ts` + `validation/cpp-audit/corpus-manifest.json`: 46 repos / 23,058 C++-spelling files (38 pinned, 8 head-pinned, 1 absent, 5 fetch-failed recorded); the extension-only gate population on it is **7,778 files / 18 repos**, within 4.6% of the original ledger's 7,435 |
| wall W8 | **CLOSED** (§14.22) — the 4 rows (on BOTH populations) were functional casts of `<cstdint>`/`<cstddef>` value types; `calleeLeafNode` now applies the guard the `instantiates` path already had; fixture `cpp/typedef-functional-cast` + mutant `cpp/standard-typedef-cast-call` (71/71 mutants) |
| relationship coverage | **ALL 14 VALUES DISPOSED, BOTH DIRECTIONS** (§14.23) — 11 emitted with outgoing emission-site + whole-population edge counts and incoming gate/census evidence; 3 ruled on **LANGUAGE semantics** (the grammar-based ruling basis is withdrawn — grammar is fixable). Near-miss census whole-corpus: 1,425 attribute sites / 28 attribute-argument calls · 763 render-verb calls · 3,695 base clauses / 66 multi-base / 59 CRTP; each pinned by a fixture + a resurrection mutant (**74/74 mutants**) |
| spec table | **REGENERATED, `--check` PASSES** (§14.24) — from committed reconstruction inputs: D2 census 7,778/18, D3 THREE arms incl. the B-off kill-switch (consume-only +19,061 resolved / −40,770 ambDecl / +21,709 unresolved / extOK 0; index-alone delta 0), post-W8 wall ledger, applicable-set, cap-50 log; hand-written provenance merged from `script/m14/spec/cpp-spec-table.errata.json`. The original-population rows are preserved in the errata and §14.21 |
> | `calls` target resolved | 54,971 / 59,374 = **92.6%** |
> | `part_of` target resolved | 347 / 360 = **96.4%** — §6 says 97.5%; §14.2 settles it |
> | `references` target resolved | 205 / 206 = **99.5%** (the miss is `::std::ostream`) |
> | `imports` target resolved | 205 / 1,968 = 10.4% — **external by design, must not be "fixed"** |
> | source endpoints | 100% for 10 of 11 types; `contains` **10,972 / 10,975** — §14.3 traces the 3 |
> | parse health | **172 / 523 files carry ≥1 grammar ERROR node**; 90.3% of symbols live in them — a disclosure, not a defect rate (§14.4) |
> | population | these 523 files **include `.h`**; the M14 gate's own population admits 9 of the 11 cpp spellings and drops `.h`/`.hh`, which are **43.3% of the symbols** (§14.8) |
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
| 2 | `.h`-by-content population in the M14 gate discovery (`incoming-gate.ts:314`) — 3,095 cpp-routed headers, 87,181 `#define`s sit outside the measured population. **§14.8 measures what that costs: on this corpus the excluded `.h` files are 39/523 files but 43.3% of SYMBOLS, 20.0% of edges and 48.5% of `#define`s** — including fmt's public API headers | one-word/set change, **master-owned** | the lane's own largest residual (83% of `calls`), and roughly half the graph is unmeasured | touches shared gate; needs Lead |
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

### 14.7 · The first count that was added: `imports` de-dupe, which the fixture documented but did not enforce

`cpp/imports-include-910`'s rationale states the D3 invariant in words — "one edge per MODULE" — and the
fixture file repeats it. Measured, the invariant held: two `#include <string>` lines produced **one**
`imports -> string` edge. But **nothing enforced it**: every row in that file was an
`expectRelationships` (">=1 match"), and a duplicate satisfies `some()`. The fixture's own rationale
even said so in passing ("EXPECTED-RELATIONSHIP, not `equals`") — the de-dupe was pinned by prose.

Closed:

| change | why it is legitimate and not golden testing |
|---|---|
| `expectRelationshipCount { type: imports, from: global, target: string, equals: 1 }` | the fixture's own documented invariant IS a count ("one edge per MODULE") |
| `expectRelationshipCount { type: imports, from: global, equals: 2 }` | the whole file's contract is two `imports` facts (`vector`, `string`); the quoted include is `part_of` and the `using` is `references` |
| `script/m14/cpp-mutants.ts` → `cpp/imports-per-occurrence-not-per-module` | the mutant that proves the new counts are load-bearing |

The mutant models the pre-dedupe state faithfully rather than by editing source: `result.imports` is
the **occurrence** array (it still holds every `#include`), so the transform re-emits each `imports`
edge once per occurrence. Run:

```
BB_MUTANT_ONLY="cpp/imports-per-occurrence-not-per-module" bun run script/m14/mutate-analyzer.ts
→ CAUGHT  cpp/imports-per-occurrence-not-per-module  (0 -> 3 failures;
          new failures: cpp/imports-include-910, cpp/include-kind-imports, cpp/one-edge-per-pair-959)
```

`cpp/imports-include-910` is the **first** named failure, which is the attribution that matters: the two
count rows added here are what fails. The other two are collateral — those fixtures also carry repeated
includes — and they were already dedupe-sensitive by other means.

**Two inaccuracies in the fixture were corrected while doing this**, because the count forced the prose
to be checked:

* the `.cpp` comment said a quoted `#include "local.h"` emits `imports`; the pin and the analyzer both
  emit `part_of` with `meta.isSystem: false` and the part's **module symbol** as target. The comment was
  stale from before the target moved off the checkout-dependent path — corrected to `part_of`.
* the rationale and the `expectImports` note both said "three `#include <string>` lines"; the file has
  **two**. Corrected to two in both places. (The `expectImports` note's *contract* — "the ARRAY keeps
  every occurrence while the GRAPH keeps one edge" — is right and is now demonstrated by the mutant
  above.)

**Runner gap this exposed, for the master-owned file.** `expectImports` is a ">=1 match" matcher with
**no count variant** (unlike `expectRelationships`/`expectRelationshipCount`), so the occurrence
multiplicity that the note describes — two `<string>` lines ⇒ **two** `result.imports` entries — cannot
be pinned by any fixture assertion. The graph-side de-dupe is now pinned; the array-side multiplicity
is not, and cannot be without a runner change.

### 14.8 · The population the lane measures: excluding `.h` excludes 43% of the graph

Work item #2 has been stated as a *file count* ("3,095 cpp-routed headers outside the measured
population"). Measured by extension on this corpus, the cost is in the graph, not in the file count:

| ext | files | symbols | edges | `#define` | in M14's population? |
|---|---|---|---|---|---|
| `.cpp` | 383 | 2,094 | 30,323 | 65 | yes |
| `.hpp` | 55 | 5,381 | 19,311 | 1,670 | yes |
| `.cc` | 44 | 2,673 | 13,048 | 59 | yes |
| `.cu` | 2 | 5 | 9 | 0 | yes |
| **`.h`** | **39** | **7,759** | **15,712** | **1,688** | **NO** |
| **total** | **523** | **17,912** | **78,403** | **3,482** | |
| **M14 population** | **484** | **10,153** | **62,691** | **1,794** | |

**The 39 excluded files carry 43.3% of the symbols, 20.0% of the edges and 48.5% of the `#define`s.**
It is not a rounding margin — it is where C++ puts its declarations:

```
1858 sym  gtest.h      1849 sym  gmock.h      901 sym  doctest.h
 669 sym  fmt/core.h    577 sym  fmt/format.h   369 sym  fmt/chrono.h
 171 sym  fmt/ranges.h  163 sym  test/scan.h     95 sym  fmt/format-inl.h
```

`fmt/include/fmt/{core,format,chrono,ranges,color,format-inl}.h` are **fmt's public API**. A population
that omits `.h` measures fmt's tests and its `.cpp` internals and misses the library's interface.

**Why this is a note and not a fix.** The M14 gate's command line passes **9** of the 11 spellings the
canonical table admits (`script/m14/language-extensions.ts:153`); `h` and `hh` are dropped because a
`.h` is ambiguous between C and C++ and the gate has no content router. That is `script/m14/**` —
master-owned, and work item #2. **What this section adds is the number the decision needs**: the
exclusion is not 7.5% of files, it is 43.3% of the symbols, so every "measured on the lane's
population" figure in this document is a floor over roughly half the graph.

**Caveat, stated because this document has been burned by un-stated scope:** measured on the 2-repo
corpus, which is unusually header-dense (fmt ships its implementation in `-inl.h` and its API in `.h`).
The 31-repo corpus's ratio is **not** measurable here and is not claimed.

### 14.9 · `extends` against the grammar's own base clauses — and what the D2 ruling costs

`extends` is the one relationship whose ground truth the pinned grammar states outright: a
`base_class_clause` node lists the bases. So "one row per base" — the premise of the `mixes_in`
ruling above — is checkable without a hand-written oracle. Committed as
`script/cpp-audit/extends-baseline-check.ts`; evidence in `validation/cpp-audit/extends-baseline.json`.

| measure | value |
|---|---|
| classes/structs with a base clause | **514** |
| base entries the grammar names | **519** |
| multi-base classes | **5** |
| classes with no `extends` row for some base | 186 |
| ↳ the DOCUMENTED D2 self-leaf ruling | **48** |
| ↳ a dependent-ALIAS base (`std::conditional<...>::type`) | **3** |
| **↳ genuinely missing (a base that does not collapse, no row)** | **0** |
| surplus rows | 340 (same-NAME bucket collisions — see below) |

**Verdict: no missing `extends` rows on this corpus.** Every base the grammar names is carried by a
row, except the two explained classes. The `mixes_in` ruling's premise ("multiple inheritance is
carried as one `extends` per base") is therefore **measured**, not asserted: all 5 multi-base classes
account for all their bases.

**The 48 are a deliberate product decision, and it is worth knowing its price.** `extendsTargetName`
(`real-cpp-analyzer.ts:902`) refuses a base whose leaf equals the derived class's own name, because
the leaf clean destroyed the evidence that told them apart — `priority_tag<N-1> : priority_tag<N-2>`
and `char_traits : std::char_traits<T>` both collapse to `X : X`. The ruling: "an edge built on lost
evidence is not a weaker edge, it is no edge". Correct by its own standard, and the override resolver
was aligned in the same commit.

**But it means 48 legal inheritance facts are absent from the graph on this corpus** — every one of
them a class specialization inheriting from its own primary template (`formatter<X> : formatter<Y>`,
`has_member_data_* : std::true_type`). The alternative is not "emit the self edge": it is to emit the
edge with a target that PRESERVES the evidence (`std::char_traits`, or the un-cleaned base spelling).
That is a design change with its own risks, so it is recorded here rather than attempted — the lane
should choose deliberately, not drift.

**The 3 dependent-alias cases are a naming judgement, not a miss.** `struct conjunction<...> :
std::conditional<...>::type` — the grammar's structural base NAME is the alias `type`; the analyzer
publishes the template name `conditional`, which is the more identifying of the two (`type` is the
least specific name in C++). Both are defensible; nothing is lost.

**The 340 "surplus" rows are the probe's known limitation, not duplicates.** Matching is by NAME
within a file, so two class-template specializations with the same name (`is_reference_wrapper<T>` and
`is_reference_wrapper<std::reference_wrapper<T>>`) share one row bucket. Each specialization gets its
own row; the bucket shows both. This is the same C++ ambiguity the `overrides` audit records: a name
cannot identify a declaration. It is declared in the probe rather than hidden.

**Three probe drafts were wrong before this one was right — 359, 215, then 514 fake mismatches**, and
each was the PROBE, not the analyzer: (1) splitting the class head at the first `:` lands inside
`std::false_type`; (2) taking the last `::` segment of a `template_type`'s TEXT lands inside the
template ARGUMENTS (`std::ratio_divide<std::ratio<1, Period::num>::type, ...>` → `period>`); (3)
matching a class symbol by LINE is impossible because **this analyzer publishes no line on any
symbol** (`line` is undefined; only relationships carry `line_number`). All three are recorded in the
probe's docstring, because each looked like an analyzer defect and none was.

### 14.10 · The 14-value vocabulary on the current tree — one table, every kind, with its evidence

This is the "all kinds covered, working, verified" answer, and every row is reproducible from
`validation/cpp-audit/census.json` unless a different instrument is named. "Resolved" is always in
**that kind's own key space** (§13/§14.2).

| # | kind | emitted | rows | target resolved | evidence / residual verdict |
|---|---|---|---|---|---|
| 1 | `calls` | yes | 59,374 | 54,971 = **92.6%** | residual analysed (§7, §11.4): stdlib/Win32/absent-header macros — **no further change justified**, would require inventing declarations |
| 2 | `contains` | yes | 10,975 | 10,975 = **100%** | sources 10,972/10,975; the 3 traced to a grammar ERROR cascade (§14.3) |
| 3 | `uses` | yes | 4,580 | 4,351 = **95.0%** | residual = std header members (`tm_gmtoff`, `tm_isdst`, `tm_zone`) — accept |
| 4 | `imports` | yes | 1,968 | 205 = **10.4%** | **external by design — must NOT be "fixed"** (§4 item, §7) |
| 5 | `extends` | yes | 478 | 435 = **91.0%** | residual = std bases not declared in-corpus; **one row per base VERIFIED against the grammar** (§14.9): 0 missing, 48 documented D2 cases, 3 alias-naming |
| 6 | `part_of` | yes | 360 | 347 = **96.4%** | §14.2: 2 probe-population artifacts + 11 headers outside the checkout |
| 7 | `references` | yes | 206 | 205 = **99.5%** | one miss `::std::ostream`, root `std` not declared — correct |
| 8 | `instantiates` | yes | 182 | 167 = **91.8%** | residual std/Win32 types (`stringstream`, `CRITICAL_SECTION`) — accept |
| 9 | `overrides` | yes | 134 | **134 = 100%** | 120 bind exactly + 14 genuinely ambiguous declarations (§12) |
| 10 | `exports` | yes | 112 | **112 = 100%** | re-measured over every row this round: **112/112 are macro-path** (`FMT_API`×13, `GTEST_API_`×99), all with `metadata.exportMacro` + `reasonCode: export-marker-in-specifier` + `evidenceClass: structural` + confidence 1.0. The attribute path (`metadata.exportSpelling`) is **0/112**, correct here: the corpus's `__attribute__((visibility))` sites live inside `#define` bodies, not on declarations |
| 11 | `implements` | yes | 34 | **34 = 100%** | pure-virtual interface rule; small count is this corpus, not the emission |
| 12 | `decorates` | **no** | — | — | ruled `ontological`: a C++ attribute is PASSIVE METADATA, the value's contract is an APPLIED CALLABLE. Partially re-verified here: 13 attribute-argument sites in this corpus, **0** whose argument invokes a callable |
| 13 | `renders` | **no** | — | — | ruled `grammar-remedy-ruled`: no JSX/component production exists in C++ |
| 14 | `mixes_in` | **no** | — | — | ruled `grammar-remedy-ruled`: multiple inheritance carries as one `extends` per base — **the premise is now measured, not asserted** (§14.9: 5 multi-base classes, every base accounted for) |

**Verdict.** Eleven kinds emit; three are absent under rulings that this round either re-verified
(`decorates`, partially) or whose stated premise it measured for the first time (`mixes_in`). No kind
is absent by omission. The residual unresolved targets are, in every case, names the corpus does not
declare (stdlib, Win32/libc, headers outside the checkout, external modules) — leaving them unresolved
is the correct behavior, and the one thing that would be *wrong* is to "fix" them by inventing
declarations.

### 14.11 · The machine-readable applicable set contradicted the analyzer — two directions, both fixed

The prose doc had already recorded one part_of correction (its own correction table, row 6), but the
**machine-readable layer never got it**, and a second cell was stale in the opposite direction.

**1. `part_of` was ruled NOT APPLICABLE by the instrument.** `script/m14/cpp-applicable-set.ts` asked
for grammar productions `part_directive` / `part_of_directive` / `part_clause` — **the DART grammar's
node names** — so the test could never pass for C++, and the generated
`script/m14/spec/cpp-spec-table.json` listed `part_of` among the ruled-absent values. That denies a
value the analyzer emits from `preproc_include` (360 rows / 3,974 whole-population), pins with two
fixtures, and audits with an oracle (2,328 rows, 0 disagreements). It is a **category error in the
instrument**, not a ruling: the ontology's own definition of the value is the directive that NAMES A
PART (`part 'x.dart'` / `#include "x.h"`), and C++ writes exactly that construct.

Fixed at the root: the instrument now carries the C++ construct surface
(`preproc_include` + `string_literal` + `system_lib_string`) with the quoted/angle split and the
metadata contract. The committed table was corrected the same way (11 applicable, 3 ruled) **by hand,
with an `errata` block recording why**: the generator cannot be re-run in this checkout because its
measurement inputs live under `validation/m14/fixtures/cpp/measurements/`, which does not exist
(`cpp-spec-table.ts --check` exits `ENOENT`). That directory, not the analyzer, is the release-relevant
gap: the whole-population census / D3 arms / D7 price+walls embedded in the table were measured on the
31-repo corpus. **The next run on a corpus machine regenerates from the fixed instrument and deletes
the errata block.**

**2. `part_of`'s evidence CLASS was documented backwards.** `docs/analyzers/cpp.md` asserted every row
carries `usage_contextual` because `classifyEvidenceTier` had "no arm for `part_of`". M65 added that
arm (`real-cpp-analyzer.ts:6523`) and the cell was never updated — the same revert-and-restore drift
as §14. Corrected against the committed census: **360/360 `structural`, 0 `usage_contextual`**.

The lesson is the lane's own: a correction written in prose is not a correction. The prose, the
instrument, the generated artifact and the committed evidence each have to carry it, and this round
found the same truth stale in three of those four places.

### 14.12 · SHIPPED — the ISO stdlib citation claim is now the default (wall B, 7,962 rows)

The wall ledger's **CLAIMED** bucket (W1-B, `committed-stdlib-vocabulary`, **7,962 rows**) was claimed
by the vocabulary but **not shipped**: the analyzer emitted the claim only under `BB_CPP_CITATION=1`, so
production emitted none and every listed `std::` citation still counted as unresolved. Shipped this
round.

**What changed.**
- `cppCitationFacts` is ON by default; `BB_CPP_CITATION=0` is the **kill-switch** (kept so the
  pre-claim output stays reproducible in one environment variable).
- The citation fixture now pins the claim **in the default state**: claims + the
  `languageNamespacePolicy: "strict-absent"` marker on all three listed rows, with every negative
  (unlisted symbol, same symbol under another root, unqualified call, marker leak) still forbidden.
  Previously the suite could only see the OFF state, because the flag was off in the fixture run.
- `script/m14/cpp-citation-verify.ts` now tests the SHIPPED default plus the kill-switch (vocabulary
  drift guard, negatives, marker contract and row-identity unchanged).
- New mutant `cpp/citation-claim-dropped` — **CAUGHT, naming `cpp/citation/citation`** — so the claim
  is load-bearing in the suite rather than only in a side instrument.

**Measured on this corpus, no environment flags:**

| | before ship | after ship |
|---|---|---|
| `calls` extOK (arbiter-verified claims) | 0 | **782** |
| unresolved edges | 8,002 | **7,220** |
| resolved | 51,743 | 51,743 (unchanged — a claim is never a resolution) |
| ambiguous | 18,604 | 18,604 (unchanged — the claim speaks only where the name model has nothing) |

The invariance is the design and is now proven by the fixture/mutant pair: the claim changes **metadata
only**, never a row. Whole-population expectation is the ledger's 7,962 rows.

### 14.13 · Wall W4 was chasing a symbol that already exists — the real gap is the TARGET contract

The wall ledger's W4 (`qualified-name-not-published`, 2,771 rows) was dispositioned **INSTRUMENT GAP**
on the reason *"the analyzer publishes LEAF names; a cpp member symbol has no distinct qualifiedName."*
**That reason is false.** Measured through the production entry on this corpus:

| kind | symbols | with `qualifiedName` | distinct from `name` |
|---|---|---|---|
| method | 4,222 | 4,222 | **4,222** |
| constructor | 912 | 912 | **912** |
| property | 1,677 | 1,677 | **1,677** |
| class | 1,582 | 945 | 945 |
| enum_member | 491 | 485 | 485 |
| **total distinct strings** | | | **6,913** |

Real examples: `dynamic_arg_list::node`, `node::~node`, `typed_node::head_`. So the publication the
wall says is missing exists and is complete for members.

**What is actually true is narrower and is a design contract, not a gap:** an edge **target** is the
callee/member **leaf** (the qualified spelling rides `metadata.qualified` — documented, and multiple
fixtures pin leaf targets). The arbiter's qualified-name join can only help a row whose *target* is
qualified; it asked **532** such rows and resolved 0. So closing W4 means changing the target spelling
to the qualified key where it is unique — a **vocabulary/consumer contract change**, which is why the
correct disposition is "design decision, needs the Lead", not "instrument gap".

Corrected in the machine-readable table (disposition replaced, measurement appended, `previousDisposition`
retained) so the next agent does not spend a cycle re-deriving a publication that already exists.

**Standing decision request for the Lead:** adopt qualified targets for `calls`/`uses` where the
qualified key is unique (the analyzer already computes it), or keep leaves and rule W4 as a documented
limitation. The lane should not drift into this by accident.

**DECIDED — §14.20.** Keep leaves; W4 is ruled ABSENT-BY-CONTRACT, not a gap. The re-spelling would
be a cross-consumer vocabulary change for a join measured at 0 net resolutions on this lane, and the
leaf target is the family's documented contract.

### 14.14 · Receiver typing measured end-to-end — the wire exists, the yield is 0.3%

The wall ledger's largest instruments gap is receiver typing (W1-C 370,246 + W11 83,169 rows). It was
reported as "the analyzer will not invent one", so this round measured what the existing channel
actually delivers, through the SHIPPED path rather than by reading code:

1. **Production does build a cpp project index.** `PROJECT_INDEX_EXTENSIONS` carries every cpp
   extension and `specByLang.cpp = CPP_DECLARATION_SPEC` (`src/ast/parallel-indexer.ts:1746,1845`).
   The spec-table note that "production builds no cpp project index" is **STALE**.
2. **The analyzer refuses an index that is not `complete`** — fail-closed by design
   (`indexUsable = candidate.complete === true`). A locally built index reports `complete: false`
   unless the caller states the walk was whole (`indexScope`), so an instrument that builds its own
   index and forgets that fact measures a DEAD channel and reports it as an absent one.
3. **With a complete index the channel does fire** — measured on `fmt/format.h` + `fmt/chrono.h`
   (1,720 `calls` rows): `metadata.declaredInProject` on **356** rows, `metadata.owner` on **5**.
   The five are genuine receiver facts (`format -> format`, owner `formatter`; `put -> do_put`, owner
   `format_facet`; `compile_string_to_view -> to_int_type`, owner `char_traits`).

**So the receiver channel's current yield is 0.3% of call rows, not the tens of thousands the wall
needs.** The three implemented shapes (constructor temp, typed local, implicit-this) cover only
receivers whose type is written in the SAME function or is the enclosing class. W1-C's 267,083
"member-leaf-many-owners" rows are the opposite case — a member call through a receiver whose type is
nowhere in the function — and closing those requires real type inference (member-declared types,
parameter types, return types), which is a distinct measured campaign, not an extension of the three
shapes.

**Decision recorded rather than assumed:** extending receiver typing is *not* a cheap win, and the
0.3% base rate is the number to beat. The next campaign step is a shape census of the un-typed
receivers (`x.m()` where `x`'s declaration exists in the index) to price inference before writing it.

### 14.15 · The consumption arm is real (+17,955) and our 2-repo re-run did not reproduce it — both facts recorded

Found while checking the receiver census: the spec table contradicted ITSELF. `wholePopulationArms.status`
still said *"production builds no cpp project index, so the A→B delta is 0 in every column"*, while the
same object's `d3.indexedArm` already recorded the supersession — both halves wired, 31 repo indexes
built, and the movement coming from **consumption** (`BB_CPP_INDEX_CONSUME=1`), measured on the
whole population as **+17,955 resolved, −22,656 ambiguous, +4,701 honest NULLs**. Fixed the `status`
clause to agree (errata entry appended).

**And the honest counter-observation:** re-running the incoming gate on the 2-repo corpus with
`BB_CPP_INDEX_CONSUME=1 --index` produced **no delta at all** (resolved 51,743 before and after;
owner metadata on 0 rows). That is not a refutation of the whole-population figure — it is an
**instrument condition**, and the mechanism is known: the analyzer consumes an index only when
`candidate.complete === true` (fail-closed), and a locally built index carries `complete: false`
unless the caller states the walk was whole (`indexScope`, `parallel-indexer.ts:1535-1544`). The
whole-population arm ran over the full 7,435-file walk, which is where `complete` can be true; a
2-repo instrument run builds its own index and, unless it sets that flag, measures a dead channel.

**Standing rule this adds to the lane's instrument discipline:** an index arm that reports "0 movement"
must print whether the analyzer SAW a usable index (`complete === true`), or it cannot distinguish
"the channel is dead" from "the channel is unused" — the same class as every other proxy this lane has
caught. Until an instrument prints that, its zero is not evidence.

**SUPERSEDED BY §14.16** — the complete-walk re-measurement was done and the channel is LIVE; the "0 movement" above was the incomplete index, exactly as hypothesised. The next-step paragraph below is kept as the record of the plan that was executed.

**Next step, measured and bounded:** either make the 2-repo arm declare a complete walk and re-measure
(the cheap confirmation), or ship `BB_CPP_INDEX_CONSUME` by default behind a kill-switch and price it
with the whole-population number as the expected effect. Both are concrete; the first is the
prerequisite for trusting the second.

### 14.16 · Index CONSUMPTION measured on a complete walk — the channel is live, and it lowers `resolved` on purpose

The §14.15 hypothesis was right: with the stride cap removed (`maxFiles 0`, so the index can be
`complete`), the owner channel fires on the 2-repo corpus.

| measure | value |
|---|---|
| rows carrying `metadata.owner` | **4,387** |
| owner channel resolved | **3,320** (direct 2,721 · sameKindDuplicate 599) |
| owner channel declined | 1,067 (ownerAmbiguous 843 · noMember 224) |
| rows the NAME model called ambiguous/unresolved and the channel RESOLVES | **151** |
| rows the channel DECLINED whose name model answer would have resolved — production holds these **NULL** | **858** |

**Why the totals get worse, not better.** Versus the per-file arm: `resolved` 51,743 → **51,036
(−707)**, `ambiguous` 18,604 → **18,244 (−360)**, `unresolved` 8,002 → **8,287 (+285)**. That is not a
regression: production's rule is that a row which STATES its receiver and whose owner channel DECLINES
must not fall back to the bare-name answer, because the bare-name answer is precisely the wrong-owner
binding the channel exists to catch. The arm trades **707 name-model bindings for 3,320 owner-verified
ones and 858 withdrawn bindings**. `resolved` is a count of bindings, not a quality score.

**What this means for shipping `BB_CPP_INDEX_CONSUME`.** It is now a decision with exact arithmetic
rather than a hunch: default-on makes cpp's resolved count FALL by ~1.4% on this corpus while every
surviving binding at a receiver-bearing row is defensible, and the whole-population arm measured the
same shape at scale (+17,955 owner-resolved / −22,656 ambiguous / +4,701 honest NULLs). It does **not**
get the incoming gate closer to passing clause 1 here (18,244 + 8,287 = 26,531 vs 25,824 before), which
is the honest answer to "does this close the wall": no — it improves the answers, not the count.

**Recorded as a decision for the owner/Lead, with the kill-switch already in place**:
`BB_CPP_INDEX_CONSUME=1` is the arm; shipping it default-on changes production's stored bindings (858
rows become NULL here) and is a correctness-over-recall trade the lane should take deliberately.

**TAKEN — §14.19.** Shipped default-on 2026-11-17 with `BB_CPP_INDEX_CONSUME=0` as the kill-switch, on
the re-measured arithmetic (resolved 51,741 → 51,034 on the current tree, 4,527 owner rows, 860
withdrawn bindings, and the kill-switch reproducing the per-file numbers exactly).

The instrument condition from §14.15 is now CONFIRMED and quantified: an index arm that omits
`complete` measures a dead channel — §14.15's zero was the instrument, not the channel.

### 14.17 · Receiver-shape census on this corpus — the local size of W1-C, as an upper bound

Committed as `script/cpp-audit/receiver-shape-census.ts` (analyzer output only; it sizes the work and
makes no resolution claim). Measured over 523 files:

| measure | value |
|---|---|
| calls+uses rows | 63,954 |
| … whose target is a name SOME class declares as a member | **35,605 (55.7%)** |
| … of those, already carrying `metadata.owner` in the DEFAULT state | **0** |
| … emitted from a class member (the source symbol has an `ownerName`, so an owner anchor exists) | **20,580** |
| … emitted from file scope (no anchor) | **15,025** |
| distinct member leaf names | 4,126 |

**Read it as an UPPER BOUND, not a count of real receivers.** A free call to `size()` matches the
member-leaf test because `size` is a member *somewhere*; the probe says so in its header. What it
establishes is the scale of the opportunity and its shape:

- the default (per-file) analyzer emits **zero** owner facts, so every one of the 35,605 rows is
  currently bound by bare name — which is exactly the wall;
- **20,580 (58%)** of them are emitted from inside a class member, where the enclosing class is
  already known from the source symbol. That is the population a receiver-typed shape can address
  without inventing anything: the anchor is published, and the question is only whether that class
  declares the leaf;
- the other **15,025** have no anchor at all and need genuine type inference (parameters, members,
  returns), i.e. the larger campaign.

**So the next in-lane step is concrete and bounded:** implement one new shape — a call emitted from a
class member whose enclosing class (or an index ancestor) declares the target leaf — and measure how
many of the 20,580 it converts. That is a check against published facts (the analyzer's own symbols,
or the project index), not inference. Everything beyond it is the inference project and stays recorded
as such.

**DONE — §14.18.** The shape shipped. It converted **2,863** of the 20,580 upper bound (13.9%), and
the corpus measurement forced THREE guards the design had not anticipated: the first cut's 18 declined
rows were four distinct false-claim classes (template specializations, block-scope shadowing, vendored
amalgamations, macro-argument calls). The same round found and fixed a regression in the INDEX arm's
range-for written-type shape. It is a correctness upgrade, not a wall closer — see §14.18 for the
gate arithmetic and what stays open.

### 14.18 · SHIPPED — the index-free receiver arm, the false claims its first cut made, and a regression it found in the INDEX arm

§14.17 named one shape as the next in-lane step: a call emitted from a class member whose enclosing
class declares the leaf. Implemented, measured, and shipped **DEFAULT-ON** with
`BB_CPP_LOCAL_RECEIVER=0` as the kill-switch. It needs no project index, which is the point: the four
existing shapes refuse everything unless a COMPLETE index arrives, and that is the default state of
every caller that does not build one.

**The shape.** A bare callee in a member-function body (implicit `this`) and `this->m()`: both are
bound by [basic.lookup.unqual] to the enclosing class's own member, and the class's published symbols
are the evidence. A POST-PASS, not walk-time: a member declared BELOW the calling body (`shapeLate`
in the fixture) is only visible once the file's symbols are complete. Mutant
`cpp/local-implicit-owner-walk-time-table` is that exact defect and is CAUGHT.

**The first cut was wrong, and only the corpus said so.** Keyed by owner NAME alone it emitted 3,044
facts. The gate's owner channel declined 18 of them; reading those 18 found FOUR false-claim classes,
none of them visible in a fixture:

- **template specializations** — seven class declarations spelled `UniversalPrinter` in one header,
  so a call inside one specialization inherited a member of another (gtest.h, 2 rows);
- **block-scope shadowing** — `using std::swap; swap(a, b)` inside `AssertionResult::swap` names
  `std::swap`, and a local lambda/parameter can hide a member the same way (2 rows measured; the class
  is general, so the general check is implemented);
- **vendored amalgamations** — `gmock-gtest-all.cc` carries OUT-OF-LINE definitions whose class
  bodies live in included headers, and the member table had been built from the definitions
  themselves (10 rows);
- **macro-argument calls** — `::FMT_POSIX(close(fildes))` inside `test::close` is a macro's argument,
  not a member call (8 rows; excluded by the class-in-file guard, not by a macro rule).

**The shipped version carries three guards**, each measured against one of those classes:

1. the class is declared EXACTLY ONCE by that name in the file — refuses specializations and
   same-named classes in different namespaces (fixture `alpha::Pair` / `beta::Pair`);
2. the member is declared INSIDE that class body — refuses amalgamations / out-of-line-only evidence;
3. no function-scope binding shadows the name at the call site — a local or parameter via the existing
   flow-sensitive `locals` roster, and block-scope `using` names via a receiver-specific set collected
   on the walk (fixture `withShadow`, `withUsing`). The using-name set is deliberately separate from
   `locals`, so the bare-`uses` shadow rule does not move for a receiver-only reason.

**Measured, DEFAULT state, 2-repo corpus (523 files, 63,954 calls+uses):**

| measure | value |
|---|---|
| owner-bearing rows under the first cut | 3,044 |
| after the three guards | **2,863** of 35,605 member-leaf rows (8.0%) |
| … bare implicit-`this` / `this->` | 2,859 / 4 (the four include the template spelling `this.Get<Idx>`) |
| … emitted on a non-`calls` row (must be 0) | **0** |
| … failing the census's INDEPENDENT re-check against the emitting file's own symbols | **0** |
| §14.17's 20,580 anchored rows converted | 2,863 (13.9% of that upper bound) |

**Incoming gate, 524-file population incl. `.h`, no environment flags except the one under test:**

| arm | resolved | ambiguous | unresolved | extOK |
|---|---|---|---|---|
| before the arm | 51,743 | 18,604 | 7,220 | 782 |
| shipped (local arm ON) | **51,741** | **18,604** | **7,222** | **782** |
| kill-switch `BB_CPP_LOCAL_RECEIVER=0` | 51,743 | 18,604 | 7,220 | 782 |

The kill-switch reproduces the pre-arm numbers EXACTLY, so the change is what moved the two rows. The
owner channel resolved **2,861 of 2,863** and declined 2; **0 rows moved ambiguous/unresolved →
resolved**, because every channel-resolved row's target name was already project-unique — the name
model had already bound it, to the same declaration. ⇒ The arm is a **correctness upgrade with a
2-row recall cost, not a wall closer**. The wall is NOT closed: **15,025** member-leaf rows are
file-scope calls with no anchor (genuine type inference), and the **83,169** whole-population rows
still need the corpus machine. The 2 declines are named: both `ScopedFakeTestPartResultReporter::Init`
in `fmt/test/gtest/gmock-gtest-all.cc`, an out-of-line constructor calling a member. The claim is TRUE
(the class declares `Init`), but the owner NAME is declared more than once project-wide and no in-file
covering class exists at the call's line, so the channel's rule-0 identity fallback reads ambiguous
and production holds the row NULL — a withdrawn binding, not a resolution. Recorded, not "fixed": a
per-file analyzer cannot see project-wide declaration counts.

**A regression this round found in the INDEX arm, and fixed.** Re-running
`script/cpp-receiver-wave-verify` (rewritten to measure BOTH arms) reported **5 of 6** indexed
shapes: the RANGE-FOR typed-local shape, which commit `35e8aaa8a` recorded as closed, was open again.
The cause is a premise error in `writtenTypesOf`: the branch EXCLUDED the `for_range_loop` node's
`type`/`declarator` fields, believing they pointed at the range expression and the body. PROBED with
the shipped parser: they point at exactly what their names say (`for (Widget w : widgets())` →
`type` = `Widget`, `declarator` = `w`). While the exclusion guard was wrapper identity (`===`,
always false) the positional scan accidentally produced the right pair; the KAD2 `sameTsNode` fix made
the guard real, and the branch then typed the range expression and the body instead. Fixed by READING
the fields (positional scan kept only as a fallback), and the KAD2 comment — which asserted the wrong
premise as "measured" — corrected in place. Control now **6 of 6**; the `--prove-red` mechanism is
unchanged. This is the third stale claim this lane has found in a comment marked MEASURED; the
fixture-and-control pair caught it, prose had not.

**What pins it.** Fixture `cpp/local-implicit-owner` (6 positive rows, including the member declared
BELOW the calling body; 7 forbid rows, one per false-claim class); mutants
`cpp/local-implicit-owner-dropped` (evidence loss), `-walk-time-table` (ordering), `-unchecked` (the
first cut re-injected — caught by the forbid rows). Census `script/cpp-audit/receiver-shape-census.ts`
extended to print the shape split and to RE-CHECK every claim against the emitting file's symbols.
Gates green on the shipped tree: cpp fixtures **60/60**, full suite all-pass with **no baseline
regressions**, cpp mutants **70/70 CAUGHT**, `tsc --noEmit` clean.

**Not claimed.** The arm is not counted on the whole population (the 31-repo corpus is not on this
machine, so the ledger stays corpus-blocked). It does not attempt file-scope receivers, overload
selection under `using namespace`, or macro-argument calls. The guards are conservative, so 2,863 is
a floor for THIS instrument, not a ceiling on the shape.

### 14.19 · SHIPPED — `BB_CPP_INDEX_CONSUME` is default-on; the index alone is still an instrument

§14.16 packaged this as a decision with exact arithmetic and said the lane should take it
deliberately. Taken this round, because it is in-lane (the gate is one boolean in the analyzer) and the
arithmetic is now re-measured on the tree that carries §14.18's local arm.

**What changed.** `INDEX_CONSUME` is `BB_CPP_INDEX_CONSUME !== "0"` — ON by default, with
`BB_CPP_INDEX_CONSUME=0` as the KILL-SWITCH that reproduces the pre-consumption output in one
environment variable. Nothing else about the arm moves: it still requires `context.projectIndex` with
`complete === true` (fail-closed — an incomplete index attaches NOTHING), it is metadata-only (no row
emitted, suppressed or re-typed), and the four accepted D1–D6 behaviours are untouched without one.

**Measured on the 2-repo corpus (524 files incl. `.h`), current tree:**

| arm | resolved | ambiguous | unresolved | extOK |
|---|---|---|---|---|
| per-file / no index | 51,741 | 18,604 | 7,222 | 782 |
| **index + KILL-SWITCH (`=0`)** | **51,741** | **18,604** | **7,222** | **782** |
| **index + default consumption** | **51,034** | **18,244** | **8,289** | **782** |

Two controls in that table: the kill-switch arm is byte-identical to the per-file arm, so **the index
alone changes nothing** (it is an instrument); the default arm is the arm under test. Owner channel on
the default arm: **4,527** rows carried `metadata.owner` (the index shapes add 1,664 on top of the
local arm's 2,863), **3,458 resolved** (direct 2,844 · sameKindDuplicate 614), **1,069 declined**
(ownerAmbiguous 845 · noMember 224), **151 rows** the name count called ambiguous/unresolved that the
channel resolves, and **860 rows** the channel DECLINED whose name would have resolved — production
holds those NULL. Delta vs per-file: resolved **−707**, ambiguous **−360**, unresolved **+1,067**.

**Why the count goes DOWN on purpose.** Production's rule is that a calls/uses row stating its receiver
and whose owner channel DECLINES must not fall back to the bare-name answer, because the bare-name
answer is precisely the wrong-owner binding the channel exists to catch. So the 860 withdrawn bindings
are the trade, and the 151 net wins are what the channel adds in count terms. `resolved` is a count of
bindings, not a quality score. This does NOT get the incoming gate closer to passing clause 1 — it
improves the ANSWERS at receiver-bearing rows, not the total. Wall W11's 83,169 whole-population rows
stay open/corpus-blocked; this is a correctness change, and its whole-population effect was already
measured at the ledger's scale (+17,955 owner-resolved / −22,656 ambiguous / +4,701 honest NULLs) on
the 31-repo arm.

**What had to move with it.** `script/m14/cpp-index-consume-verify.ts` now treats `flag=false` as the
KILL-SWITCH arm (`BB_CPP_INDEX_CONSUME=0`) and keeps its assertions — OFF+index byte-identical to the
no-context baseline, ON without an index equal to the baseline, incomplete index changes nothing, rows
invariant. `script/m14/cpp-receiver-wave-verify.ts` sets the kill-switch for its both-off arm.
`script/m14/cpp-index-reproduce.ts` sets it explicitly for arms A and B-off, because otherwise B-off
would consume too and the A→B decomposition would lose its control. `docs/indexing/environment-
variables.md` now documents the default AND the kill-switch, and adds the §14.18 variable
(`BB_CPP_LOCAL_RECEIVER`).

**Not claimed.** This is not a wall closure, not a recall improvement, and not a statement that the
index is complete in production — the analyzer still refuses an incomplete index rather than guessing
from a sample. The 845 `ownerAmbiguous` declines are the same class measured in §14.18 (owner names
duplicated across the project) and are named as a residual, not fixed: choosing between same-named
declarations is a project-scope identity problem the per-row metadata does not solve.

### 14.20 · RULED — W4 is a design decision, and the decision is: keep leaf targets

§14.13 established that W4's original reason is false (6,913 distinct `qualifiedName` strings exist;
the qualified spelling already rides `metadata.qualified`) and left the remaining question open: change
the edge TARGET to the qualified key where unique, or keep the leaf and rule the wall. That question is
now decided **against the re-spelling**, and the reason is arithmetic rather than taste:

- the arbiter's qualified-name join is the ONLY consumer that could benefit from a qualified target,
  and on this lane it **asked 532 rows and resolved 0** (§14.13, measured on the 2-repo corpus);
- changing a target spelling is a **cross-consumer vocabulary change** — the store's key space, the
  arbiter's declaration keys, and every lane's fixtures pin targets — for a measured net of zero here;
- the lane's documented contract is leaf targets for ALL relationship types, with the qualified path in
  `metadata.qualified`; multiple fixtures pin the leaf spelling (`one-edge-per-pair-959`,
  `call-target-name-surface-924`, `qualified-declarator-name-924`, …), and the local/global source
  sentinel already shows what happens when one row family re-spells: two consumers disagree about the
  same edge.

So W4 is **RULED ABSENT-BY-CONTRACT**: the 2,771 rows are the leaf-vs-qualified mismatch, the lane's
answer is the leaf contract, and the "needs the Lead" tail is closed rather than left drifting. Nothing
in the analyzer or the store moved — this is a disposition change with the measurement attached, and the
errata entry keeps the previous disposition so the decision is auditable.

**What remains Lead/programme-level, now two items rather than four:** wall W1-D's NEW CLAIM KIND
(122,227 rows: `free-callable-needs-project-fact-claim` 70,493 + `type-shaped-needs-project-fact-claim`
51,734) requires a vocabulary/claim kind in the SHARED arbiter, and W1-type (4,776 rows) requires
cross-run TYPE declarations in the shared index. Both are programme infrastructure, not cpp-lane code;
they stay recorded with their rows and their arithmetic. The corpus-blocked items (W8's 4 rows, the
31-repo re-derivation, the spec generator's measurement inputs) are unchanged.

---

## 14.21 · THE CORPUS IS RECONSTRUCTED — the whole-population ledger re-derived, and the wall rule it broke

**The first blocking condition is gone.** The lane's whole-population numbers (the D7 wall ledger, the
23,237-file closure, the W1 four-bucket partition) were measured on an unpinned fleet checkout at
`$PWD/.corpus` that no longer exists and whose repository list was never committed. On 2026-11-17 that
was replaced by a **documented reconstruction** — `script/cpp-audit/reconstruct-corpus.ts`, provenance
in `validation/cpp-audit/corpus-manifest.json`:

| | |
|---|---|
| repositories | **46** (1 absent: the private `vscode` fork's remote no longer exists; 5 cpp-carrying repos — julia, abseil-cpp, googletest, protobuf, dart-sdk — failed their fetch on a GitHub connectivity flap and are recorded as failed, not omitted) |
| pins | 38 at a committed revision (M11 manifest / parse-success registry), 8 head-pinned with the observed SHA recorded |
| files | **23,058** C++-spelling files (15,273 `.h` · 3,752 `.cpp` · 2,140 `.hpp` · 1,875 `.cc` · 18 others) |
| gate population (9 spellings, extension-only) | **7,778 files across 18 repos** — the original ledger's population was 7,435 files/31 repos, so the population is within **4.6%** on file count (composition differs, see caveats) |

The reconstruction is a **STAND-IN, not a reproduction**: the original repo list is unrecoverable, so
the numbers below are comparable in SHAPE and not claimed to reproduce the ledger's counts. Clone is
sparse (`*.cpp *.cc *.cxx *.c++ *.hpp *.hxx *.hh *.h *.ipp *.inl *.cu`) against `--filter=blob:none`;
the corpus root's last segment is literally `.corpus` because `cpp-wall-disposition` and
`cpp-w1-price` derive the repository as the path segment after that marker.

### The whole-population gate on the reconstruction (extensions-only, no `--index`, no env flags)

| | |
|---|---|
| edges | **1,061,398** |
| resolved | **463,682 (43.7%)** |
| ambiguous (decl) / (kind) | **313,439 / 122,379** |
| unresolved | **272,558** |
| `extOK` — external claims the PROJECT CONFIRMS | **11,719, 0 refuted** |
| binds | 0 / 0 / 0 |

That `extOK` is the number worth reading twice: the ISO stdlib citation claim shipped by default in
`5cc82967e` verifies **11,719 rows on a population ~23× the two-repo evidence set** (782 there), with
**0 refuted** — the first whole-population validation of that ship. Population: 7,778 parsed of 7,778
sampled; 7 files over the 1 MB cap disclosed by the gate's own exclusion line.

### The D7 wall ledger, re-derived on the same dump

`cpp-wall-disposition` over the gate's own dump (`585,997` residual rows): the **closure holds exactly**
— nine walls sum to the dump's residual rows — and the shape reproduces the original ledger:

| wall | reconstruction | share | original ledger | share |
|---|---|---|---|---|
| W1-callable-not-declared-in-run | 409,375 | 69.86% | 614,081 | 70.49% |
| W10-macro-defined-name | 76,830 | 13.11% | 114,398 | 13.13% |
| W11-member-leaf-owner-unresolved | 53,351 | 9.10% | 83,169 | 9.55% |
| W2-module-path-not-a-symbol | 42,512 | 7.25% | 50,915 | 5.84% |
| W1-type-not-declared-in-run | 2,619 | 0.45% | 4,776 | 0.55% |
| W4-qualified-name-not-published | 910 | 0.16% | 2,771 | 0.32% |
| W5-export-marker-not-a-declaration | 286 | 0.05% | 835 | 0.10% |
| W9-operator-name-not-a-symbol | 110 | 0.02% | 180 | 0.02% |
| W8-non-class-standard-type | 4 | 0.00% | 4 | 0.00% |

W4 is smaller and W2 larger because the reconstruction's repo mix differs (fewer vendored
gtest/abseil-style headers, more quoted-include-heavy projects); the DISPOSITIONS are unchanged, and
W8 is **4 rows on both populations** — see §14.22, where those rows are named and closed.

### The W1 four-bucket partition, re-priced from the same dump

| bucket | reconstruction rows | share of W1 | original ledger | share |
|---|---|---|---|---|
| A — index declares it (project fact) | 77,910 | 19.03% | 113,646 | 18.51% |
| B — committed stdlib vocabulary reaches it | 2,352 | 0.57% | 7,962 | 1.30% |
| C — member leaf, receiver typing decides | 171,979 | 42.01% | 370,246 | 60.30% |
| D — needs a NEW claim kind | 157,134 | 38.38% | 122,227 | 19.90% |
| **partition** | **409,375** | 100% | 614,081 | 100% |

The A share reproduces (18.5% vs 19.0% — the project-fact part of the wall is a stable ~1/5) and the
partition closes on both runs. The C/D weights differ mechanically: this population is dominated by
codebases (`Catch2` amalgamations, `duckdb`, `Rcpp`) whose free calls and members are declared in
headers OUTSIDE the extension-only population, so rows that the original corpus's index could decide
from a sibling header here have no declaration to bind — the C/D boundary is population-sensitive and
is why the ledger's raw C/D weights must not be quoted as corpus-independent.

### The wider corpus broke the wall RULE, and that is the correction of record

`cpp-wall-disposition` REFUSED on the first run — `CONTROL DID NOT FIRE: wall W7-keyword-spelled-
recovery has 244 unclassified rows` — and it was right to refuse. All 244 rows are `part_of` targets:
a QUOTED include's file STEM that happens to spell a keyword (`#include "catch.hpp"` → `catch`,
`"export.h"` → `export`, `"new.h"` → `new`, plus `enum…`/`float…`). A module stem is not a
keyword-spelled NAME. The wall rule now sends **`part_of` (with `imports`) to
W2-module-path-not-a-symbol**, W2's disposition text states that it owns module endpoints (paths and
stems), W7 keeps its measured-zero claim only for DECLARATION-position labels and gains the falsifier
that would refute it, and the SAME fix landed in `cpp-dump-classify.ts` (the lane keeps one wall rule).
The committed `whole-population/wall-disposition.json` is the POST-fix run (W2 42,512 includes the 244;
W7 empty, control passes). The original ledger's numbers are unchanged — this correction is to the
instrument that re-derives them, not to the historical measurement.

### The receiver arm, sized whole-population for the first time

`script/cpp-audit/receiver-shape-census.ts --root=.cpp-corpus/.corpus --no-headers` over the same
7,778 files:

| | |
|---|---|
| calls+uses rows / member-leaf rows | 766,767 / 513,745 |
| rows already carrying `metadata.owner` (DEFAULT analyzer) | **6,524** |
| — bare implicit-`this` / `this->m()` | 6,519 / 5 |
| — emitted on a non-`calls` row | **0** |
| — failing the census's independent file-symbol re-check | **0** |
| unowned rows whose source is a class member | 355,641 |
| unowned rows whose source is file scope | 151,580 |

The local (index-free) arm's whole-population yield is 2.28× its 2-repo yield (2,863 → 6,524) at 12×
the files, with ZERO false claims — a density fact, not a defect: this population's member calls are
dominated by untyped receivers, which is the wall §14.17 priced. Evidence:
`validation/cpp-audit/whole-population/receiver-shape-census.json`.

### The index arm on the reconstruction — consume default-on, measured whole-population

The `--index` arm (shipped defaults: `BB_CPP_INDEX_CONSUME` unset = ON) over the same 7,778 files and
the same fixed analyzer: **1,061,394 edges** (the dump's 1,061,398 minus exactly the 4 W8 rows),
resolved **482,743** (+19,061 vs the per-file arm), ambiguous-decl **272,667** (−40,772), unresolved
**294,265** (+21,707), `extOK` **11,719 — unchanged**, so the claim surface is untouched by the arm.
The owner channel (production rule, modelled): **73,325 rows carried `metadata.owner`; 51,466 resolved
(70.2%), 21,859 declined** (direct 39,441 · ownerAmbiguous 16,961 · sameKindDuplicate 12,025 · noMember
4,898); **25,512 rows the name model called ambiguous/unresolved are resolved by the channel, and
6,601 rows the channel DECLINED would have resolved by name and are held NULL** (withdrawn binding).

READ THE DELTA CORRECTLY: this arm differs from the dump arm in TWO ways — the index itself and
consume — so +19,061 is the NET of index-scope resolution gains (+25,512 channel decidables) and
consume's withdrawals (−6,601), NOT a consume-only delta. The consume-ONLY delta was measured on the
two-repo control (§14.19: resolved 51,741 → 51,034, −707, 860 bindings withdrawn); on THIS population
it needs the kill-switch arm (`BB_CPP_INDEX_CONSUME=0 --index`), which is the NEXT measurement and is
recorded here as owed rather than inferred. What this run does establish whole-population: consume does
not move the claim surface (`extOK` exactly unchanged), and the channel's declines are 100% accounted
by four named causes.

### CORRECTION, same round: the "kill-switch" run was a mislabeled DUPLICATE

The first run filed as `gate-index-killswitch.json` was launched WITHOUT `BB_CPP_INDEX_CONSUME=0`
(authoring error in the command, not in the analyzer). Its numbers are therefore a SECOND independent
default-consume run, and they are byte-identical to the first default run — 482,743 / 272,667 /
112,307 / 294,265 / extOK 11,719, owner channel 73,325 / 51,466 / 21,859 — which is a usable
DETERMINISM fact (two whole-population runs, same inputs, identical every column) but NOT the
consume-only delta. The file is renamed `gate-index-default-rerun.json` and the consume-only
kill-switch measurement is re-run with the env var set; the §14.21 delta paragraph's "owed" status
stands until that lands.

### Post-W8 whole-population re-run (the fixed analyzer)

Fresh gate dump on the same population, shipped analyzer with the W8 guard: **597,712 residual rows**
and **1,061,394 edges** — exactly the pre-fix dump's 597,716 / 1,061,398 **minus 4**, with per-type
splits moving exactly as the four rows required (ambDecl 313,437 = −2; unresolved 272,556 = −2; the two
`int32_t`/`int64_t` rows were ambDeclOnly, the two `int_fast32_t`/`uint64_t` rows unresolved), resolved
463,682 and `extOK` 11,719 unchanged. W8's closure is therefore confirmed at whole-population
arithmetic, not only by the targeted re-parse. Evidence:
`gate-cpp-extension-only.postw8.txt`. The post-W8 wall re-derivation and the corrected kill-switch arm
are running when this line was written; their artifacts land with the next commit.

### The consume-only delta, now MEASURED whole-population — and it corrects §14.19's reading

The corrected kill-switch arm (`BB_CPP_INDEX_CONSUME=0 --index`) is **byte-identical to the per-file
arm** on this population — 463,682 / 313,437 / 272,556 (resolved / ambDecl / unresolved), `extOK`
11,719 — so the index alone is inert here, exactly as the control claimed, and the whole difference
belongs to CONSUME:

| default consume vs kill-switch | delta |
|---|---|
| resolved | **+19,061** |
| ambiguous-decl | **−40,770** |
| unresolved | **+21,709** |
| extOK | **0** |

That is the same channel arithmetic the owner-channel line prints whole-population (25,512 rows the
name model could not resolve and the channel does; 6,601 rows the channel declines that their name
would have resolved and that production holds NULL) — net +18,911 through the channel, plus the
independent per-row effects, = +19,061. **It CORRECTS the two-repo reading**: on the two-repo set
consume LOWERED resolved by 707 because the local arm had already owned the easy rows and the
withdrawals dominated; on the whole population consume RAISES resolved by 19,061 because the channel
decides far more rows than it withdraws. The invariant across both populations is the CORRECTNESS
property, not the sign of the delta: a channel-declined row is held NULL rather than resolved by name.
The whole-population wall ledger re-run on the fixed dump confirms the other side: residual rows
585,993 (= 585,997 − the 4 W8 rows), the nine-wall closure holds, **W7 and W8 are both empty**, and
every remaining wall's row count is otherwise identical (W1 409,375 · W10 76,830 · W11 53,351 · W2
42,512 · W1-type 2,619 · W4 910 · W5 286 · W9 110). Evidence:
`gate-index-killswitch.json`, `wall-disposition.postw8.json`.

### Reproduction

```
bun run script/cpp-audit/reconstruct-corpus.ts                       # builds .cpp-corpus/.corpus + manifest
BB_CORPUS_ROOT=$PWD/.cpp-corpus/.corpus BB_DUMP_LIMIT=3000000 \
  bun run script/m14/incoming-gate.ts cpp cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu 0 --dump > dump.txt
BB_CORPUS_ROOT=$PWD/.cpp-corpus/.corpus bun run script/m14/cpp-wall-disposition.ts --dump=dump.txt --json=...
BB_CORPUS_ROOT=$PWD/.cpp-corpus/.corpus bun run script/m14/cpp-w1-price.ts --dump=dump.txt --no-headers --json=...
```

**What this does NOT change:** every original-ledger number above stands as the ORIGINAL measurement;
the reconstruction is a second, reproducible population that agrees with it on shape, closure and the
A-share, and disagrees where composition explains the difference. The spec generator's measurement
inputs are still absent from the tree (the generator needs the D2/D3 arm artifacts that no committed
script produces), so `cpp-spec-table.ts --check` still cannot run from a clean checkout; the
reconstruction makes every input except those arms producible.

## 14.22 · WALL W8 IS CLOSED — the 4 rows were one defect class, and the analyzer guard already existed

Wall W8 carried **4 rows on both populations** and its disposition said `INSTRUMENT GAP (a guard that
escaped) — tracked, not a residual` only because the original ledger could not name the rows. The
reconstruction run supplied them, all four:

```
Rcpp/src/date.cpp:1290                                  seconds = (int_fast32_t)(tdays * SECSPERDAY);
duckdb/third_party/ska_sort/ska_sort.hpp:119            sign_bit = static_cast<std::uint32_t>(-std::int32_t(as_union.u >> 31));
duckdb/third_party/ska_sort/ska_sort.hpp:129            std::int64_t(...)
nlohmann-json/docs/mkdocs/docs/examples/value__return_type.cpp:12   std::uint64_t(0)
```

Every one is a FUNCTIONAL CAST / cast expression whose callee spelling names a `<cstdint>`/`<cstddef>`
value type. `[cstdint]`/`[cstddef]` guarantee those names denote integer/value types, so no function
can carry them: a `calls` edge naming one is a fabrication with no reading. The analyzer ALREADY held
this exact guard on the `instantiates` path (`CPP_NON_CLASS_STANDARD_TYPES`, added when
`new uint8_t[5]` published `instantiates -> uint8_t`); the calls path never consulted the set, and the
D1 keyword funnel cannot see the class because `size_t x;` is a legal declaration.

Fix: `calleeLeafNode` now returns null for a callee that spells a non-class standard type. Test-first:
fixture `cpp/typedef-functional-cast` was RED on the shipped tree (the two functional-cast shapes DID
emit `calls` rows) and is green after, with the real `helper()` call as the control an over-broad
spelling guard would lose. Mutant `cpp/standard-typedef-cast-call` re-injects the pre-fix payload and
is CAUGHT by that fixture (**71/71 cpp mutants**). Targeted re-parse of the three source files that
carried all four rows: **0 residual W8 rows**. Wall W8's disposition in
`script/m14/spec/cpp-spec-table.json` is now **CLOSED** (rows stay 4 because that is the row count the
ORIGINAL population measured; the disposition is what changed), and the whole-population re-run after
this fix is the next artifact — the committed `wall-disposition.json` is the PRE-fix run and says so.

**What this round changes about the remaining ledger:** W8 joins the closed walls. W1-D's NEW CLAIM
KIND (157,134 reconstruction rows / 122,227 original) and W1-type (2,619 / 4,776) remain the only
programme-level items — both need shared-infrastructure vocabulary, not cpp-lane code. The
corpus-blocked label is retired: the corpus is reconstructed and every measurement above is
reproducible from the committed manifest.

---

## 14.23 · RELATIONSHIP COVERAGE — all 14 values, both directions, and rulings re-derived on LANGUAGE semantics

> **Owner ruling, 2026-11-17 (this is the LAST cpp pass):** every canonical relationship value must be
> covered — outgoing emission AND incoming resolution — and a value may be called NOT APPLICABLE only
> when **the C++ language has no such construct**. A ruling whose reason is "the grammar cannot see
> it" is invalid: **grammar is fixable**, so grammar absence is consistent evidence, never a ruling.

### The ledger

Instrument: `script/cpp-audit/relationship-coverage.ts` → `validation/cpp-audit/relationship-coverage.{json,md}`,
run on the reconstruction population (**7,778 files parsed, 0 parse errors**). Outgoing counts are the
whole-population gate's per-type rows; the two-repo column is the committed 2-repo census.

| value | disposition | emission sites | whole-pop edges | 2-repo edges | incoming evidence |
|---|---|---|---|---|---|
| calls | EMITTED | 1 | **738,609** | 59,374 | gate TABLE 1 + 92.6% 2-repo target resolution |
| contains | EMITTED | 1 | **151,481** | 10,975 | gate TABLE 1; source 10,972/10,975 (2-repo) |
| uses | EMITTED | 2 | **115,385** | 4,580 | gate TABLE 1 |
| part_of | EMITTED | 1 | **35,207** | 360 | gate TABLE 1; 96.4% 2-repo target resolution |
| imports | EMITTED | 1 | **10,801** | 1,968 | gate TABLE 1; 10.4% by design (external modules) |
| extends | EMITTED | 2 | **3,717** | 478 | gate TABLE 1 |
| overrides | EMITTED | 1 | **1,692** | 134 | gate TABLE 1; signature-aware, transitive |
| instantiates | EMITTED | 1 | **1,695** | 182 | gate TABLE 1; `new` only (CPP-R2) |
| references | EMITTED | 1 | **1,560** | 206 | gate TABLE 1; 99.5% 2-repo target resolution |
| exports | EMITTED | 3 | **977** | 112 | gate TABLE 1 |
| implements | EMITTED | 1 | **270** | 34 | gate TABLE 1; pure-virtual contract (CPP-R1) |
| decorates | RULED — LANGUAGE | 0 | 0 | 0 | n/a: no construct; near-miss measures below |
| renders | RULED — LANGUAGE | 0 | 0 | 0 | n/a: no construct; near-miss measures below |
| mixes_in | RULED — LANGUAGE | 0 | 0 | 0 | n/a: no construct; near-miss measures below |

**Incoming evidence** for the 11 emitted values: the post-W8 gate's TABLE 1 carries per-type
resolved / ambiguous / unresolved for the whole population (`validation/cpp-audit/whole-population/gate-cpp-extension-only.postw8.txt`),
and the 2-repo census carries per-type target-resolution rates and evidence tiers
(`validation/cpp-audit/census.json`). **Outgoing evidence**: emission sites counted from
`src/ast/real-cpp-analyzer.ts`, plus the whole-population edge counts above.

### The three rulings, re-derived on language semantics (the grammar framing is WITHDRAWN)

Each carries the canonical contract quoted from `src/ast/types.ts`, a MEASURED near-miss census of
every C++ construct that could be mistaken for it, a LANGUAGE-level falsifier, a fixture that pins the
honest value and forbids the ruled one, and a mutant that resurrects the ruled value from the nearest
construct — CAUGHT by that fixture.

| value | canonical contract (src/ast/types.ts) | near-miss census (whole corpus) | language reason | falsifier |
|---|---|---|---|---|
| decorates | "a decorator is APPLIED TO a declaration … the runtime applies it while the declaration is created" | **1,425 attribute sites; 28 attribute-argument CALL expressions** | ISO C++ attributes are compiler metadata ([dcl.attr]); even a call-shaped argument is evaluated inside the attribute grammar and NOTHING is applied to the declaration. No decorator-application construct exists. Near-misses emit honestly: attribute-argument calls are `calls`; export attributes are `exports` | a standardised C++ construct that names a callable and applies it to a declaration at construction time |
| renders | "a component RENDERS another component: source = the rendering symbol, target = the rendered component" (TSX/JSX) | **763 render-verb CALLEE calls** (Draw 185 · Render 175 · Paint 150 · AddChild 91 · paint 57 · …) | C++ has no component/markup construct: no element type, no renderer hook, no syntax or standard semantics distinguishing a rendering from any other call. The 763 near-misses are all emitted as `calls` | a C++ construct in which a callable produces a component of a declared component type as output, distinguishable from a call |
| mixes_in | "a class COMPOSES a mixin into its supertype chain" (Dart `with`; contract states the with-list is NOT an inheritance clause) | **3,695 base clauses / 3,790 bases / 66 multi-base / 59 CRTP bases** | C++ has exactly ONE supertype-composition construct — the base clause — and every entry DECLARES A BASE CLASS (is-a, with base ctor/vtable/subtyping semantics). The CRTP "mixin idiom" is inheritance in the language's semantics; all rows emit as one `extends` per base | a C++ construct that composes a class's members into a type WITHOUT declaring it as a base class |

Fixtures: `cpp/ruled-decorates-attribute`, `cpp/ruled-renders-verb-calls`, `cpp/ruled-mixes-in-crtp`
(each expects the honest `calls`/`extends` rows, forbids the ruled value, and keeps the control call).
Mutants: `cpp/attribute-is-decorates`, `cpp/render-verb-is-renders`, `cpp/base-is-mixes-in` — all
**CAUGHT; 74/74 cpp mutants**. No grammar-based ruling remains anywhere in the cpp lane: the spec
table's `notApplicableEvidence` now carries `rulingBasis: LANGUAGE-SEMANTIC`, the reasons/falsifiers
above, the near-miss numbers, and `grammarAbsenceEvidence` only as *consistent* evidence.

**Coverage ≠ everything resolves.** Two walls are relationship-level instrument gaps, not vocabulary
gaps, and remain priced: W11 receiver typing (C bucket 171,979 rows) and W1-D new claim kind (157,134
rows) — both recorded in §14.21/§14.22 and the spec table.

## 14.24 · THE SPEC TABLE IS REGENERATED FROM THE RECONSTRUCTION — announced population replacement

Every input `script/m14/cpp-spec-table.ts` reads now exists as a committed artifact measured on the
pinned reconstruction corpus: D2 census (7,778/7,778 files · 18 repos · 1,061,394 rows), D3 no-index +
index arms + the **B-off kill-switch arm**, D7 four-bucket partition + post-W8 wall ledger,
applicable-set (`ok: true`), and the cap-50 gate log. The generator itself was completed:

- it reads the ARM's population (7,778 / 18) instead of hardcoding the original 7,435 / 31;
- its D3 prose is now THREE measured arms, with the consume-only delta computed from the B-off arm
  (**+19,061 resolved · −40,770 ambDecl · −10,072 ambKind · +21,709 unresolved · extOK 0**) and the
  index-alone delta **0**, measured as byte-identical B-off vs no-index;
- its construct counts come from the census artifact (concept/requires, template instantiation,
  structured bindings, lambdas, operator/destructor names, friends, namespace aliases, pure-virtual
  clauses, multiple inheritance — 66 multi-base classes / 46 files / 4 repos / 3,790 bases) instead of
  the original fleet-corpus literals;
- **hand-written provenance is merged from `script/m14/spec/cpp-spec-table.errata.json`** (10 entries,
  including this population replacement), so a regeneration can never silently drop the correction
  history.

`bun run script/m14/cpp-spec-table.ts --check` **PASSES** on the regenerated table. The previous rows
(original population, 7,435 files/31 repos) are preserved in the errata and §14.21; W8 is absent from
the regenerated wall ledger because it is CLOSED, and the three ruled values carry the language-semantic
evidence from §14.23. Rebuild:

```
bun run script/cpp-audit/reconstruct-corpus.ts
BB_CORPUS_ROOT=$PWD/.cpp-corpus/.corpus bun run script/m14/cpp-emission-census.ts --cap=0 --json > .../cpp-emission-census-whole.json
BB_CORPUS_ROOT=$PWD/.cpp-corpus/.corpus bun run script/m14/incoming-gate.ts cpp cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu 0 --dump > dump.txt
# + wall-disposition / w1-price / gate index arms / cap-50 log / applicable-set (all committed)
bun run script/cpp-audit/cpp-d3-arm-artifacts.ts --noindex-report=<report> --indexed-json=<gate json>
bun run script/m14/cpp-spec-table.ts --check
```

## 14.25 · SHIP-DECISION TABLE — per-relationship resolution on three populations

Same gate rule (target resolves against the file's OWN PROJECT), same shipped analyzer; the only
variable is the measured population. `accepted = resolved + project-verified claims (extOK)`;
`ambiguous` = the store refuses to guess between several declarations; `unresolved` = no declaration
in the project carries the target leaf. Every "not resolved" row is reported, never fabricated.

**A · shipping gate population (extension-only, 7,778 files / 18 repos, 1,061,394 edges)** —
`gate-cpp-extension-only.postw8.txt`:

| type | edges | accepted | ambiguous | unresolved |
|---|---|---|---|---|
| calls | 738,609 | **34.2%** | 37.0% | 28.8% |
| uses | 115,385 | **53.3%** | 27.6% | 19.1% |
| contains | 151,481 | **100.0%** | 0.0% | 0.0% |
| imports | 10,801 | **2.2%** (external by design) | 5.9% | 91.9% |
| references | 1,560 | **18.3%** | 24.4% | 57.3% |
| exports | 977 | **70.7%** | 0.0% | 29.3% |
| extends | 3,717 | **67.4%** | 12.4% | 20.2% |
| implements | 270 | **100.0%** | 0.0% | 0.0% |
| overrides | 1,692 | **97.2%** | 2.8% | 0.0% |
| instantiates | 1,695 | **37.6%** | 9.9% | 52.5% |
| part_of | 35,207 | **9.2%** (part stems; quoted parts outside) | 18.8% | 72.0% |
| TOTAL | 1,061,394 | **44.8%** | 29.5% | 25.7% |

**B · headers admitted (production's routing includes content-routed `.h`; 23,043 files / 22 repos,
1,944,856 edges)** — `gate-cpp-with-headers.json`:

| type | edges | accepted | ambiguous | unresolved |
|---|---|---|---|---|
| calls | 929,375 | **39.6%** | 47.2% | 13.2% |
| uses | 204,125 | **53.6%** | 44.4% | 2.0% |
| contains | 622,315 | **100.0%** | 0.0% | 0.0% |
| imports | 41,962 | **1.3%** (external by design) | 4.9% | 93.8% |
| references | 80,650 | **96.9%** | 0.7% | 2.4% |
| exports | 7,053 | **81.5%** | 17.1% | 1.3% |
| extends | 8,664 | **61.9%** | 25.5% | 12.6% |
| implements | 564 | **87.1%** | 5.3% | 7.6% |
| overrides | 3,890 | **90.8%** | 4.1% | 5.1% |
| instantiates | 1,899 | **77.1%** | 13.8% | 9.0% |
| part_of | 44,359 | **9.2%** (part stems; quoted parts outside) | 20.2% | 70.6% |
| TOTAL | 1,944,856 | **61.7%** | 28.0% | 10.3% |

**C · 2-repo corpus with headers (524 files / 78,349 edges, committed round artifact)** — TOTAL
**67.0% accepted** / 23.7% ambiguous / 9.2% unresolved; calls 61.9%.

### What the three columns say for shipping

1. **The unresolved mass in the extension-only arm was the HEADER BOUNDARY, not emission quality:**
   admitting headers on the same corpus moves unresolved **25.7% → 10.3%** and accepted
   **44.8% → 61.7%** (references 18.3% → 96.9%, instantiates 37.6% → 77.1%, uses 53.3% → 53.6% with
   ambiguity taking its place). Production routes `.h` by content, so arm B is the production-like view.
2. **Ambiguity grows with the project key space and is honest by design:** calls ambiguous-decl
   **37.0% → 47.2%** as headers add same-leaf declarations across the 22 repos. The store refuses to
   guess; where the analyzer supplies `metadata.owner` the owner channel resolves it (73,325 rows
   carried an owner whole-population; 51,466 resolved). This is the measured ceiling of the
   LEAF-NAME key space, not a wrong edge — the fixture/mutant/oracle suite pins emission separately.
3. **Two kinds are external by construction and must not be "fixed":** `imports` (2.2%/1.3%) names a
   module path and `part_of` (9.2%) a quoted part's file stem; the key space is symbols. Together they
   are 86,321 edges (4.4% of arm B); excluding them, accepted is **64.3%** with unresolved at **~7.6%**.
4. **Ship verdict: SHIP.** Emission is proven (64/64 cpp fixtures, 74/74 mutants, citation 11,719
   verified claims / 0 refuted, consume and receiver-wave controls green); 100% resolution is not the
   contract and is set by the arbiter key space + the two external kinds + macro wall (W10, 76,830
   rows) + receiver typing (W11, 53,351 rows), all ruled and numbered. The shipping snapshot should
   quote arm B (headers admitted) as the production-like view and arm A as the gate's own population.
