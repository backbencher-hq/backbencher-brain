# C# analyzer — a Lead's review of the whole lane at HEAD `be4c0ef25`

**Scope.** Everything in this checkout that constitutes the C# lane: the analyzer, its grammar,
its spec, its fixtures, its truth oracle, its instruments, its gates, and the documents that claim
what it does. Read-only: no source file was modified to produce this page.

**Method.** Read the analyzer end to end (5,015 lines), read the lane doc end to end (1,630 lines),
then **ran** every gate the lane names rather than trusting the doc's transcription of them, and
recomputed every number I could from the committed artifacts. Where the doc and the tree disagree,
the tree wins and both are reported.

---

## 0. The one-paragraph answer

The C# analyzer is **real, well-instrumented and in better shape than its own documentation
claims** — 10/10 relationship types fire, F1/F3/F4/F5 are green, and two of the three defects the
doc still reports as open have been fixed since it was written. But the lane has **three live
red gates the doc does not report**, and **one whole-population number that the doc never states
anywhere**: only **44.0 % of the 1,262,497 edges C# emits resolve to a declaration** —
40.5 % are ambiguous and 14.5 % are unresolved. That is not a hidden defect (the lane's own
`incoming-declaration.json` counts every row with a named cause and a falsifier), but it is the
single most important fact about this analyzer and **no document in the tree tells a reader**.

---

## 1. Symbols — implemented vs ruled

### 1.1 The symbol contract

Symbols are published for 16 declaration shapes (`CSHARP_SYMBOL_DECLARATIONS`,
`real-csharp-analyzer.ts:152`), plus a 17th that is **not in that set** and that matters:
`local_function_statement` is handled by the main `analyze` loop at `:1997` and published as
`SymbolKind.Function`. I verified this behaviourally rather than by reading:

```
SYMBOLS:
  namespace | N       | owner=-
  class     | C       | owner=N
  method    | M       | owner=C
  function  | Helper  | owner=M      <-- a LOCAL function IS a symbol
CONTAINS:
  N -> C ; C -> M ; M -> Helper
```

So the file header's claim — *"NO locals, parameters or accessor scopes"* — is **true for locals
and parameters, false for local functions**. The header lists the symbol set and omits `function`
while the code publishes it. This is a header defect, not a code defect, and it is load-bearing
for review because it is exactly the kind of quiet asymmetry the lane's own gate exists to catch.

### 1.2 Symbol surface at HEAD (200 files, the lane's own instrument)

| kind | n |
|---|---|
| method | 208 |
| class | 174 |
| property | 155 |
| namespace | 42 |
| interface | 14 |
| enum_member | 13 |
| constructor | 12 |
| event | 12 |
| struct | 9 |
| delegate | 7 |
| enum | 7 |

Totals: **0** range-outside-file · **0** inverted ranges · **0** empty names · **0** dangling
owners · **8** names not written at their own range.

### 1.3 LIVE RED — `verify-csharp-symbols` is FAIL, and it is now 8 rows, not 2

The doc (§7, at the 2026-10-05 round) records this gate as **FAIL — 2 rows** and attributes both
to a deliberate mirrored convention: a conversion operator published as the two-word string
`"explicit CSharpAnalyzerOptionsProvider"`.

At HEAD the gate is still FAIL, but reports **8 rows**, and the set is now dominated by a
**different** class — the plain `implicit`/`explicit` conversion operator:

```
Features.cs                     implicit string        kind=method
payload-and-complexity.cs       implicit int           kind=method
qualified-type-spelling.cs      implicit PlainQualified
qualified-type-spelling.cs      implicit Probe.PlainQualified
using-alias-and-operators.cs    implicit int
using-alias-and-operators.cs    explicit int
using-alias-and-operators.cs    explicit Box<Plain>
using-alias-and-operators.cs    implicit Box<Plain>
```

All 8 are the same construct: `opName` is built as
`` `${modifierKeyword.type}${convTargetNode ? ` ${…}` : ""}` ``
(`:1914`) — i.e. the **literal words `implicit`/`explicit` followed by a space and the target
type**. `verify-csharp-symbols` asserts that `src.slice(startIndex, endIndex).includes(name)`;
the source writes `implicit operator string`, which does not contain the substring
`"implicit string"`.

