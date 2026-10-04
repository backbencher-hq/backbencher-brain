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

**4. Labelled** — the boundary that matters is `uses` / `calls` / `references` /
`imports`, and it is enforced and pinned in both directions. `F17-uses.R` gives
the `[` and `[[` cases DIFFERENT member names so the `[` case cannot be satisfied
by the `[[` one; with one shared name the section would have passed whichever way
the rule went. `overrides` is `Base -> member` with `overriddenBy: Derived` in
metadata — the member belongs to the base and the subclass shadows it — and that
direction is stated rather than left for a reader to infer. `implements` is 100%
at 0.8 with `reasonCode: s3_dotted_name_convention`: R registers an S3 method by
writing `generic.class`, and nothing in the FILE proves the generic exists.

**5. Resolved** — reported at TWO scopes, because they answer different
questions and conflating them is how a 40% number reads as 90%. *local* is
"resolves to a symbol in the file that emitted the edge", the only scope a
single-file parse can be held to, and the one comparable to CSS `references` at
66.8% quoted in the workstream header. *corpus* is "resolves to a symbol in some
file of the sample".

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

**The one ghost `exports` edge is a shared-machinery defect, not an R one.**
`r-testthat/R/source.R:18` declares

```r
source_file <- function(path, env, chdir, desc, wrap, shuffle, error_call)
```

and roxygen `@export`s it at line 16. `analyze()` publishes the symbol,
`ASTEngine.parseFile` publishes it, and production `parseFile` **does not** — and
the `exports` and `contains` edges naming it survive, because
`filterNoiseRelationships` consults a different list than the symbol filter does.
The cause is `keepSymbol`'s `UNIVERSAL` denylist in `src/ast/pool-worker.ts:448`,
which contains the string `"source_file"` beside `"root"`, `"program"`,
`"module_declaration"` and `"package_manifest"`. Those are tree-sitter node-type
names. Not one of the fifteen is an R keyword, and `source_file` is an ordinary R
function name. Measured over the corpus
(`validation/m14/fixtures/r/probe-denylist.ts`): **12 R symbols deleted across 9
files** — `this` 5, `me` 4, `root` 2, `source_file` 1. The file is shared
machinery (workstream §8), so this is reported and not fixed.

**6. Confident** — `evidenceClass` and confidence, per type, are in the table
above. The count the honesty contract §4 asks to be queryable:

| | count | share |
| --- | --- | --- |
| edges below 0.7 (heuristic by the contract's own threshold) | **0** | 0.00% |
| edges at exactly 0.7 (closure-attributed `calls` and `uses`) | 1,765 | 2.69% |
| edges at 0.8 (S3 `implements`, bare-identifier `library`, `references` to a bare identifier) | 1,415 | 2.16% |
| edges at 0.9 (`instantiates`) | 1 | 0.002% |
| edges at 0.95 (`overrides`) | 13 | 0.02% |
| edges at 1.0 | 62,422 | 95.15% |

**95.15% of the R graph is at confidence 1.0**, and the largest sub-1.0 population
by type is `implements` at 0.8 — all 1,015 of it a labelled naming-convention
inference, with the reason on every edge.

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
- **The `exports` resolution rate is measured against a file-local set and one of
  its edges is a ghost.** 3,490 of 3,491 is not 3,491 of 3,491, and the difference
  is a shared-machinery denylist entry, not an R rule.
- **Corpus totals for R are not bit-reproducible under concurrency.** Every
  production census of this lane logged `[BB-PARSE-ERR] r | <file> | memory access
  out of bounds`, and WHICH files logged it changed between two runs over the
  identical corpus: 22,449 symbols in one, 22,464 in another. `probe-oom.ts`
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
- **`references` does not carry namespace-qualified reads.** 5,674
  `namespace_operator` nodes occur in the corpus; 5,260 are a call's callee and
  already produce a `calls` edge to the qualified target plus an `imports` edge to
  the package; 414 are not, and none produces a `references` edge. Declared as an
  asymmetry rather than fixed, because the label it would take is a judgement call
  about `uses` versus `references` that belongs to the supervisor's ontology, not
  to one lane.

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
| `run-r-fixtures.ts` | production `parseFile` | fixture pass/fail, and 10 mutants | anything the shared `run-fixtures.ts` asserts that this copy does not |

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

`validation/m14/fixtures/r/F17-uses.R` with `F17-uses.expectation.json`, executed by
`npx tsx validation/m14/fixtures/r/run-r-fixtures.ts` through production
`parseFile`, plus the ten-mutant battery behind `--mutants`:

```
fixtures: 1 passed, 0 failed
mutants: 10 caught, 0 survived or refused, of 10
```

Four of the ten are OUTPUT transforms and six are SOURCE edits, and the split is
not cosmetic: a gate's whole behaviour is to emit nothing, so no transform of the
emitted edges can express a defect in one. **Three of the ten were no-ops on their
first version and were refused rather than counted** — one returned its input
unchanged, one matched a target shape the analyzer had already normalised, and one
edited a helper the walk never consults. A mutant that cannot fail is worse than
no mutant, because it inflates the denominator of a ratio; the runner now refuses
a mutant whose edits leave the file byte-identical, and whose anchor does not occur
exactly once.

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
- **Mutation (L4)** — 23 mutants, each re-introducing one reviewed defect as a
  source edit: **23 caught, 0 survivors**. A surviving mutant fails the issue.
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
- **A shared-machinery denylist deletes real R symbols.** `keepSymbol`'s
  `UNIVERSAL` set in `src/ast/pool-worker.ts` contains the tree-sitter node-type
  name `source_file`, which is also an ordinary R function name that testthat
  defines and `@export`s. Measured cost over the corpus: **12 symbols across 9
  files** (`this` 5, `me` 4, `root` 2, `source_file` 1), leaving `exports` and
  `contains` edges pointing at names the index does not hold. Reported, not fixed:
  the file is shared machinery.
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
