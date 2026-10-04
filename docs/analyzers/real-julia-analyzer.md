# Julia Analyzer

> Canonical path `docs/analyzers/real-julia-analyzer.md` (renamed from `julia.md`, 2026-10-03;
> `script/m14/verify-doc-truth-emissions.ts` resolves an analyzer's doc by that name and reported
> `MISSING_DOC real-julia-analyzer.ts` while `julia.md` sat beside it). One reference to the old path
> belongs to a shared file — `script/m14/completeness-inventory.ts:733` — and is reported, not edited.

## What it extracts
- **Symbols**: modules, structs (`class`), `abstract type` (`interface`), functions, macros, struct
  fields (`property`), `const` bindings (`constant`), local bindings (`variable`)
- **Relationships**: `calls`, `uses`, `references`, `contains`, `extends`, `instantiates`,
  `overrides`. `imports` and `exports` are carried on the `ImportInfo[]` / `ExportInfo[]` channels and
  never as relationship rows — each ruled below with its measurement.
- **Payloads**: `declarationForm`, `isExported`, `isForeignCall`/`foreignSymbol`/`foreignLibrary`,
  `isTypeConstruction`, `isMacroCall`, `isTypeReference`, `isSubtype`, `isWhereBound`, `isFieldRead`,
  `isQualifiedReference`, `isOperatorMember`, `evidenceClass`, `replacesLine`, `isMethodRedefinition`,
  `via: "identical_signature_redefinition"`, `signature`

**Reproduce every number in this file:**

```
npx tsx validation/m14/fixtures/julia/census.ts --json /tmp/census.json       # the census, 971 files
npx tsx validation/m14/fixtures/julia/overrides-differential.ts --json /tmp/ov.json
bun  run script/m14/run-fixtures.ts --lang julia
bun  run validation/m14/fixtures/julia/mutation-check.ts --all
npx tsx script/m14/ontology-coverage-gate.ts julia                            # exit 2, see below
```

**The arbiter has no table for julia and refuses to report.** `script/m14/ontology-coverage-gate.ts`
carries ruling tables for `bash` and `json` only, and exits 2 with *"no RULING TABLE for julia …
Refusing to report: a gate with an empty table would call every un-emitted type RULED-UNJUSTIFIED and
that is a verdict about the TABLE, not about the lane."* `RULED_BY_LANG` is at
`ontology-coverage-gate.ts:192` and adding a `JULIA_RULED` table there is a shared-file edit (§8).

**That edit is now written down and tested, and it is two lines.**
`script/m14/julia-ruled.ts` exports `JULIA_RULED` (and `JULIA_RULED_INSTRUMENT_B`, the table that
FALSIFIES the same ruling — see below). The supervisor needs one import after `ontology-coverage-gate.ts`
line 191 and one key added to `RULED_BY_LANG`; the exact edit is in that file's header. Applied to a
**scratch copy** at `.bb-tmp-julia-arbiter.ts` (gitignored, since deleted; the shared file was not
touched), over the same 971 files:

```
type          status            detail
calls         EMITTED           86,867 edges in 4+ files
uses          EMITTED           26,357
contains      EMITTED           10,467
imports       EMITTED           1,501
references    EMITTED           36,146
exports       EMITTED           1,770
extends       EMITTED           1,821
implements    RULED-SOUND       NOT EMITTED; the grammar produced 149 distinct node types
                                across the corpus and NONE expresses it.
                                Written ruling: script/m14/spec/julia-completeness.json#JUL-D2
overrides     EMITTED           3 edges in 3+ files
instantiates  EMITTED           2,830
----------------------------------------------------------------------------------------
emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0
```

**Those four counts are 13 edges short of this lane's, and the shortfall is one file, exactly.**
`calls` 86,867 vs 86,876 · `uses` 26,357 vs 26,359 · `references` 36,146 vs 36,147 · `imports` 1,501
vs 1,502. The arbiter printed `[BB-PARSE-ERR] … memory access out of bounds` for
`julia/stdlib/LibGit2/test/runtests.jl` in that same run, and that file emits **precisely**
`calls=9 uses=2 references=1 imports=1` — 13, matching the deficit edge for edge and type for type.
`validation/m14/fixtures/julia/arbiter-census-diff.ts` establishes the other half: run SEQUENTIALLY
under the **arbiter's own counting rule**, the same 971 files give **167,775**, `throw: 0`, and
`files with r.fallback truthy: 0`, and `BB_JULIA_WORKERS=8` reproduces the census's own numbers
exactly — so neither the counting rule nor the worker count explains it, and the trapped file does.
**The lane's headline numbers are the ones that include the file; the arbiter's are the truncated
ones.** The doc's verdict table is therefore not competing with the arbiter's, it is correcting it.

**Two further properties of the arbiter's output are artifacts of the shared gate, not measurements,
and apply to every language it scores.** Its file column reads `4+ files` for every large type
because `ontology-coverage-gate.ts` grows the set with `if (row.files.size < 4)` — the cap is in the
gate, so `calls in 4+ files` is not a statement about breadth (this lane measures 926). And its
`[BB-HANG]` handler is `process.exit(1)` (`src/ast/engine.ts:1412`), so a single slow file ends the
run rather than being reported: both are §8 items.

So the verdicts below are produced by the lane-owned census applying the gate's own two instruments
and the gate's own verdict algorithm to julia, and the gate's verdict algorithm now has a table to
read.

---

# The ten ontology types, verdict by verdict

**Corpus.** 971 admitted files, no sampling — the whole population the router (`detectLanguageFromPath`)
selects: `JuliaLang/julia` 941, `json_jl` 25, `nvim-treesitter` 5. 1,006 further candidates are
excluded for exceeding 512 KB and the exclusion is counted in the census output rather than left
silent. Production grammar `wasm/tree-sitter-julia.wasm`, md5 `dbcd79759b4216c80de73c17a56255f8`.

**Production totals.** 28,277 symbols · 167,775 relationships in the ten types · 0 crashes · 0 files
routed to the >1 MB structural fallback · **135 of 971 files (13.9%) yield ZERO symbols** and are
listed by name in the census output · **0 of 971 files unreadable by the production grammar**.

| Relationship type | Emitted? | Verdict, channel and measured size over 971 files | Files |
|---|---|---|---|
| `calls` | **EMITTED** | relationship, **86,876** | 926 |
| `references` | **EMITTED** | relationship, **36,147** | 852 |
| `uses` | **EMITTED** | relationship, **26,359** | 821 |
| `contains` | **EMITTED** | relationship, **10,467** | 540 |
| `instantiates` | **EMITTED** | relationship, **2,830** | 361 |
| `imports` | **EMITTED** | relationship **and** `ImportInfo[]`, **1,502** rows | 504 |
| `exports` | **EMITTED** | relationship **and** `ExportInfo[]`, **1,770** rows | 151 |
| `extends` | **EMITTED** | relationship, **1,821** | 323 |
| `overrides` | **EMITTED** | relationship, **3** | 3 |
| `implements` | **RULED** | no channel; 0 of 12 named constructs in the grammar inventory; the 325 nearest candidates are published as `extends` | — |

**Coverage is 9 emitted and 1 measured-absent — 9/9 on the emitted side, not 10/10 and not 9/10.**
The denominator shrank by one, and only through a RULED verdict that carries a corpus measurement
and a stated overturn condition. Numerator and denominator come from different instruments: the nine
from `parseFile` through the production path, the one from a tree walk that never consults the
analyzer.

