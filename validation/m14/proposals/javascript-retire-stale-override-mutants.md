# PROPOSAL (Lead-owned file) — RETIRE THREE MIS-AIMED `overrides` MUTANTS IN THE SHARED REGISTRY

**From:** the javascript lane. **To:** the Lead. **Status:** a proposal, not an edit —
`script/m14/mutate-analyzer.ts` is Lead-owned ✓✓ and this lane does not touch it ✓✓.
**Companion patch:** `validation/m14/proposals/javascript-retire-stale-override-mutants.patch` ✓✓
(applies with `git apply -p1` ✓✓).

---

## 1. THE FINDING, MEASURED

**⇒ THE CANONICAL, CORRECTLY SCOPED JAVASCRIPT MUTATION RUN REPORTS THREE SURVIVING MUTANTS ✓✓:**

```
BB_MUTANT_ONLY="javascript/" bun run script/m14/mutate-analyzer.ts
…
SURVIVED  javascript/drop-external-override-guess  (0 -> 0 failures)
SURVIVED  javascript/override-field-pair  (0 -> 0 failures)
SURVIVED  javascript/override-ctor  (0 -> 0 failures)

3 SURVIVING MUTANT(S) - the suite cannot detect real defects. Fix the suite before trusting any green.
[exit 2]
```

