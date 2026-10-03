# Julia Analyzer

> Renamed from `docs/analyzers/julia.md` (2026-10-03). `script/m14/verify-doc-truth-emissions.ts`
> resolves an analyzer's canonical doc as `docs/analyzers/real-<lang>-analyzer.md` and reported
> `MISSING_DOC real-julia-analyzer.ts` while `docs/analyzers/julia.md` sat next to it, so the file
> existed and the gate could not see it. One reference needs a one-token update and belongs to a
> shared file: `script/m14/completeness-inventory.ts:733` still names the old path.

## What it extracts
- **Symbols**: modules, structs (`class`), `abstract type` (`interface`), functions,
  macros, struct fields (`property`), `const` bindings (`constant`), local bindings
- **Relationships**: `contains`, `calls`, `uses`, `references`, `extends`, `instantiates`,
  `overrides`. `imports` and `exports` are carried on the `ImportInfo[]` / `ExportInfo[]` channels
  and never as relationships — see the verdict table.
- **Payloads**: `declarationForm`, `isExported`, `isForeignCall`/`foreignSymbol`/
  `foreignLibrary`, `isTypeConstruction`, `isMacroCall`, `isTypeReference`,
  `isQualifiedReference`, `isFieldRead`, `evidenceClass`, `replacesLine`,
  `isMethodRedefinition`, `via: "identical_signature_redefinition"`

---

# The ten ontology types, verdict by verdict

Every number below comes from `validation/m14/fixtures/julia/census.ts`, which drives the
**production entry point** — `parseFile` from `src/ast/pool-worker.ts`, not `analyze()` — over the
whole admitted corpus. Reproduce with:

```
npx tsx validation/m14/fixtures/julia/census.ts --json /tmp/census.json
```

**Corpus.** 971 admitted files, no sampling: `julia` 941, `json_jl` 25, `nvim-treesitter` 5.
806 further candidates were excluded for exceeding 512 KB and the exclusion is counted in the
census output rather than left silent. The admitted files are the population the router
(`detectLanguageFromPath`) selects, so this is a census and not a draw. Production grammar
`wasm/tree-sitter-julia.wasm`, md5 `dbcd79759b4216c80de73c17a56255f8`.

**Production totals.** 28,277 symbols · 164,084 relationships in the ten types · 0 crashes ·
0 files routed to the >1 MB structural fallback · **135 of 971 files (13.9%) yield ZERO symbols**
and are listed by name in the census output.

| Relationship type | Emitted? | Channel and measured size over 971 files | Where |
|---|---|---|---|
| `calls` | ✅ yes | relationship, **86,876** | `json_jl/src/lazy.jl`, `json_jl/src/JSON.jl`, … |
| `references` | ✅ yes | relationship, **35,727** | `json_jl/src/lazy.jl`, `json_jl/src/object.jl`, … |
| `uses` | ✅ yes | relationship, **26,359** | `json_jl/src/lazy.jl`, `json_jl/src/object.jl`, … |
| `contains` | ✅ yes | relationship, **10,467** | `json_jl/benchmarks/structs.jl`, `json_jl/src/JSON.jl`, … |
| `instantiates` | ✅ yes | relationship, **2,830** | `json_jl/src/parse.jl`, `json_jl/src/write.jl`, … |
| `extends` | ✅ yes | relationship, **1,821** | `json_jl/src/write.jl`, `json_jl/src/object.jl`, … |
| `overrides` | ✅ yes | relationship, **3** (was a GAP; the previous ruling was wrong) | `julia/Compiler/test/contextual.jl:138`, `julia/test/meta.jl:242`, `julia/test/reflection.jl:1123` |
| `imports` | ✅ yes — **on the import-site channel only** | `ImportInfo[]` payload, **0 relationship rows**; 1,675 `import`/`using` nodes exist on the tree | `json_jl/src/JSON.jl:1`, `julia/Compiler/src/ssair/EscapeAnalysis.jl:3`, … |
| `exports` | ✅ yes — **on the export-site channel only** | `ExportInfo[]` payload, **0 relationship rows**; 308 `export`/`public` nodes exist on the tree | `json_jl/src/JSON.jl:10`, `julia/stdlib/Test/src/Test.jl`, … |
| `implements` | ❌ **no**, RULED | no channel; 0 of 12 named constructs in the grammar inventory, and the 325 nearest candidates are published as `extends` | — |

**One row of that table is invisible to the doc-truth gate, and it is the gate's defect, not the
table's.** `parseClaimTable` in `script/m14/verify-doc-truth-emissions.ts` sets `started = true` and
`continue`s on the first body row after the header rule, so it never compares it. The gate therefore
reports `UNDOCUMENTED [julia] calls (relationship)` for the `calls` row above — and the same
finding against `real-kotlin-analyzer.md`, whose first row is also `calls`. Reproduced against the
gate's own exported function on a 4-row synthetic table:

```
rows returned: 2      ("uses", "contains")  — the `calls` row is absent
FIRST BODY ROW PRESENT? false
```