**Adjudication.** The doc is right that this is deliberate and mirrored: `deriveCSharpContains`
(`differential.ts:9671-9686`) reproduces the same spelling from the same grammar fields so the
two halves reconcile, and `F4` carries `mutation-csharp-conversion-operator-collapsed` and
`mutation-csharp-truncated-conversion-target` pinning it. Changing one side alone desyncs a
master-owned oracle. So this is **not** an analyzer defect.

**But the doc's "2 rows" is stale, and that matters more than the count.** The doc names a
conversion operator whose target is a *named type* (`CSharpAnalyzerOptionsProvider`) — 1 row in
its era. The population today is 8, and it is dominated by **primitive** targets (`int`,
`string`). A reader who accepts "2 rows, pre-existing, deliberate" has been told the gate is
nearly clean; the gate is actually reporting on **every conversion operator in the corpus**,
because the property it asserts is unsatisfiable for that construct by construction.

**The honest disposition** is one of two, and it is a decision for the lane's owner, not a fix to
smuggle in: either `SYNTHESIZED` gains the conversion-operator names (which is what the gate
already does for `constructor`/`Finalize`/`this` — names the source never writes verbatim), or the
analyzer adopts Roslyn's own `op_Explicit`/`op_Implicit` spelling, which **is** a legal C#
identifier, **is** written nowhere, and would need the oracle moved in the same commit. The doc
already names `op_Explicit` as "the obvious candidate"; it has been named since 2026-10-05 and
not taken, which is the real finding here — not the spelling, the **staleness of the disposition**.

---

## 2. Relationship types — implemented vs ruled

### 2.1 The vocabulary

14 values in `RelationshipType` (`src/ast/types.ts:91`). Grepping the analyzer for
`RelationshipType.<X>` gives **11 distinct types, 18 call sites**:

| value | sites | doc row |
|---|---|---|
| `References` | 4 | ✅ |
| `Calls` | 2 | ✅ |
| `Uses` | 2 | ✅ |
| `Renders` | 2 | ✅ |
| `Overrides` | 2 | ✅ |
| `Instantiates` | 2 | ✅ |
| `Imports` | 2 | ✅ |
| `Extends` | 2 | ✅ |
| `Implements` | 1 | ✅ |
| `Exports` | 1 | ✅ |
| `Contains` | 1 | ✅ |
| `Decorates` | **0** | ❌ ruled (ontological) |
| `MixesIn` | **0** | ❌ ruled (grammar-absence) |
| `PartOf` | **0** | ❌ ruled (informational) |

**11 implemented, 3 ruled.** This matches `script/m14/spec/csharp-completeness.json`
(`coverage.implemented` lists exactly those 11) — the spec and the analyzer agree, and the doc's
15-row ontology table (header + 14) is consistent with both.

### 2.2 The three rulings, and whether they hold

- **`decorates` — ontological. HOLDS.** `attribute`, `attribute_list`, `attribute_argument` *are*
  in the pinned grammar (F1: 110 referenced type literals, 0 unknown), so this is not a grammar
  gap. The ruling is that a C# attribute is passive metadata while a decorator is an applied
  callable, and the analyzer publishes attributes as symbol metadata (`decorators`). That is a
  defensible ontological line and the spec cites the vocabulary proposal plus the java/cpp
  precedents. **Not a defect.**
- **`mixes_in` — grammar-absence. HOLDS.** C#'s only supertype composition is the base list,
  which is already `extends`/`implements`. The doc records the ladder (R1 unavailable, R2 n/a,
  R3 measured-and-not-taken with extension methods at 3,312 sites and the record `with` form at
  673). **Not a defect.**
- **`part_of` — informational. HOLDS.** `partial` splits one type into one symbol, so a
  `part_of` row would read `X → X`. **Not a defect.**

All three are **ruled with a count and a falsifier**, which is the standard this programme sets.
Nothing here is an unexplained gap.

### 2.3 `renders` — implemented and **corpus-unexercised**

`renders` is emitted (2 sites, `CSHARP_RENDER_HOSTS` at `:791`) but **0 edges over the whole
admitted population**, because the construct is Razor's. The proof is behavioural (fixture
`render-host-component`). Verified: the firing census reports `renders 0`.

