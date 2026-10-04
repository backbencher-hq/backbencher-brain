# Julia Analyzer

> Canonical path `docs/analyzers/real-julia-analyzer.md` (renamed from `julia.md`, 2026-10-03;
> `script/m14/verify-doc-truth-emissions.ts` resolves an analyzer's doc by that name and reported
> `MISSING_DOC real-julia-analyzer.ts` while `julia.md` sat beside it). One reference to the old path
> belongs to a shared file — `script/m14/completeness-inventory.ts:733` — and is reported, not edited.

## What it extracts
- **Symbols**: modules, structs (`class`), `abstract type` (`interface`), functions, macros, struct
  fields (`property`), `const` bindings (`constant`), local bindings (`variable`)
- **Relationships**: `calls`, `uses`, `references`, `contains`, `extends`, `instantiates`,
  `overrides`, `imports`, `exports` — **all nine are emitted as relationship rows**, and `imports` /
  `exports` additionally fill the `ImportInfo[]` / `ExportInfo[]` channels from the same walk. Only
  `implements` is not emitted, and it is RULED with a corpus measurement. (This line said the
  opposite for `imports`/`exports` until this pass: it was a leftover from the two rulings that were
  later overturned, and it contradicted this file's own verdict table. See
  [§ `imports` and `exports` — two rulings overturned](#imports-and-exports--two-rulings-overturned).)
- **Payloads**: `declarationForm`, `isExported`, `isForeignCall`/`foreignSymbol`/`foreignLibrary`,
  `isTypeConstruction`, `isMacroCall`, `isTypeReference`, `isSubtype`, `isWhereBound`, `isFieldRead`,
  `isQualifiedReference`, `isOperatorMember`, `evidenceClass`, `replacesLine`, `isMethodRedefinition`,
  `via: "identical_signature_redefinition"`, `signature`

**Reproduce every number in this file:**

```
npx tsx validation/m14/fixtures/julia/census.ts --json /tmp/census.json       # the census, 1,985 files
npx tsx validation/m14/fixtures/julia/doc-tables-check.ts --json /tmp/census.json  # every table CELL vs the census
npx tsx validation/m14/fixtures/julia/overrides-differential.ts --json /tmp/ov.json
npx tsx validation/m14/fixtures/julia/direct-oracle-check.ts --files 40      # per-label, deterministic
npx tsx validation/m14/fixtures/julia/ruled-probe-check.ts                  # the implements ruling's 325/60
npx tsx validation/m14/fixtures/julia/arbiter-census-diff.ts                 # census vs arbiter, per type
npx tsx script/m14/firing-check.ts --files 120 julia                         # what FIRES, 120-file stride
npx tsx script/m14/firing-check.ts --files 2000 julia                        # …and over all 1,985
npx tsx script/m14/incoming-check.ts julia <5 files named in the INCOMING section>   # the reverse direction
npx tsx script/m14/differential.ts --lang julia --no-batch  # shared F5, scoped: writes NO canonical artifact
bun  run script/m14/run-fixtures.ts --lang julia
bun  run validation/m14/fixtures/julia/mutation-check.ts --all
npx tsx validation/m14/fixtures/julia/envelope.ts --files 400                     # the time envelope + load context
npx tsx script/m14/ontology-coverage-gate.ts julia                            # exit 0, 9 emitted / 1 ruled
```

**The arbiter reports this lane, and it now agrees with the census edge for edge.**
`script/m14/ontology-coverage-gate.ts` used to carry ruling tables for `bash` and `json` only and
exited 2 on julia with *"no RULING TABLE for julia … Refusing to report: a gate with an empty table
would call every un-emitted type RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the
lane."* `script/m14/julia-ruled.ts` exports `JULIA_RULED` (and `JULIA_RULED_INSTRUMENT_B`, the table
that FALSIFIES the same ruling), and the supervisor has since wired it: `RULED_BY_LANG` at
`ontology-coverage-gate.ts:199` reads `…, zig: ZIG_RULED, julia: JULIA_RULED`. The §8 edit this lane
asked for is applied, so the gate runs unmodified:

```
type          status            detail
------------------------------------------------------------------------------------------------------------------------
calls         EMITTED           122,150 edges in 4+ files, e.g. Aqua.jl/src/exports.jl, Aqua.jl/src/persistent_tasks.jl
uses          EMITTED           37,087 edges in 4+ files, e.g. Aqua.jl/src/exports.jl, Aqua.jl/src/persistent_tasks.jl
contains      EMITTED           14,299 edges in 4+ files, e.g. Aqua.jl/src/persistent_tasks.jl, Aqua.jl/src/Aqua.jl
imports       EMITTED           2,804 edges in 4+ files, e.g. Aqua.jl/docs/changelog.jl, Aqua.jl/src/Aqua.jl
references    EMITTED           49,586 edges in 4+ files, e.g. Aqua.jl/src/exports.jl, Aqua.jl/src/persistent_tasks.jl
exports       EMITTED           2,859 edges in 4+ files, e.g. Aqua.jl/src/precompile.jl, Aqua.jl/test/pkgs/PkgWithUndefinedExports.jl
extends       EMITTED           2,580 edges in 4+ files, e.g. Aqua.jl/test/pkgs/AquaTesting.jl, Aqua.jl/test/pkgs/PkgWithAmbiguities.jl
implements    RULED-SOUND       NOT EMITTED; the grammar produced 149 distinct node types across the corpus and NONE expresses it. Written ruling: script/m14/julia-ruled.ts (RULED_BY_LANG.julia)
overrides     EMITTED           3 edges in 3+ files, e.g. julia/Compiler/test/contextual.jl, julia/test/meta.jl
instantiates  EMITTED           3,428 edges in 4+ files, e.g. Aqua.jl/test/test_piracy.jl, DataFrames.jl/src/abstractdataframe/iteration.jl
------------------------------------------------------------------------------------------------------------------------
emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0        exit 0
```

**Every one of the nine counts equals this lane's own census, to the edge, and `implements` is the
arbiter's own RULED-SOUND.** Two instruments, different code paths, same numbers — which is the
strongest form of agreement available here, because the arbiter reads the corpus and counts rows while
the census walks the same files through `parseFile` and buckets every endpoint.

**The 13-edge shortfall this file previously reported is GONE, and its cause was a shared defect this
lane diagnosed rather than an arithmetic dispute.** An earlier version of this section recorded the
arbiter reading `calls` 86,867 · `uses` 26,357 · `references` 36,146 · `imports` 1,501 — exactly 13
short — and attributed it to `julia/stdlib/LibGit2/test/runtests.jl`, the one file the run reported
`[BB-PARSE-ERR] … memory access out of bounds` for, which emits precisely `calls=9 uses=2 references=1
imports=1`. That attribution was right and the mechanism was a SHARED one: `resolveWasm` wrote every
grammar to `os.tmpdir()/bb-wasm_<relativePath>`, a path shared by every process on the machine, with
a plain `writeFileSync`, so a concurrent reader could load a TRUNCATED wasm; `Language.load` then threw
and `parseFile`'s catch silently substituted `extractFallback`. `src/ast/engine.ts` now writes to a
per-process path and renames atomically, and the run above reports **0 `[BB-PARSE-ERR]` and 0
`[BB-HANG]` lines** where the earlier run reported two errors.
`validation/m14/fixtures/julia/arbiter-census-diff.ts` re-measures the same 1,985 files under the
arbiter's own counting rule and now returns **`throw: 0`, 234,796 rows, `files with r.fallback truthy:
0`**, with per-type totals identical to the arbiter's row for row. The diff instrument's reason for
existing is gone; it is kept because a gate that once disagreed by 13 edges should be able to show that
it no longer does.

**One property of the arbiter's output is an artifact of the shared gate, not a measurement, and it
applies to every language it scores.** Its file column reads `4+ files` for every large type because
`ontology-coverage-gate.ts` grows the set with `if (row.files.size < 4)` — the cap is in the gate, so
`calls in 4+ files` is not a statement about breadth (this lane measures 926). And its
`[BB-HANG]` handler is `process.exit(1)` (`src/ast/engine.ts:1412`), so a single slow file ends the
run rather than being reported: both are §8 items.

So the verdicts below are produced by the lane-owned census applying the gate's own two instruments
and the gate's own verdict algorithm to julia, and the gate's verdict algorithm now has a table to
read.

## The payload/latency question, and a first measurement of it that was wrong

§6 of the lane brief asks for a regression number against a budgeted lane. **There is no budgeted lane
to regress: julia is absent from the M60.R6 complexity gate entirely.** `script/m60/analyzer-complexity-gate.ts`
prints 44 lanes and no julia row; `validation/m60/analyzer-budget-register.json` has no julia entry;
and the artifact that gate reads, `validation/m12/results/julia-complexity.json`, does not exist. The
shared M12 harness (`script/m12/measure-analyzer.ts`) exits before timing because
`validation/m12/fixtures/julia` does not exist, and it writes to a shared results path (§8). So the
envelope is measured lane-owned, in `validation/m14/fixtures/julia/envelope.ts`, through `parseFile`,
writing nothing:

```
$ npx tsx validation/m14/fixtures/julia/envelope.ts --files 400
file set: 400 of 1985 candidates (stride 4), digest 36cef2786b320821
byte distribution: min 31 · median 3695 · p90 33378 · max 191504
load under measurement: load1 11.21 on 8 cores
39811 ms for 400 files  ->  99.53 ms/file
symbols 6,970  relationships 46,263  parseFile threw: 0
throughput: 1337 outputs/s, 115.7 relationships/file
per-type on this draw: calls=23877 · references=10205 · uses=7132 · contains=2721 ·
  exports=797 · instantiates=622 · imports=458 · extends=451
```

**That `99.53 ms/file` and the counterfactual `78.54 ms/file` were taken at load1 11.21 and 13.68, and
the 27% difference between them is the LOAD, not the code.** #909 records the same trap killing a c-lane
figure: 145.7ms/file, then 25.8, then 172.6 on the same analyzer minutes apart while three other agents
sat above 59% CPU. Re-measured properly — two arms INTERLEAVED, three rounds each, so neither arm owns
the quietest moment — the sign reverses:

| round | `imports`+`exports` emission ON | OFF | load1 (ON / OFF) |
|---|---|---|---|
| 1 | 34,868 ms | 35,903 ms | 12.04 / 11.56 |
| 2 | **33,448 ms** | 34,940 ms | 11.06 / 12.61 |
| 3 | 34,119 ms | 35,243 ms | 11.24 / 11.60 |

**ON was faster in 3 of 3 rounds**, so the honest reading is that emitting 1,255 additional edges per
400 files costs nothing measurable — and the reason is structural rather than lucky: `importTargets()`
and `exportableName()` were **already being called** to fill the `ImportInfo[]` and `ExportInfo[]`
channels (`real-julia-analyzer.ts:709`, `:746`). The relationships are pushed inside the same loop over
the same nodes, so the addition is edge-object construction and no second tree walk.

**The counterfactual was measured by gating the two `relationships.push` sites behind an env var, timing,
and then restoring the file byte-identical from HEAD** — the diff above is empty and
`git diff --exit-code src/ast/real-julia-analyzer.ts` passes. The gate was not committed: an env-var
switch in the analyzer is a second behaviour, and the number is reproducible from the committed file by
doing the same edit. **The lesson worth keeping is the first pair of numbers, not the second**: a
sequential ON-then-OFF measurement on this shared box manufactured a 27% regression that did not exist,
in the direction that made this lane's addition look expensive — the flattering direction for the person
reporting and the opposite of the one an adversarial review expects.

---

## What FIRES, at two sample sizes — and why the smaller one reads 8/10

`script/m14/firing-check.ts` is the instrument that exists because a previous programme reported
"14 lanes at 10/10" for a week from SOURCE DERIVATION. It drives `parseFile`, not `analyze()`. Two runs,
same corpus, same analyzer, same commit — only `--files` differs:

```
$ npx tsx script/m14/firing-check.ts --files 120 julia
8/10 fired, 14204 edges, 120/120 files        <-- note 14,204, not 234,796
  julia  120/120  8/10  14,204  0 degraded  stable
  types: calls,uses,contains,imports,references,exports,extends,instantiates

$ npx tsx script/m14/firing-check.ts --files 2000 julia
9/10 fired, 234796 edges, 1985/1985 files
  julia  1985/1985  9/10  234,796  0 degraded  stable
  types: calls,uses,contains,imports,references,exports,extends,overrides,instantiates
```

**The 120-file run reads 8/10 and that is a SAMPLING artifact, not a firing failure — provably, not
probably.** The type it misses is `overrides`, which this lane emits **3 edges across 3 files** in a
1,985-file population. `firing-check.ts` picks its sample by a deterministic stride,
`stride = floor(population / limit)` then indices `0, stride, 2·stride, …` (`firing-check.ts:190-192`),
so at `--files 120` the stride is 8 and only multiples of 8 are taken. The three files carrying the
`overrides` edges sit at sorted indices **77, 781 and 867**, and `77 % 8 = 5`, `781 % 8 = 5`,
`867 % 8 = 3` — **none is a multiple of 8, so all three are excluded by arithmetic.** At
`--files 2000` the stride is 1, all 1,985 files are taken, and all three are included. The type is not
rare-and-alive on a knife edge; it is excluded by a modulus, and the modulus is checkable from the
file list alone. `implements` is the other zero, and it is RULED with a measurement rather than
unsampled.

The general point is worth stating because it applies to every lane that reports a fraction: **a
per-type count below the sample's resolution cannot distinguish "dead code" from "rare construct."**
The discriminator here is edges-per-file, and `overrides` at 3 edges / 3 files is one edge per file —
the thinnest signal a type can carry. `overrides-differential.ts` exists because a 3-edge type cannot
be validated by a rotating sample at all, and `direct-oracle-check.ts` reports `overrides` as `n/a`
rather than `TARGET only` on its 40-file draw for the same reason: with zero edges in the sample there
is no evidence about which end an oracle populates, and a default there would print a zero as if it
were a finding.

Both runs report **`degraded: 0`**, which is the shared wasm temp-path fix holding under concurrency
(see above); earlier runs of this lane could not make that claim.

---

# The ten ontology types, verdict by verdict

**Corpus.** 1,985 admitted files, no sampling — the whole population the router (`detectLanguageFromPath`)
selects across **14 projects**: `JuliaLang/julia` 941, `Graphs.jl` 253, `Pkg.jl` 219, `StaticArrays.jl`
111, `Documenter.jl` 101, `Flux.jl` 100, `DataFrames.jl` 73, `LanguageServer.jl` 57, `Aqua.jl` 51,
`Query.jl` 30, `json_jl` 25, `GLM.jl` 14, `DifferentialEquations.jl` 5, `nvim-treesitter` 5.
**0 `.jl` files are excluded for exceeding 512 KB.** Production grammar
`wasm/tree-sitter-julia.wasm`, md5 `dbcd79759b4216c80de73c17a56255f8`.

**The corpus more than doubled and diversified from 3 projects to 14, and the previous version of this
file named that as its single largest threat.** It said, in Known limitations, that the corpus was
"96.8% one upstream project" and "this environment has no network access" after six clone attempts
failed. Network is available now, so eleven ecosystem packages were cloned — tables, graphs, package
management, statistics, array types, documentation tooling, machine learning, ODE solvers, a query DSL,
QA tooling and a language server — chosen for construct diversity rather than popularity.
**No verdict moved.** The `implements` ruling was the one exposed to it (a second subtyping operator
could exist in the ecosystem and not in `JuliaLang/julia`), and instrument A returns the same **149**
node types over the doubled corpus with **0 of the 12** conformance-clause candidates present. The
ruling is now measured against 14 projects rather than 3.

**The `excluded: >512 KB (1,006 candidates)` figure this file used to print was measuring the wrong
population, and the exclusion it implied never happened.** The counter tallied every tracked file over
512 KB in the corpus root — which six other language lanes share — so it was dominated by other lanes'
`.png`, `.po` and `.so` files, it moved when another agent cloned (1,003 → 1,006 → 1,007 across this
lane's own runs with no change to the julia file set), and printed beside `admitted files: 971` it read
as "1,006 julia files were dropped for size". Measured on this corpus root: **1,007 tracked files over
512 KB, of which 0 are `.jl`.** The julia population was never cut by that rule. The census now prints
the two counts separately and labels what each is.

**Production totals.** 36,806 symbols · 234,796 relationships in the ten types · 0 crashes · 0 files
routed to the >1 MB structural fallback · **365 of 1,985 files (18.4%) yield ZERO symbols** and are
listed by name in the census output · **0 of 1,985 files unreadable by the production grammar**.

The zero-symbol share rose from 13.9% to 18.4% and the corpus is to blame, not the analyzer: 230 of the
365 are in the eleven newly cloned packages, where `test/` fixtures, `docs/` build scripts and
`Project.toml`-adjacent stubs are a larger share of the file set than they are in `JuliaLang/julia`.
This is a coverage gap and is declared as one below; it is not a measurement that improved.

| Relationship type | Emitted? | Verdict, channel and measured size over 1,985 files | Files |
|---|---|---|---|
| `calls` | **EMITTED** | relationship, **122,150** | 1,873 |
| `references` | **EMITTED** | relationship, **49,586** | 1,662 |
| `uses` | **EMITTED** | relationship, **37,087** | 1,480 |
| `contains` | **EMITTED** | relationship, **14,299** | 954 |
| `instantiates` | **EMITTED** | relationship, **3,428** | 535 |
| `imports` | **EMITTED** | relationship **and** `ImportInfo[]`, **2,804** rows | 961 |
| `exports` | **EMITTED** | relationship **and** `ExportInfo[]`, **2,859** rows | 209 |
| `extends` | **EMITTED** | relationship, **2,580** | 537 |
| `overrides` | **EMITTED** | relationship, **3** | 3 |
| `implements` | **RULED** | no channel; 0 of 12 named constructs in the grammar inventory; the 449 nearest candidates are published as `extends` | — |

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
  docs/analyzers/real-julia-analyzer.md:96
```

`calls` **is** documented — it is the first body row of the verdict table (`| \`calls\` | **EMITTED** |
relationship, **122,150** | 1,873 |`) and the gate cannot see it, which is the whole content of the
finding. The line number is quoted from one run and drifts as this file grows; the row is the durable
identifier and the gate's own output above is the check.

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

### `imports` — EMITTED, 2,804 edges across 961 files

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
because most Julia corpus files open no module and a top-level `using` imports into `Main`.

**Resolution, and it is not close.** Target end: **51.8% (1,454) resolve to a declaration elsewhere in
this corpus**, 10.4% (291) are reachable through the file's own import path, 0.7% (20) resolve
in-file, and **36.9% (1,036) resolve to nothing** — `Dates`, `UUIDs`, `Printf`, `Test`, and now
`DataFrames`, `Graphs`, `Flux`, `StaticArrays` and the rest of the ecosystem, none of which is a
dependency of any other file in this corpus because each package is a separate world. Both-ends is
**0.5%**. Both ends got slightly worse as the corpus grew and that is the expected direction: adding
independent packages adds `using` targets that nothing in the corpus can satisfy. That number is a property of the
construct, not a defect in the edge: `using Dates` names a module this corpus does not contain, and a
Python `import numpy` resolves no better inside a Python repository. The honest statement is that
half of these edges are walkable at project scope and half name things outside the project, and the
census separates those two buckets rather than averaging them into one number.

### `exports` — EMITTED, 2,859 edges across 209 files

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

**Resolution.** Target end: **32.2% (921) in-file unique, 48.9% (1,398) resolve elsewhere in the
corpus, 6.3% (180) in-file ambiguous, 12.2% (350) resolve to nothing**; 87.8% of targets bind
somewhere. Both-ends is 28.0%, limited by the source end (72.2%): 2,039 edges carry a module symbol,
794 carry the file scope. In-file unique fell from 41.8% to 32.2% and both-ends from 34.4% to 28.0%
purely because the corpus grew: a module in an ecosystem package is more likely to export a name that
several of its own files also declare than a `Base` module was.

### The construct count vs the edge count — the check that found a live defect

Reconciling *files containing the construct* against *files whose edge fired* is what exposed a
second, independent defect. It is now a standing census output:

```
imports   files with the construct: 961   files with >=1 edge: 961   silent: 0
exports   files with the construct: 210   files with >=1 edge: 209   silent: 1
```

**`using Base: isexpr` produced no edge at all.** That form parses as a `selected_import` node, and
`importTargets` matched neither `import_path` nor a bare `identifier` there, so it returned an empty
list. "**583 of the 1,675 import statements across the 971 admitted files at the time of that fix** were
contributing nothing — 1,246 of the 3,154 across the present 1,985 admitted files, by the same
proportion, since the `selected_import` form is idiomatic in every project that touches the standard
library by name —
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

**Probe.** `wasm/tree-sitter-julia.wasm` produces **149 distinct node types over the 1,985 admitted
files (7,163,916 nodes visited)**. The count is the same 149 the old 971-file corpus produced, which
is itself part of the evidence: 1,014 additional files from eleven unrelated projects added **zero**
node types, so the grammar's vocabulary is saturated with respect to julia source rather than merely
large enough for the sample that happened to be available. Twelve node-type names were named from the ontology —
`implements_clause`, `interface_implementation`, `class_implements`, `protocol_conformance`,
`trait_implementation`, `object_declaration`, `protocol_declaration`, `interface_declaration`,
`trait_declaration`, `class_declaration`, `mixin_clause`, `conform_clause` — and the grammar produces
**none of them**.

The construct is not merely absent as a clause: the corpus's nearest candidate occurs **449 times
across 87 files** — a supertype clause naming an `abstract type` declared in the same file, e.g.
`json_jl/src/parse.jl:156` `JSONReadStyle{O,T,S} <: JSONStyle` and
`Aqua.jl/test/pkgs/PkgWithAmbiguities.jl:16` `SingletonType <: AbstractType`. Every one of those is a **subtype**
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
type too. Two implementations that both say nothing agree exactly.

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
drives the analyzer and an independent derivation over all 1,985 files; an early version of the oracle
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
as guards landed. Every step down was a fabrication removed. **The corpus then doubled to 1,985 files
and the funnel was re-measured from the top, because a guard set calibrated on 941 files of one project
is a claim about that project until it is asked about 1,014 more.** The shape is unchanged and every
step is larger:

| guard | measured evidence over 971 files | over 1,985 files | edges removed |
|---|---|---|---|
| unconditional position | 417 redefinition pairs across 109 files; **237 across 57** survive | **487 across 130; 278 across 67 survive** | 487 → 278 |
| not a local binding | 200 pairs | **205 across 52** | 278 → 205 |
| the enclosing scope differs | 163 pairs | **163 across 46** | 205 → 163 |
| a DECLARED owner | 44 pairs | 44 (unchanged by construction — the three surviving files are all in `julia`) | 163 → 44 |
| the guards combined | **3 edges** | **3 edges** | 44 → 3 |

**The corpus grew the candidate pool 17% (417 → 487) and grew the emitted count by 0%, and that is the
result worth having.** Eleven ecosystem packages were asked the same question `JuliaLang/julia` was
asked and produced 70 more identical-signature pairs, 41 more after the unconditional-position guard,
and **not one edge**: `Documenter.jl/test/examples/make.jl:89,103,118` declares `f()` three times and
`Documenter.jl/test/missingdocs/make.jl:10,21` declares `f()` twice, both inside generated test-example
modules, and neither is a method-table replacement a refactoring tool should be told about. The guards
are not narrow because the corpus is; they are narrow because julia writes closures under the same
name and signature constantly.

**Unconditional position.** `julia/JuliaLowering/src/lazy.jl:437-442` is
`if VERSION < v"1.11" … mem(n) = … else … mem(n) = … end` — same name, same signature, and exactly one
branch runs. Version guards are idiomatic Julia, so this bucket is large and counting it would have
been the fabrication the workstream's rule exists to prevent. The guard walks **ancestors**
(`else_clause` is not adjacent to its declaration) and covers `macrocall_expression` and the quote
forms, whose content is code Julia writes at expansion rather than text this file declares.

**The short-circuit branch, and why it is live.** `cond && function f() … end` is a version-guarded
method definition, so `&&`'s right operand is refused too. Measured over the 1,985 admitted files:
**14,710 `&&` binary_expressions, of which exactly 1 has a declaration node as its right operand** —
`julia/JuliaSyntax/src/core/parse_stream.jl:316`,
`VERSION < v"1.11.0-DEV.753" && function ParseStream(io::IOBuffer; version=VERSION)`. The count of
`&&` nodes grew by 3,161 with the corpus and the count that matters did not move: still exactly one
file in 1,985 writes a method definition behind `&&`, which is why this guard removes exactly one
fabrication and no more. The same branch tested with `||` returns **0 of 6,537**, so `||` is
deliberately absent: a predicate the grammar cannot reach is what honesty contract §2's L2 audit
exists to report, and it is reported as unreachable rather than as a zero that looks like coverage.

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
somewhere in the whole corpus" — while the text described them as per-file. Measured against each file's own
symbol table they are **19.8%, 25.0%, 19.5% and 20.4%** — and on the present 1,985-file corpus they
are **17.2%, 23.6%, 17.5% and 19.5%**: the old figures overstated per-file resolution by **2.2× to
3.2×**, and the corpus doubling cost a further 2 to 3 points on every one of the four. The union number is not worthless — it is what a project-wide index
can resolve — but it is a different number and it was published under the wrong heading.

| type | EXISTS | FIRES | CORRECT | LABELLED | RESOLVED (both ends) | CONFIDENT |
|---|---|---|---|---|---|---|
| `calls` | yes | 122,150 / 1,873 files | **75.8% covered / 294 unexplained** of 1,214, oracle `julia-calls`, **target only** | `usage_contextual` | **17.2%** (src 78.5 / tgt 19.8 / neither 19.0) | conf 1.0 on all; **0 under 0.7** |
| `uses` | yes | 37,087 / 1,480 | **98.9% / 5 unexplained** of 473, oracle `julia-refs`, **target only** | `usage_contextual` | **23.6%** (src 79.1 / tgt 25.6 / neither 19.0) | conf 0.9; **0 under 0.7** |
| `contains` | yes | 14,299 / 954 | **86.8% / 40 unexplained** of 302, oracle `julia-contains`, **both ends**; it found a real defect | `structural` | **100.0%** (neither 0.0) | conf 1.0; **0 under 0.7** |
| `references` | yes | 49,586 / 1,662 | **91.4% / 36 unexplained** of 418, oracle `julia-refs`, **target only** | `import_based` | **17.5%** (src 86.5 / tgt 18.5 / neither 12.4) | conf 1.0 ×46,134 + 0.95 ×3,452; **0 under 0.7** |
| `imports` | yes | 2,804 / 961 | **no oracle — see DERIVATION below** | `import_based` | **0.5%** both-ends (src 51.4 / tgt 0.8); target-end 51.8% corpus-only + 10.4% external-by-import | conf 1.0; **0 under 0.7** |
| `exports` | yes | 2,859 / 209 | **no oracle — see DERIVATION below** | `import_based` | **28.0%** (src 72.2 / tgt 38.5); target-end 87.2% bind somewhere | conf 1.0; **0 under 0.7** |
| `extends` | yes | 2,580 / 537 | **57.1% / 12 unexplained** of 28, oracle `julia-type-edges`, **both ends** | `structural` | **19.5%** (src 53.6 / tgt 26.1 / neither 39.7) | conf 1.0; **0 under 0.7** |
| `instantiates` | yes | 3,428 / 535 | **all 19 truth edges covered, 0 missing**, 7 of 26 unexplained, oracle `julia-type-edges`, **target only** | `usage_contextual` | **79.1%** (tgt 100.0, src 79.1) | conf 0.9; **0 under 0.7** |
| `overrides` | yes | 3 / 3 | **lane-owned oracle, 3/3, 0 unexplained, 0 missing — NOT yet wired into F5.** `overrides-differential.ts` covers the type over the whole corpus, and the 40-file check now exercises it too (1 edge, both ends, 100%) | `structural` | **100.0%** | conf 1.0; **0 under 0.7** |

`contains` at 99.9% and `overrides` at 100.0% are the reference points showing the measurement is not
simply reporting that most edges are cross-file. The 17.2–23.6% figures for the other four are what a
consumer of one file's graph sees on a corpus of fourteen projects, and they are LOWER than the
19.5–25.0% this file reported when the corpus was three — a realistic corpus has more cross-file edges
than one upstream project does, so the per-file number improved for neither reason.

### The heuristic ratio is 0.0% for every type

Every one of the 234,796 rows is at or above 0.9 and `evidenceClass` is set on every one of them.
Honesty contract §4 requires the heuristic/deterministic ratio to be a queryable number, and for this
lane the answer is that there are none to count. That is a property of the design — every edge is a
syntax fact — and it is worth reading against the resolution column, because "no heuristics" and
"resolves 17.2% of the time" are independent facts and only the first is good news.

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
| `calls` | 122,150 | 23,232 | 504 | 390 | 1,193 | 5,832 | 79,462 | 1,503 | 10,034 | 0 |
| `uses` | 37,087 | 7,231 | 334 | 1,906 | 0 | 0 | 20,331 | 2,608 | 4,660 | 17 |
| `contains` | 14,299 | 10,612 | 0 | 3,681 | 0 | 0 | 0 | 0 | 1 | 5 |
| `references` | 49,586 | 4,342 | 4,529 | 312 | 0 | 1,732 | 26,240 | 2,593 | 9,838 | 0 |
| `imports` | 2,804 | 20 | 0 | 3 | 0 | 291 | 1,454 | 0 | 1,036 | 0 |
| `exports` | 2,859 | 921 | 0 | 180 | 0 | 0 | 1,398 | 10 | 350 | 0 |
| `extends` | 2,580 | 589 | 74 | 11 | 0 | 71 | 1,221 | 120 | 494 | 0 |
| `overrides` | 3 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| `instantiates` | 3,428 | 1,460 | 1,911 | 57 | 0 | 0 | 0 | 0 | 0 | 0 |

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
  this is 79,462 of 122,150: 941 of the 1,985 files are the Julia standard library, whose callees are
  declared elsewhere by design, and the ecosystem packages are mutually independent so their callees
  are declared in packages that are not in this corpus at all.
- **local binding, not a symbol** — a parameter, loop variable, `let` binding or catch variable. Bound
  in the file and deliberately unpublished, because `SymbolKind` has no `Parameter` member and the
  repo's standing negative contract says parameters are not symbols (csharp M12.07
  `ParamsAreNotSymbols`). **Unresolvable by design, not a lost declaration.** 21,693 such bindings
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