That is a cross-lane false-negative in the gate: for any lane whose claim table leads with a
relationship type, a doc claiming that type is emitted while the analyzer emits nothing reads as a
**pass** — precisely the `FALSE_POSITIVE` class the gate exists to catch, silently disabled for one
row per language. The fix is one line (drop the `continue` so the first body row falls through) and
`script/m14/verify-doc-truth-emissions.ts` is shared machinery, so it is reported rather than applied.
The row is left FIRST here rather than reordered to make the finding go away: making this lane read
clean by exploiting a gate bug would hide it for the lanes that still have it.

Two cells in that table carry a channel qualifier and both are load-bearing rather than decorative.
`imports` and `exports` **are** emitted — on the `ImportInfo[]` and `ExportInfo[]` payload channels —
and a bare "no" would be a false denial that sends a consumer looking for a channel that is
populated. They are **not** emitted as relationship rows, and that is the part worth knowing:
`RelationshipType.Imports` serializes to `"brain_import"`, and the repo treats the payload channel as
the import surface. Each is ruled below with the measurement and the condition that would overturn
the ruling.

## `overrides` — was DECLINED, is now EMITTED, and the old ruling was wrong

The previous version of this file declined `overrides`, and so did the analyzer's own header, on the
grounds that *"Julia has multiple dispatch, not overriding"*. That argument is **sound for the case
it names** and **does not cover the case Julia has**. Two methods with the same name and different
signatures are different methods, both live, neither replacing the other — true. But Julia's method
table holds **exactly one entry per `(name, signature)` pair**, so a second declaration of the *same*
pair replaces the first, and Julia says so itself: under `--warn-overwrite=yes` it prints
`WARNING: Method definition f(Int) in module Main at line 12 overwritten at line 40`.

This is the failure `script/m14/ontology-coverage-gate.ts`'s header records as **BD8b** for bash: a
type omitted on a prose justification, invisible to the differential because the oracle omitted the
type too. Two implementations that both say nothing agree perfectly.

### What it is in this language

An `overrides` edge means: *a later declaration in the same module replaced an earlier declaration
of the same method — same name, same argument list, same `where` clause.* The edge runs
`enclosing module -> method name`, and `metadata.replacesLine` names the displaced site.

### The edge shape, and why it is not `name -> name`

A replacement's two endpoints ARE the same symbol, so a self-loop `f -overrides-> f` is the most
literally accurate shape available — and this codebase has ruled it out three times:

- `src/ast/real-php-analyzer.ts:2496` — *"UNRESOLVABLE and emit NO edge (a self-loop is always
  fabrication)"*
- `src/lsp/rich_hover.ts:222` — *"Degenerate self-loop rows … are not connections and not usages:
  skip them."*
- `src/intelligence/patterns/orphans.ts:818` — a self-loop `overrides` row is listed under **REFUSED
  EVIDENCE**, citing the rake `listen` regression

So the SOURCE is the enclosing **declared** scope — a `module` or a type, both of which own a method
table — and the target is the method. `module M … f(x) = 1; f(x) = 2 … end` gives `M -overrides-> f`
with both ends binding to real symbols in the same file. Same shape the bash lane settled on
(`real-bash-analyzer.ts:322-348`) and the shape `src/ast/override-retarget.ts` consumes.

### Four guards, each with the measurement that put it there

This type took four rounds of measurement, and the edge count fell **63 → 17 → 4 → 3** as guards
landed. Every step down was a fabrication removed.

| guard | measured evidence | edges removed |
|---|---|---|
| unconditional position | 417 redefinition declarations across 109 files; **237 across 57** survive an unconditional position | 63 → 17 |
| not a local binding | ancestor counts over those 417: **41 `let_statement`, 29 `function_definition`, 3 `macro_definition`, 3 `do_clause`** | included above |
| `where` clause in the key | 3 corpus pairs: `julia/base/checked.jl:138-139`, `julia/base/math.jl:834`+`:838`, `julia/test/testhelpers/Furlongs.jl:21-22` | 17 → 4 |
| scope declaration LINE in the key | `julia/test/deprecation_exec.jl` declares `module Src` at line 325 **and** at line 358 | 4 → 3 |

**Unconditional position.** `julia/JuliaLowering/src/lazy.jl:437-442` is
`if VERSION < v"1.11" … mem(n) = … else … mem(n) = … end` — same name, same signature, and exactly
one branch runs. `julia/JuliaLowering/src/write.jl:626-629` is the same shape on
`isdefined(Base, :StringVector)`. Version guards are idiomatic Julia, so this bucket is large and
counting it would have been the fabrication the workstream's rule exists to prevent. The guard
walks **ancestors** (`else_clause` is not adjacent to its declaration) and covers `macrocall_expression`
and the quote forms, whose content is code Julia writes at expansion rather than text this file
declares.

