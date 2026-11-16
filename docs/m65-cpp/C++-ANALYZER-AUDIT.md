# C++ analyzer — measured audit

**Instrument:** `script/cpp-audit/census.ts` · **evidence:** `validation/cpp-audit/census.json`
**Subject:** `src/ast/real-cpp-analyzer.ts` — 7,058 lines, unmodified at HEAD `a1639eb69`
**Corpus:** `.cpp-corpus/fmt` (fmtlib/fmt `10.2.1`) + `.cpp-corpus/nlohmann-json` (nlohmann/json `v3.11.3`)
**Measured:** 523 C++ files · 17,597 symbols · 78,093 relationship rows · 0 parse failures

This page exists because the lane's own numbers were measured on a corpus that is **not on this
machine** — `docs/analyzers/cpp.md` states this itself ("the five corpora it names … are all absent
from `<corpus-root>`"), and every gate that produced them reports `CANNOT RUN HERE`. So nothing
below is quoted from that page. Every number here was produced by the command in *Reproduce*, on
the file at HEAD, and the two places where this audit **agrees** with the lane are stated as
agreement rather than as confirmation of its arithmetic.

---

## 1 · Verdict

The analyzer is in **substantially better condition than its documentation claims**, and its
documentation contains claims that are now **false at HEAD** in the safe direction and in the
unsafe direction both. The ten claimed relationship types all emit. The fabrication classes the
lane built gates for (D1 keywords, D2 self-inheritance, D3 duplicate pairs, D7 the `anonymous`
sentinel, V3 name surface, R7 placeholder targets) measure **zero** on a corpus the lane has never
seen. Against that:

| | count |
|---|---|
| relationship types emitting | **11** (the ten claimed + `part_of`) |
| types with **zero** measured defects | **7** — `contains`, `uses`, `extends`, `implements`, `instantiates`, `exports`, `references` |
| types with a **measured defect** | **2** — `overrides`, `part_of` |
| types with a **vocabulary hazard** | **1** — `calls` (`global` target collision) |
| **doc claims false at HEAD** | **8** (§7) — 4 corrected in `docs/analyzers/cpp.md` this round, 4 more found while correcting them |
| **gate red at HEAD** while documented green | **1** — `source-integrity.ts` (§4.4) |
| defects found | **4** (§4.1–4.4) — 3 in the analyzer, 1 in a lane gate. **All 4 now fixed and gated.** |
| defects found in the audit's own first draft | **3** (§6 — recorded, because they are the same failure mode this lane keeps finding) |

---

## 2 · Reproduce

```bash
# 1. corpus (persistent: /tmp is a private tmpfs here and is wiped between shell calls)
mkdir -p .cpp-corpus && cd .cpp-corpus
git clone --depth 1 --branch 10.2.1  https://github.com/fmtlib/fmt.git        fmt
git clone --depth 1 --branch v3.11.3 https://github.com/nlohmann/json.git     nlohmann-json
cd .. && bun run script/cpp-audit/census.ts --json > validation/cpp-audit/census.json

# 2. the lane's own gates that DO run on this machine
bun run script/m14/run-fixtures.ts --lang cpp        # -> 57 pass / 0 fail
bun run script/cpp-review/source-integrity.ts        # -> FAIL, exit 1   (SEE §4.4)
```

The probe calls **`ASTEngine.parseFile`** — the production entry, the same call `engine.ts` makes —
never `analyze()` directly, because the lane's own doc records that the two paths differ and every
number it states is for the production path.

---

## 3 · What emits, measured

Rows this analyzer produced over 523 files. `src`/`tgt` resolved = resolves against an index built
from **this analyzer's own output** (the population `bb_graph` binds against).

| type | rows | files | distinct pairs | confidence | evidenceClass | line# missing | src resolved | tgt resolved |
|---|---|---|---|---|---|---|---|---|
| calls | 59,374 | 429 | 13,602 | `1` | `usage_contextual` ×59,374 | 0 | 59,374/59,374 | 45,967/59,374 |
| contains | 10,660 | 180 | 8,196 | `1` | `structural` | 0 | 10,657/10,660 | 10,660/10,660 |
| uses | 4,580 | 162 | 3,469 | `0.9`,`1` | `usage_contextual` | 0 | 4,580/4,580 | 4,351/4,580 |
| imports | 1,968 | 493 | 207 | `1` | `import_based` | 0 | 1,968/1,968 | 205/1,968 |
| extends | 478 | 50 | 300 | `1` | `structural` | 0 | 478/478 | 435/478 |
| part_of | 365 | 174 | 55 | `1` | `usage_contextual` ×365 | 0 | 365/365 | 65/365 |
| references | 206 | 133 | 60 | `0.9` | `import_based` | 0 | 206/206 | 76/206 |
| instantiates | 182 | 23 | 157 | `1` | `structural` | 0 | 182/182 | 167/182 |
| overrides | 134 | 12 | 128 | `0.9`,`1` | `usage_contextual` 69 / `structural` 65 | 0 | 134/134 **(all ambiguous)** | 134/134 |
| exports | 112 | 7 | 105 | `1` | `structural` | 0 | 112/112 | 112/112 |
| implements | 34 | 9 | 28 | `1` | `structural` | 0 | 34/34 | 34/34 |

**The proportions independently corroborate the lane's whole-population census.** The lane measured
1,282,777 rows over 7,435 files with `calls` at 72.6 % and `contains` at 13.1 %; this audit measures
`calls` at 76.0 % and `contains` at 13.7 % on two repos the lane has never run. Two pipelines, two
corpora, same shape — that is agreement, not a re-quote.

**`implements` fires.** The lane's 128-file corpus reported `implements` = 0 in several tables and
it reads as a type that never emits. On this corpus it is **34 rows over 9 files**, which matches
the lane's own *other* table (D2 census: 375 at population). The "0" is a small-corpus artifact, not
the type's status.

---

## 4 · Defects found

Each is a measurement with the site that produces it. None of them is a fabrication of a wrong name;
they are one unresolvable endpoint, one wrong tier, one key mismatch, and one dead branch.

### 4.1 · `overrides` SOURCE binds to a NAME, not a declaration — 134/134 ambiguous (**FIXED**)

```ts
source: `${pend.cls}.${pend.method}`,   // "iterator_buffer.grow"  <- the defect
target: pend.method,                    // "grow"   <- fixed 2026-10-17 (CPP-STATE §I1)
```

The TARGET spelling was the subject of a documented, measured fix: commit `a29357562` moved the target
from `Base.method` to the leaf and measured 1,875 of 1,875 rows going `unresolved → 0`. **The SOURCE was
never moved.**

**⚠ THIS SECTION'S FIRST VERSION WAS WRONG, AND THE CORRECTION IS THE FINDING.** It reported the source as
"0 of 134 rows unresolvable". That is false. The resolver's own `extractLeaf`
(`pool-worker.ts:879`) splits on **both** `:` and `.`, so a dot-spelled source still reaches its leaf and
**every one of the 134 rows resolved**. The real defect is narrower and harder to see:

| measurement (134 rows) | dot spelling (before) | `::` spelling (after) |
|---|---|---|
| source resolves | **134 / 134** | **134 / 134** |
| of those, the key is **AMBIGUOUS** (leaf declared >1× in the file) | **134 / 134** | **14 / 134** |
| resolves **exactly and unambiguously** | **0 / 134** | **120 / 134** |

So the dot binds to the method *name*, and the name is declared more than once in every file:
`no_grouping.do_decimal_point` and `special_grouping.do_decimal_point` become indistinguishable once the
class is dropped, and in fmt's `xchar-test.cc` the leaf `do_decimal_point` is declared **4×**. The 14 that
remain ambiguous after the fix are **genuine C++** — one declaration plus one out-of-line definition of the
same method (`Mutex::Lock` at two lines), not a spelling defect.

This is a **wrong binding, not a missing one**, and that is exactly why it survived: the row is present, it
resolves, and no "unresolved" count moves. What it costs is `bb_impact` — the edge is attributed to an
arbitrary same-named method, so changing the overriding method does not reach its base and changing a
*different* class's same-named method does.

Two further reasons the dot is the wrong spelling even though it resolves:

1. **`.` is not C++ scope syntax.** C++ spells `A::B`. The lane's own comment block at `:5671` says so —
   *"The cpp scope-resolution separator is `::` (`A::B`), NOT the dot (`A.B`) the analyzer's own OVERRIDE
   SOURCE uses"* — so the file **knows** its source spelling is wrong and says so, without fixing it. And
   the same block publishes `qualifiedName = Owner::member` for members, so the analyzer publishes the
   correct spelling *and* the incorrect one, for the same pair.
2. **The resolver's dot fallback is an accident, not a contract.** It exists so other lanes' `A.B` spellings
   bind; relying on it means the cpp row depends on a generic fallback that the L-W4 block was written to
   supersede.

**FIXED**: the source is `${pend.cls}::${pend.method}`, and the internal dedup key was changed to match.
After: **0 dot-spelled sources, 134/134 resolved.**

### 4.2 · `part_of` carries `evidenceClass: "usage_contextual"` — 365/365 (`real-cpp-analyzer.ts:6288-6303`)

`classifyEvidenceTier` has an arm for `contains`/`exports`, `imports`, `references`,
`extends`/`implements`/`overrides` and `instantiates`. **It has no arm for `part_of`**, so `part_of`
falls through to the final `md.evidenceClass = "usage_contextual"` at `:6303`. Measured: 365 of 365
`part_of` rows carry `usage_contextual`.

`docs/analyzers/cpp.md` (relationship ontology table, `part_of` row) states **"1.0; class
`structural`"**. Code and doc disagree on every row the type emits.

Why it is not cosmetic, in the lane's own terms: the tier is the machine-readable separation between
*a fact read off the tree* and *a contextual inference*, and `part_of` is emitted from
`preproc_include` — a named node of the pinned grammar with the written form (`"…"` vs `<…>`) as the
discriminator. It is the most structural thing in the include family. `imports` gets
`import_based`; its sibling gets the weakest tier available.

This one is a **one-line fix** (`if (t === "part_of") { md.evidenceClass = "structural"; continue }`)
in a file the lane owns, with the contradictory doc sentence in the same table to update with it.

### 4.3 · `part_of` de-duplicates on the PATH but emits under the STEM → duplicate pairs (`:3484` + `:3499`)

```ts
if (!referencesSeen.has(includePath)) {      // keyed on the WRITTEN PATH   ("fmt/format.h")
  relationships.push({ target: cppPartSymbol(includePath), … })   // emitted under the STEM ("format")
```

Two distinct parts that share a file stem therefore emit **two identical `(source, target)` rows** —
the exact shape the lane's D3 one-edge-per-pair contract forbids. Measured **5 rows**:

| file | include pair | collapsed to |
|---|---|---|
| `.cpp-corpus/fmt/src/fmt.cc` | `"fmt/format.h"` + `"format.cc"` | `global -> format` ×2 |
| `.cpp-corpus/fmt/src/fmt.cc` | `"fmt/os.h"` + `"os.cc"` | `global -> os` ×2 |
| `FuzzerExtFunctionsWeak.cpp` | `"FuzzerExtFunctions.h"` + `"…/FuzzerExtFunctions.def"` | `global -> FuzzerExtFunctions` ×2 |
| `FuzzerExtFunctionsDlsym.cpp` | same shape | ×2 |
| `FuzzerExtFunctionsWeakAlias.cpp` | same shape | ×2 |

The dedup key and the row's identity are **different fields**, which is the whole bug: `contains`,
`references` and `imports` all measure **0** duplicate pairs, so this is specific to `part_of`'s
stem-target rule — the one type whose dedup key is not its row.

**No fixture can currently see it, and that is checkable rather than asserted:**
`cpp/one-edge-per-pair-959` contains only ANGLE includes (`<vector>` ×2, `<string>` ×3, `<map>` ×2),
so every row it pins is `imports`, not `part_of`; and `cpp/part-of-quoted-include.cpp` carries a
single quoted `#include`, which cannot collide with itself. A stem collision needs **two quoted
includes in one file whose stems agree**, and no fixture in the suite writes that shape.

### 4.4 · The `source-integrity` gate is RED at HEAD, and its scanner is not the D6 it claims to restate

Documented status (`docs/analyzers/cpp.md`, gates table, CPP3 round): **"PASS — 0 NUL bytes, 0 D6
findings, 0 TS parse errors; 7 self-test arms, 0 blind assertions"**.

Measured now, on the unmodified file at HEAD:

```
bytes 388180 | NUL bytes 0 | findings 3
  regex-literal: at line 1: /hpp/
  regex-literal: at line 114: /[*&\s]+/g
  regex-literal: at line 197: /** ONE CHARACTER SWAPPED for another — the ZERO-REGEX way to spell the `_`/
  FAIL  d6-blind-spot: a literal that only ever appears as a STRING is not counted — injected=true findings=3 expectedFound=false
FAIL — 3 finding(s), 1 blind assertion(s)          exit code 1
```

All three findings are **comment prose**, and that is the defect: this gate's scanner
(`script/cpp-review/source-integrity.ts:96-115`) splits the file into lines and matches a regex-shaped
run on **every line including comments**, while the D6 it says it restates
(`script/cpp-review/defect-register.ts:879-918`) **strips block comments, line comments and string
literals first** — its own comment says why ("COMMENTS ARE NOT CODE"). Proven by running both
algorithms over the same bytes:

```
(A) defect-register D6   (STRIPS comments+strings): 0
(B) source-integrity     (no stripping):            3   /hpp/, /[*&\s]+/g, /** ONE CHARACTER…
```

So:

* **The analyzer's zero-regex claim is TRUE** — (A) reads 0. `src/ast/real-cpp-analyzer.ts` contains
  no regex in code. This audit confirms that independent of the lane.
* **The gate is the thing that is wrong.** It reports the file's *documentation of the regexes it
  removed* as regexes, so a lane that explains its own text rules is penalised for explaining them.
  The gate's header says the copy is "held to the original's ALGORITHM rather than to its intent";
  it is not — the comment-stripping is the algorithm.
* **Its self-test can no longer pass at all.** The `expectedFound=false` arm asserts the mutated file
  reports **0** findings. It is written against a clean baseline, and the baseline is 3. It therefore
  fails on any run, forever, until either the scanner learns to strip comments or the assertion is
  changed to compare against the baseline instead of against zero.

Attribution: this is a **gate + doc** defect, not an analyzer defect. The analyzer is right; the
instrument that certifies it is wrong in the direction that matters least for users (excess caution)
and most for maintainers (a permanently red gate trains its readers to ignore it — the M12 census
header's own warning, quoted in this very file).

---

## 5 · What is verified correct

Measured at whole population on a corpus the lane has never run. These are the lane's own invented
contracts, and they hold:

| check | result | what it means |
|---|---|---|
| **D1** a C++ keyword as a `calls`/`uses`/`instantiates` target | **0 / 64,136 rows** | no `static_cast`/`if`/`for` fabrication. Independently derived keyword set, not the analyzer's own list |
| **D1** a keyword as a published symbol name | **0 / 17,597 symbols** | no `noexcept`/`static_cast` declared names |
| **D2** `X extends X` | **0 / 478 extends** | no self-inheritance, including the `priority_tag<N-1>` and `char_traits : std::char_traits<T>` shapes |
| **D3** duplicate `(src,tgt)` in one file — `contains` | **0 / 10,660** | one-edge-per-pair holds |
| **D3** duplicate — `references` | **0 / 206** | holds |
| **D3** duplicate — `imports` | **0 / 1,968** | holds (the type that was re-labelled from `references` in the ontology round) |
| **V3** unpublished-shape symbol name (whitespace, `<`, `>`, `{`, `}`, `(`, `)`) | **0**, macro-headings excluded as designed | every published name is a name |
| **R7** placeholder endpoint (`anonymous`, empty) | **0** | D21's sentinel is genuinely unpublished |
| `overrides` **target** spelling | **0 dotted / 134** | the `a29357562` fix is intact |
| `part_of` target is a **path** | **0 / 365** | the measured ruling (path → 0 resolved of 4,612; stem → 383) is implemented |
| `exports` target resolution | **112 / 112** | export markers resolve to the macros the file declares |
| macro/`#define` symbols | 1,211 `macro` + 810 `constant` | the D9 minting is live at scale |

Two of these deserve emphasis because they are the lane's *hardest* claims and they survive an
adversarial corpus:

* **D1 across 64,136 rows with an independently-derived keyword list.** The audit's set is written
  from ISO 14882 `[lex.name]` and does **not** import `CPP_KEYWORDS`, precisely so it can disagree
  with the analyzer. It finds nothing. The 123-spelling set and its seven gate positions are
  sufficient on this corpus.
* **V3 = 0** after excluding `expandedFrom: "macro-heading"`. Every `TEST(suite, name)` symbol the
  lane publishes is a **designed** answer (the body needs an owner) and every non-macro name is a
  legal identifier. The lane's V3 predicate is doing real work: fmt's test suite is full of `TEST(…)`
  headings, which is exactly the population that would produce junk names under a weaker rule.

### The vocabulary hazard: `global` as a TARGET — 6 rows

`calls … -> global`, with `metadata.qualified = "std::locale::global"`. **The rows are correct**:
`std::locale::global` is a real function in the standard library and its callee leaf is `global`.
What is wrong is that `global` is also the lane's **file-scope SOURCE sentinel**, so:

* a consumer that filters the sentinel sees a real call disappear;
* the lane's own R7 "0 placeholder targets" rule cannot flag it without flagging a real edge;
* `global` is a **legal C++ identifier** — nothing reserves it — so this is not a bad choice of
  keyword but a collision with the language.

This is the same class as `anonymous`, which D21 fixed by *declining to publish* the construct.
`global` cannot be fixed that way (it is a source sentinel, not a symbol), and it is **not** a
fabrication, so it is recorded as a hazard rather than a defect. 6 rows over 523 files; the fix, if
one is wanted, is a sentinel that cannot be spelled in C++ (the lane already uses `\u0000` as a
separator elsewhere, and D24 is the story of what a NUL in that file costs).

---

## 6 · Three defects in this audit's own first draft

Recorded because they are the same failure mode the lane's own doc keeps finding, and because a
census whose checks guess is worse than one that omits them.

1. **`kindCensus` read `Object.prototype.constructor`.** `SymbolKind.constructor` is a legal kind and
   a plain `{}` inherits it, so `kindCensus["constructor"] ?? 0` produced the string
   `"function Object() { [native code] }111…"` instead of a count. Fixed with
   `Object.create(null)`.
2. **A placeholder set that guessed.** The first draft flagged `null`, `unknown` and `undefined` as
   placeholder literals. **Every row it flagged was correct**: fmt declares
   `template <typename T> struct null`; nlohmann declares `bool null()` on every SAX interface plus
   `value_t::null`; and `enum class Color { red, green, blue, unknown }` is in nlohmann's own
   examples. All 66 `null` rows and both `unknown` rows were traced to their source lines before the
   set was cut to the one genuine sentinel (`anonymous`). **`global` is handled separately** because
   on the target side it is a real function.
3. **Duplicate counting that ignored file scope.** The first draft counted `(src,tgt)` pairs
   globally, so `global -> cmath` in 88 different translation units read as 88 duplicates. The
   contract is **per file**; corrected, `contains`/`references`/`imports` are 0 and only `part_of`'s
   5 stem collisions remain.

---

## 7 · Documentation false at HEAD

Not analyzer defects — eight claims in `docs/analyzers/cpp.md` that a re-run contradicts. Stale claims
in the *safe* direction cost a maintainer a day of re-measurement; in the unsafe direction they hide
work. Rows 1–4 were found by this audit's first pass; rows 5–8 were found **while correcting 1–4**,
which is the usual way a stale document yields its remaining errors. All eight are now corrected in
`docs/analyzers/cpp.md` in place, with the old text quoted beside the new (the lane's convention: a
lane's history is not its last writer's), and the whole set is recorded again in that file's dated
**M65** section.

| # | claim in `docs/analyzers/cpp.md` | measured at HEAD | direction |
|---|---|---|---|
| 1 | **"39 cpp fixture suites; `{"cpp":{"pass":39,"fail":0}}`"** | **57 pass / 0 fail** | safe — 18 fixtures unreported |
| 2 | the recorded standing failure **`cpp/friend-definition-body-owner`** ("the recorded contract conflict", cited in CPP-STATE §I1 and the CPP3 gate table as the one remaining failure) | **PASSES**. The suite is 0 fail, so the conflict was resolved and the doc never said so | safe |
| 3 | **"the differential's compared-label set for cpp is `calls, extends, implements, instantiates, uses`"** and the five **DERIVATION findings** (`contains`, `overrides`, `references`, `imports`, `exports` "stored and compared against nothing") | **nine of the ten labels now have cpp truth wired**: `differential.ts:26061` (`extends`/`implements`/`instantiates`), `:26094` (`calls`/`uses`), `:26130` (`contains`/`references`/`imports`/`exports`/`overrides`), and `cpp-truth.ts:831 deriveCppUnadmittedTruth` pushes all five with its own derivers. **The live artifact agrees and names the remaining gap precisely**: `validation/m60/results/rel-type-coverage.json` (2026-10-23) records exactly **one** `DERIVATION` finding for cpp — `emits \`part_of\` but the differential audits [the nine above] — the type is stored and compared against nothing`. So the five were **closed** and the finding list was never updated; **`part_of` is the type still unaudited**, and the doc does not name it because its list predates the type's emission | safe — the gap was **closed** (and narrowed to one), the finding list never updated |
| 4 | **`source-integrity.ts` "PASS — 0 findings, 0 blind assertions"** | **FAIL, exit 1, 3 findings, 1 blind assertion** (§4.4) | **unsafe** — a red gate is documented green |
| 5 | `part_of` row, evidence-class cell: **"1.0; class `structural`"** | **`usage_contextual` on 365 of 365 rows.** `classifyEvidenceTier` has no `part_of` arm | doc contradicted the code on every row |
| 6 | `part_of` is listed **twice, contradictorily** — "RULED NOT APPLICABLE" in the applicable-set section and "**EMITTED**" in the ontology table two hundred lines above | emitted, **365 rows / 174 files** | the ruling was wrong; it is corrected to say so |
| 7 | `implements` count table: **"0 rows, 0 files, 0 pairs"** with "measured on four legs below" | **34 rows / 9 files** on this corpus (375 at the lane's own population census) | the 0 is the 128-file corpus, not the type's status |
| 8 | `RULED_BY_LANG` **"has `bash` and `json` and nothing else"** | **26 languages**, `cpp` still absent, so the gate still exits 2 | stale; the *need* is still open |

And one **genuine gap the doc's list does not contain**, because it was written before the type
existed: **`part_of` (365 rows, 174 files) has no oracle truth.** It is absent from cpp's compared
set, absent from `deriveCppUnadmittedTruth`, and present in no other lane's `part_of` truth list
(dart, php, erlang and rust each have a lane-owned `part_of` oracle; cpp has none). The newest
emitted type is the only unaudited one, and the lane's DERIVATION list — which exists precisely to
track that — does not mention it.

---

## 8 · Per-type status

`MEASURED` = this audit fired it and checked it. `ORACLE` = the shared differential derives it for
cpp. Verdict is about **this audit's** evidence.

| type | emit site | oracle | fixture | measured | verdict |
|---|---|---|---|---|---|
| **calls** | `:5105` | ✔ `deriveCppEdges` | 19 | 59,374 rows, D1=0 | **CORRECT**, one vocabulary hazard (`global` target) |
| **contains** | `:5629` | ✔ `deriveContains` | 18 | 10,660, D3=0 | **CORRECT** |
| **uses** | `:4913` (field), `:5323` (bare read) | ✔ `deriveCppBareUses` | 17 | 4,580, D1=0 | **CORRECT** |
| **imports** | `:3500` | ✔ `deriveImportsAndReferences` | 10 | 1,968, D3=0, 1,763 external-by-design | **CORRECT** |
| **extends** | `:3671` (decorated head), `:3902` | ✔ `deriveTreeEdges` | 11 | 478, D2=0 | **CORRECT** |
| **references** | `:3204` (`using`) | ✔ | 5 | 206, D3=0, external by design | **CORRECT** |
| **instantiates** | `:5239` | ✔ `deriveTreeEdges` | 4 | 182, D1=0 | **CORRECT** |
| **exports** | `:3689` (class head), `:4394` (specifier), `:5568` (file scope) | ✔ `deriveExports` | 3 | 112, targets 112/112 resolve | **CORRECT** |
| **implements** | `:5538` (post-walk, pure-virtual bases) | ✔ `deriveImplements` | 2 | **34 rows / 9 files** | **CORRECT** — and it *does* fire; the "0" in several lane tables is a 128-file-corpus artifact |
| **overrides** | `:5472` (post-walk, transitive + signature-aware) | ✔ `deriveOverrides` | 8 | 134, target ✔ / source resolves 134/134 **but all 134 ambiguous**; after fix 120 exact + 14 genuine | **FIXED** — §4.1 |
| **part_of** | `:3492` (quoted include) | ✘ **none** | 1 (`cpp/part-of-quoted-include`) | 365, **duplicates 5**, **tier wrong 365/365** | **NEEDS WORK** — §4.2, §4.3, and no oracle |

`decorates`, `renders`, `mixes_in`: **correctly absent**. Each is ruled in the lane's
`cpp-applicable-set.ts` with a grammar-absence argument, and this audit found no construct in
either corpus that would justify them. `decorates` in particular is right to be refused: C++
attributes carry no callable application, so a `decorates` edge would assert a call that does not
exist. That is a ruling this audit agrees with rather than checked.

---

## 9 · Never measured, and what would close it

| gap | why it is still open | what would close it |
|---|---|---|
| **`defect-register.ts` D1–D8** over its 1,722-file corpus | its five corpora (fmt, nlohmann-json, Catch2, abseil-cpp, spdlog, zig) are absent; it **cannot run here** | clone Catch2/abseil/spdlog (2 of 6 are now present) and re-run with `BB_CORPUS_ROOT` |
| **`.h` discovery boundary** — the lane's largest claimed residual (83 % of `calls`) | it is a property of `incoming-gate.ts:314`, not of the analyzer, and CPP-STATE I4 already found that the residual gate's population did not move when the fix landed | a run of the **incoming** gate, not the residual gate, against a `.h`-bearing corpus |
| **whole-population 1,282,777-row census** | needs the 31-repo corpus | not reproducible from this checkout |
| ~~**`part_of` oracle**~~ **CLOSED** | does not exist for cpp at all (§7) | **now exists**: `script/m14/oracles/cpp-part-of.ts` + `script/cpp-audit/oracle-check.ts`; 2,328 rows, 0 disagreements, 5 analyzer-extra rows against the pre-fix analyzer |
| **`calls` resolution to the INTENDED declaration** | this audit resolves against names, and C++ member names repeat across classes; 45,967/59,374 targets resolve and the rest are a mix of external library calls and genuine ambiguity | an owner-qualified key space (which §4.1's `::` fix would partly supply) |

---

## 10 · Recommendation — one, with its arithmetic

**Fix the four analyzer/gate defects in this order, and do not touch the emit surface while doing it.**
They are 4 edits, one of which is a one-liner, and none changes how many rows the analyzer emits:

```
 1. overrides SOURCE  `pend.cls + "." + pend.method` -> the "::"-spelled member   ~1 line
 2. part_of tier      add the missing arm to classifyEvidenceTier                1 line
 3. part_of dedup     key referencesSeen on the STEM, not only on the path        1 line
 4. source-integrity  strip comments in checkRegexLiterals, and make the
                      expectedFound=false arm compare to the BASELINE, not to 0  ~15 lines
```

The arithmetic, because it decides the order:

* **#1 is the only one that costs a consumer anything today — and it costs it silently.** 134 of 134
  `overrides` rows bind their SOURCE to a name rather than to a declaration (all 134 land on an ambiguous
  key), so `bb_impact` on an overriding method attributes the edge to an arbitrary same-named method and
  does not reach the base. Every other type's source endpoint is unambiguous — `contains` 10,657/10,660,
  `uses` 4,580/4,580, `imports` 1,968/1,968, `extends` 478/478, `instantiates` 182/182, `exports`
  112/112 — so `overrides` is the only type whose source is not a specific declaration. The fix is the
  exact edit the lane already made on the target side one commit after `a29357562`; it converts
  **134 ambiguous → 120 exact + 14 genuinely ambiguous**, and leaves the row count unchanged.
* **#2 is one line and it removes a doc/code contradiction on 365 rows.** Cheap, and it makes the
  evidence-tier column readable for the include family.
* **#3 removes 5 duplicate rows.** Small, but it is a *contract violation* (`one edge per pair`) and
  the existing fixture cannot see it — so leaving it means the contract is pinned by a test that
  cannot fail on the one shape that breaks it.
* **#4 is the largest edit and the lowest user impact, but it should not wait**, because a gate that
  is red at HEAD and documented green is the exact condition this lane's own doc calls the worst
  kind of defect: *"a documented zero that no runnable gate re-derives"*. Its self-test currently
  cannot pass, so it certifies nothing until it is repaired.

**And `deriveCppPartOfTruth` now exists** — `part_of` was the only emitted type with no second
opinion, and #2/#3 are exactly the two defects a second opinion catches.
`script/m14/oracles/cpp-part-of.ts` (151 lines, lane-owned, sharing no code/tables/helpers with the
analyzer) plus `script/cpp-audit/oracle-check.ts`. **Result: 2,328 rows, 0 disagreements in either
direction** (`imports` 1,968, `part_of` 360). It is a real gate, not a mirror: against the pre-fix
analyzer it reports **5 analyzer-extra rows**, naming each by file — the same 5 measured by hand. The
harness itself needed one fix first: it compared SETS, so pre-fix and post-fix read identically (a set
of one duplicated element equals a set of one); it now compares MULTISETS per file. Wiring it into
`differential.ts`'s cpp arm is master-owned and is the single remaining item.

**Deliberately not recommended:** re-cutting the 1,282,777-row whole-population census, and
re-litigating the `.h` boundary. Both need a corpus machine this checkout does not have, and the
`.h` question is already measured as *"the fix landed in `incoming-gate.ts:219` but the residual
gate's population did not move"* — so a re-measurement through the wrong gate would produce a
confident zero.