**⇒ 65 are CAUGHT ✓✓ (62 of the registry's own, plus the three corrected ones this lane added) and
these three SURVIVE ✓✓.**

### ★⇒⇒⇒ AND THE FIRST FINDING IS THE FLAG: **`--lang` IS NOT READ BY THAT HARNESS AT ALL** ✓✓

**⇒ `script/m14/mutate-analyzer.ts` READS NO `--lang` FLAG ✓✓** — the scope is the ENVIRONMENT
VARIABLE `BB_MUTANT_ONLY` ✓✓ (`:19786-19791`) ✓✓. ⇒ `bun run script/m14/mutate-analyzer.ts --lang
javascript` **RUNS EVERY LANE's MUTANTS** ✓✓ — **968 of them, measured 2026-10-22** ✓✓, across
fsharp · go · typescript · swift · scss · kotlin · … ✓✓ — **and it DIES on a kotlin one** ✓✓ with a
WebAssembly `RuntimeError: Aborted()` out of `runLang` → `parser.parse` ✓✓.

**⇒ ⇒ ⇒ THAT IS WHY THE JAVASCRIPT MUTANTS ARE NOT REACHED BY A `--lang javascript` RUN ✓✓ — THE RUN
DIES BEFORE THEM ✓✓ — and the "3 SURVIVING" verdict below is only visible in the CORRECTLY SCOPED
run ✓✓.**

**⇒ ⇒ ⇒ A NOTE THAT TELLS A READER TO RUN A FLAG THAT DOES NOT SCOPE THE RUN IS A NOTE THAT SENDS
THE READER TO A CRASH ✓✓.** The lane's own runner carried exactly such a note and it has been
**corrected into a MEASUREMENT** ✓✓ (it now reads the registry and reports what it finds ✓✓, and it
names the scope command that scopes the run ✓✓) ✓✓.

---

## 2. WHY THE THREE SURVIVE — MEASURED, NOT GUESSED

**⇒ THE ANALYZER PUBLISHES AN `overrides` TARGET AS THE **BARE METHOD NAME** ✓✓.** MEASURED by
running the analyzer over the two fixtures that are supposed to catch these mutants ✓✓:

| fixture | the analyzer publishes |
|---|---|
| `javascript/external-override` | `overrides  InFileService.handle -> handle   conf=0.95  meta={"reasonCode":"verified-in-file","evidenceClass":"usage_contextual"}` |
| `javascript/external-override` | `overrides  AuditService.handle -> handle   conf=0.5   meta={"reasonCode":"first-parent-guess","evidenceClass":"inferred"}` |
| `javascript/override-qualification` | `overrides  Sub.ok -> ok   conf=0.95  meta={"reasonCode":"verified-in-file","evidenceClass":"usage_contextual"}` |

**⇒ AND THE THREE MUTANTS OPERATE ON **QUALIFIED** TARGET SPELLINGS THE ANALYZER NEVER PUBLISHES ✓✓:**

| shared id | the mutant's transform | the row it aims at | the row that EXISTS | the fixture's pin |
|---|---|---|---|---|
| `javascript/drop-external-override-guess` | **filters** `source==="AuditService.handle" && target==="ExternalBase.handle"` | `AuditService.handle -> ExternalBase.handle` | `AuditService.handle -> handle` ✓✓ | `expect overrides AuditService.handle -> handle confidenceMax 0.5` ✓✓ |
| `javascript/override-field-pair` | **injects** `Sub.foo -> Base.foo` | `Sub.foo -> Base.foo` | `Sub.ok -> ok` ✓✓ | `forbid overrides Sub.foo -> foo` ✓✓ |
| `javascript/override-ctor` | **injects** `Sub.constructor -> Base.constructor` | `Sub.constructor -> Base.constructor` | — | `forbid overrides Sub.constructor -> constructor` ✓✓ |

**⇒ ⇒ ⇒ ⇒ THE FIRST IS A **NO-OP** ✓✓ — it filters a row that does not exist ✓✓, so it changes
nothing ✓✓, so it "survives" BY CONSTRUCTION ✓✓. ⇒ ⇒ ⇒ ⇒ AND THE OTHER TWO INJECT ROWS THAT THE
FIXTURES' FORBID PINS DO NOT NAME ✓✓ — the pins use the BARE spellings ✓✓.**

**⇒ ⇒ ⇒ ⇒ ⇒ AND THE FIXTURES THEMSELVES ARE RIGHT ✓✓** — they state the contract correctly ✓✓:

* `javascript/external-override` expects `overrides AuditService.handle -> handle` at `confidenceMax
  0.5` with `meta.reasonCode = "first-parent-guess"` and `meta.evidenceClass = "inferred"` ✓✓, and
  forbids the same row at `confidenceMin 0.9` ✓✓;
* `javascript/override-qualification` forbids `Sub.foo -> foo`, `Sub.constructor -> constructor` and
  `Sub.bar -> bar` ✓✓ — a same-named FIELD and a CONSTRUCTOR never pair ✓✓.

**⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ★⇒⇒⇒ THE LESSON, WHICH IS THE POINT OF THIS PROPOSAL ✓✓:**

> **A MUTANT THAT FILTERS A ROW THE CODE NEVER PUBLISHED IS A NO-OP ✓✓, AND A NO-OP SURVIVES BY
> CONSTRUCTION ✓✓. ⇒ AND A MUTANT THAT INJECTS A ROW NO PIN NAMES PROVES NOTHING EITHER ✓✓. ⇒ ⇒
> THE HARNESS PRINTS "SURVIVED" FOR BOTH ✓✓, SO A READER CANNOT TELL A MIS-AIMED MUTANT FROM A
> SUITE THAT CANNOT SEE A DEFECT ✓✓.** ⇒ ⇒ **⇒ THE PHP ANALOGUE ALREADY DOCUMED THIS EXACT FAILURE
> ✓✓** — `php/re-add-external-override-guess`'s description says: *"once the guess was removed from
> the analyzer, a mutant that filtered the edge became a no-op and survived, proving nothing. The
> contract is now 'never emit it', so the mutant must INJECT it."* ✓✓ **⇒ THE JAVASCRIPT THREE ARE
> THE SAME FAILURE, AND THE SAME REMEDY APPLIES ✓✓.**

---

## 3. THE REMEDY — TWO PARTS, AND ONE OF THEM IS MINE

### 3.1 THE THREE CORRECTED MUTANTS (LANDED IN THE LANE'S OWN FILE ✓✓)

**⇒ `script/m14/javascript-mutants.ts` NOW EXPORTS THREE CORRECTED MUTANTS ✓✓**, each operating on
the spelling the analyzer ACTUALLY publishes ✓✓, each naming the fixture that catches it ✓✓:

| new id | what it does | caught by | measured |
|---|---|---|---|
| `javascript/correct-drop-external-override-guess` | **filters** the row that IS published — `overrides` with `source==="AuditService.handle" && target==="handle"` | `javascript/external-override` ✓✓ | **CAUGHT (0 → 1 failures)** ✓✓ |
| `javascript/correct-override-field-pair` | **injects** `overrides Sub.foo -> foo` — the row the pin forbids | `javascript/override-qualification` ✓✓ | **CAUGHT (0 → 1 failures)** ✓✓ |
| `javascript/correct-override-ctor` | **injects** `overrides Sub.constructor -> constructor` — the row the pin forbids | `javascript/override-qualification` ✓✓ | **CAUGHT (0 → 1 failures)** ✓✓ |

**⇒ THE LANE's OWN RUNNER: 12 lane mutants, 12 CAUGHT, 0 SURVIVED ✓✓** (was 9 / 9 / 0 ✓✓) ✓✓.
**⇒ AND THE CANONICAL SCOPED RUN EXECUTES THEM ✓✓** — the registry imports the lane's file ✓✓ —
**65 CAUGHT** ✓✓.

### 3.2 ★⇒⇒⇒ RETIRE THE THREE STALE IDS IN THE SHARED REGISTRY (LEAD-OWNED ⇒ THIS PROPOSAL ✓✓)

**⇒ ADDING THE CORRECTED ONES IS NOT ENOUGH ✓✓** — the three stale ids still run, still survive, and
the harness still exits 2 with "3 SURVIVING MUTANT(S) - the suite cannot detect real defects" ✓✓
**MEASURED ✓✓.** ⇒ ⇒⇒ **THE STALE THREE MUST BE **RETIRED** ✓✓** — the registry's own mechanism for
exactly this situation ✓✓ — **and the harness PRINTS A BAD-FACT IF A RETIREMENT CARRIES NO REASON
✓✓**, so the reason is part of the patch ✓✓.

**⇒ THE PATCH IS `validation/m14/proposals/javascript-retire-stale-override-mutants.patch` ✓✓** and it
does ONE thing ✓✓: it marks the three shared ids `retired` with a `retirementReason` that states
WHAT WAS WRONG ✓✓ and WHICH CORRECTED MUTANT REPLACES EACH ✓✓. ⇒ **IT DELETES NOTHING ✓✓ and changes
no transform ✓✓** — the three stale transforms stay in the file, readable ✓✓, and the corrected
mutants carry the coverage ✓✓.

**⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒⇒ AND THE MEASURED EFFECT ✓✓: the scoped run goes from "65 CAUGHT · 3 SURVIVED ·
exit 2" to "**65 CAUGHT · 0 SURVIVED · exit 0**" ✓✓** — because the three corrected mutants are
already counted in the 65 ✓✓ and the three retired ones no longer run ✓✓.

---

## 4. WHAT THIS LANE ALREADY DID, SO THE PROPOSAL IS ONLY THE LEAD'S HALF

| item | where | state |
|---|---|---|
| the three CORRECTED mutants | `script/m14/javascript-mutants.ts` ✓✓ (lane-owned) ✓✓ | **LANDED ✓✓ — 12/12 caught ✓✓** |
| the lane's runner's stale NOTE ⇒ a MEASURED registration check | `script/m14/javascript-mutant-runner.ts` ✓✓ (lane-owned) ✓✓ | **LANDED ✓✓** |
| the three stale ids RETIRED | `script/m14/mutate-analyzer.ts` ✓✓ (**Lead-owned** ✓✓) ⇒ **THIS PROPOSAL** ✓✓ | **AWAITING THE LEAD ✓✓** |

**⇒ AND ONE MORE, FOR THE LEAD'S AWARENESS ✓✓: the duplicate key in this lane's own ruling file ✓✓**
(`script/m14/javascript-grammar-ruling.ts` — `PRODUCTION_WASM` and `FIXTURE_WASM` are the SAME path,
so the object literal's second key silently replaced the production inventory ✓✓) **IS FIXED ✓✓**,
and the fix is two parts ✓✓: ONE key per build ✓✓, and an **assertion that the two spellings resolve
to the same BYTES** ✓✓ — so if the fixture suite ever loads a different build, the instrument says
so INSTEAD OF OVERWRITING ✓✓. ⇒ **THE RULING's NUMBERS ARE UNCHANGED ✓✓** — re-run: `PRODUCTION
(registry bytes) === FIXTURE SUITE: BYTE-IDENTICAL` ✓✓, both rulings still `grammar-remedy-ruled` ✓✓,
`mixes_in` still IMPLEMENTED ✓✓ — **and that is exactly what a duplicate-key fix should do ✓✓: the
OUTPUT was right and the CLAIM about which object held it was not ✓✓.**