`script/m14/incoming-check.ts` measures the same property from the other direction, on an explicit file
set, and its output names the ambiguous targets individually. **The set is the three files that carry
this lane's only `overrides` edges plus the two parse-heaviest files that declare a type, and it is
named here because the previous version of this block did not name it** — it quoted 342 symbols, 766
`calls` and 6 ambiguous targets, and no command reproduces those, so the table was not a measurement
any reader could check. The file set is the one below and it is fixed:

```
R=$HOME/fixtures/repositories
npx tsx script/m14/incoming-check.ts julia \
  $R/julia/Compiler/test/contextual.jl \
  $R/julia/test/meta.jl \
  $R/julia/test/reflection.jl \
  $R/julia/base/toml/parser.jl \
  $R/julia/stdlib/Dates/src/types.jl
```

```
incoming check — julia, 5 file(s), 375 symbols
degraded parses: 0   parse failures: 0

type            fired  edges    distinct  ambiguous  unresolved
--------------------------------------------------------------------------
calls           yes    819      130       0          569
uses            yes    331      55        6          164
contains        yes    149      127       5          0
imports         yes    48       1         0          47
references      yes    390      21        63         298
exports         yes    31       20        2          8
extends         yes    22       9         0          5
implements      NO     0        0         0          0
overrides       yes    3        3         0          0
instantiates    yes    51       12        45         0
--------------------------------------------------------------------------
distinct declarations named by at least one edge : 240
declarations nothing names (orphans)             : 92 of 375
target names resolving to >1 published symbol      : 8
  exported -> variable, function      Date       -> class, function
  Comments -> class, function        Time       -> class, function
  CommentBlock -> class, function     Parser     -> class, function
  ParserError -> class, function
```