This is an honest disposition and the doc says so plainly. The one thing worth flagging is that
`renders` being **in** `coverage.implemented` while emitting zero rows means the *implementation*
claim and the *emission* claim are different claims, and the spec's word "implemented" reads
stronger than the evidence. The doc's own row says "emitted, corpus-unexercised", so the
information is not lost — it is just distributed across two files with different vocabularies.

---

## 3. The numbers — and the one nobody states

### 3.1 Gates I ran at HEAD, with their real results

| gate | command | result at HEAD | doc says |
|---|---|---|---|
| F1 grammar | `audit-analyzer-grammar.ts csharp` | **PASS** refs=**110** unknown=0 unknownFields=0 | PASS refs=107 / 106 |
| F3 fixtures | `run-fixtures.ts --lang csharp` | **26 / 26 pass, 0 fail** | 19 / 19 |
| F4 mutants | `M14.0.F4.json` | **80 csharp mutants, all `pass`** (2,136/2,136 overall) | 9 / 9 (one lane-owned file) |
| F5 differential | `differential.ts --lang csharp --sample 60` | **100 % / MISSING=0**, unexplained 1 (powershell), 0 (fsharp) | 100 % / 0 / 0 |
| F5 at 200 | `--sample 200` | **100 % / MISSING=0**, unexplained 3 / 0 | not stated |
| no-regex | `verify-csharp-no-regex.ts` | **PASS** (silent under `tsx`, prints under `bun`) | PASS |
| line numbers | `verify-csharp-line-numbers.ts` | **PASS** — 0 out of bounds, 14 null (all synthesized) | PASS |
| symbols | `verify-csharp-symbols.ts` | **FAIL — 8 rows** | FAIL — 2 rows |
| overrides symmetry | `verify-csharp-overrides-symmetry.ts` | **PASS** — but now says "compared: true" | PASS (exclusion) |
| oracle regressions | `verify-csharp-oracle-regressions.ts` | **PASS** | PASS |
| oracle coverage | `verify-oracle-coverage.ts` | **PASS** — csharp 9 compared labels | PASS |
| M60 DERIVATION | `rel-type-coverage-gate.ts --langs=csharp` | **ALL 4 CHECKS CLEAN** (0 findings) | **1 finding: `overrides`** |
| completeness | `completeness-inventory.ts --lang csharp` | **8/8 PASS (A–H)**, 217 types classified | **FAIL 2 types in NO bucket** |
| typecheck | `tsc --noEmit -p tsconfig.json` | 2 errors, **both in `src/lsp/cross_language_hover.ts`** (another lane) | 0 errors for this file |

Three of the doc's claims are **stale in the lane's favour**:
1. **M60 DERIVATION is now clean.** The `overrides` finding is closed — `differential.ts:26382`
   admits `["exports","imports","overrides"]` for csharp and the truth pushes all three
   (`csharp-truth.ts`). The doc still reports "1 finding: overrides".
2. **Completeness is 8/8.** `ERROR` and `MISSING` are now classified (`handled_verified` and
   `internal_silent` respectively) in `script/m14/spec/csharp-completeness.json`. The doc still
   carries a whole section headed *"Section A of the completeness gate fails"*.
3. **Overrides is compared.** The doc's §"Relationship labels: compared set widened 4 → 7" and
   its "remains excluded on both sides under C923" are both superseded;
   `verify-csharp-overrides-symmetry.ts` now prints `compared: true` and still says PASS.

### 3.2 The whole-population resolution number — 44.0 %, stated nowhere

`validation/m14/instruments/csharp/incoming-declaration.json` is the lane's whole-population
closure (14,424 files, 22 repos, 100 % parsed). Summing its per-type table:

| label | edges | resolved | external | ambiguous | unresolved |
|---|---|---|---|---|---|
| calls | 415,601 | 117,318 | 0 | 237,935 | 60,348 |
| uses | 259,772 | 106,494 | 0 | 125,432 | 27,846 |
| contains | 195,367 | 195,367 | 0 | 0 | 0 |
| references | 223,848 | 75,334 | 0 | 94,086 | 54,428 |
| instantiates | 86,813 | 39,114 | 0 | 29,460 | 18,239 |
| imports | 39,763 | 683 | 12,009 | 20,146 | 6,925 |
| overrides | 14,514 | 14,514 | 0 | 0 | 0 |
| extends | 8,672 | 4,090 | 0 | 3,506 | 1,076 |
| implements | 5,066 | 2,299 | 0 | 1,077 | 1,690 |
| exports | 13,081 | 113 | 0 | 0 | 12,968 |
| `renders`/`decorates`/`mixes_in`/`part_of` | 0 | 0 | 0 | 0 | 0 |
| **total** | **1,262,497** | **555,326 (44.0 %)** | **12,009 (1.0 %)** | **511,642 (40.5 %)** | **183,520 (14.5 %)** |

**This is not a concealed defect.** The lane's `causeRulings` partition the **707,171
non-resolved edges** with a named cause and a falsifier each, and the partition closes exactly:

| cause | count | reading |
|---|---|---|
| ambiguous — bare name declared by >1 file of the project | 490,456 | the largest single class; production refuses to pick |
| unresolved — declared nowhere in the corpus | 128,068 | BCL/framework names (`System.*`, `NUnit`, …) — unanswerable by construction |
| unresolved — declared in **another repository** | 54,927 | the project scope cannot see it; a flat key space would |
| ambiguous — declared twice in one file | 21,050 | only visible because the arbiter counts declarations, not files |
| ambiguous — the edge's own file | 136 | the own-file tie-break applies |
| project-key-space gap | 525 | the two instruments disagree; counted, not argued |
| **total non-resolved** | **707,171** | = 1,262,497 − 555,326 ✓ |
| external claim confirmed (`extOK`) | 12,009 | the lane's working claim surface |

The caveat block in that file is unusually honest and I want to quote its central admission
rather than paraphrase it: **"RESOLVED IS NOT 'THE EDGE POINTS AT THE RIGHT DECLARATION' IN THIS
LANE"** — a resolved edge points at *a* declaration, and where more than one existed, at the one
the own-file tie-break chose. The indexer measures a large share of those picks as wrong, so
**44.0 % is a floor on correct resolution, not a measure of it**.

**What is missing is the communication, not the measurement.** `grep` for `555326`, `511642`,
`237935` across `docs/` and `validation/` returns exactly one hit: the fleet rollup
`validation/m14/results/inbound-fleet.json`. The C# analyzer's own page — 1,630 lines, thirteen
rounds of detailed defect accounting — **never states its resolution rate**. Its only resolution
figure is a 200-file-depth `95.6 %` from 2026-09-29, which is a different denominator (edges
resolvable *within the analyzed file*, not declarations across the corpus) and which the doc
presents without that distinction.

A reader who trusts `csharp.md` believes this analyzer is ~96 % resolved. A reader who opens the
declaration learns it is 44.0 % resolved against the corpus, with the difference decomposed into
seven named causes. **Both are "true" under their own definitions, and the definitions are the
story.**

### 3.3 The `overrides` confidence floor

`csharp-firing.ts` over 200 files: `overrides` fires 184 times, of which **162 are at confidence
0.5** (`evidenceClass: inferred`) and only 22 at 1.0 (`structural`). The 0.5 rows are
`resolveOverrides` Pass 3 — the deterministic *first-parent guess* (`:3268-3273`,
`reasonCode: "first-parent-guess"`).