**The short-circuit branch, and why it is live.** `cond && function f() … end` is a version-guarded
method definition, so `&&`'s right operand is refused too. Measured over the 971 admitted files:
**11,549 `&&` binary_expressions, of which exactly 1 has a declaration node as its right operand** —
`julia/JuliaSyntax/src/core/parse_stream.jl:316`,
`VERSION < v"1.11.0-DEV.753" && function ParseStream(io::IOBuffer; version=VERSION)`. The same branch
tested with `||` returns **0 of 5,145**, so `||` is deliberately absent: a predicate the grammar
cannot reach is what honesty contract §2's L2 audit exists to report.

**Local bindings.** Inside a function body `f(x) = …` binds a *local variable* holding a closure. It
adds no method and displaces nothing. `compound_statement` is deliberately **not** in the guard set
because it is the node for both a function body *and* a top-level `begin … end` inside a module, and
the second is a legitimate method-table position — verified on both spellings.

**The scope's declaration line.** Two modules in one file can share a name and are still two modules
with two method tables. This one is worth stating twice because **the first fix did not work**:
the scope *name* threaded down the pre-pass while its *line* reset to `0` at every frame, so every
key came out `name@0` and the change was indistinguishable from no change. A fixture with one module
cannot see that. Reading the source of all 63 edges found it.

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
declares no module, and `global` is this repo's documented synthetic scope rather than a symbol, so
an edge sourced from it resolves to nothing. The census prints every guard's surviving count so the
refusal is a number and not an absence: **417 → 237 → 200 → 163 → 44 → 3.**

## `imports` — RULED

**Instrument: B, parse-tree count.** Julia expresses module dependencies and the corpus uses them
heavily: **1,675 `import_statement` / `using_statement` nodes across 504 of the 971 admitted files** —
`julia/Compiler/src/ssair/EscapeAnalysis.jl:3`, `json_jl/src/JSON.jl:10`, and so on. The construct
is present and common.

It is not emitted as a relationship because `RelationshipType.Imports` is the value
`"brain_import"`, and the whole repo treats the `ImportInfo[]` channel as the import surface rather
than a relationship row. `script/m14/differential.ts`'s F5 label allowlist admits `imports` by
default for every language, so the lane was comparing **zero** julia `imports` relationship rows
against zero truth rows — the harness prints *"COMPARED WITH NO TRUTH — the published coverage for
those labels is not coverage."*

**What would overturn this ruling:** a julia `imports` row that is not an import-site artifact — a
row whose source is the importing declaration rather than the literal `root`. The 87 `references`
rows sourced from `root` carry `isImport: true` and are the honest shape of the fact today, and a
count of `imports` rows greater than the count of `ImportInfo` entries would mean the relationship
had started carrying something else.

## `exports` — RULED

**Instrument: B, parse-tree count.** **308 `export_statement` / `public_statement` nodes across 152
of the 971 admitted files** — `json_jl/src/JSON.jl:10` exports nine names,
`julia/stdlib/Test/src/Test.jl` exports its whole surface. The construct is present.

It is not emitted as a relationship for the same reason as `imports`, and additionally because an
`export` **declares nothing**: `export X` names a binding whose kind depends on what `X` turns out
to be, and Julia allows the export to precede the declaration. The first version of this lane pushed
a `SymbolKind.Function` for every `export`, which produced a *second* `Circle` beside the real
`class:Circle`, and the dedup did not merge them because its key is `kind:owner:name`. The
`ExportInfo[]` channel records the export and marks nothing.

**What would overturn this ruling:** an `exports` relationship count above the `ExportInfo` count
for the same corpus, which would mean the edge was carrying a declaration claim the channel does not.

## `implements` — RULED

**Instrument: A, grammar-inventory.** Julia has no interface-conformance relation. `abstract type`
participates in a **type hierarchy** (`<:`), not in a protocol relation, and publishing `S implements I`
for `struct S <: I` would apply the managed-OO ontology to a language that does not have it.

The measurement: `wasm/tree-sitter-julia.wasm` produces **149 distinct node types over the 971
admitted files (4,948,278 nodes visited)**. Twelve node-type names were named from the ontology —
`implements_clause`, `interface_implementation`, `class_implements`, `protocol_conformance`,
`trait_implementation`, `object_declaration`, `protocol_declaration`, `interface_declaration`,
`trait_declaration`, `class_declaration`, `mixin_clause`, `conform_clause` — and the grammar
produces **none of them**.

The construct is not merely absent as a clause: the corpus's nearest candidate occurs **325 times
across 60 files** — a supertype clause naming an `abstract type` declared in the same file, e.g.
`json_jl/src/parse.jl:156` `JSONReadStyle{O,T,S} <: JSONStyle`. Every one of those is a **subtype**
relation and is published as `extends`. That is a number, and it is why the ruling is sound rather
than convenient: the thing `implements` would carry here is already carried, under its own name.

**What would overturn this ruling:** a non-zero count of any of the 12 named node types in the
instrument-A inventory, **or** a corpus measurement of an `implements` row that is not a subtype
relation. The census prints the first directly.

---

## The six questions, per emitted type

Measured through `parseFile`. "Resolved" means **both** endpoints bind to a symbol declared in the
**same file** — the analyzer is per-file, so this is the number a consumer of one file's graph sees,
and it is not the cross-file resolution rate.