**This table was 7 emitted and 3 ruled one commit ago, and two of those three rulings were wrong.**
`imports` and `exports` were RULED; they are now EMITTED, and the reasons are in
[§ `imports` and `exports` — two rulings overturned](#imports-and-exports--two-rulings-overturned).
A ruling that is later overturned is not a failure of the instrument; a ruling that cannot be
overturned is a failure of the instrument. Both of these could not be.

### The doc-truth gate cannot see the first row of this table

`parseClaimTable` in `script/m14/verify-doc-truth-emissions.ts:457-469` sets `started = true` and
`continue`s on the first body row after the header rule, so it never compares that row. Reproduced
against the gate's own exported function on a four-row synthetic table:

```
rows returned: 3      ('uses', 'contains', 'extends')  — the 'calls' row is absent
first body row present? false
```

The consequence is a cross-lane false negative: for any lane whose claim table leads with a
relationship type, a doc claiming that type is emitted while the analyzer emits nothing reads as a
**pass** — the `FALSE_POSITIVE` class the gate exists to catch, silently disabled for one row per
language. The same shape is reported against `real-kotlin-analyzer.md`, whose first row is also
`calls`. The fix is one line (drop the `continue`) in a shared file, so it is reported rather than
applied. The row is left FIRST here rather than reordered to make the finding disappear: making this
lane read clean by exploiting a gate bug would hide it for the lanes that still have it.

**This lane's current state under that gate is exactly one finding, and it is this bug:**

```
$ bun script/m14/verify-doc-truth-emissions.ts | grep julia
UNDOCUMENTED [julia] calls (relationship)
  docs/analyzers/real-julia-analyzer.md:52
```

`imports` and `exports` were also reported and are now cleared, and the fix was in this table rather
than in the gate. The gate derives its expected surface from the analyzer source, so the doc owes a
checkable claim per channel, and **the cell and not the surrounding prose is what the gate reads**: a
reader — or the next agent — extracts the cell. The cells now read **"EMITTED — relationship *and*
`ImportInfo[]`"** / **"EMITTED — relationship *and* `ExportInfo[]`"**, which names both channels
because both are now written from one walk.

That cell convention was itself the product of the wrong rulings. When the types were payload-only, the
cells had to read *"yes — on the import-site/export-site channel; RULED as a relationship"*, because a
cell saying `RULED — payload channel only` was a `NO_MARKER` to the gate: the gate saw a type the
analyzer published on no relationship and no channel marker, and reported it UNDOCUMENTED. **A gate
that cannot parse `RULED — payload channel only` will report a lane as undocumented until the lane stops
ruling.** That pressure is a plausible reason the ruling was never re-examined, and it is worth
recording: the instrument did not merely fail to catch a wrong verdict, it applied steady pressure
toward keeping it.

---

## `imports` and `exports` — two rulings overturned

Both types were RULED non-applicable by this lane. **Both rulings were wrong**, and the reason they
were wrong is the same shape in both: each named its own overturn condition, and each condition was
worded so that **doing the right thing could not satisfy it**. That is not a falsifiable condition.
A falsifiable ruling names a count that a correct implementation would move.

The independent corroboration is in the supervisor's own gate file.
`script/m14/ontology-coverage-gate.ts:143-152` carries this note on the **json** lane's table:

> `exports` WAS here and was removed: it was ruled on a grammar inventory ("no export_statement
> node") and that is the same unsound reasoning that produced the wrong `imports` ruling. […] it is
> emitted now, and the gate re-measures rather than trusting this note.

So the correction had already been made once, on another lane, for the same argument, and this lane
made it again anyway.

### `imports` — EMITTED, 1,502 edges across 504 files

**What the ruling claimed.** Not emitted, because `RelationshipType.Imports` serializes to
`"brain_import"` (`src/ast/types.ts:69`) and the repo treats the `ImportInfo[]` channel as the import
surface.

**Why that was wrong.** `"brain_import"` constrains no lane at all. It is the string *every* lane
writes through when it emits the relationship:

| lane | site | source of the edge |
|---|---|---|
| python | `real-python-analyzer.ts:979`, `:1050` | `ctx.moduleName`, conf 1.0 |
| lua | `real-lua-analyzer.ts:569` | `frame.callable \|\| "global"` |
| yaml | `real-yaml-analyzer.ts:1017` | `path` |
| nim | `real-nim-analyzer.ts:1064` | — |
| typescript | `real-typescript-analyzer.ts:5509` | — |

Python is the exact structural analogue — a dynamic language whose module dependency is an
`import`/`using` statement — and it emits the relationship **and** fills `ctx.imports` from the same
walk. A convention was read as a constraint.

**What the ruling got right, and kept.** Its overturn condition was *"a julia `imports`
relationship row that is not an import-site artifact — a row whose source is the importing
declaration rather than the literal `root`"*. That is a real distinction and it is now the emitted
shape: **446 of 1,502 edges carry a module symbol as their source and 595 carry the file scope**,
because 71.9% of Julia corpus files open no module and a top-level `using` imports into `Main`.

**Resolution, and it is not close.** Target end: **50.0% (751) resolve to a declaration elsewhere in
this corpus**, 11.3% (170) are reachable through the file's own import path, 1.1% (17) resolve
in-file, and **37.4% (561) resolve to nothing** — `Dates`, `UUIDs`, `Printf`, `Test`, external
packages that are not in the corpus at all. Both-ends is **0.7%**. That number is a property of the
construct, not a defect in the edge: `using Dates` names a module this corpus does not contain, and a
Python `import numpy` resolves no better inside a Python repository. The honest statement is that
half of these edges are walkable at project scope and half name things outside the project, and the
census separates those two buckets rather than averaging them into one number.

### `exports` — EMITTED, 1,770 edges across 151 files

**What the ruling claimed.** Not emitted, for the same `brain_export` reason, "and additionally
because an `export` **declares nothing**".

**Why that was wrong, in two parts.** The serialization argument fails as above. The
`declaresNothing` argument was **correct** and is honoured: the emitted edge asserts no kind, no
symbol is fabricated, and the fixture proves it by exporting `Exported` (a `class`) and
`export_declare` (a `function`) under one statement. The mistake was promoting a real constraint on
*what the edge may claim* into a reason for *not emitting the edge at all*. `real-python-analyzer.ts:1166`
emits both channels from a single `__all__` walk and asserts no kind about the exported name either.

**Why the ruling's condition was unfalsifiable.** *"An `exports` relationship count above the
`ExportInfo` count for the same corpus."* Emitting one row per `ExportInfo` entry **cannot exceed
it**. The condition could only ever be met by an edge carrying something the channel does not — i.e.
by a wrong edge. A threshold that only a defect can cross is not a test.

**Resolution.** Target end: **41.8% (739) in-file unique, 36.0% (637) resolve elsewhere in the corpus,
9.0% (159) in-file ambiguous, 12.8% (226) resolve to nothing**; 87.8% of targets bind somewhere.
Both-ends is 34.4%, limited by the source end (55.8%): 962 edges carry a module symbol, 783 carry the
file scope.

### The construct count vs the edge count — the check that found a live defect

Reconciling *files containing the construct* against *files whose edge fired* is what exposed a
second, independent defect. It is now a standing census output:

```
imports   files with the construct: 504   files with >=1 edge: 504   silent: 0
exports   files with the construct: 152   files with >=1 edge: 151   silent: 1
```

**`using Base: isexpr` produced no edge at all.** That form parses as a `selected_import` node, and
`importTargets` matched neither `import_path` nor a bare `identifier` there, so it returned an empty
list. **583 of the 1,675 import statements across the 971 admitted files** were contributing nothing,
including `using Base: isexpr` at `julia/Compiler/src/Compiler.jl:40` — how the compiler reaches its
own standard library.

It was invisible three ways at once: the statements parse without an `ERROR` node, `parseFile` throws
nothing, and every affected file still publishes hundreds of symbols from its other declarations.
Only the statements-against-edges count finds it. Fixing it moved `imports` from 399 to 504 files.

The one `exports` shortfall is a **deliberate refusal**, and the census says so where the number is
printed: `julia/test/precompile.jl:15` is `export $Foo_module, $FooBase_module`, whose names are
`interpolation_expression` nodes computed at macro-expansion time. There is no name to publish, and
emitting the literal `$Foo_module` would assert a binding that exists nowhere in the file. The
alternative — a green 152/152 — would have meant asserting two names it cannot know.

---

## `implements` — RULED

**Instrument: A, grammar-inventory.** Julia has no interface-conformance relation. `abstract type`
participates in a **type hierarchy** (`<:`), not in a protocol relation, and publishing
`S implements I` for `struct S <: I` would apply the managed-OO ontology to a language that does not
have it.

**Probe.** `wasm/tree-sitter-julia.wasm` produces **149 distinct node types over the 971 admitted
files (4,948,278 nodes visited)**. Twelve node-type names were named from the ontology —
`implements_clause`, `interface_implementation`, `class_implements`, `protocol_conformance`,
`trait_implementation`, `object_declaration`, `protocol_declaration`, `interface_declaration`,
`trait_declaration`, `class_declaration`, `mixin_clause`, `conform_clause` — and the grammar produces
**none of them**.

The construct is not merely absent as a clause: the corpus's nearest candidate occurs **325 times
across 60 files** — a supertype clause naming an `abstract type` declared in the same file, e.g.
`json_jl/src/parse.jl:156` `JSONReadStyle{O,T,S} <: JSONStyle`. Every one of those is a **subtype**
relation and is published as `extends`. That is a number, and it is why the ruling is sound rather than
convenient: the thing `implements` would carry here is already carried, under its own name.

**What would overturn this ruling:** a non-zero count of any of the 12 named node types in the
instrument-A inventory, **or** a corpus measurement of an `implements` row that is not a subtype
relation. The census prints the first directly.

---

## `overrides` — EMITTED, and the earlier DECLINE was wrong

An earlier version of this file declined `overrides`, and so did the analyzer's own header, on the
grounds that *"Julia has multiple dispatch, not overriding"*. That argument is **sound for the case it
names** and **silent about the case julia has**. Two methods with the same name and different
signatures are different methods, both live, neither replacing the other — true, and irrelevant to the
method table. Julia's method table holds **exactly one entry per `(name, signature)` pair**, so a
second declaration of the *same* pair replaces the first, and Julia says so itself: under
`--warn-overwrite=yes` it prints
`WARNING: Method definition f(Int) in module Main at line 12 overwritten at line 40`.

This is the failure `script/m14/ontology-coverage-gate.ts`'s header records as **BD8b** for bash: a
type omitted on a prose justification, invisible to the differential because the oracle omitted the
type too. Two implementations that both say nothing agree perfectly.

### What it is in this language

An `overrides` edge means: *a later declaration in the same method-table owner replaced an earlier
declaration of the same method — same name, same argument list, same `where` clause.* The edge runs
`enclosing owner -> method name`, and `metadata.replacesLine` names the displaced site.

### The edge shape, and why it is not `name -> name`

A replacement's two endpoints ARE the same symbol, so a self-loop `f -overrides-> f` is the most
literally accurate shape available — and this codebase has ruled it out three times:

- `src/ast/real-php-analyzer.ts:2496` — *"UNRESOLVABLE and emit NO edge (a self-loop is always
  fabrication)"*
- `src/lsp/rich_hover.ts:222` — *"Degenerate self-loop rows … are not connections and not usages:
  skip them."*
- `src/intelligence/patterns/orphans.ts:818` — a self-loop `overrides` row is listed under **REFUSED
  EVIDENCE**, citing the rake `listen` regression

So the SOURCE is the enclosing **declared** owner — a `module`, or a type declaration, both of which
own a method table — and the target is the method. `module M … f(x) = 1; f(x) = 2 … end` gives
`M -overrides-> f` with both ends binding to real symbols in the same file. Same shape the bash lane
settled on and the shape `src/ast/override-retarget.ts` consumes.

### Why a TYPE owns a method table, and where that reading came from

This was found by the oracle, not by review. `validation/m14/fixtures/julia/overrides-differential.ts`
drives the analyzer and an independent derivation over all 971 files; an early version of the oracle
scoped a method table by the enclosing **module** only, and it disagreed with the analyzer on exactly
one construct in the corpus: `julia/test/core.jl:8196-8209` declares `struct S36104{K,V}` twice
inside `module M36104`, each with the same two inner constructors, and the file's own comment says
*"check that redefining it works"*.

The oracle was wrong. An **inner** constructor — `S36104{K,V}() where {K,V} = new()` written inside a
`struct` body — is added to the **type's** constructor table, and that table hangs off the type
*object*. A second `struct S36104{K,V}` creates a NEW type object with a NEW, EMPTY table and rebinds
the name; the first type becomes unreachable. The second constructor therefore does not displace the
first method in a live table — it writes into a different one.

**No julia runtime was available in this environment**, so that is an argument from Julia's data
model and not an observed result. It is stated as such because the opposite conclusion — *the analyzer
is under-emitting and the oracle found a real gap* — was the tempting reading of the same
disagreement, and only knowing where Julia keeps the table distinguishes them.

### Four guards, each with the measurement that put it there

This type took four rounds of measurement, and the edge count fell **417 → 237 → 200 → 163 → 44 → 3**
as guards landed. Every step down was a fabrication removed.

| guard | measured evidence | edges removed |
|---|---|---|
| unconditional position | 417 redefinition pairs across 109 files; **237 across 57** survive an unconditional position | 417 → 237 |
| not a local binding | 200 pairs are not inside a function body / `do` / `let` / `->` | 237 → 200 |
| the enclosing scope differs | 163 pairs are in a genuinely different scope from the earlier declaration | 200 → 163 |
| a DECLARED owner | 44 pairs sit inside a declared `module` or type | 163 → 44 |
| the guards combined | **3 edges** | 44 → 3 |

**Unconditional position.** `julia/JuliaLowering/src/lazy.jl:437-442` is
`if VERSION < v"1.11" … mem(n) = … else … mem(n) = … end` — same name, same signature, and exactly one
branch runs. Version guards are idiomatic Julia, so this bucket is large and counting it would have
been the fabrication the workstream's rule exists to prevent. The guard walks **ancestors**
(`else_clause` is not adjacent to its declaration) and covers `macrocall_expression` and the quote
forms, whose content is code Julia writes at expansion rather than text this file declares.

**The short-circuit branch, and why it is live.** `cond && function f() … end` is a version-guarded
method definition, so `&&`'s right operand is refused too. Measured over the 971 admitted files:
**11,549 `&&` binary_expressions, of which exactly 1 has a declaration node as its right operand** —
`julia/JuliaSyntax/src/core/parse_stream.jl:316`,
`VERSION < v"1.11.0-DEV.753" && function ParseStream(io::IOBuffer; version=VERSION)`. The same branch
tested with `||` returns **0 of 5,145**, so `||` is deliberately absent: a predicate the grammar cannot
reach is what honesty contract §2's L2 audit exists to report.

**Local bindings.** Inside a function body `f(x) = …` binds a *local variable* holding a closure. It
adds no method and displaces nothing. `compound_statement` is deliberately **not** in the guard set
because it is the node for both a function body *and* a top-level `begin … end` inside a module, and
the second is a legitimate method-table position.

**The owner's identity, not its name.** Two modules in one file can share a name and are still two
modules with two method tables. `julia/test/deprecation_exec.jl` declares `module Src` three times.
This is worth stating twice because **the first fix did not work**: the scope *name* threaded down
the pre-pass while its *line* reset to `0` at every frame, so every key came out `name@0` and the
change was indistinguishable from no change. A fixture with one module cannot see that. Reading the
source of all 63 edges found it.

### The 3 surviving edges, each verified by reading its file

```
julia/Compiler/test/contextual.jl:138  contextual[module] -> f[function]     replacesLine=136  sig=()
julia/test/meta.jl:242         TestExpandInWorldModule[module] -> m[macro] replacesLine=240  sig=()
julia/test/reflection.jl:1123  MethodDeletion[module] -> foo[function]     replacesLine=1118 sig=(::Int, ::Int)
```

`contextual.jl:136-139` is `f() = 1`, `@test overdub(Ctx(), f) === 1`, `f() = 2`,
`@test overdub(Ctx(), f) === 2` — the test after the second declaration asserts the replacement took
effect. `meta.jl:240-244` is `macro m() 1 end` then `macro m() 2 end`, and the test asserts `@m`
expands to `1`, i.e. the first still wins — a macro redefinition exactly.

### It is not `f(x)` replacing `f(x, y)`

`area(r::Int) = r * r` beside `area(r::Float64)` is a **new method**, not a replacement, and this is
pinned as a negative. The signature is the whole argument list plus the `where` clause:
`f(x) where {T} = …` and `f(x) where {S} = …` are two different methods, and `f(x) = 1` and
`f( x ) = 2` are the same one.

### The refusals, counted rather than hidden

`overrides` is refused at **file scope**, which is the majority case: 71.9% of the admitted corpus
declares no module, and `global` is this repo's documented synthetic scope rather than a symbol, so an
edge sourced from it resolves to nothing. The census prints every guard's surviving count so the
refusal is a number and not an absence: **417 → 237 → 200 → 163 → 44 → 3.**

---

# The six questions, per emitted type

Measured through `parseFile`. **RESOLVED means BOTH endpoints bind to a symbol declared in the SAME
file**, because the analyzer is per-file and that is the resolution one file's graph can promise.

**A correction, and it is the largest one in this file.** The resolution column used to read
`calls` 54.8%, `uses` 56.1%, `references` 53.7%, `extends` 64.1%. Those numbers were measured
against a **single union set of every symbol name in the whole corpus** — "is this endpoint a name
somewhere in 971 files" — while the text described them as per-file. Measured against each file's own
symbol table they are **19.8%, 25.0%, 19.5% and 20.4%**: the old figures overstated per-file
resolution by **2.2× to 3.2×**. The union number is not worthless — it is what a project-wide index
can resolve — but it is a different number and it was published under the wrong heading.

| type | EXISTS | FIRES | CORRECT | LABELLED | RESOLVED (both ends) | CONFIDENT |
|---|---|---|---|---|---|---|
| `calls` | yes | 86,876 / 926 files | 97.4% covered / 8.7% unexplained, oracle `julia-calls` | `usage_contextual` | **19.8%** (src 78.1 / tgt 23.1 / neither 18.7) | conf 1.0 on all; **0 under 0.7** |
| `uses` | yes | 26,359 / 821 | oracle `julia-refs` | `usage_contextual` | **25.0%** (src 76.3 / tgt 27.3 / neither 21.4) | conf 0.9; **0 under 0.7** |
| `contains` | yes | 10,467 / 540 | oracle `julia-contains`, which found a real defect | `structural` | **99.9%** (neither 0.0) | conf 1.0; **0 under 0.7** |
| `references` | yes | 36,147 / 852 | oracle `julia-refs` | `import_based` | **19.5%** (src 87.3 / tgt 20.7 / neither 11.5) | conf 1.0 ×34,128 + 0.95 ×2,019; **0 under 0.7** |
| `imports` | yes | 1,502 / 504 | **no oracle — see DERIVATION below** | `import_based` | **0.7%** both-ends (src 43.8 / tgt 1.3); target-end 50.0% corpus-only + 11.3% external-by-import | conf 1.0; **0 under 0.7** |
| `exports` | yes | 1,770 / 151 | **no oracle — see DERIVATION below** | `import_based` | **34.4%** (src 55.8 / tgt 50.7); target-end 87.8% bind somewhere | conf 1.0; **0 under 0.7** |
| `extends` | yes | 1,821 / 323 | oracle `julia-type-edges` | `structural` | **20.4%** (src 50.0 / tgt 28.7 / neither 41.7) | conf 1.0; **0 under 0.7** |
| `instantiates` | yes | 2,830 / 361 | oracle `julia-type-edges` | `usage_contextual` | **76.9%** (tgt 100.0, src 76.9) | conf 0.9; **0 under 0.7** |
| `overrides` | yes | 3 / 3 | **lane-owned oracle, 3/3, 0 unexplained, 0 missing — NOT yet wired into F5** | `structural` | **100.0%** | conf 1.0; **0 under 0.7** |

`contains` at 99.9% and `overrides` at 100.0% are the reference points showing the measurement is not
simply reporting that most edges are cross-file. The 19.5–25.0% figures for the other four are what a
consumer of one file's graph sees on a corpus that is one upstream project.

### The heuristic ratio is 0.0% for every type

Every one of the 167,775 rows is at or above 0.9 and `evidenceClass` is set on every one of them.
Honesty contract §4 requires the heuristic/deterministic ratio to be a queryable number, and for this
lane the answer is that there are none to count. That is a property of the design — every edge is a
syntax fact — and it is worth reading against the resolution column, because "no heuristics" and
"resolves 19.8% of the time" are independent facts and only the first is good news.

**One gap in the labelling, found and fixed:** `classifyEvidenceTier` had **no arm for `overrides`**.
It read `contains`, `imports`/`exports`/`references`, `calls`/`uses`/`instantiates` and
`extends`/`implements`, and an unlisted type falls through with no tier at all — so the first 6
`overrides` edges were published with **no `evidenceClass`**, which every consumer that groups
relationships by tier counted as unclassified. It now sets `structural`, pinned as a value in the
fixture.

## INCOMING: can the graph walk TO the other end?

`src/lsp/impact.ts` walks the graph backwards by scanning outgoing edges and matching **targets**,
because the schema stores no inbound edge. So the quality of a reverse walk is exactly the quality of
the table below, and two things follow that are this lane's problem rather than the traversal code's.

Each edge's endpoints are classified into seven buckets. The split between the last four is the whole
deliverable: an endpoint that resolves to nothing is otherwise indistinguishable from a declaration
that was never indexed, and those are opposite findings.

| type | edges | in-file unique | multi-symbol, disambiguated | multi-symbol, residual | C `ccall` | external by import | declared in another corpus file | local binding, not a symbol | resolves to nothing | synthetic scope |
|---|---|---|---|---|---|---|---|---|---|---|
| `calls` | 86,876 | 19,258 | 434 | 336 | 1,184 | 3,819 | 54,004 | 1,140 | 6,701 | 0 |
| `uses` | 26,359 | 5,384 | 285 | 1,514 | 0 | 0 | 13,683 | 1,803 | 3,683 | 7 |
| `contains` | 10,467 | 7,771 | 0 | 2,687 | 0 | 0 | 0 | 0 | 7 | 2 |
| `references` | 36,147 | 3,504 | 3,689 | 302 | 0 | 1,044 | 18,776 | 2,369 | 6,463 | 0 |
| `imports` | 1,502 | 17 | 0 | 3 | 0 | 170 | 751 | 0 | 561 | 0 |
| `exports` | 1,770 | 739 | 0 | 159 | 0 | 0 | 637 | 9 | 226 | 0 |
| `extends` | 1,821 | 441 | 71 | 11 | 0 | 49 | 930 | 114 | 205 | 0 |
| `overrides` | 3 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `instantiates` | 2,830 | 1,224 | 1,549 | 57 | 0 | 0 | 0 | 0 | 0 | 0 |

Bucket meanings, each of which is a claim with a stated basis:

- **in-file unique** — the name binds to exactly one symbol in this file.
- **multi-symbol, disambiguated / residual** — the name binds to more than one, and the edge's *own
  metadata* picks out exactly one / does not.
- **C `ccall`** — a C symbol, asserted by the file: the edge carries `isForeignCall` + `foreignSymbol`.
- **external by import** — the target is a qualified path whose root segment is named by an `import`
  or `using` in **this** file, read off the tree. `Base.println` in a file that says `using Base` is a
  dependency on another module, not a declaration this index lost. An *unqualified* name is
  deliberately not given this bucket: `using Base` would make every bare call in the file a Base call,
  and reading it that way relabels whole files and hides the ones that are not.
- **declared in another corpus file** — resolvable in principle by a project-wide index. For `calls`
  this is 54,004 of 86,876: the corpus is the Julia standard library, whose callees are declared
  elsewhere by design.
- **local binding, not a symbol** — a parameter, loop variable, `let` binding or catch variable. Bound
  in the file and deliberately unpublished, because `SymbolKind` has no `Parameter` member and the
  repo's standing negative contract says parameters are not symbols (csharp M12.07
  `ParamsAreNotSymbols`). **Unresolvable by design, not a lost declaration.** 14,974 such bindings
  across the corpus.
