# real-r-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-r-analyzer.ts`
- Grammar: `grammars/tree-sitter-r/grammar.js` (vendored), built to
  `wasm/tree-sitter-r.wasm`
- Parser: pinned `tree-sitter-r` WASM at `wasm/tree-sitter-r.wasm`
- Wiring: `ASTEngine.getAnalyzer("r")` -> `RealRAnalyzer`
- Corpora: **13 repositories, 1,890 files** measured in this pass —
  `dplyr`, `ggplot2`, `usethis`, `nvim-treesitter`, `r-Rcpp`, `r-air`, `r-cli`,
  `r-pkgdown`, `r-rlang`, `r-scales`, `r-testthat`, `r-vctrs`, `r-withr` under
  `$HOME/fixtures/repositories`. Nine of the thirteen were cloned for
  this pass; the corpus held four and 637 R files at handover. Earlier revisions of
  this document measured `dplyr`, `Matrix`, `ggplot2`, `shiny`, `testthat`.
  <!-- provenance: find-grammar-provenance -->
  Provenance of the shipped bytes: the shipped grammar is a **PATCHED** build, so it
  is no longer byte-identical to any published artifact. Its **base** was established by
  byte-identity before the patch: the bytes this repo shipped were byte-identical to
  `@eagleoutice/tree-sitter-r@1.1.2` (sha256 `b11a872a88ad8a9e…`). The hex-float rule
  below was then changed and the grammar rebuilt, which is why a fresh
  `find-grammar-provenance` run now reports no byte match — and that is the correct
  result, not a regression. Evidence: `validation/m60/results/G-PROVENANCE.json`.
- Corpus: clean `dplyr@d5e94e7f` tracked R sources

