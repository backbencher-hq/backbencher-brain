# real-r-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-r-analyzer.ts`
- Grammar: `grammars/tree-sitter-r/grammar.js` (vendored), built to
  `wasm/tree-sitter-r.wasm`
- Parser: pinned `tree-sitter-r` WASM at `wasm/tree-sitter-r.wasm`
- Wiring: `ASTEngine.getAnalyzer("r")` -> `RealRAnalyzer`
- Corpora: `dplyr@d5e94e7`, `Matrix@d598862`, `ggplot2@313d090`, `shiny@8184460`,
  `testthat@09dcd88` under `$HOME/fixtures/repositories` — 1,174 tracked
  `.R`/`.r` files
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

## Relationship ontology

Every edge carries **`line_number`**: the 1-based line of the node that *names*
it, per the M59.A7 / #825 convention the rest of the family follows (33 of 44
analyzers). The R analyzer previously carried no line on any edge, so every R
relationship was unlocatable in the graph and the LSP. A `contains` edge is
stamped with the line its member's **name** is written on, not the first line of
the declaration — for a multi-line `Cls <- R6Class(` those differ.

| Relationship | Rule | Confidence |
| --- | --- | --- |
| `contains` | one edge per owner/member, deduped by (owner, name) | 1.0 |
| `exports` | a roxygen `@export` symbol, published from the same array that feeds `ExportInfo` | 1.0 |
| `overrides` | a class method shadowing a method of a base class **declared in the same file** | 0.95, `reasonCode: base_class_declared_in_same_file` |
| `imports` | every dependency, alongside `references` | as `references` |
| `calls` | the callee **as written** (`dplyr::filter`, `obj$method`, `Cls$new`) | 1.0 when the enclosing symbol is named by syntax; **0.7** through an anonymous closure, with `reasonCode` |
| `instantiates` | `Declared$new()`, or `new("Declared")` for S4 — only when the class is declared in this file | 0.9 |
| `extends` | R6 `inherit=`, R5 `contains=`, S4 `contains=`, S7 `parent=` | 1.0 |
| `implements` | dotted S3 method to its generic prefix | **0.8**, `reasonCode: s3_dotted_name_convention` |
| `references` | `library`/`require` package, `source()`/`sourceCpp()` path | 1.0 for a string literal, 0.8 for a bare identifier |

Every edge below 1.0 carries a `reasonCode` and a `reason` string in its
metadata. `calls` inside an anonymous function passed as a call argument —
`lapply(x, function(v) f(v))`, `tryCatch(..., error = function(e) ...)`,
`shiny::moduleServer(id, function(id) ...)` — is attributed to the nearest
enclosing **named** symbol at 0.7, because the closure itself is not a
declaration. When there is no enclosing named symbol the call is counted in
`metadata.architecturalInsights` as `r.ambiguity.callsUnresolvedScope` rather than
being given an invented source.

`uses` is the one universal type R does not emit, and the omission is recorded
rather than left implicit: R has no import-binding indirection distinct from the
dependency itself, `references` and `imports` both carry it, and
`evidence_tier.ts` already classifies `references` as a usage context. The
machine-checked count is in `validation/m12/results/r-edge-line-audit.json`:
**9 of the 10 universal values emitted, 1 justified as not applicable.**

`library()`/`require()` publish exactly **one** dependency: the first positional
argument. Every other argument is an option (`warn.conflicts`, `quietly`,
`character.only`, `pos`, `lib.loc`, `mask.ok`, `exclude`, `include.only`,
`attach.required`) and is not a package.

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

- R is dynamically dispatched. S3 dispatch, non-standard evaluation, and
  external package classes cannot be resolved from syntax alone, so `calls`
  edges are syntactic targets.
- A closure stored on an object (`domain$onEnded <- function() ...`,
  `self$x <- function() ...`) creates no named R binding, so calls in its body
  are recorded unresolved rather than attributed to an invented symbol.
- S3 generic resolution for `implements` is a naming convention, not proof; it is
  labelled 0.8 with a reason code.
- S7, R6, R5 and S4 are covered; other R object systems in circulation are not.
- The corpora are five representative CRAN packages, not all of CRAN. Only two
  files fail to parse, and both failures are correct.