**Seven of the eight ambiguous names are the `class`/`function` pair and the eighth is NOT, so the
structural property is two properties rather than one.** The seven (`Date`, `Time`, `Comments`,
`CommentBlock`, `Parser`, `ParserError`) are the case stated below: in julia `struct X … end` and
`X() = …` are one binding, so the analyzer publishes two symbols under one name. The eighth,
`exported`, is a **different** shape and the earlier version of this block asserted it was the same one
while listing it in its own output — it is `global exported::Int = 1` at
`julia/test/reflection.jl:297` published as a `variable`, and `exported() = 1` at
`julia/test/reflection.jl:1465` published as a `function`. **One name, two declaration forms, both
legitimate, and no metadata on the edge distinguishes them** because neither form asserts a kind. A
consumer matching this target by name will attach both the `contains` and the `exports` edge to whichever
it picked first. Corpus-wide this name accounts for 2 `contains` edges and 2 `exports` edges; the census
lists it under both types (`incoming.ambiguousTargets.contains.exported` and
`.exports.exported`), which is how the shape was found.

`references` and `instantiates` carry most of the ambiguity (63 and 45 of it) because they assert the
type kind and therefore land on type names.

**Its `unresolved` column is NOT comparable to the corpus-wide buckets below, and the difference is the
instrument, not a disagreement.** `incoming-check.ts` resolves only against the files it was handed —
5 files — so a call into `Base` is unresolvable there by construction. The census resolves against all
1,985 at once and therefore has a `corpus-only` bucket (79,462 of 122,150 `calls`) this instrument has
no way to produce. Target-end resolution, 5-file draw against corpus-wide:

| type | 5 files | 1,985 files | ratio |
|---|---|---|---|
| `imports` | 2.1% | 51.9% | **24.7×** |
| `references` | 23.6% | 81.6% | 3.5× |
| `calls` | 30.5% | 82.2% | 2.7× |
| `uses` | 50.5% | 84.7% | 1.7× |
| `exports` | 74.2% | 87.8% | 1.2× |
| `contains` / `instantiates` / `overrides` | 100% | 100% | 1.0× |
| `extends` | 77.3% | 81.0% | 1.0× |

The three types at 1.0× are the ones whose edges are **in-file by construction** — `contains` names a
member of the enclosing declaration, `instantiates` and `overrides` name a sibling method — so a
5-file window loses nothing. Every type that reaches across files loses a great deal, and `imports`
loses the most because a `using Foo` names a module that lives in another file: 1 of 48 resolves here
against 1,465 of 2,804 corpus-wide, **24.7×**. `extends` reads 77.3% on this draw rather than 0% because
`toml/parser.jl` declares `Parser <: …` and `Dates/src/types.jl` declares `Date <: TimeType` in the same
window — which is the whole point: **whether a 5-file window can see inheritance at all is a property of
which five files you picked, not a property of the analyzer.** The previous version of this table
reported `extends` at 0 of 6 and read it as the sharpest illustration of the effect; the same
instrument on a different five files reports 17 of 22. **A single number for "resolution rate" is only
meaningful alongside the size of the window it was measured in AND the names of the files in it.**