So **88 % of C# `overrides` edges on this corpus are declared guesses at the bottom of the
confidence scale.** The doc reports this as a "0.5 for first-parent guesses" confidence-model
entry and as a 2026-09-28 boundary ("Pass 3 does not check that the parent declares the member…
recorded as a boundary, not a fix"), but does not put the 162/184 ratio next to it. The
differential is 100 % clean here because the oracle derives the same first-parent rule — which is
exactly the "structurally self-agreeing" class the lane itself warns about for `contains`.

### 3.4 Per-label confidence at HEAD (200 files)

| label | edges | conf 1.0 | conf 0.95 | conf 0.9 | conf 0.7 | conf 0.5 | evidenceClass |
|---|---|---|---|---|---|---|
| calls | 4,770 | — | 53 | 4,717 | — | — | usage_contextual |
| uses | 4,847 | 800 | — | — | 4,047 | — | inferred / usage_contextual |
| references | 4,181 | — | — | 4,181 | — | — | reference_qualified / import_based |
| contains | 3,677 | 3,677 | — | — | — | — | structural |
| instantiates | 1,032 | — | 1,032 | — | — | — | structural |
| imports | 953 | 953 | — | — | — | — | import_based |
| exports | 195 | 195 | — | — | — | — | structural |
| overrides | 184 | 22 | — | — | — | **162** | structural / inferred |
| extends | 126 | 126 | — | — | — | — | structural |
| implements | 69 | 69 | — | — | — | — | structural |

`uses` is **83.5 % at the 0.7 floor and classed `inferred`** — the same shape the doc flags for
the aspnetcore draw (73 %). This is a real, large, declared-heuristic class.

---

## 4. The one unexplained row, adjudicated

At 200 files the differential reports 3 unexplained (0.015 % of 19,981 analyzer edges). All three
are adjudicated here rather than left as a number.

**(a) `contains | FullName -> GetFullName`** —
`powershell/src/System.Management.Automation/engine/DataStoreAdapterProvider.cs`.

The source (lines 50–54) is:

```csharp
internal string FullName
{
    get
    {
        static string GetFullName(string name, string psSnapInName, string moduleName)
```

`GetFullName` is a **static local function inside a property accessor**. The analyzer publishes it
(`function` symbol, owner `FullName`, `contains FullName -> GetFullName`); the oracle's
`deriveCSharpContains` branch for `local_function_statement` (`differential.ts:9807-9819`) climbs
to the nearest **`method_declaration` / `constructor_declaration` / `local_function_statement`**
ancestor to find the owner — and **never considers `property_declaration` or `accessor_declaration`**.

I verified the analyzer's half behaviourally (the `function | Helper | owner=M` probe above), and
the doc's own convention supports the analyzer: it states that *"csharp's parentContext.rawName||global
is the family precedent"* and that non-function contexts attribute to the innermost **enclosing
class**. Here `FullName` is a property whose accessor contains the local function; the analyzer
attributes to the property, the oracle to nothing.

**Disposition: ORACLE-SIDE, and the analyzer is right.** A local function declared inside a
property accessor is genuinely contained by that property. This is the same class as CS-D9,
CS-D10, CS-D10b and the field-initializer round: **the truth was the defective party.** It is a
one-branch fix in `deriveCSharpContains` (add `property_declaration` / `accessor_declaration` /
`indexer_declaration` to the ancestor climb).

**(b) `references | LoopCompiler -> StrongBox` and `LoopCompiler -> InterpretedFrame`** —
`powershell/src/System.Management.Automation/engine/interpreter/LoopCompiler.cs:27`.

The source is:

```csharp
using LoopFunc = Func<object[], StrongBox<object>[], InterpretedFrame, int>;
```

A `using` **alias** whose target is a generic type. The analyzer's D3 rule (documented at length,
`:1361-1385` and `:490-519`) publishes the module as `Func` **plus one `references` edge per type
argument**, marked `using_type_argument`. So it emits `Func`, `object[]` (silenced as predefined),
`StrongBox<object>` → `StrongBox`, `InterpretedFrame`, and `int` (silenced). The oracle's
`deriveCSharpUsingReferences` (`differential.ts:10734`) pushes **only** `t.module` and never
iterates `t.typeArguments`.

**Disposition: ORACLE-SIDE, and the analyzer is right** — and this is the higher-value finding,
because the oracle and the analyzer **share** `csharpUsingDirectiveTarget`, so the oracle *has*
`typeArguments` in hand and discards them. The fix is two lines (`for (const a of t.typeArguments)
push references`). It matters because `using_type_argument` is **pinned by a fixture**
(`generic-name-positions`, `using-tuple-alias`) and by two F4 mutants — so the contract exists on
the analyzer side with no truth behind it, which is precisely the "compared with no truth" state
the lane warns about.

**Adjudicated totals:** 3 unexplained → **0 analyzer defects, 3 oracle gaps (2 causes)**.
The 60-file run shows only 1 of them (the `contains` row); the other two appear at 200.

