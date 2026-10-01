# Julia Analyzer

## What it extracts
- **Symbols**: modules, structs (`class`), `abstract type` (`interface`), functions,
  macros, struct fields (`property`), `const` bindings (`constant`), local bindings
- **Relationships**: contains, extends, calls, uses, references, instantiates, imports
- **Payloads**: `declarationForm`, `isExported`, `isForeignCall`/`foreignSymbol`/
  `foreignLibrary`, `isTypeConstruction`, `isMacroCall`, `isTypeReference`,
  `isQualifiedReference`, `isFieldRead`, `evidenceClass`

## Two relationships are DECLINED, and that is a decision

`overrides` and `implements` are declined — not unimplemented, not forgotten.

- **Julia has multiple dispatch, not overriding.** `Area(::Circle)` and `Area(::Square)`
  are both live simultaneously and neither replaces the other. An `overrides` edge between
  them states a falsehood, and there is no correct substitute relationship to emit in its
  place. The analyzer emits neither, and fixture forbids assert their absence so a future
  change that starts producing them fails a gate instead of quietly improving a count.
- **`abstract type` is a type hierarchy, not protocol conformance.** `struct S <: I` is a
  subtype relation, the same one `abstract type` participates in. Publishing it as
  `implements` would be the managed-OO ontology applied to a language that does not have it.

`<:` is published as `extends` **only** for a real supertype. A type *parameter's* bound is
not a supertype: `struct Circle{T<:Real} <: Shape` binds `T`, and `Circle <: Real` is false.

Measured: 0 `overrides`, 0 `implements` over **160,558** relationships across 941 corpus files —
and asserted by fixture forbids, so a change that starts emitting them fails a gate rather than
quietly improving a count.

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
| `scoped_identifier` **does not exist** (0 occurrences in 400 files). Qualified access is a nested `field_expression` | every qualified call vanished; a file of them produced an empty graph with no error |
| `binary_expression`'s `operator` is a **named** child at index 1 | `pos(node,1)` returned the operator instead of the right operand, and an anonymous-child scan found nothing — zero `extends` edges corpus-wide |
| a `where` clause wraps the callable in a `where_expression`; **bare `where T` puts the type variable there as a sibling `identifier`** | every `where`-form declaration was skipped, and the type variable was published as the function's name (`T`) |
| `f(x)::T = …` is a `typed_expression` on the left; `x::Int = 5` is too | the return-type form was invisible, or the function published under its return type (`Float64`) |

The recurring lesson, recorded in the analyzer: **scan for a name before unwrapping the
wrapper around it, and you get the wrapper.** This happened three times in one lane.

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
| symbols / relationships | **27,560 / 160,558** |
| imports / exports | 1,047 / 1,785 |
| crashes | 0 |
| determinism | SHA-256 identical across a reused and a fresh analyzer instance |
| fixtures / mutants | 3 (40 facts) / **16, all caught, 0 survivors** |
| wall time | **168-208 s** for 941 files (4.5-5.6 file/s) — a range, and the reason is below |
| largest single file | 1,818 symbols / 3,888 relationships |

By kind: function 16,566 · property 4,232 · constant 2,632 · class 2,201 · module 749 ·
macro 460 · variable 441 · interface 279.
By relation: **calls 85,174** · references 34,898 · uses 25,766 · contains 10,215 ·
instantiates 2,720 · extends 1,785.

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
`calls` — 85,174 edges, the largest surface in the lane — was invisible rather than unverified.

Opting `calls`, `uses` and `references` in took the compared surface from 811 to ~6,200 edges on the
same 60-file sample and **halved** the unexplained rate, which is the opposite of what adding a strict
comparison usually does and worth stating plainly: the earlier high rate was the analyzer emitting
real edges the truth side declines to claim, not those edges being wrong.

    F5 julia (60 of 941, ROTATING):  covered 99.1%   unexplained 8.5%
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

- `+%` / `-%` and the remaining 177 ERROR-node files are grammar-side, not analyzer-side
- Macro-generated definitions are visible only when the definition is in source
  (`@inline f(x) = x` declares `f`; a macro that *synthesises* a name does not)
- Same-name ambiguity across modules is resolved by qualified path, but two paths that differ
  only in a segment the grammar does not expose would still merge
- Conditional-`Base` builtins cannot be resolved offline; the audit oracle reads the live
  runtime rather than a census, because `names(m; all=true)` lists names *defined in* a module
  rather than names *accessible through* it