- **resolves to nothing** — external package, `Base` builtin, dynamic dispatch, or a lost
  declaration. This census does not start a Julia runtime, so those four are NOT separable here, and
  the bucket says so rather than guessing a split.
- **synthetic scope** — `global` and `root`, this repo's documented synthetic scope names, counted per
  type in the table below rather than excluded from the denominator.

**19,022 `calls`, 6,234 `uses`, 3,234 `global` + 1,371 `root` `references` and 652 `instantiates`
edges are sourced from `global`/`root`.** Those are dangling sources by construction and are counted
as such: a resolution rate that excluded them would not be the number a consumer sees.

### The ambiguity, and the fact that the edge already carries the answer

**10,936 edges target a name the file publishes under more than one kind or more than once.** The
concrete case is structural in Julia rather than accidental: `struct Object … end` together with
`Object() = …` is **ONE binding** — the type name *is* the constructor — so the analyzer publishes
`class:Object` and `function:Object` side by side, and an edge whose target is that bare name names
two symbols.

**The edge's own metadata picks out exactly one candidate in 100% of the multi-symbol cases for
`calls` (434/434), `uses` (285/285), `references` (3,689/3,689), `extends` (71/71) and `instantiates`
(1,549/1,549)**, because each of those edges asserts the kind its target must have:

| metadata | means the target is | type |
|---|---|---|
| `isMacroCall` | a `macro`, else a `function` | `calls` |
| `isFieldRead` | a `property` | `uses` |
| `isTypeReference` | a `class` | `references` |
| `isSubtype` | a `class` or an `interface` (an `abstract type` is published as `interface`) | `extends` |
| `isTypeConstruction` | a `class` | `instantiates` |

So for those five types the ambiguity is **not a defect** — the information needed to resolve it is on
the edge, and a consumer that matches targets by bare name is discarding it.

The residual is where a consumer must be told rather than shown:

- **`contains`, 2,687 edges.** *Disambiguated by its SOURCE*, not by its target: `Owner -contains->
  field` already names one member, and both-ends resolution for `contains` is 99.9%. A bare field NAME
  colliding across structs (`id`, `x`, `val`, 285/121/42 edges) is not something the reverse walk has
  to choose between. It is counted as residual because the *target* alone cannot disambiguate it, and
  reporting 100% here would be the false reassurance.
- **`uses`, 1,514 residual.** Same shape as `contains`: several structs declare a field named `x`, all
  of kind `property`, so `isFieldRead` narrows the kind and not the declaration.
- **`overrides`, 1 edge.** `julia/test/reflection.jl` declares **four** methods named `foo`, all of
  kind `function`, so the kind narrows nothing. It is disambiguated by `metadata.signature` and
  `metadata.replacesLine` instead.