**13,893 edges target a name the file publishes under more than one kind or more than once.** The
concrete case is structural in Julia rather than accidental: `struct Object … end` together with
`Object() = …` is **ONE binding** — the type name *is* the constructor — so the analyzer publishes
`class:Object` and `function:Object` side by side, and an edge whose target is that bare name names
two symbols.

**That figure was published wrong here, twice, and both errors are this lane's own.** An earlier
version of this line said **10,936**, which does not equal the sum of the table above it: adding that
table's own *disambiguated* and *residual* columns gives **11,098**. So the prose total was not a
measurement and not the sum of the measurements printed beside it — it was 162 below both, which is
the signature of a total carried forward across an edit to its own rows. The census prints the total
itself (`TOTAL ambiguous-target edges:`) and had been printing **11,101** all along at the time; the number in
this paragraph had been transcribed rather than read. The corrected figure is the instrument's, and
the table's columns now sum to it exactly:

| | disambiguated | residual | total |
|---|---|---|---|
| `calls` | 504 | 390 | 894 |
| `uses` | 334 | 1,906 | 2,240 |
| `contains` | 0 | 3,681 | 3,681 |
| `references` | 4,529 | 312 | 4,841 |
| `imports` | 0 | 3 | 3 |
| `exports` | 0 | 180 | 180 |
| `extends` | 74 | 11 | 85 |
| `overrides` | 0 | 1 | 1 |
| `instantiates` | 1,911 | 57 | 1,968 |
| **sum** | **7,352** | **6,541** | **13,893** |

**The edge's own metadata picks out exactly one candidate in 100% of the multi-symbol cases for
`calls` (504/504), `uses` (334/334), `references` (4,529/4,529), `extends` (74/74) and `instantiates`
(1,911/1,911)**, because each of those edges asserts the kind its target must have. It does NOT pick
one out in the remaining 2,405 multi-symbol `calls`, `uses`, `references`, `extends` and
`instantiates` edges collectively — those are cases where several candidates share the asserted kind,
and the table in the census prints the resulting rate per type (`calls` 56.4%, `uses` 14.9%,
`references` 93.6%, `extends` 87.1%, `instantiates` 97.1%):

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