| type | EXISTS | FIRES | CORRECT | LABELLED | RESOLVED (both ends) | CONFIDENT |
|---|---|---|---|---|---|---|
| `calls` | yes | 86,876 | 97.4% covered / 8.7% unexplained, oracle `julia-calls` | `usage_contextual` | **54.8%** (src 78.1 / tgt 70.2 / neither 6.5) | conf 1.0 on 86,876; **0 under 0.7** |
| `uses` | yes | 26,359 | oracle `julia-refs` | `usage_contextual` | **56.1%** (src 76.3 / tgt 72.8 / neither 6.9) | conf 0.9; **0 under 0.7** |
| `contains` | yes | 10,467 | oracle `julia-contains`, which found a real defect | `structural` | **99.9%** (neither 0.0) | conf 1.0; **0 under 0.7** |
| `references` | yes | 35,727 | oracle `julia-refs` | `import_based` | **53.7%** (src 88.3 / tgt 58.6 / neither 6.8) | conf 1.0 ×33,708 + 0.95 ×2,019; **0 under 0.7** |
| `extends` | yes | 1,821 | oracle `julia-type-edges` | `structural` | **64.1%** (src 84.6 / tgt 74.7 / neither 4.7) | conf 1.0; **0 under 0.7** |
| `instantiates` | yes | 2,830 | oracle `julia-type-edges` | `usage_contextual` | **76.9%** (tgt 100.0, src 76.9) | conf 0.9; **0 under 0.7** |
| `overrides` | yes | 3 | **no oracle — DERIVATION finding** | `structural` | **100.0%** | conf 1.0; **0 under 0.7** |

### The heuristic ratio is 0.0% for every type

Every one of the 164,084 rows is at or above 0.9 and `evidenceClass` is set on every one of them.
Honesty contract §4 requires the heuristic/deterministic ratio to be a queryable number, and for
this lane the answer is that there are no heuristics to count. That is a property of the design —
every edge is a syntax fact — and it is worth reading against the resolution column, because "no
heuristics" and "resolves 54.8% of the time" are independent facts and only the first one is good
news.

**One gap in the labelling, found and fixed:** `classifyEvidenceTier` had **no arm for `overrides`**.
It read `contains`, `imports`/`exports`/`references`, `calls`/`uses`/`instantiates` and
`extends`/`implements`, and an unlisted type falls through with no tier at all — so the first
6 `overrides` edges were published with **no `evidenceClass`**, which every consumer that groups
relationships by tier counted as unclassified. It now sets `structural`, pinned as a value in the
fixture.

### Resolution: what the 53.7–56.1% actually means

`calls`, `uses` and `references` resolve at both ends for roughly half their edges because the
analyzer is per-file and the corpus is `JuliaLang/julia` itself — a standard library whose callees
are overwhelmingly declared **elsewhere**. 19,022 `calls`, 6,234 `uses`, 3,234 `references` and 652
`instantiates` rows are sourced from `global`, and 951 `references` rows from `root`; those are this
repo's documented synthetic scopes, not symbols, and they are counted as unresolvable rather than
excluded from the denominator. `contains` at 99.9% and `overrides` at 100.0% are the reference points
that show the measurement is not simply reporting that most edges are cross-file.

For comparison, CSS `references` — the reference point named in the workstream contract — resolves at
both ends on 66.8% of its edges. This lane's `references` is at 53.7% over a corpus that is one
upstream project.

### The differential, and the limitation it cannot cover

`bun run script/m14/differential.ts --lang julia --sample 200 --no-batch`:

```
[julia] files=200 tree-truth=17503 covered=17051 (97.4%) MISSING=452
        analyzer-edges=18285 unexplained=1596 (8.7%) heuristic=0
        unexplained-by-label: calls=975, contains=382, instantiates=98,
                               extends=74, references=44, uses=23
```

Six lane-owned oracles in `script/m14/oracles/` — `julia-contains`, `julia-type-edges`,
`julia-calls`, `julia-refs` — cover every compared label.

**Declared limitation, and it is not a formality.** The oracle is a second walker over the **same
grammar**. It can disagree with the analyzer when either is wrong; it is **blind** when a construct
is absent from both, which is precisely how the `overrides` omission survived — the julia oracle
region contained no `overrides` rows either, and two implementations that both say nothing agree
perfectly. Nothing in the differential above can see a missing relationship type. Only measuring the
language can, and that is what this section is.

### DERIVATION findings: 1

`overrides` is emitted and **nothing audits it**. There is no `julia-*-overrides` oracle and no
differential row compares it, so those 3 edges are stored and compared against nothing. Paying it down
needs a lane-owned `script/m14/oracles/julia-overrides.ts` plus two lines in
`script/m14/differential.ts` (the import and the label allowlist entry) — both shared-file edits, so
reported rather than made. The dart lane's `script/m14/oracles/dart-overrides.ts` is the template,
including its statement of the same single-walker limitation.

## The L2 substitute, and three dead branches it found