- **`calls`, 336 residual** and **`references`, 302**: names with several same-kind candidates.

Two defects this section found in the instrument rather than in the graph, both recorded because a
gate that reports a clean bill of health for the wrong reason is worse than one that reports nothing:

- **The disambiguation filter counted distinct KINDS, not candidate SYMBOLS.** Five same-kind `property`
  candidates read as one kind and were scored disambiguated. Counting the array fixed it, and it moved
  `references` from 3,689 apparent disambiguations to a number that survives scrutiny.
- **The ambiguity table reused its numerator as its denominator**, so `contains` — which has no implied
  kind, so nothing is ever picked out — reported **0** multi-symbol edges while the table above it
  reported 2,687. A type with *no* disambiguator scored better than a type with a partial one. The
  denominator is now counted at the multi-symbol test itself.

### The differential, and the limitation it cannot cover

`npx tsx script/m14/differential.ts --lang julia --sample 200 --no-batch` (sample rotates per run,
so per-rotation counts move; the unexplained rate and the no-truth line are the stable figures):

```
[cold-pool] julia:julia: 0/200 fresh (rot 30, corpus 941)
[julia] julia: COMPARED WITH NO TRUTH: overrides (1 comparable, 0 truth)
[julia] julia: files=200 tree-truth=19052 covered=18839 (98.9%) MISSING=213
        analyzer-edges=20221 unexplained=1755 (8.7%) heuristic=0
        unexplained-by-label: calls=1075, contains=412, instantiates=100, extends=91,
                               references=53, uses=23, overrides=1
```

The `COMPARED WITH NO TRUTH: overrides` line is the harness naming the open DERIVATION finding itself,
and it is the line the three-line shared-file edit below removes.

Five lane-owned tree-truth oracles in `script/m14/oracles/` — `julia-contains`, `julia-type-edges`,
`julia-calls`, `julia-refs` — cover every label F5 compares for this language, each written from
Julia's own rule and **sharing no rule table, key set or resolver with the analyzer**, which is the
only property that makes a MATCH mean something.

**Declared limitation, and it is not a formality.** An oracle is a second walker over the **same
grammar**. It can disagree with the analyzer when either is wrong; it is **blind** when a construct is
absent from both, which is precisely how the `overrides` omission survived a differential that was
green throughout. Nothing in the differential can see a missing relationship type. Only measuring the
language can, and that is what the census's instrument B is.

## DERIVATION findings: 2 open in the lane, 1 more open in the F5 harness

Three types this lane emits are compared against **no independent oracle**, so they are stored and
audited against nothing. Counting them honestly matters more here than usual: for two of the three the
absence of an oracle is the direct reason a wrong verdict survived, because `script/m14/differential.ts`'s
F5 label allowlist admits `imports` and `exports` by default for every language — so the harness
compared **zero** julia `imports` rows against zero truth rows and printed *"COMPARED WITH NO TRUTH —
the published coverage for those labels is not coverage."* A type that is emitted and never compared
is exactly what a RULED verdict hides.

| type | edges | independent oracle | what stands behind it instead |
|---|---|---|---|
| `overrides` | 3 | **yes** — `script/m14/oracles/julia-overrides.ts`, 3/3 agreement | paid down below; not yet wired into F5 |
| `imports` | 1,502 | **no** | fixture `imports-and-exports` + the construct-vs-edge reconciliation (504/504, 0 silent) |
| `exports` | 1,770 | **no** | fixture `imports-and-exports`; 151 of 152 files, the shortfall explained by node type |

Neither of the two is close to paid down the way `overrides` was, and the limit should be stated
rather than papered over: an oracle for either would have to derive "this file imports that module"
and "this module exports that binding" from the tree **independently** of `importTargets` and
`exportableName`. Those are the two functions under test, so reusing them would make the oracle agree
with the analyzer by construction — the "two implementations that both say nothing agree perfectly"
failure the gate header records as BD8b. A real oracle means a second derivation of julia's module
grammar, which is a shared-file effort (`script/m14/oracles/` plus the `differential.ts` wiring) and is
therefore §8.

**What I did instead of an oracle, and its exact limit.** The construct-vs-edge reconciliation in
`validation/m14/fixtures/julia/census.ts` compares files containing the construct against files whose
edge fired. It is tree-side and analyzer-independent, and it is what caught `selected_import`. What it
cannot do is check that an emitted edge is the *right* edge — it would not notice a module name off by
one segment, or an `exports` row pointing at an imported name instead of an exported one. Those remain
unaudited.

`overrides` was the lane's first DERIVATION finding — emitted, stored, compared against nothing.

**Paid down.** `script/m14/oracles/julia-overrides.ts` is an independent derivation from Julia's
method-table rule, sharing no rule set, key set, guard list or resolver with the analyzer, and
`validation/m14/fixtures/julia/overrides-differential.ts` drives both sides over the whole corpus:

```
SIDES      analyzer `overrides` edges via parseFile: 3 in 3 file(s)
           oracle   `overrides` edges independently derived: 3 in 3 file(s)
AGREEMENT  COVERED 3   MISSING 0   UNEXPLAINED 0   covered 100.0%   unexplained 0%
```

It found one real disagreement, on `julia/test/core.jl:8196-8209`, and the oracle was wrong — see
*Why a TYPE owns a method table* above. That is the oracle doing its job: an independent derivation
that never disagrees is not measuring anything.

**Still open, and it is a shared-file edit.** The F5 harness does not compare `overrides`, so at the
F5 level the DERIVATION finding persists until three lines land in `script/m14/differential.ts`:

1. after line 44, `import { deriveJuliaOverridesTruth } from "./oracles/julia-overrides"`
2. in the `if (lang === "julia")` truth block after line 22863, the two lines
   `for (const e of deriveJuliaOverridesTruth(root)) { (truth as any[]).push(e) }`
3. in the F5 label allowlist beside lines 23212–23223,
   `...(lang === "julia" ? ["overrides"] : []),`

`script/m14/differential.ts` is supervisor-owned (§8), so this is reported, not applied. Until it is,
the honest statement is: the oracle exists, agrees 3 of 3 when run, and **is not part of any gate**.

---

## The L2 substitute, and three dead branches it found

`script/m14/audit-analyzer-grammar.ts` is the L2 gate. **julia is not in its language list** — a full
run prints 48 rows and no `julia` line — so the shared gate cannot make any statement about this lane.
That script is shared machinery and is reported rather than edited. The census's instrument A' is the
lane-owned substitute: it extracts the analyzer's node-type **claims** and checks each against the node
types the production grammar actually produced over the 971 corpus files.

**46 node-type claims, 0 unknown.** The extraction is narrowed to the three positions where a literal
IS a node type — a `.type` comparison, a `firstNamedChildOfType` type argument, or a member of a
node-type `Set` — because an earlier version extracted every snake_case literal and accused 32 names of
which 30 were relationship-type names, evidence-class names and `IMPLICIT_OR_CONSTANT` members.

The count was **45** until the `imports`/`exports` work added `selected_import` to the analyzer
(`932a20d27`), and this paragraph was the stale one: a count measured once and reprinted. It is written
here as the number the census prints on every run for that reason.

It immediately named **three dead branches**:

| dead branch | where | what it was |
|---|---|---|
| `import_list` | `importTargets`, twice | a node the grammar never produces — and the mapping beside it was a ternary whose **both arms were `x.text.trim()`**, so a conditional that could not choose |
| `list_litteral` | `exportableName` | misspelled, and unreachable: `tuple_expression` and `parenthesized_expression` are both present and cover the shapes |
| `case_statement` | `complexity`'s decision set | julia has no `case`; it spells multi-way branching `if`/`elseif`, and all three spellings were already in the set |

The substitute is **stricter** than the shared gate in one respect (it matches node types the
production grammar **produced** over 971 real files, so a declared-but-never-produced name is caught)
and **weaker** in two (it does not check field names, and it does not detect a dead branch — which is
why the `&&`-branch reachability measurement is reported separately rather than assumed).

### The scanner that reads the analyzer's own TypeScript, and a zero that read as a pass

The extraction reads string literals out of `src/ast/real-julia-analyzer.ts`, which needs a lexical
scanner: `validation/m14/fixtures/julia/text-util.ts`. It reports the same **46 claims / 0 unknown**
as the three regexes it replaced, which is the check that it is equivalent.

It also produced the most instructive failure in this file's history. A first version of the scanner
blanked **string literals** along with comments — and string literals are the payload, because a
node-type claim *is* a string literal. The census then reported *"node-type CLAIMS: 0, NOT produced:
0"*: an entirely fictional clean bill of health, from a gate that had stopped looking at
anything. **The regression that mattered was not that the count was wrong. It was that the count was
zero and zero reads as a pass.** A gate that returns zero on a non-empty input is a failed check.