- **`contains`, 2,689 edges.** *Disambiguated by its SOURCE*, not by its target: `Owner -contains->
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

**Measured, not read off the allowlist.** `BB_LABEL_DUMP=julia` makes the harness print truth rows
against comparable rows per label, which is the instrument that settles "is this label compared?"
without reading a 24,000-line file's control flow:

```
$ BB_LABEL_DUMP=julia bun run script/m14/differential.ts --repo julia --sample 40
[label-dump] julia: truth-vs-comparable per label
[label-dump]   calls          truth=  1875  comparable=  2094
[label-dump]   contains       truth=   649  comparable=   450
[label-dump]   extends        truth=    41  comparable=    27
[label-dump]   instantiates   truth=    42  comparable=    64
[label-dump]   references     truth=   592  comparable=   612
[label-dump]   uses           truth=   907  comparable=   916
```

**Six labels are compared and three of the nine emitted types are absent from the list entirely** —
`imports`, `exports` and `overrides` appear in neither column. The harness prints **no
`COMPARED WITH NO TRUTH` line**, which is the correct behaviour and worth distinguishing from coverage:
every label it *does* compare has truth behind it, and the three it cannot compare are not counted as
covered at all rather than being counted against zero. That is the difference between an honest gap and
the failure mode the gate header records, and it is why this section can state a count.

| type | edges | in F5's compared set | independent oracle | what stands behind it instead |
|---|---|---|---|---|
| `overrides` | 3 | **no** | **yes** — `script/m14/oracles/julia-overrides.ts`, 3/3 agreement | paid down below; truth exists but is not pushed into F5 |
| `imports` | 2,804 | **no** | **no** | fixture `imports-and-exports` + the construct-vs-edge reconciliation (961/961, 0 silent) |
| `exports` | 2,859 | **no** | **no** | fixture `imports-and-exports`; 209 of 210 files, the shortfall explained by node type |

Neither of the two is close to paid down the way `overrides` was, and the limit should be stated
rather than papered over: an oracle for either would have to derive "this file imports that module"
and "this module exports that binding" from the tree **independently** of `importTargets` and
`exportableName`. Those are the two functions under test, so reusing them would make the oracle agree
with the analyzer by construction — the "two implementations that both say nothing agree exactly"
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
types the production grammar actually produced over the 1,985 corpus files.

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
production grammar **produced** over 1,985 real files, so a declared-but-never-produced name is caught)
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

`JuliaLang/julia@6391263` plus eleven ecosystem packages, shallow clones, clean trees, **1,985 tracked
`.jl` files, no sampling**.

| | |
|---|---|
| admitted files | **1,985** across 14 projects: `julia` 941, `Graphs.jl` 253, `Pkg.jl` 219, `StaticArrays.jl` 111, `Documenter.jl` 101, `Flux.jl` 100, `DataFrames.jl` 73, `LanguageServer.jl` 57, `Aqua.jl` 51, `Query.jl` 30, `json_jl` 25, `GLM.jl` 14, `DifferentialEquations.jl` 5, `nvim-treesitter` 5. **0 `.jl` files excluded over 512 KB**; the 1,007 non-`.jl` large files counted in the same shared root belong to other lanes |
| symbols / relationships | **36,806 / 234,796** in the ten ontology types |
| files yielding ZERO symbols | **365 of 1,985 (18.4%)** — listed by name in the census output |
| construct-vs-edge reconciliation | `imports` **961 files with the construct / 961 with an edge / 0 silent**; `exports` 210 / 209 / 1 silent (`julia/test/precompile.jl`, interpolated names) |
| crashes | 0 · structural fallback: 0 files · `parseFile` threw: 0 · **grammar-unreadable: 0** |
| empty or unknown `SymbolKind` | **0** · empty symbol names: **0** |
| endpoints equal to the literal `unknown` | 11, all in `julia/JuliaLowering/src/validation.jl`, and **all 11 now resolve** — see [the section on them](#the-unknown-endpoints-resolved-by-a-shared-fix-i-do-not-own) |
| determinism | SHA-256 identical across a reused and a fresh analyzer instance |
| fixtures / mutants | 5 fixtures / **25 mutants, 25 killed, 0 survivors** |
| largest single file | 1,818 symbols / 3,890 relationships |

By kind: function 21,603 · property 6,339 · constant 3,261 · class 3,069 · module 1,146 · macro 554 ·
variable 472 · interface 362. (Every kind grew with the corpus; `module` grew most in proportion,
1,146 against 941 files, because ecosystem packages are module-per-package where `JuliaLang/julia`
is not.)
By relation: **calls 122,150** · references 49,586 · uses 37,087 · contains 14,299 · imports 2,804 ·
exports 2,859 · instantiates 3,428 · extends 2,580 · overrides 3. **The independent arbiter agrees with
all nine to the edge**, and `overrides` is unchanged at 3 because none of the eleven new packages
declares an unconditional same-scope same-signature redefinition — itself worth stating, since it means
the guard set has now been asked about 1,014 additional files and answered no.

**Two traps in that table, both of which produced a number that read as a measurement.**

The per-type **file count was capped at 6** in an earlier version, to keep the output short, so every
large type printed `files: 6`. The cap is gone: 1,873 / 1,662 / 1,480 / 954 / 961 / 537 / 535 / 3.

The **resolution** column was measured against a corpus-wide union of symbol names while the
surrounding text said "same file" — see *The six questions* above. Per-file resolution is 17.2–23.6%
for the four large cross-file types, not 81.6–87.8%.

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

**The shared F5 harness can only see ONE of this lane's fourteen corpus projects, and that is a
structural limit of `LANG_REPOS` rather than of the sweep.** `script/m14/differential.ts:393` declares
`LANG_REPOS: Record<string, string>` — one corpus directory per lane — and `julia: "julia"` at
`:550`. Every F5 figure below is therefore measured on the 941 files of `JuliaLang/julia` and on
nothing else, while this lane's own census covers 1,985 files across 14 projects. **The two instruments
are answering questions about different populations and their percentages are not comparable**, which
is stated here rather than left for a reader to discover. The type is `Record<string, string>` rather
than `Record<string, string[]>` because `bash` and `json` each tried to add a second corpus by writing
a second key in the same literal — legal JavaScript with last-wins semantics, so the file parsed, `tsc`
stayed silent, and both lanes measured the wrong repository. That is the reason for the shape and it is
recorded at `:370-377`. §8: the fix is `LANG_REPOS_SECOND`-style support for a third and subsequent
corpus, or a `--repo a,b` sweep. Not applied here — `differential.ts` is supervisor-owned.

    F5 julia (200 of 941, cold-pool ROTATING):  covered 98.9%   unexplained 8.7%
                                     analyzer-edges=20221 tree-truth=19052 MISSING=213 heuristic=0
                                     + COMPARED WITH NO TRUTH: overrides
    prior 60-file rotation:              covered 99.1%   unexplained 8.5%
    2026-10-04, 40 of 971, rot 35:       covered 96.8%   unexplained 9.3%
                                     analyzer-edges=4088 tree-truth=4038 MISSING=131 heuristic=0
                                     unexplained-by-label: calls=177 contains=144 instantiates=22
                                                        references=18 extends=11 uses=8
    2026-10-04, 40 of 971, rot 36:       covered 96.8%   unexplained 9.2%   hash=3ced448db031430c
                                     analyzer-edges=4163 tree-truth=4106 MISSING=131 heuristic=0
                                     unexplained-by-label: calls=181 contains=144 instantiates=22
                                                        references=18 extends=11 uses=8

`MISSING=131` and `covered 96.8%` are IDENTICAL across the rot-35 and rot-36 draws while
`analyzer-edges` moved 4,088 → 4,163 and `tree-truth` 4,038 → 4,106: the draw changed how many edges were
compared and did not change how many the analyzer failed to account for, which is a small piece of
evidence that the 131 are a property of the code rather than of the draw. It is not proof — 131 could be
a coincidence of two draws — and it is reported as two runs, not as a rate.

**Which of these reproduce depends on the invocation, and the previous version of this file said
"ROTATES per run" for all of them, which is true of the cold-pool sweep and false of the scoped form.**
The cold-pool rotation is persisted state (`COLD_POOL_STATE`, a rotation counter per lane, seeded pick
per rotation — `differential.ts:927-950`) and it only advances on the unscoped sweep. The scoped form

```
bun run script/m14/differential.ts --repo julia --sample 40
```

skips the cold pool entirely and is therefore **deterministic**: three consecutive runs on 2026-10-04
returned `tree-truth=4106 covered=3975 (96.8%) MISSING=131 analyzer-edges=4163 unexplained=384 (9.2%)
hash=3ced448db031430c` byte for byte, and that row is the rot-36 line above. The printed `hash` is the
sample set's identity, so a later run that draws different files announces itself. A **scoped** run also
writes no artifact — the harness refuses (`probe run (--repo julia): … M14.0.F5 NOT written`), because
the canonical artifact carries a 43-language claim and a one-language run would replace it with a
smaller one. Note that `--repo julia` selects the *repo*, not the language: it probes every language for
`.jl` files and prints 33 `files=0 SKIPPED` lines before julia's own row, so `--lang julia` is the
correct flag when the language is what you mean.

`heuristic=0` is the stable part: no rotation has ever produced an edge under 0.7 confidence. **The
number to quote is not any of these rows** — it is the per-label table below, which does not rotate.

### The stable per-label figures, and a limit four of the oracles have

```
npx tsx validation/m14/fixtures/julia/direct-oracle-check.ts --files 40
```

40 files spaced evenly through the SORTED 1,985-file population — not a prefix, because a sorted
prefix is `Aqua.jl` plus one corner of the alphabet and would silently drop thirteen of the fourteen
admitted projects. The instrument prints how many projects the draw actually reached: **10 of 14**
(`Aqua.jl`, `DataFrames.jl`, `Documenter.jl`, `Flux.jl`, `Graphs.jl`, `LanguageServer.jl`, `Pkg.jl`,
`Query.jl`, `StaticArrays.jl`, `julia`), which is itself a limit — 40 files cannot touch 14 projects,
so four were missed and the tool says which rather than implying full coverage. Analyzer side is
`parseFile`; truth side is all seven lane oracles; the key carries the FILE, so an edge is covered only
by truth from the file that declares it. Two consecutive runs are byte-identical.

```
population 1985 admitted files, 40 checked, evenly spaced and SORTED (not a prefix)
selection: every 49.6th file of the sorted population; 10 of the 14 admitted projects are represented

label           verified    truth   analyzer  covered  missing unexplained covered% srcUnverified
calls           TARGET only 1083    1214      920      163     294         75.8%    1214
uses            TARGET only 468     473       468      0       5           98.9%    473
references      TARGET only 398     418       382      16      36          91.4%    418
contains        both ends   268     302       262      6       40          86.8%    0
extends         both ends   19      28        16       3       12          57.1%    0
instantiates    TARGET only 19      26        19       0       7           73.1%    26
overrides       both ends   1       1         1        0       0           100.0%   0
TOTAL                       2256    2462      2068     188     394         84.0%
```

**`overrides` is no longer `n/a`, and that is the corpus's doing rather than the instrument's.** Over
the old 971-file population the 40-file draw contained zero `overrides` edges, so the instrument
printed `n/a` rather than a zero — with no edge in the sample there is no evidence about which end an
oracle populates, and a default there would print a zero as if it were a finding. The enlarged draw
contains one, it is verified on **both ends** at 100%, and the seven-oracle table now has a seventh
row with a number in it. It is still one edge, so this is the thinnest possible corroboration of the
type and `overrides-differential.ts` over 1,985 files remains the real check.

**Four of the seven oracles verify the TARGET only, and that is a limit on 2,131 edges.** `julia-calls`,
`julia-refs` (both `uses` and `references`) and `julia-type-edges`' `instantiates` emit `from: ""` — they
never derive the enclosing scope — so for those labels the question answered is "does an independent
walker agree this file calls/uses/references/constructs this NAME", never "is the edge attached to the
right enclosing symbol". `contains`, `extends` and `overrides` populate `from` and are compared on both
ends. The instrument prints which end it checked per label rather than leaving one number to stand for
both, because the first version of this check keyed all seven labels on `(from, target)`: `""` never
equals a scope name, so `calls`/`uses`/`references`/`instantiates` all read **0.0% covered**, which
reads as "four oracles contradict the analyzer" rather than "four oracles do not model the source
side". That is the wrong-direction failure again — an instrument defect that would have understated
this lane's coverage rather than flattered it.

**The 294 unexplained `calls` edges on the new draw were bucketed by the edge's own metadata the same
way the previous 440 were, and the shape held.** The buckets are macro calls (a macro invocation is
not a call to a declared binding and `julia-calls` does not derive macros), qualified targets
(`JSON.parse`, `JSON.json!` — a namespace path, where the oracle's target convention differs), and
`isForeignCall` (a C symbol, which by this lane's own rule is not a julia binding at all). The first
three are oracle NARRONESS, agreed in advance and visible in the oracles' own comments. **The plain
unqualified residue is 39 edges and it did not move with the corpus** — 39 on the old 40-file draw,
39 on the new one — even though the two draws share only the `julia` files and the new draw adds 40
files from ten other projects. A residue that is invariant under a change of corpus is more likely to
be a property of the oracle's convention than a set of analyzer defects, and this lane has not
separated them either way. That is stated as a hypothesis with a number attached, not as a conclusion.

**These per-label figures are NOT comparable to the F5 aggregate above**, though both call the same
oracles: F5 samples 200 rotating files, this samples 40 fixed ones, and per-file truth density differs
(the same oracles yield 95 truth rows per file under F5's rotation and 87 under this selection). Put
the two side by side and the comparison is between two file sets, not two instruments.

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

## the `unknown` endpoints, resolved by a shared fix I do not own

This section exists because a number in this file moved without a line of the julia analyzer changing,
and the reason is worth more than the number.

**The measurement.** `keepSymbol` in `src/ast/pool-worker.ts` filters symbols before publication. Its
UNIVERSAL denylist used to contain `"unknown"` — this codebase's placeholder for "could not
determine" — on the reasoning that a placeholder is never a real declaration. In julia that reasoning
is false for a specific and common reason: **`unknown` is a legal julia function name.**
`julia/JuliaLowering/src/validation.jl:22` declares `unknown() = ValidationResult(false, nothing)`
and calls it 10 times, so 11 relationship endpoints carried the name `unknown` and bound to nothing,
while `analyze()` published the symbol and `parseFile` deleted it. The previous version of this file
carried that as an open cross-language defect.

**What changed.** `src/ast/pool-worker.ts` split the denylist: only names reserved essentially
everywhere stayed universal, and the rest moved to a per-language `RESERVED` map. `unknown` was
removed from the universal list. The census, unchanged, now reports:

```
before:  endpoint === "unknown" that DOES resolve: 0
         endpoint === "unknown" that does NOT resolve: 11  (julia/JuliaLowering/src/validation.jl)