`script/m14/audit-analyzer-grammar.ts` is the L2 gate. **julia is not in its language list** — a full
run prints 48 rows and no `julia` line — so the shared gate cannot make any statement about this lane.
That script is shared machinery and is reported rather than edited. `validation/m14/fixtures/julia/census.ts`
carries an instrument A' that is the lane-owned substitute: it extracts the analyzer's node-type
**claims** (the literals in a `.type` comparison, a `firstNamedChildOfType` argument, or a node-type
`Set`) and checks each against the node types the production grammar actually produced.

**45 node-type claims, 0 unknown.** A first version extracted *every* snake_case string literal and
accused 32 that are not node types — 30 of which were relationship-type names, evidence-class names
and `IMPLICIT_OR_CONSTANT` members, none of which claims to be a node. Narrowing the extraction to
the three positions where a literal IS a node type made the check precise, and it immediately named
**three dead branches**:

| dead branch | where | what it was |
|---|---|---|
| `import_list` | `importTargets`, twice | a node the grammar never produces — and the mapping beside it was a ternary whose **both arms were `x.text.trim()`**, so a conditional that could not choose |
| `list_litteral` | `exportableName` | misspelled, and unreachable: `tuple_expression` and `parenthesized_expression` are both present and cover the shapes |
| `case_statement` | `complexity`'s decision set | julia has no `case`; it spells multi-way branching `if`/`elseif`, and all three spellings were already in the set |

The substitute is **stricter** than the shared gate in one respect (it matches node types the
production grammar **produced** over 971 real files, so a declared-but-never-produced name is caught)
and **weaker** in two (it does not check field names, and it does not detect a dead branch — which is
why the `&&`-branch reachability measurement above is reported separately rather than assumed).

## The fixture lane and its mutants

Four fixtures, **38 expected symbols, 33 expected relationships, 20 forbidden relationships, 8
forbidden symbols**; `bun run script/m14/run-fixtures.ts --lang julia` → 4 pass, 0 fail.

`script/m60/julia-mutants.ts` holds **21 mutants**. It had **zero importers** when this lane started —
a repo-wide search for `JULIA_MUTANTS` returned only its own declaration — so every one of them was
an assertion nothing executed, which is the class this repo names twice (`script/m14/run-fixtures.ts`:
*"an expectation file nothing executes is evidence of nothing"*). Wiring them into
`script/m14/mutate-analyzer.ts`'s `MUTANTS` array is a shared-file edit, so it is reported.
`validation/m14/fixtures/julia/mutation-check.ts` is the lane-owned half and it runs them:

```
bun run validation/m14/fixtures/julia/mutation-check.ts --all
→ 21 killed, 0 survived, of 21
```

Five mutants were added by this lane, one per guard above, and **all five are killed by the fixture
suite**:

| mutant | what it reverts | killed by |
|---|---|---|
| `julia/drop-overrides-edges` | the whole type (JUL-14) | `method-redefinition-overrides` |
| `julia/overrides-without-position-guard` | the unconditional-position test (JUL-15) | `method-redefinition-overrides` |
| `julia/overrides-ignores-local-scope` | the local-binding test and the scope key (JUL-16) | `method-redefinition-overrides` |
| `julia/overrides-drops-where-clause` | the `where` half of the signature key (JUL-17) | `method-redefinition-overrides` |
| `julia/overrides-ignores-scope-line` | the scope's declaration line (JUL-18) | `method-redefinition-overrides` |

Three of the five went through a **SURVIVING** state first, and each was a defect in the *mutant*
rather than in the suite — the shape this repo has recorded twice before:

- `julia/overrides-drops-where-clause` first stripped `metadata.signature`, which no assertion
  constrained, so it changed nothing observable. It now emits the pre-fix signature and the fixture
  pins the exact string, which is what made the defect catchable at all.
- Its source scan built the key from the regex's *inner* capture group, producing `"x"` where the
  real `argument_list` text is `"(x)"`.
- `julia/overrides-ignores-scope-line` first matched `\(\)` — an empty argument list — while the
  fixture declares `same(x) = 1`; and its map was cleared between modules, which is the very
  behaviour it was written to model being absent.

---

## The grammar is almost entirely POSITIONAL

From the vendored `src/node-types.json`: **7 of 151 named node types carry field names** —
`module_definition.name`, `field_expression.value`, `if_statement.condition`/`.alternative`,
`elseif_clause.condition`, `while_statement.condition`, and the two prefixed string/command
literals. Everything else, including `binary_expression`, `typed_expression`, `signature`,
`call_expression` and `type_head`, must be navigated by **child order**.

Four shape facts, each of which produced a plausible wrong answer on files that parse with
zero ERROR nodes:

| Fact | What went wrong without it |
|---|---|
| a qualified CALLEE is a nested `field_expression`, not a `scoped_identifier` | every qualified call vanished; a file of them produced an empty graph with no error |
| `binary_expression`'s `operator` is a **named** child at index 1 | `pos(node,1)` returned the operator instead of the right operand, and an anonymous-child scan found nothing — zero `extends` edges corpus-wide |
| a `where` clause wraps the callable in a `where_expression`; **bare `where T` puts the type variable there as a sibling `identifier`** | every `where`-form declaration was skipped, and the type variable was published as the function's name (`T`) |
| `f(x)::T = …` is a `typed_expression` on the left; `x::Int = 5` is too | the return-type form was invisible, or the function published under its return type (`Float64`) |