## No regex in this lane

The brief forbids regex in the analyzer, in a census script and in an oracle, on the ground that regex
over source text matches comments and string literals, misses nested syntax, and breaks silently on
the next grammar version.

`script/m12/verify-regex-census.ts` reported **9 regex usages** in `real-julia-analyzer.ts` and the
committed census (`validation/m12/results/regex-census.json`) carries **no julia row at all** — the
analyzer was written after that census was established, so the whole file arrived as unrecorded debt.
A census row is a verifier-written results artifact (honesty contract §5.1), so it is not editable
here even to declare the debt honestly. **The only honest move was to delete the regexes.**

All 9 were node-text normalisation, and each replacement is a prefix or character test:

| count | was | is |
|---|---|---|
| 4 | `/^@/` on a `macro_identifier` | `stripSigil(text, "@")` |
| 2 | `/^:/` on a `quote_expression` | `stripSigil(text, ":")` |
| 1 | `/^:\(|\)$/g` on a quoted operator member | `unquoteOperatorMember(text)` |
| 2 | `/\s+/g` in the signature key | `collapseSpace(text)` |

The census had 10 more of its own, now in `text-util.ts`. `script/m14/oracles/julia-calls.ts`'s
`/^@/` was replaced the same way.

**Measured after the change:** the shared scanner finds **0 julia regex usages** (was 9);
`bun run script/m14/run-fixtures.ts --lang julia` → 4 pass, 0 fail;
`bun run validation/m14/fixtures/julia/mutation-check.ts --all` → 21 killed, 0 survived, of 21;
`npx tsc --noEmit` → no error in any julia file.

`text-util.ts`'s **declared limitation**: it is a lexical scanner, not a TypeScript parser. It handles
comments, strings, template literals with `${ … }` interpolation, and it does **not** disambiguate a
`/` that opens a regex literal from a `/` that is division. The input has no division expression, and
the number the scanner feeds is printed on every run so a change in its behaviour is visible rather
than inferred from a count that quietly moved.

## The fixture lane and its mutants

Four fixtures, **38 expected symbols, 33 expected relationships, 20 forbidden relationships, 8
forbidden symbols**; `bun run script/m14/run-fixtures.ts --lang julia` → 4 pass, 0 fail.

`script/m60/julia-mutants.ts` holds **21 mutants**. It had **zero importers** when this lane started —
a repo-wide search for `JULIA_MUTANTS` returned only its own declaration — so every one of them was an
assertion nothing executed. Wiring them into `script/m14/mutate-analyzer.ts`'s `MUTANTS` array is a
shared-file edit, so it is reported. `validation/m14/fixtures/julia/mutation-check.ts` is the lane-owned
half and it runs them: **21 killed, 0 survived, of 21**.

Five mutants were added for `overrides`, one per guard, and **all five are killed by the fixture
suite**:

| mutant | what it reverts | killed by |
|---|---|---|
| `julia/drop-overrides-edges` | the whole type | `method-redefinition-overrides` |
| `julia/overrides-without-position-guard` | the unconditional-position test | `method-redefinition-overrides` |
| `julia/overrides-ignores-local-scope` | the local-binding test and the scope key | `method-redefinition-overrides` |
| `julia/overrides-drops-where-clause` | the `where` half of the signature key | `method-redefinition-overrides` |
| `julia/overrides-ignores-scope-line` | the owner's declaration line | `method-redefinition-overrides` |

Three of the five went through a **SURVIVING** state first, and each was a defect in the *mutant*
rather than in the suite — the shape this repo has recorded twice:

- `julia/overrides-drops-where-clause` first stripped `metadata.signature`, which no assertion
  constrained, so it changed nothing observable. It now emits the pre-fix signature and the fixture
  pins the exact string.
- Its source scan built the key from the regex's *inner* capture group, producing `"x"` where the real
  `argument_list` text is `"(x)"`.
- `julia/overrides-ignores-scope-line` first matched `\(\)` — an empty argument list — while the fixture
  declares `same(x) = 1`; and its map was cleared between modules, which is the very behaviour it was
  written to model being absent.

---

## The grammar is almost entirely POSITIONAL

From the vendored `src/node-types.json`: **7 of 151 named node types carry field names** —
`module_definition.name`, `field_expression.value`, `if_statement.condition`/`.alternative`,
`elseif_clause.condition`, `while_statement.condition`, and the two prefixed string/command literals.
Everything else, including `binary_expression`, `typed_expression`, `signature`, `call_expression` and
`type_head`, must be navigated by **child order**.

Four shape facts, each of which produced a plausible wrong answer on files that parse with zero ERROR
nodes:

| Fact | What went wrong without it |
|---|---|
| a qualified CALLEE is a nested `field_expression`, not a `scoped_identifier` | every qualified call vanished; a file of them produced an empty graph with no error |
| `binary_expression`'s `operator` is a **named** child at index 1 | `pos(node,1)` returned the operator instead of the right operand, and an anonymous-child scan found nothing — zero `extends` edges corpus-wide |
| a `where` clause wraps the callable in a `where_expression`; **bare `where T` puts the type variable there as a sibling `identifier`** | every `where`-form declaration was skipped, and the type variable was published as the function's name (`T`) |
| `f(x)::T = …` is a `typed_expression` on the left; `x::Int = 5` is too | the return-type form was invisible, or the function published under its return type (`Float64`) |

The recurring lesson, recorded in the analyzer: **scan for a name before unwrapping the wrapper around
it, and you get the wrapper.** This happened three times in one lane.

**And once more, in the census's own instrument, which is why it is here.** Collecting a declaration's
parameters from a `signature` found **13** local bindings in 1,543 call targets, which is not a
property of Julia. Two separate causes: a `signature`'s callable is reached through a
`where_expression`, and Julia's most common way to declare a function — `f(x) = expr` — is an
`assignment` with **no `signature` node at all**. The short form is the common form.

**A CORRECTION, and the reason it belongs here rather than in a commit log.** An earlier draft of this
table said `scoped_identifier` **does not exist** in this grammar, on the evidence of 0 occurrences in
400 corpus files. That was the wrong measurement: the node IS produced — **401 occurrences across 186
files** — it is simply never the callee of a call. Qualified ACCESS is a `field_expression`, which is
what the fix routes through, so the code was right and the claim was not. A node census answers "does
this type occur", and a narrower question had been asked and the answer reported as the broader one.
The classification in `script/m14/spec/julia-completeness.json` is derived mechanically from the
analyzer's own `case` labels intersected with the census, precisely so claims like this cannot be
hand-maintained into wrongness.

## Qualified names are kept WHOLE

Collapsing a qualified callee to its last segment was measured to **invent merges**. Over 400 files,
1,352 bare segments appear behind a qualified path and **72 are reachable by more than one distinct
path**:

- `parse` — `Meta.parse`, `Base.parse`, `TOML.parse`, `Dates.parse`
- `bitcast` — `Base.bitcast`, `Core.bitcast`, `Intrinsics.bitcast`
- `isreadable` — `Filesystem.isreadable`, `Base.isreadable`, `Sys.isreadable`

One node per bare name fuses unrelated functions, and a fused node makes every edge into and out of it
a statement about the wrong function. In Julia the qualified path **is** the identity of the binding.
Corollary: a `field_expression` member is not *also* published as a bare `uses` edge, which would
rebuild the same ambiguity by the back door.

## File scope: 71.9% of Julia files have no `module` block

Measured over 295 corpus files. Scripts, REPL transcripts, `include`d fragments and whole stdlib test
suites run at file scope, where `const C = f(x)` and bare `f(x)` are ordinary executable code. Because
the call edge required a non-empty scope, 46 module-less files emitted **zero** call edges while
holding 8,478 `call_expression`s.

Those edges are sourced from `global`, which is this repo's own rule rather than an invention:
`real-c-analyzer.ts:892` documents `getRelationshipSource()` as "the enclosing FUNCTION name … or
`global`". `contains` deliberately **keeps** its guard, because `global contains x` is a dangling
ownership claim about a container that does not exist.

## `ccall` names C symbols, not Julia bindings

Three spellings, and they disagreed until they were made to agree:

```julia
ccall(:jl_getpid, Cint, ())                      # C symbol in the first ARGUMENT
ccall((:malloc, :libc), Ptr{Cvoid}, (…))        # …as a tuple naming symbol AND library
Base.@ccall strlen(s::Ptr{UInt8})::Csize_t      # C function in a call_expression
```