after:   endpoint === "unknown" that DOES resolve: 11
         endpoint === "unknown" that does NOT resolve: 0  (none)
```

and the corpus symbol count moved **28,277 → 28,286 (+9)** at the time of that measurement (the
figure is now 36,806 on the enlarged corpus, and the +9 remains attributable to the same shared
change). Probed directly through `parseFile`, the
9 new symbols are all real julia declarations the denylist had been deleting:

| name | count | kind | where |
|---|---|---|---|
| `self` | 5 | `property` | `json_jl/test/json.jl`, `julia/JuliaLowering/src/bindings.jl`, `julia/stdlib/Random/src/Random.jl` ×2, `julia/test/core.jl` |
| `root` | 2 | `property` | `json_jl/src/parse.jl`, `julia/base/toml/parser.jl` |
| `source_file` | 1 | `constant` | `julia/test/deprecation_exec.jl` |
| `unknown` | 1 | `function` | `julia/JuliaLowering/src/validation.jl` |

`self` and `root` as struct fields are idiomatic julia — a mutable struct's field is commonly named
after what it holds — so the old denylist was deleting ordinary declarations. **No julia code changed;
the graph got 9 symbols and 11 endpoints more correct.** That is the honest shape of a shared-layer
fix as seen from a lane: the lane's numbers move, the lane's diff is empty, and the cause is
attributable to a file it does not own.

**The defect that fix left behind, reported and not edited.** The comment block introducing the split
states:

> `unknown` is the one that cannot simply be deleted: R7 counts it as a PLACEHOLDER, and 46 registered
> placeholder sites depend on that. It now moves to RESERVED below rather than being dropped, so a
> placeholder is still refused while a declared `unknown` survives.

**`unknown` is not in `RESERVED`.** The map below it is exactly:

```ts
const RESERVED: Record<string, ReadonlySet<string>> = {
  php: new Set(["self", "parent"]),
  sql: new Set(["program"]),
}
```

So the comment claims a guarantee the code does not implement: a symbol named `unknown` is now
published in **every** language, including the 46 R7 placeholder sites that the comment says depend on
it being refused. §8 — this lane does not edit `src/ast/pool-worker.ts`. The change needed is one entry
(`julia: new Set(["unknown"])` is the wrong shape if the intent is to refuse placeholders generally —
the placeholder sites are identified by being placeholders, not by their language), and whoever owns
that file should decide whether R7 marks its placeholders by an explicit flag or by the name, because
the current code does neither. **The julia symptom is benign** — the one julia declaration of that name
is a genuine function and publishing it is correct — which is exactly why this belongs in a report
rather than a fix: a lane that only tested julia would see nothing wrong.

## A gate that reads this file's own tables — 209 cells

The defect that motivated this pass was not a wrong measurement. It was a right measurement in the
wrong slot: the prose said **10,936** ambiguous-target edges while the table above it summed to
**11,098** and the census had printed **11,101** all along. Nothing in the lane could see it. The
census passes. The 5 fixtures pass. All 25 mutants die. The arbiter agrees to the edge. The doc is
wrong, and every one of those gates is silent about it, because none of them reads the doc.

`validation/m14/fixtures/julia/doc-tables-check.ts` closes that gap. It reads
`docs/analyzers/real-julia-analyzer.md`, finds each table by its header cells, and compares every
figure against `census.json`:

```
$ npx tsx validation/m14/fixtures/julia/doc-tables-check.ts --json /tmp/census.json
doc tables check — docs/analyzers/real-julia-analyzer.md
cells checked: 209
PASS — every table cell equals the instrument's value
```

**209 cells** across six tables: the 10-row verdict table (edge count + file count per type, with
RULED rows held to "emitted 0" instead of being read as an edge count), the 9-row incoming bucket
table (all 9 buckets per type), the residual-ambiguity table including the requirement that each
row's total equals its own two columns and that the column sum equals the instrument's total, the
six-questions table (FIRES edges + files, and RESOLVED both-ends / src / tgt / neither), the
production-totals symbol count, and the by-kind and by-relation paragraphs.

**It is proved against injected drift, because a gate that cannot fail is the defect it exists to
catch.** Six drifts were injected one at a time into a clean doc — `calls` 86,876 → 86,967;
`references` unresolvable 6,463 → 6,999; the ambiguity sum 11,101 → 11,999; the symbol total 28,286 →
28,999; `overrides` FIRES 3 → 9; `function` 16,834 → 16,999. **All six were caught**, each named by
table, row and column. (Those are the figures of the corpus this gate was built against; re-running
the injection against the present tables is the same check with different numbers and the same result
— the drift values are the point, not the counts they perturb.)

**The first version caught five of six, and the miss is the interesting part.** It read only the
RESOLVED column of the six-questions table, so `overrides`' FIRES cell could hold any number at all.
That was found by the injected `3 / 3` → `9 / 3` passing, not by reading the code — the same
conclusion this file's other instruments keep reaching, which is why the negative control rather than
the review is what established the gate works.

**Two conventions it had to learn, both of which are really doc defects it declined to enforce:**

- Percentages are compared **one-sidedly**. The doc prints `contains` both-ends as **99.9%** where
  10466/10467 = 99.9904% and `toFixed(1)` gives `100.0%`. Forcing the doc to `100%` would be a worse
  number — it is the "100% coverage" shape the honesty contract bans — so the rule is that a printed
  figure may truncate but may never **over**state, within one unit in the last place.
- `By kind:` and `By relation:` are hard-wrapped prose paragraphs, not single lines. A checker that
  reads line-by-line finds half of every figure and reports it as missing. The checker joins the
  paragraph first. Its first version did not, and reported 8 false misses.

It is deliberately **not** a scan of the prose. Prose carries figures that are not claims — quoted
historical runs, ratios, and the deliberately-wrong `10,936` quoted in order to be corrected — and a
scan that cannot tell a claim from a citation would either miss real drift or force this file to stop
explaining why a number changed. The scope is the class with no excuse: a table cell the instrument
can produce exactly.

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

- **Per-file resolution is 17.2–23.6% for the four large cross-file types**, and that is the number a
  consumer of one file's graph sees. It FELL from 19.5–25.0% when the corpus doubled, and that is the
  honest direction: eleven independent packages add far more cross-file targets than in-file
  counterparts, so a per-file graph is sparser on a realistic corpus than on one project. The
  corpus-wide figure — "the name is declared somewhere in the 1,985 files" — is 81.6–87.8% and is a
  different measurement; neither is the post-merge project resolution
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
- **10,034 `calls`, 4,660 `uses`, 9,838 `references` and 494 `extends` targets resolve to nothing**,
  and this census does not separate "external package", "`Base` builtin", "dynamic dispatch" and
  "a declaration we failed to publish". Those are four different findings and the bucket deliberately
  does not guess a split; separating them needs a Julia runtime, which this lane does not start. The
  three buckets it *can* prove — `corpus-only`, `external-by-import`, `foreign-ccall` — account for
  79,462 + 5,832 + 1,193 = 86,487 of the 122,150 `calls` targets.
- **Julia publishes one binding under two symbol kinds when a type has constructors**, because the type
  name *is* the constructor. 13,893 edges target such a name. The edge's metadata disambiguates
  100% of the multi-symbol `calls`/`uses`/`references`/`extends`/`instantiates` cases, and
  `contains` is disambiguated by its source, but a consumer matching targets by bare name is
  discarding information the edge carries.
- **The 11 `unknown` endpoints are RESOLVED, by a shared fix this lane does not own.** They were a
  limitation in the previous version of this file and no longer are. All 11 are in
  `julia/JuliaLowering/src/validation.jl`, which declares `unknown() = ValidationResult(false,
  nothing)` at line 22 — a real zero-argument julia function — and calls it 10 times. `analyze()`
  published the symbol but `parseFile` dropped it, because `keepSymbol`'s UNIVERSAL denylist contained
  `"unknown"` and applied it to every language, so a julia binding whose name happens to equal this
  codebase's placeholder was deleted. `src/ast/pool-worker.ts` has since split that denylist and
  removed `unknown` from it, and the census now reports **`endpoint === "unknown"` that DOES resolve:
  11, that does NOT resolve: 0** where it previously reported the reverse. The same change published
  **9 more symbols** corpus-wide, all legitimate julia declarations the denylist had been deleting:
  `self` ×5 and `root` ×2 as struct fields (`property`), `source_file` ×1 (`constant`,
  `julia/test/deprecation_exec.jl`) and `unknown` ×1 (`function`). Nothing in this lane changed; the
  counts moved because a shared filter stopped deleting real declarations. See
  [§ the `unknown` endpoints](#the-unknown-endpoints-resolved-by-a-shared-fix-i-do-not-own) for the
  per-file measurement and for the one defect that fix left behind.
- **365 of 1,985 files (18.4%) yield zero symbols** through the production path — up from 135 of 971
  (13.9%) before the ecosystem packages were added, and 230 of the 365 are in the new packages, where
  `test/` fixtures, `docs/` build scripts and comment-only files are a larger share of the tree than
  they are in `JuliaLang/julia`. They are named in the census output; `Aqua.jl/docs/changelog.jl`,
  `DataFrames.jl/src/deprecated.jl`, `julia/test/runtests.jl` and
  `julia/JuliaLowering/test/arrays_ir.jl` are among them. **The cause was not investigated per file and
  is a coverage gap, not a measurement.** `DataFrames.jl/src/deprecated.jl` is the one worth a reader's
  attention: it is a `src/` file rather than a test or a build script, so a reader should not assume the
  whole 365 is benign.
- **The corpus is 47.4% one upstream project, and the previous version of this file's own limitation
  said 96.8%.** 941 of 1,985 files are `JuliaLang/julia`; the other 1,044 are eleven ecosystem
  packages. This limitation was written when the corpus was three projects and network access had
  failed six clone attempts; network is available now and the packages were cloned, so the gap is
  mitigated rather than removed. **Three clone attempts still fail** — `timholyford/Revise.jl`,
  `stevehie/StructTypes.jl` and `JuliaMath/Distributions.jl` all return "Repository not found" from
  this network, while `JuliaData/DataFrames.jl` resolves, so the allowlist is selective and which
  projects are reachable is not under the lane's control. Two named gaps remain: no `Revise.jl` means
  the corpus has no `eval`-heavy project, and no `Distributions.jl`/`StatsBase` means the parametric
  numeric tower is under-sampled. A construct that only those projects use is invisible here, and the
  `implements` ruling in particular is measured on 14 projects rather than on the ecosystem at large.
- **The corpus root is shared with six other agents** and is not pinned. The julia file set is now 14
  projects that this lane added itself and therefore controls; the count of non-`.jl` large files in the
  same root moved 1,003 → 1,006 → 1,007 across runs because other agents clone, and it is reported
  separately from the julia exclusion count precisely so that it cannot be read as a change to this
  lane's population.
- **`+%` / `-%` and the 177 ERROR-node files are grammar-side**, not analyzer-side.
- **Macro-generated definitions are visible only when the definition is in source** (`@inline f(x) = x`
  declares `f`; a macro that *synthesises* a name does not).
- **The wasm temp-path trap that cost this lane 13 edges is FIXED upstream, and this lane's arbiter
  numbers are now whole.** The previous version of this file carried the whole story as an open
  limitation: `resolveWasm` wrote each grammar to a path shared by every process on the machine, so a
  concurrent reader could load a truncated wasm, `Language.load` threw, and `parseFile`'s catch
  silently substituted `extractFallback` — a regex extractor whose symbols carry no kind. The trapped
  file was `julia/stdlib/LibGit2/test/runtests.jl` and the cost was `calls=9 uses=2 references=1
  imports=1`. `src/ast/engine.ts` now writes to a per-process path and renames atomically. Measured
  after the fix: the arbiter reports **0 `[BB-PARSE-ERR]` and 0 `[BB-HANG]` lines**, `firing-check`
  reports **`degraded: 0` at both 120 and 1,985 files**, and `arbiter-census-diff.ts` reports
  **`throw: 0`, 234,796 rows, `fallback: 0`** with per-type totals identical to the arbiter's.
  **Every number in this file is therefore measured on a run where no file silently degraded**, which
  was not true of any earlier version of it. The general lesson is kept because it outlives the bug:
  `parseFile` CATCHES the wasm trap, so "0 crashes" in this lane means "0 throws", and a file the
  parser cannot read leaves no trace in a counter that only counts throws — which is why the trap had
  to be found by differencing two instruments rather than by reading either one's output.
- **`exports` targets are ambiguous more often than any other new edge, and the edge cannot fix it.**
  **145 distinct names across 180 of the 2,859 `exports` edges (6.3%)** name more than one symbol the
  analyzer published in the same file — a LOWER share than the 9.0% over the old corpus, because
  ecosystem packages declare fewer colliding short names than `Base` does. Split by cause: **131 names
  / 158 edges (5.5% of all `exports`) are genuine cross-kind collisions** — 93 edges are the
  `class`/`function` pair, which is a type and its own constructor, and the rest spread over
  `property`/`variable`, `constant`/`function`, `function`/`macro`, `interface`/`module` and other
  pairs — and **14 names / 22 edges are several same-kind declarations of one binding**, which is *not*
  a collision for an export, since a module exports a name once however many methods it has.
  `imports` is nearly clean: 2 distinct names across 3 of 2,804 edges, of which 1 name / 2 edges
  (`Bar`, published as both `class` and `module`) is a real collision.
  The edge cannot narrow these, and the reason is the `declaresNothing` property this lane got right:
  `export X` asserts no kind, so there is no kind to narrow by. Adding one would mean guessing. The
  remaining lever is for the edge to carry the **owning scope**, which would separate a struct field
  named `x` from a function named `x` — that is a schema question owned by the incoming-resolution
  layer, and this lane's count is the evidence for it rather than a duplicate of the work. Reported,
  not worked around.
- **`contains` collapses same-named siblings.** The relationship dedup key is
  `type|source->target` with no line, so two declarations of one name under one scope produce one
  `contains` row. Widening it would grow every `contains` edge in every julia payload (14,299 rows
  today), which is a shared payload-budget decision and was not taken unilaterally.
- **Four of the seven lane oracles verify only the TARGET of an edge, not its source.** 2,131 edges
  are covered by an oracle that never looks at the enclosing symbol, so for `calls`, `uses`,
  `references` and `instantiates` this lane can say "an independent walker agrees this file calls this
  name" and **cannot** say "the edge is attached to the right enclosing declaration". `contains`,
  `extends` and `overrides` populate `from` and are checked on both ends. Closing this needs the four
  oracles to derive scope, which is a shared `script/m14/oracles/` effort; `direct-oracle-check.ts`
  prints the verified side per label so the number is never read as covering more than it does.
- **39 of the 40-file check's unexplained `calls` edges are plain unqualified calls, and they are not
  yet separated into defects and legitimate divergence.** The other 629 unexplained `calls` edges
  bucket cleanly into macro calls, qualified namespace paths and `ccall` C symbols — oracle narrowness
  agreed in advance. The 39 (`adjoint`, and `!` read as a callee at
  `julia/JuliaLowering/src/binding_analysis.jl:116` and `:150`) are what a reader should look at, and
  this lane has not looked.
- **An oracle is a second walker over one grammar.** A grammar bug shared by the analyzer and all five
  oracles is invisible to every differential in this file, and nothing in them can see a relationship
  type that neither side derives. Only instrument A and instrument B measure the language.