The recurring lesson, recorded in the analyzer: **scan for a name before unwrapping the
wrapper around it, and you get the wrapper.** This happened three times in one lane.

**A CORRECTION, and the reason it belongs here rather than in a commit log.** An earlier draft of this
table said `scoped_identifier` **does not exist** in this grammar, on the evidence of 0 occurrences in
400 corpus files. That was the wrong measurement: the node IS produced — **401 occurrences across 186
files** — it is simply never the callee of a call. Qualified ACCESS is a `field_expression`, which is
what the fix routes through, so the code was right and the claim was not. A node census answers "does
this type occur", and I had asked a narrower question ("is it ever a call callee"), reported the answer
as the broader one, and wrote it into a permanent artifact. The classification in
`script/m14/spec/julia-completeness.json` is derived mechanically from the analyzer's own `case` labels
intersected with the census, precisely so that claims like this cannot be hand-maintained into
wrongness.

## Qualified names are kept WHOLE

Collapsing a qualified callee to its last segment was measured to **invent merges**. Over
400 files, 1,352 bare segments appear behind a qualified path and **72 are reachable by more
than one distinct path**:

- `parse` — `Meta.parse`, `Base.parse`, `TOML.parse`, `Dates.parse`
- `bitcast` — `Base.bitcast`, `Core.bitcast`, `Intrinsics.bitcast`
- `isreadable` — `Filesystem.isreadable`, `Base.isreadable`, `Sys.isreadable`

One node per bare name fuses unrelated functions, and a fused node makes every edge into and
out of it a statement about the wrong function. In Julia the qualified path **is** the
identity of the binding. Corollary: a `field_expression` member is not *also* published as a
bare `uses` edge, which would rebuild the same ambiguity by the back door.

## File scope: 71.9% of Julia files have no `module` block

Measured over 295 corpus files. Scripts, REPL transcripts, `include`d fragments and whole
stdlib test suites run at file scope, where `const C = f(x)` and bare `f(x)` are ordinary
executable code. Because the call edge required a non-empty scope, 46 module-less files
emitted **zero** call edges while holding 8,478 `call_expression`s.

Those edges are sourced from `global`, which is this repo's own rule rather than an invention:
`real-c-analyzer.ts:892` documents `getRelationshipSource()` as "the enclosing FUNCTION name
… or `global`". `contains` deliberately **keeps** its guard, because `global contains x` is a
dangling ownership claim about a container that does not exist.

## `ccall` names C symbols, not Julia bindings

Three spellings, and they disagreed until they were made to agree:

```julia
ccall(:jl_getpid, Cint, ())                      # C symbol in the first ARGUMENT
ccall((:malloc, :libc), Ptr{Cvoid}, (…))        # …as a tuple naming symbol AND library
Base.@ccall strlen(s::Ptr{UInt8})::Csize_t      # C function in a call_expression
```

`@ccall` puts the C function in an ordinary `call_expression`, so without knowing it is under
an `@ccall` the analyzer asserted a Julia call to a binding that does not exist in Julia's
namespace. Foreign calls keep their edge — the code really does call `strlen` — and carry
`isForeignCall`, `foreignSymbol`, `foreignLibrary`. **No C symbol becomes a Julia symbol**;
that is a fixture forbid. The C symbol gets its *own* edge because relationships dedup on
`type|source->target`, so two `ccall` calls in one scope are the same edge and the second
would have taken `foreignLibrary: libc` with it.

## Multiple declaration forms, one name

`f(x) = expr` and `A.B(x) = expr` are **not** `function_definition` nodes — Julia's most
common way of writing a function has no node of its own. All of these declare one function:

```julia
function f end          f(x) = expr        f(x)::T = expr
f(x) where {T} = expr   function f(x) where T end
```

`Area(::Circle)` and `Area(::Square)` are **one** symbol. A definition is not an invocation:
`f(x) = …` does not call `f` (2,502 false self-calls across a 200-file sample before the fix).
Parameters are **not** symbols — the repo's standing negative contract (`SymbolKind` has no
`Parameter` member; csharp M12.07 `ParamsAreNotSymbols`) — but they are still `uses` reads.

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

Not patched, and stated rather than hidden: `+%` / `-%` (the lexer ties them with `+`/`-`),
which accounts for one regression in `Enums.jl`. `script/m60/julia-error-minimal.ts` clusters
the 177 remaining files by the smallest failing span.

Grammar health over the corpus: **177 of 966 files carry ERROR nodes, 1,947 ERROR, 0 MISSING**
(18.32%). 89 named types produced, 0 declared-but-never-produced, 0 produced-but-undeclared.
The 17 non-Julia IR test dumps are identified by **content** and excluded from that headline
— they hold 10,308 ERROR nodes and are stated, not dropped.