The shipped grammar is a **patched** tree-sitter-r. The base is
`@eagleoutice/tree-sitter-r@1.1.2` (its published `tree-sitter-r.wasm` was

byte-identical to the one this repo shipped). **Two** rules were changed — the
hex-float literal and the `..N` identifier — both because the grammar mis-parsed
code R itself accepts. See [Grammar](#grammar-two-patches) below.


## Grammar: two patches

```
_hex_literal: $ => /0[xX][0-9a-fA-F]+/          # before
```

R parses every numeric literal with `strtod(3)`, so it accepts the C99
hexadecimal-float form `0x<hexdigits>[.<hexdigits>]p[+-]<decimals>` — where the
binary exponent is mandatory. The rule above knew only the integer-hex form, so the
lexer stopped at `0x1` and the remainder was re-read as an identifier plus an
addition. Two failure shapes, both wrong:

| Source | Before | After |
| --- | --- | --- |
| `v <- 0x1p+53` | `v <- 0x1` **and** `p + 53`, `hasError=false` | one `float` `0x1p+53` |
| `mn <= 0x1p+53` | `ERROR` on `0x1` plus a stray `p + 53` | clean `float` |
| `0x.8p1` | `0` and a fabricated identifier `x.8p1` | one `float` |
| `0xABp-2` | `0xAB`, `p`, `2` | one `float` |

The first row is the dangerous one: it is a **silent misparse with no error
anywhere**. `Matrix` — CRAN recommended, written by R Core — writes `0x1p+53` in
8 places, so this was reachable from ordinary R.

The fix is `_hex_literal_exponent` (C99 form) chosen before `_hex_literal_plain`
(integer-hex form). `1e`-style exponents were also tightened from `[eE][+-]?\d*`
to `[eE][+-]?\d+`, because R's own scanner requires the digits and `\d*` let
`1east` lex as the float `1e` followed by `ast`.

### Patch 2 — `..N` stole a prefix of a longer identifier

`dot_dot_i` matched `/[.][.]\d+/` at a **positive rank**, so the lexer took `..2`
out of `..2dge` and left `dge` behind: two sibling nodes, and a declaration
published under the wrong name.

R accepts `..2dge` as one identifier — verified on R 4.4.3: `..2dge <- 1; ls()`
yields `..2dge`.

Rust's regex has no lookahead, so "digits NOT followed by an identifier character"
cannot be written directly. It is expressed as the complement: an alternative
**inside the `identifier` token** that requires at least one trailing identifier
character and is ranked above `dot_dot_i`. It must live inside `identifier` — a
separate rule is not in the valid-token set where an expression may start, which
is exactly where the split happened (the first attempt put it beside `identifier`
and changed nothing). `..1` and `..2` still lex as `dot_dot_i`; `..2dge` and
`..foo` are single identifiers.

That one occurrence — a deprecated alias in `Matrix/R/zzz.R` — was the **only
missed binding** in the R-oracle differential, and fixing it took recall from
0.999886 to 1.000000.

### A note on the A/B

**Measured, both builds from the same toolchain (tree-sitter-cli 0.24.7) so the
delta is the patch and nothing else:** ERROR/MISSING nodes over the 1,174 corpus
files **15 -> 3**; Matrix **12 -> 0**; 4 files improved, **0 regressed**;
0 analyzer output changes (the affected code is inside function bodies whose
symbols were already extracted, so the patch is pure correctness). The 3
remaining are correct failures: `shiny/inst/app_template/app.R` is a Go
text/template file that ships inside the package, and testthat's
`tests/.../test-error-1.R` is a deliberate syntax-error fixture. Node-type and
field sets are otherwise unchanged (2 new hidden tokens, 0 named types, 0 fields).

## Symbol contract

| Construct | Symbol | AST rule |
| --- | --- | --- |
| `name <- function() {}` | `function` | `binary_operator`, `operator` in {`<-`,`<<-`,`=`,`->`,`->>`}, target side is an `identifier` |
| `generic.class <- function() {}` | `method` | same, name has a `.` at index > 0 |
| `` `weird name` <- 1 `` | `variable` | same, one backtick pair stripped from the identifier text |
| `R6Class(...)` / `R6::R6Class(...)` / `R6:::R6Class(...)` | `class` | assignment whose value call resolves, via the `rhs` field, to `R6Class` |
| R6 `public=`/`private=`/`active=` entry, function value | `method` | named `argument` in a `list(...)` under that argument |
| R6 `public=`/`private=` entry, non-function value | `property` | same entry — the class's data members |
| `setRefClass(...)` `fields=` entry | `property` | named `argument` in a `list(...)` |
| `setRefClass(...)` `methods=` entry, function value | `method` | same |
| `setClass("Name", ...)` | `class` | first string argument of the call |
| S4 `slots = c(a = "...")` | `property` | named arguments inside the `c(...)` call, ranged at the **name node** |
| S4 `representation(a = "...")` | `property` | the call's own named arguments; this is an **unnamed** argument (R tag syntax) |
| `setGeneric("name", function(x) ...)` | `function` | first string argument; the generic body's parameters are attached |
| `setMethod("name", "Class", function...)` | `method` | first and second string arguments; owner is the class |
| `setMethod("name", signature("Class", "missing"), ...)` | `method` | owner read from inside the `signature(...)` call |
| `setValidity("Class", function...)` | `method` named `validity` | first string argument |
| `S7::new_class("Name", parent=, properties=)` | `class` | assignment whose value call resolves to `new_class` |
| S7 `properties = list(a = class_double)` | `property` | named arguments of that `list` |
| `S7::method(generic, Class) <- function...` | `method` | assigned name is a **call**, not an identifier |
| other module-level identifier assignment | `variable` / `constant` | target side is an `identifier`; all-uppercase names are constants |

Not declarations: assignments inside any function body (R has no block scope, so
these are execution locals), field mutations (`$`/`@` targets), subset targets,
`obj@slot <- v` / `obj$field <- v`, anonymous function expressions, and
parameters.

### Assignment direction

`->` and `->>` bind **only their right operand**. The left side is always a
value. This is R's own rule, measured on R 4.4.3 rather than assumed:

| Form | R |
| --- | --- |
| `2 -> b` | OK, binds `b` |
| `2 ->> cc` | OK, binds `cc` |
| `identity(1) -> gg` | OK, binds `gg` |
| `bb -> 2` | **Error: invalid (do_set) left-hand side to assignment** |
| `cc ->> 2` | **Error** |

So `e -> 6` publishes **nothing**, and that is correct: R refuses to evaluate it.
`F13-invalid-r.R` asserts exactly that.

R desugars both rightward forms to `<-`(value, name) at parse time, so a name on
the left of `->` is not a declaration. tree-sitter-r does **not** desugar — it
keeps `->` as an operator — which is why the two sides must be distinguished here
and why an oracle reading R's AST must not.

**This corrects an error in an earlier revision of this review**, which read
"whichever side is an identifier" and published `variable e` for `e -> 6`. The
fixture suite could not catch it, because the fixture asserting that behaviour had
been written to match the same wrong belief. R 4.4.3 could, and did.

### Parameters

The default lives in the grammar's `default` field. `Parameter.defaultValue` is
populated with the default expression, and `isOptional` is its presence. A rest
parameter (`...`) arrives as a `parameter` whose `name` field is a `dots` node and
is marked `isRest`.

## Relationship ontology — all ten types, measured

Every number in this section comes from **production `parseFile`**
(`src/ast/pool-worker.ts`), never from `analyze()`. `analyze()` is a per-file
unit that skips the noise filter, the relationship filters, truncation and the
enhancement stages, and one measurement in this document's own history turned on
exactly that difference (see *An audit whose baseline cannot be named*). The
harness is `validation/m14/fixtures/r/census.ts`; its committed output is
`validation/m14/fixtures/r/census-evidence.json`; its per-type verdicts with the
instrument behind each are in `validation/m14/fixtures/r/rulings.json`.

**Corpus.** 13 repositories, **1,890 files**, sampled as every git-tracked file
the ROUTER (`src/ast/language-detection.ts` `detectLanguageFromPath` — the same
call the indexer makes) maps to `r`, per repo, in `git ls-files` order, first
250 per repo. That is a deterministic prefix, not a random draw: the only bias is
the truncation, and the four repos under the cap are admitted whole. Nine of the
thirteen repositories were cloned by this lane (`r-Rcpp`, `r-air`, `r-cli`,
`r-pkgdown`, `r-rlang`, `r-scales`, `r-testthat`, `r-vctrs`, `r-withr`); the
corpus held four R repositories and 637 R files at handover. One clone was
**rejected rather than counted**: `r-dplyr` turned out to be the same commit as
the pre-existing `dplyr` (`d5e94e7fa8fd4a5f79c1a707d1842216bb4c691f`) and was
deleted, because a census that counts one package twice reports a larger sample
than it measured.

| Corpus | repos | files |
| --- | --- | --- |
| at handover | 4 (`dplyr`, `ggplot2`, `usethis`, `nvim-treesitter`) | 637 |
| this pass | 13 | **1,890** |

### The ten verdicts

Every type is **EMITTED**. `uses` was not, at handover, and the reason it was
believed inapplicable is the most useful thing in this document — see
*`uses` was RULED-UNJUSTIFIED*.

| Type | Verdict | Edges | Files | Confidence | Instrument |
| --- | --- | --- | --- | --- | --- |
| `calls` | EMITTED | 41,565 | 1,890 | 1.0: 40,017 · 0.7: 1,548 | census |
| `uses` | EMITTED (was a GAP) | 3,823 | 1,890 | 1.0: 3,606 · 0.7: 217 | probe-surfaces (B) |
| `contains` | EMITTED | 13,431 | 1,890 | 1.0: 13,431 | census |
| `imports` | EMITTED | 1,925 | 1,890 | 1.0: 1,726 · 0.8: 199 | census |
| `references` | EMITTED | 280 | 1,890 | 1.0: 79 · 0.8: 201 | census |
| `exports` | EMITTED | 3,491 | 1,890 | 1.0: 3,491 | census |
| `extends` | EMITTED | 58 | 1,890 | 1.0: 58 | census |
| `implements` | EMITTED | 1,015 | 1,890 | 0.8: 1,015 | census |
| `overrides` | EMITTED | 13 | 2 | 0.95: 13 | probe-classes (B) |
| `instantiates` | EMITTED | 1 | 1 | 0.9: 1 | probe-classes (B) |

Total **65,602** relationships over **22,479** symbols. These are the figures in
the committed `census-evidence.json`. **Two earlier runs of the same analyzer over
the same 13 repositories reported 65,600/22,478 and 61,632/22,449**, because the
wasm grammar exhausts memory on a different file each time — see *What this lane
cannot claim*. The per-label gate counters were identical across runs
(`memberReadsSuppressedByCall` 2,314 in every one), so the variation is in the
`memory access out of bounds` files and not in the rule.

**0** relationships carry no
`line_number`; **0** carry line 0; **0** have an endpoint equal to the literal
`unknown`; **0** symbols have an empty name; **0** symbols have an empty or
`unknown` kind. Symbol kinds observed: `variable` 13,267 · `function` 7,458 ·
`method` 1,407 · `property` 210 · `class` 99 · `constant` 38.

### The population census — 2,184 files, and all ten types firing

The table above is a **sample**: first 250 files per repository, 13
repositories, 1,890 files. The census below removes the cap and admits every
git-tracked file the production router maps to `r` — **2,184 files across 16
repositories**, no sampling, no truncation. Harness
`validation/m14/fixtures/r/ontology-ten-types.ts`; committed output
`validation/m14/fixtures/r/ontology-ten-types.txt`.

The reason the sample had to be replaced is a measurement, not a preference.
`validation/m14/measurements/firing-sweep-26-lanes.ndjson` records this lane at
**8/10** over a 120-file draw, with `overrides` and `instantiates` at zero
edges. The draw picked mostly `dplyr` / `testthat` / `ggplot2` files, which are
functional and carry no in-file class hierarchy; R's object systems live in
`R6` (27 files), `S7` (61) and `Matrix` (80), and those files are a small share
of any prefix. Over the population:

| Type | Edges | Files | 120-file draw | Verdict |
| --- | --- | --- | --- | --- |
| `calls` | 48,233 | 1,294 | fires | EMITTED |
| `uses` | 4,810 | 584 | fires | EMITTED |
| `contains` | 17,634 | 1,874 | fires | EMITTED |
| `imports` | 2,095 | 1,112 | fires | EMITTED |
| `references` | **2,137** | 1,116 | fires | EMITTED |
| `exports` | 3,592 | 711 | fires | EMITTED |
| `extends` | 351 | 61 | fires | EMITTED |
| `implements` | 1,133 | 221 | fires | EMITTED |
| `overrides` | **107** | **9** | **0** | EMITTED |
| `instantiates` | **3** | **2** | **0** | EMITTED |

Total 80,095 relationships over **29,562** symbols in that run. `references` moved
389 → 2,137 and the total 78,311 → 80,095 (+2.28%) when `::`/`:::` was given the
`references` label it should have carried all along; the measurement and the
reasoning are under **R7** below.

**The wobble is measured across five production walks of this same population, and
it is a property of the parser, not of the analyzer.** Each row is the sum of that
run's own ten per-type rows; the artifacts and the runs whose bytes were not kept
are named so a reader can check them.

| run | instrument | calls | uses | contains | imports | references | exports | extends | implements | overrides | instantiates | total | files lost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `ontology-ten-types.txt` | 48,233 | 4,810 | 17,634 | 2,095 | 2,137 | 3,592 | 351 | 1,133 | 107 | 3 | 80,095 | 0 |
| 2 | `labels-and-resolution.txt` | 48,174 | 4,808 | 17,622 | 2,095 | 2,137 | 3,585 | 351 | 1,133 | 107 | 3 | 80,015 | 1 |
| F | arbiter, output not captured | 48,082 | 4,789 | 17,550 | 2,087 | 2,129 | 3,525 | 351 | 1,133 | 107 | 3 | 79,756 | 5 |
| G | `arbiter/arbiter-r-runG-2026-10-05.txt` | 48,028 | 4,803 | 17,601 | 2,087 | 2,129 | 3,581 | 351 | 1,133 | 107 | 3 | 79,823 | 2 |
| H | `arbiter/arbiter-r-runH-2026-10-05.txt` | 48,206 | 4,810 | 17,629 | 2,093 | 2,135 | 3,588 | 351 | 1,133 | 107 | 3 | 80,055 | 2 |

The cause is named per run, not asserted: the wasm grammar dies with
`[BB-PARSE-ERR] … memory access out of bounds` and WHICH files it dies on changes.
Run 2 lost `usethis/R/badge.R`; run F lost `ggplot2/R/scale-manual.R`,
`r-cli/R/width.R`, `r-cli/exec/news.R`, `r-cli/R/zzz.R` and
`r-testthat/R/expect-equality.R`; run G lost `ggplot2/R/scale-manual.R` and
`usethis/R/course.R`; run H lost `usethis/R/ci.R` and `usethis/R/citation.R`. A file
that fails to parse contributes no edges, so the totals track the failures. The
losses cluster in two repositories — 9 of the 11 across the five runs are `usethis`
or `r-cli` files, and `r-rlang`'s 160 files were walked by every run without one
loss. Every total above is correct for the files its own run walked and none is
correct for the admitted population as a whole; **the observed total band for the
ten types is 79,756–80,095 (Δ339), and every rate in this document inherits that
band on its denominator.** Run 1 walked all 2,184 files with 0 parse failures and 0
degraded parses; run 2 with 0 and 1; runs F, G and H each reported 1 degraded parse,
which is the 120-second bomb substituting a regex extractor.

`extends`, `implements`, `overrides` and `instantiates` are **identical in all five
runs**, which says the wobble is confined to the types whose counts are large enough
to be sensitive to losing a handful of files — not that those four are more correct
than the others.

Integrity on run 1, which walked the whole population: **0** parse failures, **0**
degraded parses, **0** symbols with an empty name, **0** with an empty or `unknown`
kind, **0** relationships with an empty or `unknown` endpoint.

The two types the draw read as zero are located, not asserted:

| Type | Files | Example edges |
| --- | --- | --- |
| `overrides` | `R6/tests/manual/encapsulation.R` (29), `R6/tests/testthat/test-nonportable-inheritance.R` (22), `R6/tests/testthat/test-clone.R` (19), `r-testthat/R/reporter-progress.R` (14), `R6/tests/manual/encapsulation.R` (12), `S7/inst/doc/S7.R` (5), `r-testthat/R/reporter-junit.R` (3), `R6/tests/testthat/test-finalizer.R` (2), `S7/inst/doc/generics-methods.R` (1) | `BC -overrides-> inc_x`, `CC -overrides-> inc_x`, `BC -overrides-> getx` |
| `instantiates` | `R6/tests/testthat/test-clone.R` (2), `r-testthat/R/reporter-silent.R` (1) | `initialize -instantiates-> AC`, `initialize -instantiates-> BC`, `capture_expectations -instantiates-> SilentReporter` |

Every `overrides` edge carries
`relationshipSubType: object_system_method_override`, `overriddenClass` and a
`reasonCode`; every `instantiates` edge carries `isRConstructor: true` and
`reasonCode: declared_class_constructor`. Three `instantiates` edges over the
whole population is a real ceiling, and the reason is structural rather than a
sampling artefact: the rule requires a constructor the FILE declares, so it
cannot fire on a call into another package's constructor.

**The arbiter's own verdict, independently measured.**
`script/m14/r-ruled.ts` registers an EMPTY ruling table for this lane, because
all ten types are emitted and there is nothing left to rule, and
`script/m14/ontology-coverage-gate.ts` `RULED_BY_LANG` carries the two-line
registration:

```
$ npx tsx script/m14/ontology-coverage-gate.ts r
emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0
```

Run twice, and the edge counts differ by 0.2% between the two runs
(`calls` 48,133 then 48,008) because the wasm grammar exhausts memory on a
different file each time — `usethis/R/ci.R` in the first run, `r-cli/R/utils.R`
in the second, each accompanied by `[BB-PARSE-ERR] … memory access out of
bounds` for other files. The gate process then **exits 1 from
`src/ast/engine.ts:1442`**, whose 120-second parse bomb calls `process.exit(1)`
process-wide, *after* the verdict table has printed. Three runs of three
different instruments hung on three different files (`r-cli/R/utils.R`,
`r-testthat/R/evaluate-promise.R`, `usethis/R/ci.R`). That is shared machinery
and is reported, not worked around; the fix belongs in the engine, not here.

### `uses` was RULED-UNJUSTIFIED, and the measurement overturned it

The previous version of this document ruled `uses` inapplicable in these words:

> `uses` is the one universal type R does not emit […] R has no import-binding
> indirection distinct from the dependency itself, `references` and `imports`
> both carry it, and `evidence_tier.ts` already classifies `references` as a
> usage context.

That argument is about **imports**, and it does not reach the construct `uses`
carries. A member read of a value — `obj$member`, `obj@slot`, `df[["col"]]` — is
neither a call nor a package dependency. `self$value` inside an R6 method is not a
dependency on anything: it reads a field of an object that is already in hand.
Neither `references` nor `imports` can carry it, and `evidence_tier` classifying
`references` as a usage context says how an *existing* edge should be read, not
that the edge exists.

The measurement, by instrument B (`validation/m14/fixtures/r/probe-surfaces.ts`,
a parse-tree count over the same 1,890 files):

| surface | occurrences | in callee position | not in callee position |
| --- | --- | --- | --- |
| `extract_operator` (`obj$m`, `obj@s`) | 16,621 | 2,314 | **14,307** |
| `[[` with a string literal index | 549 | 2 | **547** |

**14,854 member reads in 1,890 files, of which the analyzer emitted zero.** That
is the RULED-UNJUSTIFIED shape the ontology workstream describes, and it is
invisible to a differential for the structural reason that workstream names: a
type absent from both the analyzer and the oracle has nothing to disagree about.

### The `uses` rule, and the four gates

`uses` is **a member read of a value**, and the target is the **member name
alone** — never `receiver$member`. That is the name an R6/R5/S4/S7 property
symbol is published under, so the edge joins to a real symbol instead of to a
string that exists nowhere in the graph; the receiver rides in metadata when it is
itself a plain name. It is the same construct the Python lane publishes as `uses`
(`src/ast/real-python-analyzer.ts:1425`, `isMemberRead`) and the Julia oracle
derives as `uses` (`script/m14/oracles/julia-refs.ts`, on `a.b`).

Four gates, each of which exists because the alternative is a false edge, and
each of which is pinned by at least one line of `F17-uses.R` that must produce
nothing. A gate no line exercises is a comment:

1. **not the callee of a call.** `obj$method()` is already a `calls` edge whose
   target is `obj$method`; a second edge to `method` is one fact under two labels,
   which is the `uses`/`calls` confusion the workstream names as its labelling
   question. **Suppressed: 2,314.** The `pkg::obj$fn()` shape is included because
   there the `namespace_operator` holds the call's function field and the
   `extract_operator` is only its `rhs`, so a gate that looks one level up misses
   it.
2. **not the target of an assignment.** `obj$field <- v`, `<<-` and `=` all store
   into the member; `x <- obj$field` reads it. The two sides are read off the
   grammar's `operator` field through the same `assignmentSides` that decides which
   side an assignment binds, so the rule cannot disagree with that one.
   **Suppressed: 1,911.**
3. **the member must be nameable.** A computed right side names no member, and a
   guessed target is the fabrication the workstream calls its most expensive
   mistake. **Suppressed: 26.**
4. **an enclosing named symbol must exist** — the same attribution rule `calls`
   uses, including the 0.7 closure case, so the two surfaces cannot disagree about
   who owns a body. **Suppressed: 6,948.** 55.6% of R's call sites are at file
   scope, so this gate suppresses a large population and that population is
   printed in `metadata.callAttribution.memberReadsUnresolvedScope` rather than
   lost.

`[` is deliberately **not** read, only `[[`. In R they are not interchangeable:
`obj["name"]` is a character subset — on a plain list it evaluates to `NULL` —
while `obj[["name"]]` is the member lookup. Publishing the string index of a `[`
as a member name would put a `uses` edge on an expression R does not treat as a
member read.

**Confidence is the attribution's, not a constant.** The member name is a certain
parse fact, but the *owner* of a body reached through an anonymous function is
inferred, so the edge is 0.7 there exactly as a `calls` edge in the same body is.
Writing 1.0 would have been a confidence that measures the label rather than the
evidence, and it would have understated this lane's guesswork by exactly the
closure cases. Every edge below 1.0 carries a `reasonCode` and a `reason`.

### The change is `uses`-only, and that was measured rather than argued

`validation/m14/fixtures/r/census-percount.ts` prints one line per file with the
per-label counts the totals are summed from, so two analyzer revisions can be
diffed file by file. Run over the stashed pre-change analyzer and the current one,
on all 13 repositories:

| | |
| --- | --- |
| files compared | 2,027 |
| files whose `sym`, `calls`, `contains`, `exports`, `imports`, `implements`, `extends`, `references`, `overrides` or `instantiates` count differs | **0** |
| `uses` edges added | 3,864 |

A change that adds one label and no symbol should move nothing else, and this one
does not. The number is a diff, not an assurance.

### The six questions, per type

**1. Exists** — every one of the ten is constructed in `src/ast/real-r-analyzer.ts`
and each construction site is named in `validation/m14/fixtures/r/rulings.json`.

**2. Fires** — all ten fire on real code; the table above carries the counts. Two
of them fire on **2 files and 1 file respectively**, and the reason is worth
stating because it is the reason a handover believed them missing: `overrides`
needs a base class declared in the *same file*, and all three same-file member
shadows in the corpus live in `r-testthat/R/reporter-junit.R` and
`r-testthat/R/reporter-progress.R`. The pre-widening 4-repo corpus contained
neither. A type whose construct occurs 3 times in 1,890 files is not a type the
language lacks; it is a type a thin corpus cannot see.

**3. Correct** — there is no differential for R (see *What this lane cannot
claim*), so the only independent check available is the one below, and its limit
is stated with it.

**4. Labelled** — measured, over the population, by keying every emitted edge on
`(type, relationshipSubType)`. Harness
`validation/m14/fixtures/r/labels-and-resolution.ts`; committed output
`validation/m14/fixtures/r/labels-and-resolution.txt`. A subtype that appears
under two ontology types is a labelling ambiguity and is named as one; a subtype
under exactly one type is the label being consistent.

| Type | Subtypes (count) | Straddles another type? |
| --- | --- | --- |
| `calls` | `(none)` 44,015 · `closure_call` 1,668 · `s4_method` 1,413 · `r6_method` 793 · `s7_method` 234 · `r5_method` 13 | yes — the four method subtypes, and `(none)` |
| `uses` | `member_read` 4,799 | **no** |
| `contains` | `(none)` 16,773 · `r6_method` 418 · `r6_field` 184 · `s7_method` 118 · `s7_property` 103 · `s4_method` 18 · `r5_field` 5 · `r5_method` 1 | yes — the four method subtypes, and `(none)` |
| `imports` | `namespace_access` 1,746 · `library_import` 290 · `rcpp_source` 46 · `r_source` 8 | yes — `rcpp_source`, `r_source` |
| `references` | `namespace_access` 1,751 · `library_dependency` 290 · `rcpp_source` 46 · `s7_class_binding` 21 · `s4_binding` 21 · `r_source` 8 | yes — `namespace_access`, `rcpp_source`, `r_source` |
| `exports` | `roxygen_export` 3,581 | no |
| `extends` | `s4_inherits` 263 · `r6_inherits` 53 · `s7_parent` 33 · `r5_inherits` 1 | no |
| `implements` | `s3_method` 1,133 | no |
| `overrides` | `object_system_method_override` 107 | no |
| `instantiates` | `(none)` 3 | yes — `(none)` |

**The `uses` / `references` confusion is structurally impossible in this lane,
and that is a measurement rather than a claim.** `uses` carries exactly one
subtype and `references` carries five, and **no subtype is shared between
them**. A member read of a value (`obj$member`, `obj@slot`, `df[["col"]]`,
`pkg::name`) is `uses`; a dependency mention (`library(dplyr)`, `require(x)`,
`source("f.R")`) and an S4/S7 class binding are `references`. An edge cannot be
mislabelled across that boundary without also changing its subtype, which makes
the confusion countable rather than a matter of taste.

**All 15 straddling subtypes are accounted for, and two of them are by design.**
`r_source` and `rcpp_source` appear under **both** `imports` and `references`
because `real-r-analyzer.ts:2108` emits the pair on purpose, and the comment
above it records that `references` is the generic dependency type while `imports`
is what `graph_usages` reads to build the imports/exports view and what
`evidence_tier` classifies as an import kind, so R dependencies were invisible to
both while existing. The four method subtypes (`r6_method`, `r5_method`,
`s4_method`, `s7_method`) appear under both `calls` and `contains` because a
call to a method body and a class→member containment are two different facts
about one declaration. **A consumer keying on `relationshipSubType` cannot
recover the label for those six subtypes; it has to read `type`.** That is a
real constraint on a consumer and it is stated here rather than discovered later.

**The `(none)` entries are a DENOMINATOR error in this document, corrected.** An
earlier revision of this line read "**60,898 of 78,347 edges (77.7%) carry no
`relationshipSubType` at all**". The 60,898 is the sum of the `(none)` rows under
`calls` and `contains` alone, divided by the edge count of the WHOLE population. Two
different sets, so the ratio described nothing.

Recomputed over the same block, per type, against that type's own edge count:

| | edges | carrying a subtype | `(none)` |
| --- | --- | --- | --- |
| `calls` | 48,174 | 4,123 | 44,051 |
| `contains` | 17,622 | 847 | 16,775 |
| `uses` | 4,808 | 4,808 | · |
| `imports` | 2,095 | 2,095 | · |
| `references` | 2,137 | 2,137 | · |
| `exports` | 3,585 | 3,585 | · |
| `extends` | 351 | 351 | · |
| `implements` | 1,133 | 1,133 | · |
| `overrides` | 107 | 107 | · |
| `instantiates` | 3 | **0** | 3 |
| **all** | **80,015** | **80,012** | **3** |

So the honest figure is **3 of 80,015 edges (0.0%) carry no subtype**, and all 3 are
the `instantiates` edges, which do carry `isRConstructor` and `reasonCode`.

The `(none)` rows under `calls` and `contains` are a different and still real finding:
those edges are subtyped as *unclassified within their own type*, not as *untyped*.
`calls` at 4,123 of 48,174 (8.6%) and `contains` at 847 of 17,622 (4.8%) carry a
subtype; the rest carry other metadata and no subtype name. The gap is that the
analyzer never names a subtype for an ordinary call or an ordinary containment, so a
consumer filtering `relationshipSubType == "closure_call"` sees 1,670 of 48,174 calls
and has no way to learn what the other 46,504 are. That is a gap in the vocabulary, not
in the edges — the edges exist, are typed, and resolve.

**`extends` and `implements` checked against an independent carrier probe.** The
subtype table says the analyzer is *consistent*; it cannot say the label is
*right*. So a second instrument reads the same two constructs off the parse tree
without touching the analyzer's rule table: R's inheritance carriers are named
arguments (`R6Class(inherit=)`, `setRefClass(contains=)`, `setClass(contains=)`,
`S7::new_class(parent=)`) and R's generic-implementation carrier is the
`generic.class <- function(…)` convention.

| Type | Tree carriers | Emitted pairs | Agreement | Carriers with no edge | …inside `if`/`while`/`for` | …unconditional |
| --- | --- | --- | --- | --- | --- | --- |
| `extends` | 381 (64 files) | 350 (60 files) | 348 | 33 | 19 | **14** |
| `implements` | 1,206 (229 files) | 1,133 (221 files) | 1,054 | 152 | 8 | **144** |

The 19 and 8 conditional carriers are `if (FALSE) { … }` bodies, which R never
evaluates and which the analyzer deliberately skips. The remaining 14 `extends`
and 144 `implements` unconditional carriers are **not** adjudicated here: the
examples are dominated by S7 base classes (`S7/R/zzz.R: S7_generic -extends->
class_function`, `ggplot2/R/margins.R: margin -extends-> simpleUnit`) and by
backticked names (`` `$.AC` -implements-> `$` ``), which the probe reads as
dotted S3 names and the analyzer's `name.indexOf(".") > 0` test reads
differently. Each is a candidate finding; none is confirmed, and a candidate
list is reported as a candidate list.

### A probe that pointed at correct code, and what that cost

The first version of the carrier probe reported **11 "unconditional implements
carriers with no edge" in `Matrix/R/Ops.R`** — `Ops.x.x`, `A.M.n`, `diagOdiag`
and 8 more — and the number was going into this document as a gap. It is wrong,
and the way it is wrong is worth more than the gap would have been.

All **22** top-level function bindings the probe called missing in that file are
removed by a top-level `rm(...)` later in the same file: `rm(Ops.x.x)` at
`Ops.R:775`, `rm(A.M.n, A.n.M)` at 639, `rm(Cmp.Mat.atomic)` at 376,
`rm(diagOdiag)` at 2029, `rm(diagOtri)` at 2062, and 17 more — 22 for 22, with
none left over. The analyzer models `rm()` unbinding
(`removeTopLevelBindings`) and is **right** to drop them: `Ops.x.x` exists only
to be handed to `setMethod("Ops", …, Ops.x.x)` at `Ops.R:471-479` and R does not
hold the binding after line 775 either.

The probe was the defective instrument, and an oracle that over-claims is worse
than no oracle, because its misses aim at correct code and a reader cannot tell
the difference. It now models `rm()` and reports the 144 above as candidates
rather than as gaps. Two smaller probe defects were fixed the same way and are
named here because a probe that is quietly wrong twice is a probe nobody should
trust: reading the callee of `c(…)` as a base class (75 fabricated "carriers"
named `c`), and requiring a bare `identifier` inside `rm(x)` when the grammar
wraps it in an `argument` (0 removals found in 40 files).

The methodology that found the real behaviour was a bisect down the parse tree's
top-level statements, then a temporary instrumented build of the analyzer that
printed the walk's function-scope depth at each visit. The build was reverted and
`git status` is clean of it; the finding it produced is the `rm()` model above.

### Two instrument bugs, and the one real gap they were hiding

The probe above was itself wrong three times before it was right, and the third
time it was wrong it was pointing at a **real defect in the analyzer**. Both
bugs are recorded because an instrument's own error rate is the thing a reader
needs most and the thing a document never states.

**1. `rhs === n` is false for the same node.** web-tree-sitter materialises a
*fresh* JS wrapper on every `childForFieldName` call, so object identity cannot
be used to ask "is this call the right-hand side of that assignment?" Verified
directly: `rhs === n` evaluates `false` while `rhs.id === n.id` evaluates
`true`. The probe's enclosing-assignment lookup therefore **never fired** and
silently fell through to the first-argument fallback. The consequence was two
rows of BLOCK B wrong from one operator: `class_ggplot -extends-> class_gg`
was printed as *an edge with no tree carrier* and `ggplot -extends-> class_gg`
as *a carrier with no edge*, when both are the same declaration written at
`ggplot2/R/all-classes.R:322`. Comparing by `.id` fixed it.

**2. The diff demanded one spelling per declaration.** R names a class twice
when the name is written as a string: `class_labels <- new_class("labels",
parent = class_S3_gg)` binds `class_labels` **and** declares the class `labels`,
and the analyzer publishes the declared name plus a `References` edge back to
the binding. A set diff keyed on a single spelling calls half of every such
declaration a disagreement. The unit is now the **declaration**, carrying a set
of spellings, and the report states which spelling matched: **405 under the
binding, 8 under the declared string**, with **0 edges carrying no tree
declaration** (it was 2).

With the probe fixed, one UNADJUDICATED declaration was left in
`R6/tests/manual/test-inheritance.R:126`:

```r
BC <- R6Class(
  inherit = R6testA::AC,
  public = list(y = 2)
)
```

`extractNamedArguments` read only `identifier` and `string` values, so a
`namespace_operator` value — `pkg::Parent` — produced **no edge at all**. R6
documents this spelling and it is the only way to inherit a class across a
package boundary without exporting a constructor call. This is a genuine gap:
the language expresses the construct and the analyzer was not reading it.

Census of every class-constructor call in the admitted corpus — **738** across
2,342 R files (`new_class` 283, `R6Class` 229, `setClass` 201, `new_base_class`
12, `setRefClass` 9) — found exactly **one** qualified base class, so this is a
**one-edge gap** and is written up as one rather than dressed up. All four
carriers sit behind that one helper (`R6Class(inherit=)`, `setRefClass(contains=)`,
`setClass(contains=)`, `new_class(parent=)`), so all four were fixed by the one
read and `F20-qualified-base-class` asserts all four: a fixture that exercised
only R6 would have passed with S4, R5 and S7 still broken.

The edge carries the **bare** class name. `pkg::Parent` names the class
`Parent`, which is what `class(x)` returns and what dispatch keys on, and no
symbol named `R6testA::AC` binds in any file. `F20` pins that with five
`forbidRelationships` entries, so a later change that keeps the qualifier
fails. `namedArgumentNode` was widened with the same read: it used
`nodeAsName`, which returns `""` for a `namespace_operator`, so the first
version of this edge published **with no line number** — real but
unattributable. It now stamps 127.

**The naming convention that is NOT a gap.** Production reads the class name
from the *positional* string and ignores the `name =` spelling, so
`class_ggplot <- S7::new_class(name = "ggplot", parent = class_gg)` publishes
the class under `class_ggplot` while `class_ggplot <- new_class("ggplot_built",
parent = class_gg)` publishes it under `ggplot_built`. That looks like an
inconsistency and is measured here rather than asserted: **5 of the 283**
`new_class` calls in the corpus write the class name as `name =` (plus 1
`setRefClass(Class =)`), and in the only production source among them — ggplot2 —
the package's own code refers to the class by the **binding** in **50** places
(`S7::method(grid.draw, class_ggplot)` at `R/save.R:378`,
`plot = class_ggplot` at `R/all-classes.R:396`,
`class_ggplot | class_ggplot_built` at 421). So the binding is the name that
binds, and renaming the symbol to the declared string would **break** those 50
in-file references rather than fix them. Left alone, with the measurement
recorded.

**The last reason code.** `S7/inst/doc/performance.R:68` and `:104` both write

```r
assign(x, new_class(x, parent = parent), env)
```

inside a `bench::press({...})` block. `x` is the `for` variable over
`gen_character(num_classes, …)`'s randomly generated strings, so the class name
is the **runtime value of an expression** and is not nameable statically; and
`x` in that one file is also an S7 object (line 14) and a `do.call` result
(line 76), so publishing `x -extends-> parent` would attach a class edge to a
name that means three different things. The probe now records whether any
spelling came from a string literal and codes the rest
`CLASS_NAME_IS_AN_EXPRESSION` — 2 occurrences.

**The adjudicated result, whole population, 2,184 files, no sampling:**

| | tree declarations | emitted | agree | no edge | edge with no declaration |
| --- | --- | --- | --- | --- | --- |
| `extends` | 449 in 65 files | 351 in 61 | 413 | 36 | **0** |
| `implements` | 1,206 in 229 files | 1,133 in 221 | 1,133 | 73 | **0** |

Reason codes for the 36 and the 73: `TARGET_NOT_DECLARED_IN_THIS_FILE` 21 and
72, `SOURCE_NOT_DECLARED_IN_THIS_FILE` 13 and 1, `CLASS_NAME_IS_AN_EXPRESSION`
2, and 20 + 8 whose declaring call sits inside an `if`/`while`/`for` body.
**`UNADJUDICATED` is 0 for both types**, which is the claim: there is no
`extends` and no `implements` gap left in this lane, and every tree declaration
and every tree carrier is accounted for by a reason read off the tree.

**5. Resolved** — reported at TWO scopes, because they answer different
questions and conflating them is how a 40% number reads as 90%. *local* is
"resolves to a symbol in the file that emitted the edge", the only scope a
single-file parse can be held to, and the one comparable to CSS `references` at
66.8% quoted in the workstream header. *corpus* is "resolves to a symbol in some
file of the sample".

Over the **population** (2,184 files), with the endpoint SHAPE printed alongside
the rate so a low number is readable rather than merely low — the source of
`imports`, `references` and `exports` is the literal string `global` by
construction, and the targets of `imports` and `references` are package names:

| Type | target in same file | source shape | target shape |
| --- | --- | --- | --- |
| `contains` | 17,618 / 17,622 = 100.0% | `global` 16,653 | declared names |
| `exports` | 3,584 / 3,585 = 100.0% | `global` 3,585 | declared names |
| `overrides` | 107 / 107 = 100.0% | class names | member names |
| `instantiates` | 3 / 3 = 100.0% | `initialize`, `capture_expectations` | class names |
| `extends` | 258 / 351 = 73.5% | class names | `VIRTUAL` 34, `Reporter` 20, class names |
| `implements` | 371 / 1,133 = 32.7% | `generic.class` | `vec_ptype2` 86, `vec_cast` 82, `print` 74 |
| `references` | 55 / 2,137 = 2.6% | `global` 2,095 | `cli` 318, `withr` 254, `utils` 122 |
| `calls` | 5,035 / 48,174 = 10.5% | any symbol | `c` 1,794, `return` 1,398, `length` 1,118 |
| `uses` | 402 / 4,808 = 8.4% | any symbol | `x` 217, `name` 106, `Dim` 93 |
| `imports` | 13 / 2,095 = 0.6% | `global` 2,095 | `cli` 318, `withr` 254, `utils` 122 |

Each denominator above is the edge count **of that row's own run**, read from the
committed `labels-and-resolution.txt`. That run is one of four over the same
population and they do not agree to the digit, so a second reading of this table
gives `calls` 5,042 / 48,230 = 10.5% — a different walk, not a different rate. The
rates are stable across runs; the denominators are not. An earlier revision of this
table quoted that second walk's denominators while the artifact held the first, which
is the same two-sets error the `(none)` table below records, so the row now carries
the run it came from.

`imports` at 0.6% and `references` at 2.6% are **the structure of the type, not
a defect rate**: no R source file declares its own package name as a symbol, so a
same-file symbol lookup cannot bind `cli` or `Matrix` whatever the analyzer does.
The measurable question for `imports` is whether the named package exists, which
is a question about CRAN rather than about syntax, and this lane does not answer
it. Both types' source endpoints being the literal `global` means a "both ends
resolve" figure for them is **0.0%** and always will be — the earlier table's
0.7% is the target-side rate, which is the only one of the two that means
anything for these types.

Over the **1,890-file sample** the same instrument reads:

| Type | local, both ends | local, target | corpus, target | reading |
| --- | --- | --- | --- | --- |
| `contains` | 99.6% | 99.9% | 99.9% | 9 targets resolve nowhere, 4 distinct names, largest `me` (4) |
| `exports` | 100.0% | 100.0% | 100.0% | **one** edge is a ghost — see below |
| `overrides` | 100.0% | 100.0% | 100.0% | 13/13 |
| `instantiates` | 100.0% | 100.0% | 100.0% | 1/1 |
| `calls` | 10.7% | 10.8% | **55.4%** | see below |
| `uses` | 8.5% | 8.6% | **55.7%** | see below |
| `implements` | 36.0% | 36.0% | 84.9% | the generic is usually in another package |
| `extends` | 36.2% | 36.2% | 84.5% | 26 of 58 name a class in another package |
| `imports` | 0.7% | 0.7% | 33.0% | structural, see below |
| `references` | 7.9% | 7.9% | 23.6% | structural, see below |

**The 44.6% of `calls` that resolve nowhere are base R, and the census names
them.** The top unresolved targets are `return` (1,257), `list` (864),
`is.null` (805), `paste0` (750), `invisible` (711), `identical` (297),
`is.na` (293), `sprintf` (246), `UseMethod` (233), `any` (229), `paste` (223),
`inherits` (217), `parent.frame` (209), `missing` (205) — every one of them a base
R function, and **base R is not one of the thirteen sampled repositories**. The
remainder are qualified targets written `pkg::name` (`cli::cli_abort`, 235), which
resolve to no single symbol name by construction. So 55.4% is a floor imposed by
the corpus, not a defect rate, and the honest statement is that this lane cannot
resolve across a package boundary it does not have.

**`imports` at 0.7% local and `references` at 7.9% local are the STRUCTURE of
the type, not a defect.** Their targets are package names (`withr` 242, `utils`
99, `lifecycle` 83, `Rcpp` 70, `purrr` 60) and file paths (`testthat` 30, `Rcpp`
27, `inline` 17), and no R source file declares its own package name as a symbol.
The measurable question for `imports` is whether the named package exists, which is
a question about CRAN rather than about syntax, and this lane does not answer it.

**`uses` at 55.7% corpus has the same shape as `calls`, and its unresolved
targets are R data-column and option NAMES**: `val` (55), `package` (26),
`bs_version` (21), `OS.type` (15), `line` (15), `double.eps` (14),
`subscript_arg` (14), `remote` (14), `group` (13), `total` (13), `upstream` (13),
`file_out` (12), `repo_spec` (12). These are the names of data-frame columns and
list entries read out of objects the file does not declare — which is the correct
answer for a member read and not an error in the rule.

**EVERY unresolved `contains` and `exports` edge in the population is a
shared-machinery denylist, and the accounting is closed: 5 edges, 3 names, 4
files, 0 unexplained.** A dedicated walk of all 2,184 files listing every
`contains`/`exports` edge whose target is absent from its own file's symbol set
returns exactly this and nothing else:

| edge | count | file | what the name is |
| --- | --- | --- | --- |
| `exports -to-> super` | 1 | `S7/R/super.R:100` | `super <- function(from, to)`, exported by S7 |
| `contains -to-> super` | 1 | `S7/R/super.R:100` | the same declaration |
| `contains -to-> super` | 1 | `Matrix/R/00_Class.R:723` | an S4 slot, `slots = c(super = "integer", …)` |
| `contains -to-> this` | 1 | `r-cli/tests/testthat/test-progress-variables.R:173` | a `local()` binding read 3× below |
| `contains -to-> this` | 1 | `r-vctrs/tests/testthat/test-type2.R:26,50` | two `local()` bindings |

So `contains` at 17,618/17,622 and `exports` at 3,584/3,585 are not R-rule
shortfalls with a denylist problem mixed in: the denylist **is** the whole of them.
Neither `super` nor `this` is reserved in R, and `S7/R/super.R` shows why that
matters — `super()` is S7's dispatch primitive, and dropping it leaves **13 edges
naming it in that one file** (11 `calls`, 1 `exports`, 1 `contains`), so the graph
holds an exported name with no node behind it.

This is the SECOND time this shape has appeared in this lane. The first was
`source_file`, an ordinary testthat function that `keepSymbol` deleted at 12 symbols
across 9 files and that has since been removed from the set upstream. The fix split
the list into a residual `UNIVERSAL` plus a per-language `RESERVED` map, and its
comment now says the names that remain are "the ones no lane has produced a
counterexample for" — and this lane has one for two of the four. Measured cost of
what the fix left: **7 symbols across 4 files.** The file is shared machinery
(workstream §8), so this is reported and not fixed.

**The `unknown` gap the same fix left.** `pool-worker.ts:499-501` says `unknown`
"now moves to RESERVED below rather than being dropped, so a placeholder is still
refused while a declared `unknown` survives". No `RESERVED` set contains `unknown`
— the map holds only `php {self, parent}` and `sql {program}` — so
`keepSymbol({name:"unknown"}, lang)` returns `true` for every language, which is the
opposite of what the comment describes. Measured cost to R over 1,492 files: **0
symbols named `unknown` reach production**, so the gap is LATENT rather than active;
the risk is that an analyzer minting `unknown` as a name would have it published
instead of refused. `probe-denylist.ts` prints this as a live line rather than a note,
because a comment that describes behaviour the code does not implement is the kind of
thing a reader trusts.

**6. Confident** — measured over the population with a 0.05-wide histogram,
because a threshold test cannot tell a lane that sits on 0.7 from a lane with a
spread, and both satisfy `>= 0.7`. **0 of 80,095 edges fall below 0.7; 0 carry
a missing or non-numeric confidence.**

| Type | Edges | 1.00 | 0.95 | 0.90 | 0.85 | 0.80 | 0.70 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | 48,174 | 46,504 | · | · | · | · | 1,670 |
| `contains` | 17,622 | 17,622 | · | · | · | · | · |
| `uses` | 4,808 | 4,572 | · | · | 236 | · | · |
| `exports` | 3,585 | 3,585 | · | · | · | · | · |
| `imports` | 2,095 | 1,815 | · | · | · | 280 | · |
| `implements` | 1,133 | · | · | · | · | 1,133 | · |
| `references` | 2,137 | 1,857 | · | · | · | 280 | · |
| `extends` | 351 | 351 | · | · | · | · | · |
| `overrides` | 107 | · | 107 | · | · | · | · |
| `instantiates` | 3 | · | · | 3 | · | · | · |

Each sub-1.0 band is one derivation rule, and each carries a machine-readable
reason on the edge: 0.70 is closure-attributed `calls`/`uses`, 0.80 is the S3
`generic.class` convention for `implements` (`s3_dotted_name_convention`), a
bare-identifier `library(x)` with no string literal
(`library_bare_identifier`), and the same for `references`, 0.90 is
`declared_class_constructor`, 0.95 is `base_class_declared_in_same_file`.

**FINDING — `evidenceClass` is absent on 80,095 of 80,095 R edges.** Not one
edge in the population carries the field. That is legal: `src/lsp/evidence_tier.ts`
rule 2 derives the tier from confidence when no stored class exists, so with
every R edge at `>= 0.7` every R edge reads `structural`. It is still an
outlier worth naming — **42 of the 51 `src/ast/*analyzer*.ts` files set
`evidenceClass`, and the six that do not are `clojure`, `elixir`, `erlang`,
`fsharp`, `r` and `vb`.** So the store cannot distinguish an R edge that parsed
from one that was inferred, except by reading the confidence the analyzer already
wrote. The three bands above are the honest substitute and they are countable;
`evidenceClass` being absent means a consumer that filters on the tier rather
than the number sees one tier for this lane.

### What this lane cannot claim

- **No differential.** `script/m14/differential.ts` has no `LANGS.r` entry, so no
  differential row for R has ever been computed by the repository's own harness.
  All nine previously-emitted types are therefore **DERIVATION findings** — the
  largest count of any lane named in the workstream header, whose zero list has
  twelve lanes. `uses` is a tenth now.
- **The only independent cross-check available here is weaker than a differential,
  and is worth exactly what it is.** `probe-surfaces.ts` counts parse-tree nodes
  without consulting the analyzer; the analyzer counts its own suppressions in
  `metadata.callAttribution`. The two are separate walkers and they agree
  **exactly**: 2,314 member accesses suppressed as already-carried callees, on both
  sides. That is real corroboration of one number. It is not a differential,
  because both walk the same grammar — a grammar bug shared by the two is invisible
  to it, which is the limitation the workstream header requires be stated rather
  than glossed.
- **The `exports` resolution rate is measured against a file-local set, and every
  unresolved `exports` and `contains` edge in it is a denylist ghost.** 3,584 of
  3,585 and 17,618 of 17,622, where the 5 missing edges are 3 names in 4 files and
  the cause is `keepSymbol`, not an R rule. The accounting is closed rather than
  partial, which is a stronger statement than the one it replaces: there is no
  unexplained residue left in either rate.
- **Corpus totals for R are not bit-reproducible under concurrency.** Five
  production walks of this lane over the identical 2,184-file population logged
  `[BB-PARSE-ERR] r | <file> | memory access out of bounds` on 0, 1, 5, 2 and 2
  files respectively, totalling 79,756 to 80,095 edges for the ten types. The
  per-run table above carries each walk's own counts. `probe-oom.ts`
  establishes what is *not* wrong: over `r-rlang` (160 files, 3 passes each),
  **0** files had a symbol or relationship count that differed between passes, and
  15 files legitimately publish no symbols (roxygen topic files and testthat
  standalone files contain no top-level binding). The instability is in which
  files the wasm grammar exhausts memory on, not in the counts for a given file.
  Every total in this document therefore carries that caveat.
- **`instantiates` emits 1 edge where 23 same-file constructions occur.** The gap
  is the attribution gate, not the labelling: 6 are `Declared$new()` and 17 are
  `new("Declared")` with `Declared` declared in the same file, and
  `instantiates` is emitted from the `calls` path, which requires an enclosing
  named symbol. 5 of the 6 `Declared$new()` sites are at file scope in
  `r-Rcpp/inst/tinytest/`. That is the same file-scope limitation `calls` declares,
  applied consistently rather than worked around.
- **`references` did not carry namespace-qualified reads — CORRECTED, this was wrong
  and it was fixable here.** An earlier revision of this list declared the gap as
  unfixable "because the label it would take is a judgement call about `uses` versus
  `references` that belongs to the supervisor's ontology, not to one lane". Both halves
  of that were wrong. The frame was `uses` versus `references`; the actual asymmetry was
  `imports` versus `references` **for a dependency**, and `src/ast/types.ts:72` already
  decides it — `DependsOn = "references"`. And the fix needed no shared edit, because the
  answer was already written down.

  The gap was 1,751 edges and it was the largest single miss the lane's oracle found.
  Measured before and after, same 2,058-file oracle population:

  | | oracle derives | analyzer emits | missing | unexplained | precision | recall |
  |---|---|---|---|---|---|---|
  | before | 2,171 | 387 | **1,805** | 21 | 94.6% | **16.9%** |
  | after | 2,171 | 2,094 | 98 | 21 | 99.0% | **95.5%** |

  `unexplained` is 21 in both rows. That is the check that matters for a change this
  size: 1,707 edges were recovered and none of them is a fabrication.

  A `::`/`:::` access is a hard dependency — R must load the namespace to evaluate it —
  and the analyzer already published both labels for the other three dependency forms it
  reads (`library()`/`require()` at `real-r-analyzer.ts:2108`, `source()`/
  `sourceCpp()` at `:2141`). Only namespace access published `imports` alone. The
  `references` edge is now pushed beside it at `:1907`, at the same confidence (1.0 — a
  deterministic parse fact) and under the same `namespace_access` subtype, so a consumer
  keying on the subtype sees the pair, exactly as it already sees `rcpp_source` and
  `r_source`.

  Cost: `references` 389 → 2,137, the lane total 78,311 → 80,095 (+2.28%). Pinned by
  `F21-namespace-depends-on` (21 fixtures now) and by two source mutants,
  `src-namespace-drops-dependson` and `src-namespace-target-is-the-function`, both of
  which that fixture rejects. 17 mutants, 17 caught, 0 survivors.

- **THE DEDUP KEY HAS NO LINE, so 67% of namespace accesses never reach the graph.**
  `real-r-analyzer.ts:422` keys a relationship on `` `${type}\u001f${source}\u001f${target}` ``.
  The comment above it says the intent — "Preserve one edge per semantic fact even when
  the same call appears in multiple AST wrappers" — and the intent is sound, because one
  call reached through two wrappers is one call. The key cannot tell that from two
  different use sites, because both reduce to the same triple. The survivor carries the
  **first** site's line.

  Minimal reproducer, four lines, no corpus needed:

  ```r
  utils::globalVariables(".my_var")
  utils::head(x)
  utils::tail(x)
  ```

  Production `parseFile` returns one `imports` edge and one `references` edge, both at
  line 1. Lines 2 and 3 are gone and nothing reports the loss. Measured on a 400-file
  sequential sample (`probe-dedup-collapse.ts`): **682 `namespace_operator` nodes on the
  tree, 225 edges emitted — 67.0% collapsed.** Nine lines below the offending comment,
  `imports` as an `ImportInfo` list is keyed by `(module, range)` and keeps every site,
  so the same dependency is complete as a list and truncated as an edge.

  Not fixed here. The key is in this lane's file, but the `line_number` it would have to
  join is shared with every other lane's edges, and re-keying it changes edge counts
  everywhere — a supervisor decision, reported with the instrument attached.

### R6, R5, S4 and S7 — why instrument A is the wrong instrument here

tree-sitter-r produces **97 distinct node types** across the 1,890-file sample and
**none** of them is a type declaration, a class declaration, a `new` expression, an
interface list or an inheritance specifier. R's object systems are LIBRARY CALLS —
`R6Class(inherit=)`, `setRefClass(contains=)`, `setClass(contains=)`,
`S7::new_class(parent=)` — which is why `extends`, `implements`, `overrides` and
`instantiates` are reachable in R at all. A grammar inventory would have concluded
R has no object system; the classes are in the grammar's `call` node. So the two
types that fire rarely were measured with **instrument B**, a cross-node semantic
count (`probe-classes.ts`):

| construct | occurrences | files | example |
| --- | --- | --- | --- |
| `Declared$new()` anywhere | 57 | 57 | `dplyr/R/deprec-do.R` |
| …with the class declared in the same file | **6** | 4 | `r-Rcpp/inst/tinytest/test_misc.R` `FooGC$new()` |
| `new("Declared")` anywhere | 36 | 36 | `dplyr/R/filter.R` |
| …with the class declared in the same file | **17** | 6 | `r-Rcpp/inst/tinytest/test_s4.R` |
| `R6Class(...)` declared | 40 | 32 | `dplyr/R/data-mask.R` `DataMask`, 42 members |
| `setClass(...)` declared | 39 | 15 | `dplyr/tests/testthat/test-arrange.R` `TestS4` |
| `setRefClass(...)` declared | 8 | 4 | `r-Rcpp/R/00_classes.R` `C++OverloadedMethods`, 9 members |
| `S7::new_class(...)` declared | 20 | 6 | `ggplot2/R/all-classes.R` `gg` |
| `setMethod(...)` declared | 26 | 11 | `dplyr/tests/testthat/test-arrange.R` `TestS4$[` |
| class inherits a base **in this file** | 7 | 5 | `r-scales/R/range.R` `Range -> DiscreteRange` |
| …and redeclares one of its members | **3** | 2 | `r-testthat/R/reporter-progress.R` `ProgressReporter#initialize` |
| class inherits a base **in another package** | 26 | 24 | `r-Rcpp/R/Module.R` `clname inherits C++Object` |

Both `overrides` and `instantiates` were believed missing at handover. Neither is.
The last row is why: **26 overrides in the corpus are not emitted and cannot be**,
because the base lives in another package and syntax cannot resolve it. That is
the declared scope of the file-scoped rule, and it is a number rather than an
apology.

**The overturn condition, stated so the ruling is falsifiable.** A probe finding a
same-file base class whose derived class redeclares one of the base's members at a
count above 3 would mean the 13 `overrides` edges miss cases; a probe finding a
`Declared$new()` or `new("Declared")` with the class declared in the same file at a
count above 23 would mean the single `instantiates` edge does. `probe-classes.ts`
*is* that probe, so the conditions are re-runnable rather than rhetorical.

### The gate counters, because a gate whose suppressed count is unprinted is a gate whose absence is indistinguishable from its size

Summed over the 1,890-file sample, from `metadata.callAttribution`:

| counter | value | what it suppresses |
| --- | --- | --- |
| `unresolvedScope` | 110,381 | `calls` with no enclosing named symbol |
| `memberReadsUnresolvedScope` | 6,948 | `uses` with no enclosing named symbol |
| `throughClosure` | 2,245 | `calls` attributed through an anonymous closure (at 0.7) |
| `memberReadsSuppressedByCall` | 2,314 | `uses` suppressed because the access is a call's callee |
| `memberWrites` | 1,911 | `uses` suppressed because the access is an assignment target |
| `unnameableCallee` | 65 | calls whose callee is not a name — `(if (u) triu else tril)(x)` |
| `memberReadsWithComputedIndex` | 26 | `uses` suppressed because the member is computed |
| `heuristicS3Generic` | 0 | reserved |

`unresolvedScope` at 110,381 is the largest single hole in this lane's coverage and
it is not a bug: 55.6% of R call sites are at file scope because R packages are
mostly top-level code, and `source` in this framework's relationship model is a
symbol name. Those calls get no edge, which is recorded here as a limitation with
its number attached.

### The probes this lane owns, and what each one is worth

Five instruments, all lane-owned, all committed, all re-runnable. None of them is
a differential and the table says what each can and cannot see.

| Probe | Instrument | What it measures | What it cannot see |
| --- | --- | --- | --- |
| `census.ts` | production `parseFile` | per-type edges, confidence histogram, two-scope resolution, gate counters, symbol kinds, empty names, `unknown` endpoints | anything the pipeline filters, by construction — it reads the production output |
| `census-percount.ts` | production `parseFile` | one line per file, so two analyzer revisions diff file by file | which pipeline stage made a difference |
| `probe-surfaces.ts` | **B** — parse-tree counts | member reads, in callee position and not, over the same grammar | a grammar bug, because it reads the same grammar the analyzer does |
| `probe-classes.ts` | **B** — cross-node semantic counts | R6/R5/S4/S7 declarations, bases, members, and the override/instantiation constructs | the same |
| `probe-grammar.ts` | grammar's own `nodeTypeForId` table, read at run time | that every node type and field the `uses` surface reads is declared by the shipped wasm | the other 20 node types the analyzer touches, which are pre-existing and covered by `audit-analyzer-grammar.ts` |
| `probe-denylist.ts` | `keepSymbol` called directly | what the shared symbol filter costs this language | — |
| `probe-oom.ts` | production `parseFile`, repeated | whether per-file counts are stable, and which files legitimately publish nothing | why the wasm parser exhausts memory on some files |
| `run-r-fixtures.ts` | production `parseFile` | fixture pass/fail, and 17 mutants | anything the shared `run-fixtures.ts` asserts that this copy does not |

**`probe-grammar.ts` result: 0 unknown node types, 0 undeclared fields.** The
grammar's own table declares 137 node types; the nine the `uses` surface reads are
all among them, and `lhs`, `operator`, `rhs`, `arguments`, `function`, `name` and
`value` are all returned by `childForFieldName` on a parsed occurrence of the
construct. That is the honesty contract §2 L2 precondition, met for this change
against `wasm/tree-sitter-r.wasm`. One correction is recorded in the probe itself:
its first version required EVERY node of a type to carry a field and reported
`argument`'s `name` as undeclared, because `f(a = 1, 2)` writes its second argument
bare and an unnamed argument has no `name` field.

**`probe-oom.ts` result: 0 of 160 `r-rlang` files had a symbol or relationship count
that differed between three passes of the same file with the same analyzer**, and
15 files publish no symbols at all. Those 15 are roxygen topic files
(`r-rlang/R/faq.R`, `R/doc-data-masking.R`) and testthat standalone files
(`tests/testthat/test-standalone-rlang.R` and six siblings), none of which contains
a top-level binding — checked by reading them, not assumed.

### What the repository's own arbiter says about R

`npx tsx script/m14/ontology-coverage-gate.ts r` admits **747 files** and then
exits **2** with:

```
ontology coverage gate — no RULING TABLE for r.
Refusing to report: a gate with an empty table would call every un-emitted type
RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
```

That refusal is the gate behaving correctly, and it is also the whole problem: the
R lane's ten verdicts cannot be printed by the repository's own arbiter because
`RULED_BY_LANG` has no `r` entry, and `script/m14/spec/r-completeness.json` does
not exist. Both files are shared machinery. The exact change needed is in
`validation/m14/fixtures/r/rulings.json` under `_report_to_supervisor`; in short,
`RULED_BY_LANG.r` should be `[]` (all ten types are emitted, so no ruling is
needed) and a `BD-ontology` decision should be added to a new
`script/m14/spec/r-completeness.json`.

Two further shared-file facts, measured rather than assumed:

- **`npm run audit:fixtures` fails today.** `run-fixtures.ts` computes
  `orphaned = dirs.filter(d => !(d in LANGS))` and calls `process.exit(6)`;
  `validation/m14/fixtures/r/` is such a directory and `LANGS` has no `r`. Adding
  the entry alone turns 1 pass into 16 failures, because that runner fails a
  fixture source with no expectation file and the directory holds 16 pre-existing
  `.R` sources with 0 expectation files. This lane's own runner,
  `validation/m14/fixtures/r/run-r-fixtures.ts`, exists so that `F17`'s
  expectation is a RESULT rather than a file nothing reads.
- **`bun script/m60/lane-surface-audit.ts --lang r` exits `2 — unknown language r`.**

### Fixtures and mutants

`validation/m14/fixtures/r/*.expectation.json` — **21 files**, `F01` through
`F21` — executed by `npx tsx validation/m14/fixtures/r/run-r-fixtures.ts`
through production `parseFile`, plus the **17**-mutant battery behind
`--mutants`:

```
fixtures: 21 passed, 0 failed
MUTATION — 17 mutants, each in ONE child running all 21 fixture(s)
mutants: 17 caught by >=1 of 21 fixture(s), 0 survived by every fixture,
         0 harness faults, of 17 mutants
analyzer restored: src/ast/real-r-analyzer.ts is byte-identical to its pre-run content
```

Four of the seventeen are OUTPUT transforms and thirteen are SOURCE edits, and the
split is not cosmetic: a gate's whole behaviour is to emit nothing, so no transform of the
emitted edges can express a defect in one. **Three were no-ops on their
first version and were refused rather than counted** — one returned its input
unchanged, one matched a target shape the analyzer had already normalised, and one
edited a helper the walk never consults. A mutant that cannot fail is worse than
no mutant, because it inflates the denominator of a ratio; the runner now refuses
a mutant whose edits leave the file byte-identical, and whose anchor does not occur
exactly once.

`F20-qualified-base-class` is the fixture for the one gap this round closed; it
asserts all four carriers and forbids the package-qualified endpoint in five
directions, and its two mutants are the ones that pin the fix in place
(`src-qualified-base-class-dropped`) and the way the target is written
(`src-qualified-base-class-keeps-package`).

A source mutant rewrites a tracked file, so it runs in a CHILD PROCESS: ESM caches
modules by resolved URL, and re-importing `pool-worker` with a cache-busting query
yields a fresh `pool-worker` whose `import("./real-r-analyzer")` hands back the
PRISTINE class. The first version of this runner did that and every source mutant
"passed" by never being loaded. The guard on the write is byte identity rather than
`git status`, so a mutant battery can be run on the change it is meant to test;
after the run the file is asserted byte-identical to its pre-run content.

### Scope boundaries — decided by running R, not by reasoning

An assignment is a file-level binding unless it is inside a scope R introduces.
Three were measured on R 4.4.3:

| Enclosing construct | Binds at file level? | Why |
| --- | --- | --- |
| `function(...) { }` | **no** | the body is a local frame |
| `local({ ... })` | **no** | `local()` creates a child environment |
| `{ ... }` block in a call | **yes** | R evaluates it in the CALLING frame |
| assignment as a call argument | **yes** | `f(x <- 1)` binds `x` |
| `(x <- 1)` | **yes** | parentheses are not a scope |
| `m[x <- 1]` | **yes** | the subscript is evaluated first |
| `for (i in 1:3) { v <- i }` | `v` yes, `i` no | the loop variable is deleted |

`local()` is the one that cannot be found by looking for a `function_definition`
node — it is a call, not a function — and it was being missed: dplyr's
test-across.R binds `_local_var` inside `local({ ... })` and the analyzer was
publishing it as a global. `F14-local-boundary.R` pins all seven rows above.

An earlier revision of this review also treated a `subset` ancestor as a scope
boundary, on the reasoning that a complex assignment is evaluated "in the indexing
context". That is wrong, it silently dropped four real bindings, and the R oracle
caught it. Both the error and the correction are recorded here rather than only
the correction.

## Verifying the LINE NUMBER — R's own token positions

The binding differential above answers "which names does this file bind?". It says
nothing about *where*, and the line-number claim was resting on a check that could be
fooled: an edge's `line` was required to **contain** its target's text, which passes just
as happily on a substring inside a string literal or a comment.

So the same oracle was extended to positions. `getParseData()` lists every terminal
token with the line and column R itself recorded, and a token R lists *is* an occurrence
of that name. Two exact invariants replace the fuzzy one:

1. **symbol position** — the name must **begin** at an offset R recorded, and that
   offset must fall **inside** the analyzer's own declared range. Both halves are
   needed: checking the name alone passes a symbol whose range is wrong; checking the
   range alone passes a name R never saw.
2. **edge line** — R must have recorded the edge's target name on that exact line.

### Three things about R's coordinates, each measured

- **Columns are TAB-EXPANDED.** R reports `	foo` with `foo` at columns 9..11. Every
  other byte advances the column by one — a multi-byte character advances it by its
  *byte* count, so `café` spans 1..5 — but a TAB jumps to the next multiple of eight.
  A first attempt treated R's column as a byte offset and rejected **6,448 rows**,
  which read as "the oracle disagrees with the analyzer" rather than as a unit error.
- **A name often lives inside a string.** `setClass(Matrix, ...)` raises *object
  'Matrix' not found*; the class name must be a `STR_CONST`. So the oracle speaks in
  "names R recorded", and reports each hit as bare or in-a-string rather than hiding
  the distinction in a boolean. 863 edges resolve in a string; that is correct for S4.
- **`base::sign` is FOUR tokens**, and the package name is carried by `SYMBOL_PACKAGE`
  — the `NS_GET` token's own text is just `"::"`. Missing it made 927 `imports` edges
  look like they pointed at nothing. That cluster was a blind spot in the harness, not a
  defect in the analyzer.

### What it found

| | before | after | what it was |
|---|---|---|---|
| span mismatches | 6,448 | **0** | harness: TAB and wrong-line lookups |
| symbols whose name is not where R says | 876 | **7** | 833 real, 1 quoted name, 42 harness |
| edges whose line has no such name | 2,003 | **0** | 927 harness, 1,076 real |

Of the 2,003 edge failures, **927 were a blind spot in the oracle and 1,076 were real
defects.** The blind spot is worth naming rather than banking: an `imports` edge whose
evidence is `base::sign` was failing because the package name lives in R's
`SYMBOL_PACKAGE` token, which the first version of the oracle never asked for.

Three of the R-token facts are asymmetries, which is the pattern worth remembering — R has
a distinct token type for each of these, and none of them is discoverable from the rule
names in the grammar:

| R text | token | why it matters |
|---|---|---|
| `Dim = ...` in a call | `SYMBOL_SUB` | an argument name, not a variable |
| `base` in `base::sign` | `SYMBOL_PACKAGE` | the package; `NS_GET`'s own text is just `"::"` |
| `"Matrix"` in `setClass("Matrix", ...)` | `STR_CONST` | R **requires** the class name to be a string |
| `return(1)` | `SYMBOL_FUNCTION_CALL` | a NAME |
| `break()` | `BREAK` | a **keyword**, though it is a legal call |
| `\tfoo` → `foo` at column 9 | — | columns are **TAB-EXPANDED**, not byte offsets |

The last one is the one I got wrong first. This document asserted "R's columns are 1-based
bytes, **verified**" on the strength of a `café <- 1` probe — a file with no leading
whitespace, which is exactly where tab expansion and byte counting coincide. The claim was
true and untested, and testing it rejected 6,448 rows that looked like the oracle
disagreeing with the analyzer. It was also the second wrong conclusion in a row: the first
was an off-by-one line index that I had already written up as a bytes-versus-UTF-16 unit
error. Both are corrected above, and the correction is in the code as well as here.

Four analyzer defects, all real:

- **833 member ranges excluded the name they publish under.** A member is written
  `name = value`; the range was taken from the *value*, so an R6 method's range began at
  the `function` keyword. The range did not contain the symbol's own name. Fixed by
  spanning `name .. value`. Found in dplyr, shiny and testthat — the R6-heavy packages.
- **75 `calls` edges whose target was a copy of the caller's source.** R can call a
  non-name: `chol2inv((if (uplo == "U") triu else tril)(x))`. `calleeName` ended in a
  blanket `return unquoteIdentifier(fnNode.text)`, so the whole if-expression became a
  function's name. A relationship target that quotes the input back is not a
  relationship. Now an allowlist, and an unnameable callee emits **no** edge — counted
  in `ambiguity.callsToUnnameableCallee` so the gap stays visible.
- **1 S4 slot name published as `"a"`, quotes included.**
  `setClass("new_class", slots = c("a" = "numeric"))` names a slot with a string.
  Argument names may be bare, backticked or a string; only backticks were stripped.
- **7 byte offsets in files containing non-ASCII.** See below.

The F03-r6.R ground truth asserted the *old*, wrong member range. R puts `size` at 4:5
and `token` at 16:5, so `4:12-4:14` (the value alone) was never right. **The expectation
was corrected to match R, not the analyzer** — and the reason is recorded in the ground
truth's own notes.

### Call coverage — the largest gap, finally a number

Every other check in this lane measures what the analyzer **produced**. None measured what
it did not, and in R that difference is the biggest number here. The denominator is counted
by walking the parse tree for `call` nodes, independently of the analyzer, so the ratio
cannot be moved by changing the numerator.

| | |
|---|---|
| call sites in the parse tree | **107,534** |
| …at file scope | **59,840** (55.6%) |
| …inside a function | 47,694 (44.4%) |
| `calls` edges emitted | **27,753** |
| edge per call site | **25.8%** |
| calls the analyzer could not attribute to any symbol | **66,592** |

R packages are mostly top-level code, so more than half of all calls have no enclosing
function, and `source` in this framework's relationship model is a symbol name — there is
no symbol to name. Those calls get no edge. **That is a design limitation, not a bug**, and
it is now recorded as one with its number attached.

Per repo, the file-scope share runs 49–74%: dplyr is 74% top-level, shiny 49%.

**The interesting part is how invisible this was.** The analyzer has counted
`callsUnresolvedScope` on every call since the counter was introduced, and the comment on
its own declaration says:

> Ambiguity counters, surfaced in metadata so a claim of completeness can be audited.

They were not surfaced. The object was created, incremented, and dropped on the floor of the
function. The number that would have exposed the lane's largest completeness gap was being
discarded on the way out. That is worse than an unrecorded limitation: a comment asserting
an auditability the code did not provide, which reads as a guarantee to anyone who greps
for the word.

The counters are now attached to `metadata.callAttribution`, and the coverage harness
**fails** if any file stops surfacing them — so the gap cannot quietly go dark a second
time. A completeness claim that cannot be read is not auditable.

### The production path — the check every other harness here is blind to

Every other R check constructs `new RealRAnalyzer()` and loads `wasm/tree-sitter-r.wasm`
itself. That skips everything a user actually goes through: `ASTEngine.parseFile`, the
analyzer registry, grammar resolution, and the temp copy the engine makes before handing
bytes to web-tree-sitter.

That gap is not theoretical. `resolveWasm("tree-sitter-r/tree-sitter-r.wasm")` searches
four directories, and the data-dir cache `~/.bb/wasm` comes **before** the repository's own
`wasm/`. A stale copy of the unpatched grammar sitting there would be loaded in preference
to the shipped one — and every result in this lane would stay perfectly green while the
product shipped a grammar that mis-parses `0x1p+53` and splits `..2dge` in half.

**A green harness is not evidence that the product uses what the harness used.**

So the production path is exercised end to end, and the bytes are compared by SHA-256
rather than by path, because a path check passes happily while a cache shadows it:

| assertion | result |
|---|---|
| bytes handed to the parser are the bytes in `wasm/tree-sitter-r.wasm` | **yes** |
| patch 1 (hex float) reachable through `ASTEngine.parseFile` | **yes** |
| patch 2 (`..2dge` is one identifier) reachable through it | **yes** |
| an analyzer fix survives routing (S7 edge on the naming line) | **yes, line 5** |

The harness is checked for teeth rather than assumed to have them: planting a stale
grammar in the data-dir cache made it report the hazard and exit non-zero, and the planted
copy was removed. It separates a **hazard** — a differing copy in a directory searched
before the shipped one — from a **breach**, where the bytes actually loaded differ. The
distinction earns its keep: the engine caches the grammar in `/tmp` and reuses it, so the
file loaded can be correct while a stale shadow sits unused, and calling that a failure
would teach people to ignore the gate.

Worth recording because it was found by looking rather than by reasoning: the parse
*succeeded* while the stale cache was planted. The `/tmp` copy from the previous run was
still valid and got reused, so the hazard did not bite — this time. The check exists for
the run where it does.

### An unresolved defect: `startIndex` is not a byte index

**Proven.** For a file containing non-ASCII, the reported `startIndex`/`endIndex` are
**UTF-16 code units**, not bytes. A file mixing 2-, 3- and 4-byte characters, read through
this parser and the same one upstream, gives:

| name | reported | bytes | UTF-16 |
|---|---|---|---|
| `b` | 28 | 29 | 28 |
| `c` | 54 | 57 | 54 |
| `zzz` | 82 | 87 | 82 |

UTF-16 every time, and `startPosition.column` agrees with it. `src/types/
web-tree-sitter.d.ts` declares `startIndex: number` and **says nothing about the unit**,
while upstream tree-sitter reports bytes. Every analyzer in this repository passes the
value straight through, so this is one library's behaviour inherited by roughly fifteen
lanes, and the missing unit is why it went unnoticed.

The corpus effect is bounded and measured: **7 symbols, in the 15 of 1,155 compared files
that contain non-ASCII**. In `shiny/R/shiny.R`, R places `cache` at byte **39407** and the
analyzer reports **39395** — exactly the 12 surplus UTF-8 bytes earlier in the file.

**A hypothesis I tested and threw away.** The tempting move is to claim the (line, column)
pair is sound and only the range is in the wrong unit, so the fix is a conversion. I
measured it, and it is **false**: (line, column) locates **14,964 of 16,290** symbols,
against **16,283** for the byte range. Line/column is *worse*, because 1,326 symbol ranges
do not start at the name for reasons that have nothing to do with units — an S4 class
range begins at the `setClass` call, for instance. So (line, column) cannot stand in for
a byte offset, and a remedy has to convert the range itself. The number is in the evidence
record under `unitFinding.REFUTED`, because a refuted hypothesis with a number attached is
worth more than a plausible story, and it is what stopped the wrong fix being proposed.

**Resolved, additively.** The decision was to add `byteStart`/`byteEnd` *alongside* the
existing fields rather than convert them, so nothing that already reads
`startIndex`/`endIndex` moves. `src/ast/engine.ts` declares them as optional, the unit of
the existing fields is documented where they are declared, and
`src/types/web-tree-sitter.d.ts` now states plainly that the library reports **UTF-16 code
units** — which is the single most load-bearing fact in that file and was previously
unstated.

The result is measured on the same symbols with the same query, differing only in the unit:

| range used | symbols located correctly |
|---|---|
| existing `startIndex`/`endIndex` (UTF-16) | 16,283 of 16,290 |
| new `byteStart`/`byteEnd` (bytes) | **16,290 of 16,290** |

All 16,290 symbols carry the byte fields, and every one resolves. **So the unit was the
whole defect**, not a contributing factor — which the refuted hypothesis above had made
uncertain, and which no amount of reasoning would have settled.

The 7 non-ASCII symbols still fail through the *existing* fields. That is a decision, not
an oversight: ~15 lanes read those fields today, and changing them is a breaking change
made while other lanes are mid-flight. A consumer that needs a correct byte offset now has
one.

**One thing found on the way:** a second, near-identical `UniversalSymbol` exists in
`src/ast/types.ts` and is imported by **nothing**. The first edit landed there, had no
effect, and produced a type error that looked like the change was wrong. Two declarations of
one contract is how they drift; the live one now says which it is.

The existing range audit cannot see this: it recomputes offsets in the same unit the
analyzer reports, so it is self-consistent by construction. **Two harnesses sharing a
unit assumption agree with each other and are wrong together.** That is the most
important thing this pass found, and it is left open rather than quietly patched,
because the unit is a framework-wide contract and 1.3% of files is not the place to
change it unilaterally. Every one of the 7 remaining position failures is this.

### The nameability of a callee is a property of its text, not of its node type

The first fix here allowlisted node types. That was the wrong axis and it cost real
coverage: the grammar gives `return` its own node type, so every `return(x)` in the corpus
stopped producing an edge — **1,089 removals the audit could not explain**. `return` is a
name; it is a name the grammar happens to tokenize specially.

Asking instead whether the callee's text *is* an R name gets it right without enumerating
the grammar, and stays right if a future grammar adds a node type. `chol2inv((if (uplo
== "U") triu else tril)(x))` is not a name and gets no edge; `return(1)` is.

### Which line an edge points at

"The line that names the target" needed a rule for a target split across lines. R's
promises package chains routinely:

```r
p$value <- p$value$          <- line 743: `value` is here
  then(function(value) {     <- line 744: `then` is HERE
```

The target is `value$then`. The rule adopted is **the line where the target's last name
component is written** — uniform, and identical to the expression start for the ordinary
one-line `pkg::fn` and `obj$method` cases. "The line where the expression begins" is not a
property of the call; it is an artifact of where the author pressed return.

A related fix: `nameLineOf` found a symbol's name with a plain substring search, so
`theme` matched inside `class_theme` and put `global exports theme` on the binding's line
instead of the line the class is named on. It now requires a whole identifier.

### An audit whose baseline cannot be named cannot be believed

The removal audit compared the current analyzer against `/tmp/r-head-analyzer.ts` — a
snapshot in a temp directory that nobody could reproduce or date. It was reporting **79
`contains|global|<name>` edges as lost that this lane had never touched**, because they
had been gone for some while. The baseline is now checked out from a **pinned git commit**,
its import paths rewritten so the snapshot loads, and the commit printed in the output. A
baseline that fails to load aborts the run, because a baseline that silently analyzes zero
files reports "nothing was removed" — the most flattering possible false result.

## The repo's own M60 gate covers this lane

`script/m14/differential.ts` had no `LANGS.r`, so `bun script/m60/lane-surface-audit.ts
--lang r` exited `2 — unknown language r`: the repository's own line-number and
name-surface audit had **never looked at R**, and this lane had verified the same property
with its own harness instead.

R is registered now (`LANG_REPOS.r = "ggplot2"`, the largest R holding in `CORPUS_ROOT`).
On the full 357-file corpus the repo's tool reports **0** for every row it measures:

| row | value |
|---|---|
| files / edges / symbols | 357 · 10,093 · 3,965 |
| relationships with no line | **0** |
| relationships with line 0 | **0** |
| relationships missing a seam key | **0** |
| names not a name / not in source | **0** |
| ghost targets | **0** |
| parse errors | **0** |

This is the same conclusion the R-positions oracle reaches by a stronger route — R's own
lexer rather than a text search — and the agreement matters, because it is the first check
of R by something this lane did not write.

## The red-team pass

`reviews/r/adversarial-2026-09-28.md` is the full record. The short version: the
differential's 1.000000 was *agreement*, because the oracle that produced it shares an
author with the analyzer. Asking R a different question — evaluate the file, then ask the
environment what it holds — found three classes no amount of fixture work would have:

- a **quoted assignment target** (`"%+replace%" <- …`, which ggplot2 writes) published
  nothing at all;
- a **statically dead `if (FALSE)` branch** published declarations R never makes;
- a **top-level `rm()`** left the removed helper published, 59 names across the corpora.

With the oracle corrected to stop sharing those blind spots, precision read **0.990219** —
not 1.0 — and the binding count fell 8,798 → 8,707. All three are fixed, pinned by
`F16-runtime-semantics.R` and four new mutants (30/30 caught), and the 1.0 is now earned:
an oracle cross-checked against R's own runtime on 321 files with 0 disagreements.

The pass is **self-directed, not independent**, and the log says so. It covers 27% of the
corpus, checks only bindings rather than `imports`/`exports`/`overrides`, and the exec
oracle's own assumptions are unexamined. Those are the honest limits of the result.

## Text operations (the complete inventory)

There are **no regex literals** in the analyzer. Every text-level operation is
confined to a single node's own text, because the grammar exposes no
sub-structure for it:

| Operation | Why the grammar cannot express it |
| --- | --- |
| strip one backtick pair from an `identifier` | tree-sitter-r reports a quoted identifier as a plain `identifier` whose text still carries the backticks |
| unquote a `string` via the `content` field, first/last-token fallback | `content` is absent for `""`; the quotes are anonymous tokens |
| roxygen tag position test inside a `comment` | a comment is a single token; `@export` has no node |
| `generic.class` S3 prefix | R's registration convention is a property of the identifier's text |
| all-uppercase -> constant | likewise |

`apply`-family and tidyverse detection use exact `Set` membership, not substring
tests. Namespace collapsing uses the `rhs` **field** of `namespace_operator`, so
`::` and `:::` behave identically.

## Verification evidence

Regenerate with `bun run script/m12/r-evidence.ts`; every record is sealed and
refuses a hand edit.

- **fixture set (pinned)** — `validation/m12/results/r-fixture-set.json`: the 15 fixture
  sources and the ground truth they are scored against, both committed and hashed, so the
  two headline numbers below can be re-run rather than believed. `setSha256` covers the
  whole set; each fixture carries its own digest. The set lives in
  `validation/m14/fixtures/r/`, which is where `script/m14/owner-spot-check.ts` inventories
  a lane's fixtures from — one canonical copy, because two copies of a fixture set is how
  they drift. `validation/m12/results/SPOT-CHECK-PACK-r.md` is the human-sampling pack.

  These lived only in an unversioned scratch directory until now, which meant **251/251 and
  26/26 were assertions rather than results** — the same defect already fixed for the two
  oracle scripts, and missed here until the closure step went looking for them. Both
  harnesses now prefer the committed paths and *report which they used*, so a future run
  against the scratch copy cannot be mistaken for a reproducible one.

- **R-oracle differential (the strongest check in this lane)** —
  `validation/m12/results/r-oracle-differential.json`: **R 4.4.3 itself decides
  which top-level names each of the 997 comparable corpus files binds, and the
  analyzer is asked the same question.** Result: **8,798 bindings, 8,798 agree,
  0 phantom, 0 missed, precision 1.000000, recall 1.000000.**

  The two sides share no grammar, no code and no assumptions. R's own `parse()`
  builds the AST — so R's grammar and R's desugaring of the rightward forms are
  already applied — and a walk over that AST collects the file-level names.
  Nothing is executed, so there are no stubs and no unevaluated files.

  This is the check that earned its place: it found **two errors a fixture suite
  structurally could not** — a wrong belief about `->` that the fixtures had been
  written to match, and an identifier the grammar split in half.

  **But its 1.000000 was agreement, not verification** — see
  [the red-team pass](../reviews/r/adversarial-2026-09-28.md). The oracle is a walk over
  R's AST written by the same author as the analyzer, so it can share a wrong belief about
  R's *semantics* even while being immune to a wrong belief about the *grammar*. A second
  R method that EVALUATES each file and asks the environment what it holds disagrees with
  the oracle on 8 of 321 overlapping files, and all 8 were the oracle reporting names R
  never binds. Three real defect classes came out of it, and the honest precision before
  they were fixed was **0.990219**, not 1.0.

- **Grammar conformance (L2)** — `validation/m12/results/r-grammar-conformance.json`:
  **0 unknown node types, 0 unknown fields, 0 regex literals**, against node types
  and fields enumerated from the shipped wasm at run time. The one dead field the
  M14 register carried for R (`default_value`) is repaid and removed: the grammar
  names the field `default`.
- **Differential (L3)** — `validation/m12/results/r-differential.json`:
  12 hand-derived fixtures, **222/222 facts, precision 1.000, recall 1.000, 0 FP,
  0 FN, 0 unknown**, plus 0 phantom violations against each fixture's
  `mustNotEmit` list, 9 exact range assertions pinning the 1-based source
  columns of members and S4 slots, and a check that **every** edge carries a
  `line_number` that is the line actually containing its target.
- **Edge, line and name audit** — `validation/m12/results/r-edge-line-audit.json`:
  every edge located and correct, 0 unknown symbol names, 0 inconsistent ranges,
  and the relationship-type coverage count.
- **Corpus-scale line audit** (`fixtures/corpus/line-audit.mts`, re-derived from
  the parse tree without consulting the analyzer): **36,734 edges, all carry a
  line, 0 land on a line that does not contain their target; 8,410 symbols, all
  range/line/column/byteIndex self-consistent; 0 names that the grammar did not
  produce.**
- **Mutation (L4)** — 17 mutants, each re-introducing one reviewed defect as a
  source edit (`npx tsx validation/m14/fixtures/r/run-r-fixtures.ts --mutants`):
  **17 caught, 0 survivors, 0 harness faults**. A surviving mutant fails the issue.
  The count has moved twice and both moves are recorded here: it said 23 when the
  battery held 15, one site was corrected to 15, and the `::`/`:::` dependsOn fix then
  added `src-namespace-drops-dependson` and `src-namespace-target-is-the-function`,
  making it 17. The number is the one the runner prints, and the runner refuses a
  mutant whose edits leave the analyzer byte-identical, so it cannot inflate its own
  denominator. `src/ast/real-r-analyzer.ts` is restored byte-identical after each run
  and the runner asserts it.
- **Corpus** — `validation/m12/results/r-corpus-errors.json`: 1,174 files,
  16,467 symbols, 39,128 relationships, 2 files with parse errors (both correct).
- **A/B against the previous analyzer** — +3,313 relationship instances, 601
  removed, and **every removal lands in a named bucket with 0 unexplained**:
  332 backtick-normalized identity fixes, 6 phantom `library()` options no longer
  published as packages, 263 edges whose old *source* was an expression
  (`domain$onEnded`) that no symbol ever carried.

## Complexity

`fixtures/corpus/complexity.mts`. The extraction walk carries the chain of
enclosing `function_definitions` on an explicit stack, so attributing a call to
its enclosing symbol is O(nested functions) rather than O(tree depth); resolving
each definition's owner happens once, on entry. Relationship and `contains`
deduplication are `Set`-based.

- **Linearity**: one fixed R shape at 8 geometric doublings (29 KB -> 4.3 MB,
  500 -> 64,000 symbols, 750 -> 96,000 relationships). Per-KiB analyzer cost is
  flat: largest/median **1.41**, largest/previous-doubling **1.11**.
- **Throughput**: dplyr 270 symbols/s and 494 relationships/s; shiny 320/874;
  testthat 256/866; ggplot2 240/547; Matrix 230/508.
- **Pathological shapes**: a 60,000-argument call and 20,000 top-level
  assignments both cost ~2,700 us/KiB, in line with the corpus.

**Declared limitation, measured not asserted.** On a deliberately degenerate
12,000-deep call nest the analyzer takes ~42 s — but the raw
`childCount`/`child(i)` walk that any web-tree-sitter consumer must perform takes
~16-30 s of that, and `.parent` access alone roughly doubles it. Across all
1,174 corpus files the **maximum AST depth is 53** (shiny) and **no file exceeds
depth 100**; the degenerate shapes are two to three orders of magnitude beyond
anything real R code produces. The superlinear cost there is a characteristic of
the binding on an input shape that does not occur, not an analyzer defect — but it
is a real cost and is recorded rather than explained away.

## Limitations

Declared non-empty because R is Turing-complete, and each entry carries the
number that bounds it rather than an adjective.

- **Dynamic dispatch.** S3 dispatch, non-standard evaluation (`substitute`,
  `enquo`, `rlang` tidy-evaluation) and external package classes cannot be
  resolved from syntax, so `calls` edges are syntactic targets. Measured cost:
  1,015 `implements` edges at 0.8, every one a `generic.class` naming-convention
  inference with a reason code.
- **File scope is where R's code is.** 55.6% of call sites are at file scope
  because R packages are mostly top-level code, and `source` in this framework's
  relationship model is a symbol name. **110,381 `calls` and 6,948 `uses` reads
  are suppressed for want of an enclosing named symbol**, counted in
  `metadata.callAttribution` rather than dropped. A package's top level is the
  part of it that runs.
- **Cross-package resolution is not attempted and cannot be measured from this
  corpus.** 44.6% of `calls` targets resolve nowhere in a 13-package sample, and
  the top unresolved targets are base R functions — `return` (1,257), `list`
  (864), `is.null` (805), `paste0` (750) — because base R is not in the sample.
  The rate is a property of the corpus, not of the analyzer.
- **`overrides` is file-scoped.** 26 of the 29 same-file-or-external base
  relationships in the corpus have their base in another package and cannot be
  resolved from syntax; 3 are emitted.
- **`instantiates` inherits the file-scope limitation.** 23 same-file
  constructions occur and 1 edge is emitted; the other 22 are at file scope.
- **A closure stored on an object** (`domain$onEnded <- function() ...`) creates
  no named R binding, so calls in its body are counted unresolved rather than
  attributed to an invented symbol.
- **Non-standard evaluation is detected, not resolved.** Tidyverse NSE verbs,
  `substitute`/`quote`/`enquo` and reactive constructors are recorded as metadata
  patterns; the analyzer does not evaluate what they capture.
- **Other R object systems are not covered.** R6, R5, S4 and S7 are. Environments
  used as classes, `proto`, `refclass` legacy forms and R5 `fields=` polymorphism
  are not.
- **Grammar-version drift.** The lane reads the `rhs`, `operator`, `name`,
  `value`, `default`, `function`, `arguments` and `lhs` fields and the
  `extract_operator`, `namespace_operator`, `subset`, `subset2`, `argument`,
  `binary_operator`, `function_definition`, `call`, `string`,
  `string_content`, `braced_expression`, `parenthesized_expression` and
  `if_statement` node types of a **patched** `@eagleoutice/tree-sitter-r@1.1.2`
  build. A grammar change to any of them moves the lane silently.
- **Grammar memory exhaustion makes corpus totals move.** Every production census
  logged `[BB-PARSE-ERR] r | <file> | memory access out of bounds`, on different
  files in different runs over the identical corpus: 22,449 symbols in one run,
  22,464 in another. `probe-oom.ts` establishes that per-file counts are stable
  (0 of 160 `r-rlang` files varied across 3 passes) and that 15 files legitimately
  publish no symbols. The defect is in which files the wasm parser survives.
- **A shared-machinery denylist still deletes real R symbols, and it accounts for
  every unresolved `contains` and `exports` edge in the population.** `keepSymbol`'s
  residual `UNIVERSAL` set in `src/ast/pool-worker.ts` holds `this` and `super`; its
  own comment says the names that remain are those "no lane has produced a
  counterexample for", and this lane has one for both. `super` is an exported S7
  function (`S7/R/super.R:100`) and an S4 slot in Matrix
  (`Matrix/R/00_Class.R:723`); `this` is a `local()` binding in two testthat files.
  Measured cost: **7 symbols across 4 files, leaving 5 edges** (4 `contains`,
  1 `exports`) pointing at names the index does not hold. An earlier, larger instance
  of the same defect — `source_file`, 12 symbols across 9 files — was measured here
  and has since been fixed upstream. Reported, not fixed: shared machinery.
- **`keepSymbol` keeps the name `unknown` for every language, while the comment
  beside it says a per-language `RESERVED` set should refuse it.**
  `pool-worker.ts:499-501` states `unknown` "now moves to RESERVED below … so a
  placeholder is still refused while a declared `unknown` survives", but no
  `RESERVED` set contains it — the map holds only `php {self, parent}` and
  `sql {program}`. Measured cost to R over 1,492 files: **0 symbols named `unknown`
  reach production**, so nothing is wrong in the graph today; the risk is that an
  analyzer minting `unknown` would have it published rather than refused, which is
  the case the placeholder accounting in `R7` exists to prevent.
- **There is no differential for R.** `script/m14/differential.ts` has no
  `LANGS.r` entry, so all nine previously-emitted types are DERIVATION findings —
  stored and compared against nothing. The only independent cross-check available
  is a parse-tree count that agrees with the analyzer's own suppression counter at
  2,314, which corroborates one number and cannot see a grammar bug the two share.
- **The corpus is 13 CRAN-adjacent repositories, not all of CRAN.** 1,890 of the
  2,016 tracked R files, first 250 per repo. Nine repositories were cloned for this
  pass; `r-lib/data.table`, `r-lib/shiny`, `r-lib/purrr` and `r-lib/tibble` were
  unreachable from this host, so R6-heavy and S4-heavy packages are
  under-represented relative to CRAN as a whole.
- **`[BB-PARSE-ERR]` files are excluded from nothing.** They are counted as
  parsed with whatever the pipeline recovered, which is why the symbol totals
  differ between runs.
- **An instrument's own error rate is not in this document's own tables.** The
  BLOCK B probe above carried three defects before it was right (a `===` that
  web-tree-sitter makes always false, a diff that demanded one spelling per
  declaration, and a missing symbol-set check), and each one produced a
  confident wrong number. Any probe in this lane — including the two that
  adjudicated it — has an unmeasured error rate of its own, and the count that
  would measure it does not exist yet.
- **A base class named with its package loses the package.** `inherit =
  pkg::Parent` publishes `extends -> Parent`, not `-> pkg::Parent`, because no
  symbol named `pkg::Parent` binds in any file. A graph consumer cannot tell
  from the edge that the base came from another package. Measured cost: **1
  occurrence** in 2,342 corpus files, so the loss is bounded and named rather
  than fixed.
- **A class whose name is a runtime expression cannot be published.** 2
  occurrences (`S7/inst/doc/performance.R:68` and `:104`), where the name is a
  `for` variable over generated strings. Correct to omit, but the omission is
  indistinguishable in the graph from the class not existing.