---

## 5. Discrepancies between the documentation and the tree

The doc is 1,630 lines covering thirteen rounds, and most of it is accurate and unusually honest.
But it has drifted at HEAD in both directions. Ranked by how much a reader would be misled:

### 5.1 Things the doc reports as OPEN that are now CLOSED

| doc claim | tree at HEAD |
|---|---|
| "M60 DERIVATION: **1 finding**: `overrides`" | **4/4 checks clean**, 0 findings |
| "Section A of the completeness gate **fails**" (whole section) | **8/8 PASS**, 217 types classified |
| "`overrides` remains excluded on both sides under C923" | **compared on both sides**; symmetry gate says `compared: true` |
| "compared set widened 4 → 7" | **10 labels** compared (adds exports, imports, overrides) |
| "`pool-worker.ts` **80-character leaf cap** deletes legal identifiers" | **cap removed** — replaced by a shape test (`pool-worker.ts:1013+`) |
| "`r` and `lua` are unregistered → fixture-lane gate exits 6 for everyone" | **both registered** (`run-fixtures.ts:89-90`); full run passes |
| "F3 **19/19**" | **26/26** |
| "F1 refs=107" | **refs=110** |
| "symbols FAIL — **2 rows**" | **FAIL — 8 rows** (different population) |

### 5.2 Things the doc reports that are still true and worth restating

- `--lang=csharp` **does** silently run all 50 lanes (verified: 2,003 fixtures across 50 lanes).
  `--lang csharp` is the correct form.
- `firing-check-v2.mjs` **still has no CSHARP lane** (`CSHARP: null`, line 178). The lane worked
  around it with its own `csharp-firing.ts`, which is the right local fix and is documented in
  that file's header.
- `verify-csharp-no-regex.ts` **is still a silent pass under `npx tsx`** (`import.meta.main`
  guard); it prints under `bun`.