**The external scanner is proven by a functional probe, not by token names.** Its 16 declared
externals are internal and never appear as tree nodes, so a tree census structurally cannot
observe them. `functionalProbe` instead asks whether the constructs that exist only because
there is a scanner parse cleanly — string interpolation, nested quotes inside interpolation,
command literals, block comments, char literals, triple-quoted strings — and all six are clean.

## Measured corpus

`JuliaLang/julia@6391263`, **941 tracked `.jl` files, no sampling**, sparse checkout, clean tree.

| | |
|---|---|
| admitted files (this round) | **971** = `julia` 941 + `json_jl` 25 + `nvim-treesitter` 5; 806 further candidates excluded over 512 KB |
| symbols / relationships (this round) | **28,277 / 164,084** in the ten ontology types |
| files yielding ZERO symbols | **135 of 971 (13.9%)** — listed by name in the census output |
| symbols / relationships (prior round) | 27,560 / 160,777 |
| imports / exports | 1,047 / 1,785 (`ImportInfo[]` / `ExportInfo[]`, not relationships) |
| crashes | 0 · structural fallback: 0 files · `parseFile` threw: 0 |
| empty or unknown `SymbolKind` | **0** · empty symbol names: **0** |
| endpoints equal to the literal `unknown` | 11, all in `julia/JuliaLowering/src/validation.jl` — see limitations |
| determinism | SHA-256 identical across a reused and a fresh analyzer instance |
| fixtures / mutants | 4 fixtures (38 symbol + 33 relationship assertions, 20 + 8 forbidden) / **21 mutants, 21 killed, 0 survivors** |
| wall time | **168-208 s** for 941 files (4.5-5.6 file/s) — a range, and the reason is below |
| largest single file | 1,818 symbols / 3,890 relationships |

By kind (this round, 971 files): function 16,833 · property 4,492 · constant 2,684 ·
class 2,324 · module 755 · macro 465 · variable 441 · interface 283.
By relation (this round): **calls 86,876** · references 35,727 · uses 26,359 ·
contains 10,467 · instantiates 2,830 · extends 1,821 · overrides 3.

The wall time is a RANGE because repeated runs of the same code read 167,613 ms and 207,989 ms. The
variance is the shared machine, not the analyzer — other agents' sweeps run concurrently — so the
range is stated rather than one pinned number, which would be precision the measurement does not
support.

**Performance was the first measurement nobody took on this lane, and it found a defect every
correctness number walked past.** `complexity()` is a full tree walk called **once per
symbol**, which also gave every symbol the *file's* complexity instead of its own.
`test/core.jl` took **228 s** alone; the corpus took 969 s. Now 728 ms and 168-208 s. The residual
is not the analyzer: the worst remaining file spends **16.7 s inside tree-sitter's `parse()`**
and 124 ms here — it is one of the non-Julia IR dumps, and that cost belongs with the
grammar, not with this analyzer.

## The F5 differential: every compared label has an oracle behind it

Six lane-owned tree-truth oracles, in `script/m14/oracles/`, one per label F5 compares for this
language: `contains`, `extends`, `instantiates`, `calls`, `uses`, `references`. Each is written from
Julia's own rule and **shares no rule table, key set or resolver with the analyzer** — which is the
only property that makes a MATCH mean something, because two implementations that agree because they
share a rule cannot disagree.

Before them, the state was worse than "unbacked": `extends`, `instantiates` and `calls` were being
**compared against zero truth rows** and the harness printed that the published coverage for those
labels is not coverage, while `uses` and `references` (15k and 33k edges) were not compared at all.
`calls` — 85,393 edges, the largest surface in the lane — was invisible rather than unverified.

Opting `calls`, `uses` and `references` in took the compared surface from 811 to ~6,200 edges on the
same 60-file sample and **halved** the unexplained rate, which is the opposite of what adding a strict
comparison usually does and worth stating plainly: the earlier high rate was the analyzer emitting
real edges the truth side declines to claim, not those edges being wrong.

    F5 julia (200 of 941, ROTATING):  covered 97.4%   unexplained 8.7%
                                     analyzer-edges=18285 tree-truth=17503 MISSING=452 heuristic=0
    prior 60-file rotation:          covered 99.1%   unexplained 8.5%
    direct 40-file check:            extends 39/39 · instantiates 27/27 · uses 98.8% · references 97.3%

The sample ROTATES per run, so per-rotation covered and MISSING counts move. The stable figures are
the unexplained rate and the direct 40-file measurement; a per-rotation count is a sample size, not a
result.

### What six independent oracles found that nothing else did

Each is a defect the fixtures AND the mutants both missed, and each produced an edge that was
**present, plausible, and named a real identifier in the file** — so no count would have shown it:

- A **construction before its type declaration** was a plain `calls`. The comment on that variable
  already claimed the opposite of what the code did, which is exactly why review missed it.