`@ccall` puts the C function in an ordinary `call_expression`, so without knowing it is under an
`@ccall` the analyzer asserted a Julia call to a binding that does not exist in Julia's namespace.
Foreign calls keep their edge — the code really does call `strlen` — and carry `isForeignCall`,
`foreignSymbol`, `foreignLibrary`. **No C symbol becomes a Julia symbol**; that is a fixture forbid.
The C symbol gets its *own* edge because relationships dedup on `type|source->target`, so two `ccall`
calls in one scope are the same edge and the second would have taken `foreignLibrary: libc` with it.
The incoming census counts **1,184 `calls` edges** in this bucket, which is the size of that decision.

## Multiple declaration forms, one name

`f(x) = expr` and `A.B(x) = expr` are **not** `function_definition` nodes — Julia's most common way of
writing a function has no node of its own. All of these declare one function:

```julia
function f end          f(x) = expr        f(x)::T = expr
f(x) where {T} = expr   function f(x) where T end
```

`Area(::Circle)` and `Area(::Square)` are **one** symbol. A definition is not an invocation:
`f(x) = …` does not call `f` (2,502 false self-calls across a 200-file sample before the fix).
Parameters are **not** symbols — the repo's standing negative contract (`SymbolKind` has no
`Parameter` member; csharp M12.07 `ParamsAreNotSymbols`) — but they are still `uses` reads, and the
incoming census counts **5,426** endpoints in that state.

## Grammar provenance

`tree-sitter-julia@0.23.1` from the npm tarball, which ships its own wasm, `grammar.json`,
`node-types.json` and `src/scanner.c`, so the lane is pinnable from pristine published bytes.

**The prebuilt wasm does not parse real Julia.** Four constructs were patched into
`grammars/tree-sitter-julia` and the wasm rebuilt:

| patch | construct | error files |
|---|---|---|
| — | prebuilt baseline | 185 |
| P2 | `∞` literal | |
| P3 | `const global x = 1` as one node | |
| P4 | `abstract type` with a body | |
| P5 | operator function definitions | |
| | **after all four** | **177** |

Not patched, and stated rather than hidden: `+%` / `-%` (the lexer ties them with `+`/`-`), which
accounts for one regression in `Enums.jl`. `script/m60/julia-error-minimal.ts` clusters the 177
remaining files by the smallest failing span.

Grammar health over the corpus: **177 of 966 files carry ERROR nodes, 1,947 ERROR, 0 MISSING** (18.32%).
89 named types produced, 0 declared-but-never-produced, 0 produced-but-undeclared. The 17 non-Julia IR
test dumps are identified by **content** and excluded from that headline — they hold 10,308 ERROR nodes
and are stated, not dropped.

**The external scanner is proven by a functional probe, not by token names.** Its 16 declared
externals are internal and never appear as tree nodes, so a tree census structurally cannot observe
them. `functionalProbe` instead asks whether the constructs that exist only because there is a scanner
parse cleanly — string interpolation, nested quotes inside interpolation, command literals, block
comments, char literals, triple-quoted strings — and all six are clean.

## Measured corpus

`JuliaLang/julia@6391263`, **941 tracked `.jl` files, no sampling**, sparse checkout, clean tree.

| | |
|---|---|
| admitted files | **971** = `julia` 941 + `json_jl` 25 + `nvim-treesitter` 5; 1,006 further candidates excluded over 512 KB |
| symbols / relationships | **28,277 / 167,775** in the ten ontology types |
| files yielding ZERO symbols | **135 of 971 (13.9%)** — listed by name in the census output |
| construct-vs-edge reconciliation | `imports` **504 files with the construct / 504 with an edge / 0 silent**; `exports` 152 / 151 / 1 silent (`julia/test/precompile.jl:15`, interpolated names) |
| crashes | 0 · structural fallback: 0 files · `parseFile` threw: 0 · **grammar-unreadable: 0** |
| empty or unknown `SymbolKind` | **0** · empty symbol names: **0** |
| endpoints equal to the literal `unknown` | 11, all in `julia/JuliaLowering/src/validation.jl` — see limitations |
| determinism | SHA-256 identical across a reused and a fresh analyzer instance |
| fixtures / mutants | 5 fixtures / **25 mutants, 25 killed, 0 survivors** |
| largest single file | 1,818 symbols / 3,890 relationships |

By kind: function 16,833 · property 4,492 · constant 2,684 · class 2,324 · module 755 · macro 465 ·
variable 441 · interface 283.
By relation: **calls 86,876** · references 36,147 · uses 26,359 · contains 10,467 · imports 1,502 ·
exports 1,770 · instantiates 2,830 · extends 1,821 · overrides 3.

**Two traps in that table, both of which produced a number that read as a measurement.**

The per-type **file count was capped at 6** in an earlier version, to keep the output short, so every
large type printed `files: 6`. The cap is gone: 926 / 844 / 821 / 540 / 361 / 323 / 3.

The **resolution** column was measured against a corpus-wide union of symbol names while the
surrounding text said "same file" — see *The six questions* above. Per-file resolution is 19.5–25.0%
for the four large cross-file types, not 53.7–56.1%.

**Performance was the first measurement nobody took on this lane, and it found a defect every
correctness number walked past.** `complexity()` is a full tree walk called **once per symbol**, which
also gave every symbol the *file's* complexity instead of its own. `test/core.jl` took **228 s** alone;
the corpus took 969 s. Now 728 ms and 168–208 s. The residual is not the analyzer: the worst remaining
file spends **16.7 s inside tree-sitter's `parse()`** and 124 ms here — it is one of the non-Julia IR
dumps, and that cost belongs with the grammar, not with this analyzer. The wall time is a RANGE
because repeated runs of the same code read 167,613 ms and 207,989 ms; the variance is the shared
machine, not the analyzer.

## The F5 differential: every compared label has an oracle behind it

Five lane-owned tree-truth oracles, in `script/m14/oracles/`, one per label F5 compares for this
language: `contains`, `extends`, `instantiates`, `calls`, `uses`, `references`.

Before them, the state was worse than "unbacked": `extends`, `instantiates` and `calls` were being
**compared against zero truth rows** and the harness printed that the published coverage for those
labels is not coverage, while `uses` and `references` (15k and 33k edges) were not compared at all.
`calls` — 85,393 edges, the largest surface in the lane — was invisible rather than unverified.

Opting `calls`, `uses` and `references` in took the compared surface from 811 to ~6,200 edges on the
same 60-file sample and **halved** the unexplained rate, which is the opposite of what adding a strict
comparison usually does and worth stating plainly: the earlier high rate was the analyzer emitting
real edges the truth side declines to claim, not those edges being wrong.

    F5 julia (200 of 941, ROTATING):  covered 98.9%   unexplained 8.7%
                                     analyzer-edges=20221 tree-truth=19052 MISSING=213 heuristic=0
                                     + COMPARED WITH NO TRUTH: overrides
    prior 60-file rotation:          covered 99.1%   unexplained 8.5%
    direct 40-file check:            extends 39/39 · instantiates 27/27 · uses 98.8% · references 97.3%

The sample ROTATES per run, so per-rotation covered and MISSING counts move. The stable figures are
the unexplained rate and the direct 40-file measurement; a per-rotation count is a sample size, not a
result.

### What independent oracles found that nothing else did

Each is a defect the fixtures AND the mutants both missed, and each produced an edge that was
**present, plausible, and named a real identifier in the file** — so no count would have shown it:

- A **construction before its type declaration** was a plain `calls`. The comment on that variable
  already claimed the opposite of what the code did, which is exactly why review missed it.
- A **field read published the receiver** instead of the member — `c.radius` gave `uses -> c`, and
  `<: Compiler.AbstractInterpreter` gave `uses -> Compiler`. Inverted, not dropped.
- A **qualified type annotation named the module**: `x::Threads.SpinLock` gave `references -> Threads`.
- A **parameterised type in a namespace** had no reference at all — `Iterators.Filter{T}`'s base is a
  `field_expression`, not an `identifier`, so the lookup returned null.
- **`where {T<:Real}` was invisible**: the braced spelling hides the bound in a `curly_expression`, and
  `f{T<:Real}(x)` has no `where_expression` at all.
- A **macro's expansion-local binding** was published as a member of the macro, when quoted code
  expands at the call site.

Three of those were the SAME mistake in three places — reading a dotted name with a rule of its own
rather than one resolver. They now all go through `fieldPath`, and that consolidation is the real fix:
while N sites each carry their own rule, site N+1 is one corpus file away from shipping the same bug.

## What the lane's own gates caught

Mutation testing, not review, is what found most of this — and three of the five mutants that survived
the first run were **no-ops returning the result unchanged**, which reads as "the suite cannot detect
this" when the truth is "the mutant cannot express it". A mutant that cannot fail is decoration.