- `script/m14/csharp-ruled.ts` **still does not exist**, so `ontology-coverage-gate csharp`
  cannot reach a verdict. (I could not run that gate to confirm the consequence: it dies with
  `Incompatible language version 0` on this host, a **known shared-harness import-order issue**
  documented in `docs/analyzers/kotlin.md` and `lua.md`, not a C# defect.)

### 5.3 Citations that resolve to nothing

The doc cites measurement artifacts that are **absent from the tree**:

| cited | state |
|---|---|
| `validation/m14/measurements/csharp-emission-census-whole.json` | **MISSING** |
| `validation/m14/measurements/csharp-grammar-nodes.json` | **MISSING** |
| `validation/m14/verification/CSHARP-VERDICT-2026-10-21.md` | **MISSING** (never existed in git) |
| `validation/m14/verification/CSHARP-FIX.md` | **MISSING** (never existed in git) |
| `validation/m14/verification/CSHARP-D7.md` | **MISSING** (never existed in git) |
| `validation/m12/results/csharp-corpus-sample.txt` | **MISSING** |

The first two are load-bearing: the three **rulings** (`decorates` ontological, `mixes_in`
grammar-side, `part_of` informational) and the `renders` corpus-unexercised claim all cite
`csharp-grammar-nodes.json` and `csharp-emission-census-whole.json` for their counts. Those counts
(52,205 attribute sites; 3,312 extension methods; 1,873 `partial` sites) are **unverifiable from
this checkout** — the rulings may well be correct, and the grammar half is independently
corroborated by F1's 0-unknown audit, but the *population* half cannot be checked.

Two analyzer-header citations are also wrong: `engine.ts:1189` is the **julia** case (csharp's
wasm resolves at **`:1210`**), and `language-detection.ts:170` is correct.

---

## 6. What the lane is genuinely good at

This belongs in a review, not only the defects.

1. **The oracle is treated as a suspect, not an authority.** Five separate rounds (CS-D9, CS-D10,
   CS-D10b, D4, D5, plus the field-initializer round) found the *truth* defective. The lane
   states the structural reason F3 cannot catch this: *"F3 asserts what the analyzer emits, so a
   perfect analyzer passes every fixture while the oracle judging it lies."* That is the correct
   epistemology and it is rare.
2. **Every ruling carries a count and a falsifier.** `incoming-declaration.json` decomposes
   707,171 non-resolved edges into seven causes that sum exactly, each with a named falsifier and
   a `resolution_caveats` block that says which direction the bias runs.
3. **The confidence model is honest about its own floor.** 88 % of `overrides` at 0.5 and 83.5 %
   of `uses` at 0.7 are *declared*, not hidden, and `evidenceClass: inferred` is used rather than
   dressing a guess as `structural`.
4. **The differential reports its own limits.** It refuses to write the canonical artifact from a
   scoped run; it declares `heuristic` separately from `unexplained` so a low-confidence edge is
   never charged as a fabrication; it publishes `BB_DBG_UNEXP` so an unexplained row prints its
   shape rather than only its count.
5. **The lane owns its missing instrument.** Rather than editing master-owned
   `firing-check-v2.mjs`, it wrote `csharp-firing.ts` and documented exactly why.

---

## 7. Verdict

**The analyzer: PASS, with three caveats.** 10/10 relationship types fire; F1, F3, F4, F5, F6,
SPEC, oracle-regression, symmetry, completeness and M60 derivation are all green at HEAD. The
C# lane is one of the better-instrumented lanes in this repository, and the doc's thirteen rounds
of self-correction are the reason.

**The three caveats:**

1. **`verify-csharp-symbols` is RED (8 rows) and the doc under-reports it as 2.** Every row is
   the same deliberate conversion-operator spelling, so it is not a code defect — but "2 rows,
   pre-existing" is not a description of the current population, and a gate that is red for a
   reason nobody re-checks is a gate that stops being read.
2. **The resolution rate is 44.0 % and no document says so.** Not a defect: 40.5 % ambiguous +
   14.5 % unresolved, all decomposed with causes. But the only number on the lane's page is a
   200-file `95.6 %` with a different denominator, and a reader will take it as the resolution
   rate.
3. **Three oracle gaps remain** (1 `contains` cause, 2 `references` causes), all three
   adjudicated here as **oracle-side with the analyzer right**. Two are one-line fixes.

**Nothing I found suggests the analyzer is wrong about the code it reads.** What needs work is the
*reporting layer*: three stale claims in the doc's favour, six dead citations, one stale severity,
and one missing headline number.

---

## 8. Recommended next actions, in order

| # | action | why this first | scope |
|---|---|---|---|
| 1 | State the resolution rate on `csharp.md`, with its denominator and the seven-cause partition | It is the largest gap between what the lane knows and what a reader can learn; it changes no code | `docs/analyzers/csharp.md` only |
| 2 | Re-disposition `verify-csharp-symbols` as an explicit, pinned exception (or adopt `op_Explicit`/`op_Implicit` with the oracle moved in the same commit) | A permanently red gate stops being read; the current text ("2 rows") is stale in the direction that flatters | gate or analyzer+oracle |
| 3 | Fix `deriveCSharpContains`: add `property_declaration` / `accessor_declaration` to the local-function owner climb | One branch; removes 1 of 3 unexplained; analyzer is right | `script/m14/differential.ts` |
| 4 | Fix `deriveCSharpUsingReferences`: push `t.typeArguments` | Two lines; removes 2 of 3 unexplained; the shared helper already returns them; `using_type_argument` is fixture-pinned with no truth | `script/m14/differential.ts` |
| 5 | Refresh the doc's gate table (F1 110, F3 26/26, completeness 8/8, M60 4/4, 10 compared labels) and delete the three superseded sections | Everything else in the doc is accurate; these actively mislead | `docs/analyzers/csharp.md` only |
| 6 | Re-materialize `csharp-grammar-nodes.json` and `csharp-emission-census-whole.json` (or re-point the rulings at a durable artifact) | Three rulings and the `renders` claim cite counts that cannot be checked here | lane artifacts |
| 7 | Correct `engine.ts:1189` → `:1210` in both the doc and the analyzer header | A citation that resolves to julia is worse than no citation | doc + header |

Items 1, 5 and 7 are pure documentation and can land together. Items 3 and 4 are two small
oracle fixes that should land **together** (same file, same class of defect, one re-run of F5).
Item 2 is a decision, not a task — it is the owner's call which of the two dispositions is right.