- A **field read published the receiver** instead of the member — `c.radius` gave `uses -> c`, and
  `<: Compiler.AbstractInterpreter` gave `uses -> Compiler`. Inverted, not dropped: every field access
  still yielded a healthy-looking row.
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

Mutation testing, not review, is what found most of this — and three of the five mutants that
survived the first run were **no-ops returning the result unchanged**, which reads as "the
suite cannot detect this" when the truth is "the mutant cannot express it". A mutant that
cannot fail is decoration.

The fixture caught 3 defects **and 2 errors in its own expectations**. `expectSymbols` matches
on name *and kind*, so an extra wrongly-kinded symbol beside a correct one passes unnoticed —
`export Circle` fabricating a `function` named `Circle` sat next to the real `class:Circle` and
nothing objected. Forbidding a name alone cannot catch that; the pair can.

Expectations are authored from Julia semantics **before** the analyzer runs. An
auto-generated fixture agrees with whatever the analyzer did and tests nothing.

A later wave of three survivors was the more interesting half, and none of them was a weak suite:

- **One was a mutant I had written as a deliberate no-op.** It shipped in the same commit series
  that criticises inert mutants. Deleted rather than kept with a caveat, because a mutant that cannot
  fail is decoration whether or not the description admits it.
- **One was inert for a mundane reason** — it read `s.startLine` where symbols carry
  `range.startLine`, so it matched nothing and reported as SURVIVING, which is indistinguishable from
  a suite that cannot catch the defect.
- **Two were a fixture and an analyzer agreeing on NOTHING.** The fixture's own `where {T<:Real}` bound
  was invisible to the analyzer, so the mutant that removes bounds had nothing to remove and could not
  fail. A third was a construction before its declaration, which the fixture never exercised.

That last shape is the one worth remembering: a surviving mutant is not automatically a weak suite. It
can be a fixture asserting things the code does not do, and the fixture is what needs fixing.

## Known limitations

- **`overrides` is a small type and its guards are strict.** 3 edges over 971 files, from 417
  redefinition declarations. 414 are refused: 180 sit in a conditional or generated position, 37 are
  local bindings inside a function body / `do` / `let`, and the remainder are at file scope where no
  declared symbol exists to source the edge. A corpus that used more unconditional, module-nested
  redefinitions would produce more edges and the guard set would need re-measuring, not widening.
- **The scope of an `overrides` edge is a NAME, so two same-named modules in one file cannot both
  own the edge.** `julia/test/deprecation_exec.jl` declares `module Src` three times; the pre-pass
  keys on the declaration line so only genuine within-scope redefinitions are published, but the
  *edge's source string* is `Src` and the file's symbol table collapses the three modules into one
  `Src`. Cross-file identity for same-named modules is a project-wide question this per-file
  analyzer cannot answer.
- **`overrides` has no differential oracle.** It is emitted, it is stored, and nothing compares it
  against an independent derivation — the one DERIVATION finding in this lane. The fixture and five
  mutants cover it; the oracle does not exist.
- **11 relationship endpoints carry the name `unknown` and resolve to nothing**, all in
  `julia/JuliaLowering/src/validation.jl`, which declares `unknown() = ValidationResult(false, nothing)`
  at line 22 and calls it 10 times. `analyze()` publishes the symbol (93 symbols for that file);
  `parseFile` does not (90), because `keepSymbol`'s UNIVERSAL denylist
  (`src/ast/pool-worker.ts:452`) contains `"unknown"` and drops it for **every** language. That is a
  shared-file defect, reported rather than fixed here: the denylist's intent is to catch
  placeholder names, and a julia user function called `unknown` is neither a placeholder nor
  synthetic. Cross-language blast radius is unmeasured from here.
- **135 of 971 files (13.9%) yield zero symbols** through the production path. They are named in the
  census output; `julia/test/runtests.jl` and `julia/JuliaLowering/test/arrays_ir.jl` are among them.
  The cause was not investigated in this round and is a coverage gap, not a measurement.
- `+%` / `-%` and the remaining 177 ERROR-node files are grammar-side, not analyzer-side
- Macro-generated definitions are visible only when the definition is in source
  (`@inline f(x) = x` declares `f`; a macro that *synthesises* a name does not)
- Same-name ambiguity across modules is resolved by qualified path, but two paths that differ
  only in a segment the grammar does not expose would still merge
- Conditional-`Base` builtins cannot be resolved offline; the audit oracle reads the live
  runtime rather than a census, because `names(m; all=true)` lists names *defined in* a module
  rather than names *accessible through* it
- **Resolution is measured within one file**, because the analyzer is per-file. 53.7–56.1% for
  `calls`/`uses`/`references` is a statement about a corpus that is one upstream project, not about
  the graph as a consumer sees it after cross-file resolution. Nothing in this lane measures the
  second number.
- **`contains` collapses same-named siblings.** The relationship dedup key is
  `type|source->target` with no line, so two declarations of one name under one scope produce one
  `contains` row. The bash lane's key includes the line and keeps both. Widening it would grow
  every `contains` edge in every julia payload (10,467 rows today), which is a shared payload-budget
  decision and was not taken unilaterally.