The fixture caught 3 defects **and 2 errors in its own expectations**. `expectSymbols` matches on name
*and kind*, so an extra wrongly-kinded symbol beside a correct one passes unnoticed — `export Circle`
fabricating a `function` named `Circle` sat next to the real `class:Circle` and nothing objected.
Forbidding a name alone cannot catch that; the pair can.

Expectations are authored from Julia semantics **before** the analyzer runs. An auto-generated fixture
agrees with whatever the analyzer did and tests nothing.

A later wave of three survivors was the more interesting half, and none of them was a weak suite:

- **One was a mutant written as a deliberate no-op.** Deleted rather than kept with a caveat.
- **One was inert for a mundane reason** — it read `s.startLine` where symbols carry `range.startLine`,
  so it matched nothing and reported as SURVIVING, which is indistinguishable from a suite that cannot
  catch the defect.
- **Two were a fixture and an analyzer agreeing on NOTHING.** The fixture's own `where {T<:Real}` bound
  was invisible to the analyzer, so the mutant that removes bounds had nothing to remove.

That last shape is the one worth remembering: a surviving mutant is not automatically a weak suite. It
can be a fixture asserting things the code does not do, and the fixture is what needs fixing.

---

## Known limitations

- **Per-file resolution is 19.5–25.0% for the four large cross-file types**, and that is the number a
  consumer of one file's graph sees. The corpus-wide figure — "the name is declared somewhere in 971
  files" — is 53.7–56.1% and is a different measurement; neither is the post-merge project resolution
  a consumer of the indexed graph actually gets, and **nothing in this lane measures that third
  number.**
- **`overrides` is a 3-edge type behind four strict guards.** 414 candidate pairs are refused: 180 sit
  in a conditional or generated position, 37 are local bindings inside a function body / `do` / `let`,
  and the remainder are at file scope where no declared owner exists to source the edge. A corpus that
  used more unconditional, module-nested redefinitions would produce more edges and the guard set would
  need re-measuring, not widening.
- **The `overrides` reading of inner constructors is argued, not executed.** No julia runtime was
  available in this environment, so `julia/test/core.jl:8196-8209` was settled from Julia's data model
  (the constructor table hangs off the type object). The reasoning is in *Why a TYPE owns a method
  table*; the measurement that could confirm it is one `julia -e` away and was not run.
- **`overrides` has no oracle inside the F5 harness.** The lane-owned oracle exists and agrees 3 of 3
  when run, but `script/m14/differential.ts` does not import it, so at the F5 level the type is still
  a DERIVATION finding pending three lines of shared-file edit.
- **The scope of an `overrides` edge is a NAME.** `julia/test/deprecation_exec.jl` declares `module Src`
  three times; the pre-pass keys on the declaration line so only genuine within-scope redefinitions are
  published, but the *edge's source string* is `Src` and the file's symbol table collapses the three
  modules into one `Src`. Cross-file identity for same-named modules is a project-wide question this
  per-file analyzer cannot answer.
- **6,701 `calls`, 3,683 `uses`, 6,463 `references` and 205 `extends` targets resolve to nothing**,
  and this census does not separate "external package", "`Base` builtin", "dynamic dispatch" and
  "a declaration we failed to publish". Those are four different findings and the bucket deliberately
  does not guess a split; separating them needs a Julia runtime, which this lane does not start. The
  three buckets it *can* prove — `corpus-only`, `external-by-import`, `foreign-ccall` — account for
  54,004 + 3,819 + 1,184 = 59,007 of the 86,876 `calls` targets.
- **Julia publishes one binding under two symbol kinds when a type has constructors**, because the type
  name *is* the constructor. 10,936 edges target such a name. The edge's metadata disambiguates
  100% of the multi-symbol `calls`/`uses`/`references`/`extends`/`instantiates` cases, and
  `contains` is disambiguated by its source, but a consumer matching targets by bare name is
  discarding information the edge carries.
- **11 relationship endpoints carry the name `unknown` and resolve to nothing**, all in
  `julia/JuliaLowering/src/validation.jl`, which declares `unknown() = ValidationResult(false,
  nothing)` at line 22 and calls it 10 times. `analyze()` publishes the symbol; `parseFile` does not,
  because `keepSymbol`'s UNIVERSAL denylist (`src/ast/pool-worker.ts:452`) contains `"unknown"` and
  drops it for **every** language. That is a shared-file defect, reported rather than fixed here: a
  julia user function called `unknown` is neither a placeholder nor synthetic. Cross-language blast
  radius is unmeasured from here.
- **135 of 971 files (13.9%) yield zero symbols** through the production path. They are named in the
  census output; `julia/test/runtests.jl` and `julia/JuliaLowering/test/arrays_ir.jl` are among them.
  The cause was not investigated and is a coverage gap, not a measurement.
- **The corpus is 96.8% one upstream project** (941 of 971 files are `JuliaLang/julia`), and **this
  environment has no network access**, so the julia ecosystem could not be sampled: six clone attempts
  (`Documenter.jl`, `Pkg.jl`, `Graphs.jl`, `DataFrames.jl`, `Interpolations.jl`,
  `JumpProcesses.jl`) all failed to connect, and a filesystem sweep found **0** `.jl` files outside the
  corpus. Every count here is therefore a census of `JuliaLang/julia` plus two small projects, and a
  construct that ecosystem does not use is invisible to it. This is the single largest threat to the
  RULED verdicts and it is not mitigated.
- **The corpus root is shared with six other agents** and is not pinned: the count of candidates
  excluded over 512 KB moved from 1,003 to 1,006 across this session's own runs, with no change to the
  julia file set. The admitted population was 971 in every run.
- **`+%` / `-%` and the 177 ERROR-node files are grammar-side**, not analyzer-side.
- **Macro-generated definitions are visible only when the definition is in source** (`@inline f(x) = x`
  declares `f`; a macro that *synthesises* a name does not).
- **A `[BB-PARSE-ERR] … memory access out of bounds` under the arbiter's 8-worker run costs this lane
  13 edges, and the cost is attributable rather than suspected.** The trapped file is
  `julia/stdlib/LibGit2/test/runtests.jl`; it emits `calls=9 uses=2 references=1 imports=1`, and the
  arbiter's four short counts are short by exactly those numbers. `parseFile` CATCHES the wasm trap,
  so "0 crashes" in this lane is measured as "0 throws" and a file the parser cannot read leaves no
  trace in a counter that only counts throws — which is why the trap had to be found by differencing
  two instruments rather than by reading either one's output. **Sequential, the same file parses and
  all 13 edges are there** (`arbiter-census-diff.ts`: 167,775, `throw: 0`), and so do they at
  `BB_JULIA_WORKERS=8`, so the trigger is concurrency inside the shared engine. Which file traps
  varies between runs — an earlier session saw it on `online.jl` and `online-tests.jl` instead, and
  this session's unpatched arbiter run showed **none at all** — so the deficit is 13 edges in one run
  and 0 in another. Any julia number taken from the arbiter is short by whatever it lost that day.
- **`exports` targets are ambiguous more often than any other new edge, and the edge cannot fix it.**
  **128 distinct names across 159 of the 1,770 `exports` edges (9.0%)** name more than one symbol the
  analyzer published in the same file. Split by cause: **113 names / 132 edges (7.5% of all `exports`)
  are genuine cross-kind collisions** — `x` is published as a `property` and a `variable` and a
  `macro` in one file — and **15 names / 27 edges are several methods of one binding**, which is *not*
  a collision for an export, since a module exports a name once however many methods it has.
  `imports` is nearly clean: 2 distinct names across 3 of 1,502 edges, of which 1 name / 2 edges
  (`Bar`, published as both `class` and `module`) is a real collision.
  The edge cannot narrow these, and the reason is the `declaresNothing` property this lane got right:
  `export X` asserts no kind, so there is no kind to narrow by. Adding one would mean guessing. The
  remaining lever is for the edge to carry the **owning scope**, which would separate a struct field
  named `x` from a function named `x` — that is a schema question owned by the incoming-resolution
  layer, and this lane's count is the evidence for it rather than a duplicate of the work. Reported,
  not worked around.
- **`contains` collapses same-named siblings.** The relationship dedup key is
  `type|source->target` with no line, so two declarations of one name under one scope produce one
  `contains` row. Widening it would grow every `contains` edge in every julia payload (10,467 rows
  today), which is a shared payload-budget decision and was not taken unilaterally.
- **An oracle is a second walker over one grammar.** A grammar bug shared by the analyzer and all five
  oracles is invisible to every differential in this file, and nothing in them can see a relationship
  type that neither side derives. Only instrument A and instrument B measure the language.
