# powershell analyzer — analyzer documentation

Pure Tree-sitter PowerShell extraction for `*.ps1`, `*.psm1`, and `*.psd1`
sources, verified under milestone **M12.40** (issue #179).

- Parser: `tree-sitter-powershell` — **a local rebuild from vendored source of upstream
  0.26.4, carrying 8 local patches** (WASM at `wasm/tree-sitter-powershell.wasm`, loaded
  by `engine.ts` via `resolveWasm`). This row previously read "0.25.10 (npm, published
  2025-12-08)", which was true of the artifact the lane *started* with and is now false
  of the artifact it *ships*. See "Provenance" below for the history and the current pin.

## Provenance

`wasm/tree-sitter-powershell.wasm` is `sha256
1d30b5a21866354aa2eb94845556f1e19126ff00e3335048719a0e6435b1c154`, 983,236 B, and it is
**byte-for-byte** the `tree-sitter-powershell.wasm` inside the `tree-sitter-powershell@0.25.10`
npm tarball. Neighbouring versions do not match: `0.25.9` is `2a46fff0…` / 944,125 B and
`0.26.3` is `192fc7a4…` / 1,080,493 B. So the identity is 0.25.10 and the check is
re-runnable with `npm pack tree-sitter-powershell@<v>` and a `sha256sum` of the extracted
wasm — no build required, because upstream publishes the artifact we ship.

Upstream latest is **0.26.4** (2026-05-04, `airbus-cert/tree-sitter-powershell`). It was
fetched, **rebuilt from source with tree-sitter CLI 0.26.9, and the rebuild reproduced the
published prebuilt byte-for-byte** (`796124137f0500e5…`, 1,088,467 B) — so the artifact
adjudicated below is provably upstream's. It closes **0 of the named reproducible grammar
limits** on this lane (`reviews/m60-powershell-grammar-0264-refused.md`).

**The pin has since moved off 0.25.10, and the current pin is NOT an upstream artifact.**
The lane now ships a **local rebuild from vendored 0.26.4 source with 8 patches applied**:

| Property | Value |
| --- | --- |
| `sha256` | `df867849137e4e87d326a52dc88d502d366efddd19fff4dce6c83522eccbdfc6` |
| Size | 1,168,838 B |
| Kind | `local-rebuild-from-vendored-source` |
| ABI | 15 |
| Node types | 429 ids / 154 named / 14 fields (`validation/m14/measurements/powershell-grammar-nodes.json`) |
| Runtime | `web-tree-sitter@0.25.9` |

The 8 patches, in the order they were admitted: **G5a/b** (PS7 `??` and `? :`), **G5c**
(`?.` and `?[`), **G1** (script-level `param()` after another statement), **G6** (command
argument list with a bare word), **G7** (sigil-led path as a command *argument*),
**G8** (`+` as .NET's nested-type separator), **G9** (bracketed generic type argument),
**G10** (a value glued to a double-dash parameter).

**A patch record that disagrees with the artifact is the failure this lane already paid
for once.** G8's wasm was committed against a G1 pin record, and the two were only caught
by a consistency check. So the pin record and the wasm are verified together, and the
"Provenance" row above is deliberately split into *what upstream is* and *what we ship*:
they stopped being the same file, and saying otherwise in either direction is the bug.

## Language

- Analyzer file: `src/ast/real-powershell-analyzer.ts`
- Parser: `tree-sitter-powershell` — a local rebuild from vendored upstream 0.26.4 source with 8 patches (WASM at `wasm/tree-sitter-powershell.wasm`); the shipped artifact is byte-identical to upstream `tree-sitter-powershell@0.25.10`'s prebuilt wasm
- Language detection: extensions `.ps1` / `.psm1` / `.psd1`
- Wired in: `engine.ts` `getAnalyzer` → `RealPowerShellAnalyzer`

## Symbol contract

| Field | Supported? | How extracted |
| --- | --- | --- |
| name | yes | declaration node's name text |
| kind | yes | `function_statement` → `function`; `class_statement` → `class`; `class_method_definition` → `method`/`constructor` |
| qualified/container name | yes | class members carry `ownerName`; top-level declarations are unowned |
| ownerName / ownerKind | yes | class members and function locals carry `ownerName` = enclosing class/function |
| range (start/end line + column) | yes | node positions |
| parameters | yes | typed from `type_literal → type_spec` |
| returnType / type | no | PowerShell is untyped at the grammar layer |
| documentation/comments | no | comments are not attached as documentation |
| complexity metrics | no | no separate complexity metric published |
| syntax errors | yes | syntax errors are engine-owned |
| decorators/attributes | no | PowerShell has no decorator syntax |

## Supported constructs

PowerShell's supported constructs map to the ontology: cmdlets and functions emit `calls`;
modules and classes are contained; classes' `: Base, IFoo` headers emit `extends` and
`implements`; `[Type]::new(...)` and `New-Object` emit `instantiates`; `Import-Module` /
`using namespace` / `#requires` emit `imports` (with a `references` sibling); `Export-ModuleMember`
emits `exports`; dot-sourcing (`. ./lib.ps1`) emits `part_of` — the sourced file's declarations
land in the caller's scope. `decorates`, `renders` and `mixes_in` are ruled not applicable on
measurement (attributes are engine metadata, PowerShell has no component model, and the only
declaration-level composition construct is the class base list, which is conformance and is
emitted as `extends`/`implements`). The measured per-type census is further down under
"Ontology measurements"; the canonical claim table is below.

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| `calls` | ✅ yes | cmdlet/function invocation by name, method call (`$obj.Method()`), static call (`[Type]::Static()` → `Type.Static`, PS-B22), or a script run through an invocation operator (`. ./x.ps1`, `& ./x.ps1`); resolved by name against the file's own declarations, then project-wide | `usage_contextual`; 0.9 invocation-operator / 0.8 static-member / 0.6 dynamic member call |
| `extends` | ✅ yes | the FIRST name in a class header's `: Base, IFoo, IBar` list; position is the only information the grammar carries (the language resolves class-vs-interface at run time) | `structural`; 1.0 |
| `implements` | ✅ yes | every name AFTER the first in the same header list | `structural`; 0.85 |
| `uses` | ✅ yes | a name READ rather than invoked: a type literal's spec, a variable read, a hashtable key, a cmdlet parameter name, an attribute, hashtable/array composition, and a `New-Object` type name held in a variable (PS29); resolved by name, then to a declaration when one is visible | `usage_contextual`; 0.8 type-reference / 0.9 write or argument read |
| `imports` | ✅ yes | one module dependency from `Import-Module` / `ipmo`, `using namespace`, or a `#requires` list/hashtable; also carried on the import-site channel (`ImportInfo[]`) | `import_based` (the `import: true` short-circuit); 0.9 |
| `exports` | ✅ yes | what `Export-ModuleMember -Function`/`-Variable`/`-Alias`/`-Cmdlet` publishes, read from the command's argument list; wildcard targets publish nothing; also carried on the export-site channel (`ExportInfo[]`) | `structural`; 1.0 |
| `contains` | ✅ yes | lexical nesting: the module contains its functions/classes, a class its members, a function its locals and parameters | `structural`; 1.0 |
| `references` | ✅ yes | the sibling channel for the same module dependency (`import_sibling`, plus `requires_version`); never a mention of an arbitrary name | `import_based`; 0.9 |
| `overrides` | ✅ yes | a subclass member that overrides a member of its RESOLVED base: same name, same kind, base member neither `hidden` nor `static`; PowerShell has no `override` keyword (class methods are virtual by default), so this is the lane's one INFERRED type | `inferred`; 0.9 |
| `instantiates` | ✅ yes | an object construction: `[Type]::new(...)` or `New-Object` in its three spellings; type-accelerator names are suppressed, and a type name held in a variable is not published as an instantiates target | `usage_contextual`; 0.9 |
| `decorates` | ❌ no | 0 `RelationshipType.Decorates` sites in the analyzer. RULED ONTOLOGICAL (PSD13): a PowerShell attribute is engine metadata, not an applied callable — measured over the whole population, 6,421 attribute sites / 2,825 arguments / 0 arguments that apply a declared callable at declaration creation; the two call-shaped same-file sites are validation/completion REGISTRATIONS already published as `calls` | — (ruling: no emission) |
| `renders` | ❌ no | 0 sites over 1,181 admitted files; the vocabulary's relation is a component rendering another component and PowerShell has no component model (`ConvertTo-Html` is a text serializer, `[Windows.Markup.XamlReader]::Parse` builds UI from XAML text) — RULED, PS-B20 | — (ruling: no emission) |
| `mixes_in` | ❌ no | 0 sites over 1,181 admitted files; PowerShell has no trait/role construct, and its one declaration-level composition construct — the class base list (50 entries) — IS conformance and is already emitted as `extends`/`implements` — RULED, PS-B20 | — (ruling: no emission) |
| `part_of` | ✅ yes | the DOT-SOURCE operator (`. ./lib.ps1`): the sourced script runs in the CALLER's session scope, so the file is a part of the calling unit (the `part_of` contract's positive test). 1:1 relabel from `calls` at rung R3; the target is the sourced file's basename (its module-symbol name), the written path stays in `metadata.partPath`, and `metadata.partRole:"library"` is mandatory. `& ./x.ps1` (child scope) stays `calls`; `Import-Module` stays `imports` | `import_based`; 0.9; measured 38 edges over 37 files (whole admitted population) |

PowerShell-specific channels, named so a consumer does not mistake them for extra kinds:
`import-site: ImportInfo[]` and `export-site: ExportInfo[]` carry the same dependencies as the
`imports`/`exports` rows; every row carries `powershellSpecific: true`; the module symbol is the
file's basename WITH its extension (PS1), which is why the `part_of` target is symbol-shaped.
The per-type measured census (edges, files, corpus/intra resolution, tier) is the table under
"Ontology measurements".

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/powershell.json` — manual audit of the lane's fixtures.
- Result `validation/m12/results/powershell-differential.json`: `passed: false`, expected 79, truePositive 78, falsePositive 0, falseNegative 1, unknown 1, precision 1, recall 0.9873 — 1 false negative is the lane's open defect class.

## Corpus validation

- Corpus `validation/m12/results/powershell-corpus-errors.json`: corpus `powershell`, extensions `*.ps1` / `.psm1` / `.psd1`, 553 tracked files, 182 error files / 1387 error nodes, 0 crash files.
- Differential `validation/m12/results/powershell-differential.json`: `passed: false`, expected 79, truePositive 78, falsePositive 0, falseNegative 1, unknown 1, precision 1, recall 0.9873.

## Contract

| Concern | Contract |
| --- | --- |
| Symbol identity | `function_statement` → `function`; `class_statement` → `class`; `class_method_definition` → `method` (or `constructor` when the name matches the class); `class_property_definition` → `property`; `enum_statement` → `enum`; `enum_member` → `enum_member`; assignments / `param()` / `foreach` vars → `variable` |
| Parameters | typed from `type_literal → type_spec` (no bracket stripping needed — the grammar separates the spec); `script_parameter_default` marks `isOptional`; both `script_parameter` and `class_method_parameter` shapes handled |
| Owners | class members and function locals carry `ownerName` = enclosing class/function; top-level declarations are unowned. No synthetic `global` scope symbol is ever emitted; a constructor never contains itself |
| Variables | assignments (including `for` counters and `foreach` loop vars) declare once per scope; `$global:`/`$script:`/`$env:` qualified names and automatic variables (`$this`, `$_`, `$args`, `$PSItem`, …) are never declarations |
| Calls | cmdlets and functions emit `calls` (source = enclosing owner or `global`); flow keywords (`break`, `continue`, `return`, …) excluded; `$obj.Method()` → `calls` with `methodCall`; `[Type]::Static()` → `calls` to the store's QUALIFIED NAME `Type.Static` (the source's `::` is not a name any declaration has — PS-B22); `& ./file.ps1` → `calls` with the invocation operator recorded; `. ./file.ps1` (DOT-SOURCE) → `part_of`: the sourced file's declarations land in the CALLER's scope, so the file is a part of the calling unit; the invocation operator is recorded on that row too (`invokationOperator: "."`) |
| Instantiates | `[Type]::new(...)` → `instantiates` to the type |
| Imports | `Import-Module` (bare, `-Name` and positional), `using module`, `using namespace`, and `#requires -Module`/`-Modules` populate the import table **and emit BOTH an `imports` and a `references` edge** at 0.9, tier `import_based`, with `metadata.via` naming which of the four forms declared it (char/index scanning only — comments are opaque to the grammar). Both edges carry identical metadata. See "The ontology types" for why both and not one |
| Extends / Implements | class header `: Base, IFoo, IBar` → `extends` to the FIRST base and `implements` to the rest. PowerShell's header cannot say which base is a class and which are interfaces — the language resolves that at runtime — so the grammar's positional shape is the only information there is, and this row pins the rule rather than a guess. Gated by `class-inherit-psa2` and three mutants |
| Overrides | a subclass member whose name matches a member of its resolved base emits `overrides` carrying `meta.overridesMember` = the member name. PowerShell class methods are virtual by default, so there is no `override` keyword to key on — the match is by name against the base's declared member set, and since PS26 it must additionally match the member KIND and the base member must be neither `hidden` nor `static` (the two things PowerShell uses to say a member is NOT overridden). The match is case-INSENSITIVE since PS28, because PowerShell identifiers are. Gated by `class-inherit-psa2`, `overrides-modifiers-psb12` and `overrides-redeclaration-psb13` |
| Interfaces | PowerShell 5.0 `interface IShape { [string] Describe() }`. The GRAMMAR has no node for it, so it parses as a `command` named `interface`; the analyzer declares `IShape` as an `interface` symbol from that structure and does not publish it as a call. Known gap: the interface's method signatures are bodiless, so they are not `class_method_definition` nodes and an interface is declared with no members |
| Patterns | `CmdletBinding`/`Parameter`/`Validate*` attributes, DSC, Azure/Exchange/SharePoint/AD/VM frameworks, REST/I-O/service patterns — string checks on AST nodes, never source text |
| Line numbers | **every relationship carries a `line`**, measured at 12,028/12,028 = 100% over the production draw. Not a sample: a relationship without a line would be counted as missing, so the ratio is a completeness check on the emit path rather than a quality score. Scoped reads (`$env:X` used as a dependency) carry the line of the READ, not of the declaration |
| Exports | `Export-ModuleMember -Function/-Variable/-Alias/-Cmdlet` publishes the NAME each flag names. A WILDCARD target publishes nothing since PS25 — `-Function *` and `-Function Measure*` are the same declaration, the expansion happens at run time, and `*` is not legal in a PowerShell identifier. Gated by `overrides-modifiers-psb12` |
| Evidence tier | every relationship carries a `tier`, emitted centrally rather than per-call-site so it cannot drift: `structural` (the tree settles it), `usage_contextual` (settled by what the construct means), `import_based` (a `references` edge with `metadata.import: true`), and `inferred` for `overrides`, which is genuinely an inference from name-matching since PowerShell has no `override` keyword |
| Composition | hashtable literals and array literals emit `uses` for their member and element targets — **this row previously read `references` and was false**, and pass 2 measured why (see "A `references` claim that was false"). PowerShell's composition is a literal, not a declaration, so these are reads and not `contains` |
| `New-Object` | all three spellings are handled: `-TypeName`, `-ComObject`, and the positional type name, with accelerator names suppressed. This was a real defect found by hand audit, not a theoretical gap |
| Errors | syntax errors are engine-owned (engine.ts merges `treeErrors`); the analyzer never duplicates them |
| Regex | **ZERO — 0 regex operations, 0 stored regex literals**, enforced by `script/m60/powershell-zero-regex.ts` rather than asserted. Equivalence to the previous regex implementation was measured over 759 files (691 corpus + 10 fixtures), byte-for-byte, 0 differing. This row previously read "zero regex usages (census 10 → 0)", and both halves were false: there is no powershell regex census, and there were 8 |

## Complexity envelope

One iterative DFS over the tree with a constant-time owner stack, O(1)
Map-backed symbol dedupe (keyed by `scope:name:kind`), descendant searches
bounded by tree depth, and Set-backed relationship dedupe: **O(nodes +
emitted facts)**, no per-symbol O(n) scans and no O(n²) passes. (The
previous analyzer's `findIndex`-based symbol/relationship dedupe was O(n²)
and is gone.)

Measured on the pinned corpus `powershell@91ce9844` (34 strict-acceptance
production `.ps1`/`.psm1` files, one production `parseFile` pass each):

| Metric | Value |
| --- | --- |
| Wall time | 997 ms |
| Files / s | 34.1 |
| Symbols | 460 (461.2 / s) |
| Relationships | 590 (591.5 / s) |
| Errors / crashes | 0 / 0 |

## Regex inventory

**Zero. 0 regex operations, 0 stored regex literals, and a gate that fails if either
comes back.**

This section used to be headed "**None.**" under a Contract row reading "**zero** regex
usages (census 10 → 0)". Both halves were false, and an audit for an unrelated question
is what caught it: **there is no powershell regex census** — the number cited an
instrument that was never written, which is the worse half, because a number attributed
to a census reads as measured. And the real count was **8**, because later waves put
regexes back after the original ten were removed. The claim was true once and stopped
being true with nothing re-deriving it, which is the failure mode of a number no
instrument owns.

**What the original 10 were replaced with, and that work stands:**

- `$` stripping → char-code check (`text.charCodeAt(0) === 36`) on `variable` nodes (the grammar keeps `$` in the node text)
- type bracket stripping → `type_literal → type_spec` child text
- `[Type]::new()` bracket stripping → `invokation_expression` with `type_literal` + `member_name` children
- `#requires -Module` extraction → index-based token scan of the comment text

**The 8 that were here, and what replaced each.** The distinction that matters is not
"regex vs not" but "does this match DECIDE a fact, or normalize a string whose fact the
tree already settled":

| was | now | decided anything? |
| --- | --- | --- |
| `/^\s*<#/` on a comment line | `stripOpenCommentDelim` — char scan for `<#` after leading space | no — comments are opaque to the grammar |
| `/#>\s*$/` on a comment line | `stripCloseCommentDelim` — char scan for `#>` before trailing space | no |
| `/^#+\s?/` on collected comment lines | `stripCommentMarkerRun` — consume the `#` run and AT MOST ONE following space | no |
| `/^-/` on a flag name (3 sites) | `stripLeadingDash` — one `charCodeAt(0) === 45` test | no — normalizes for comparison |
| `/(\[[\s]*\])+/g` on a declared type | `stripTypeSuffixBrackets` — consumes `[`+space*+`]` pairs, copies the rest | no — normalizes `string[]` to `string` |
| `/\.[A-Za-z0-9]+$/.test()` on an invocation target | `hasTrailingExtension` — anchor on the LAST dot, require alnum to the end | **partly** — see below |
| `/\\/g` on the file path | `split("\\").join("/")` | no — and it is a path, not source |

**The one that made a judgement call** was `hasTrailingExtension`, and it is called out
rather than buried because the honest reading is that it *can* be wrong. It matches a
token as a path if it contains a separator or ends in something shaped like an
extension. That is sound for its single live use — `& ./run.ps1` against
`& SomeCommand`, with `$`-prefixed tokens diverted first — and its own docstring records
that it was **deliberately removed from the `Import-Module` path** for a measured reason:
an installed module has a bare name, so `Import-Module PoshRSJob` matched nothing while
`Import-Module Az.Accounts` matched only because a dotted name looks like a file
extension. Telling a module name from a switch-argument VALUE is the switch-value set's
job, and that is PS7's rule.

**Equivalence was measured, not reviewed.** Anchoring on the *last* dot is equivalent
rather than approximate: if the text after the last dot is not all alphanumerics, no
earlier dot can be followed by alphanumerics to the end either, because that remainder
would contain the same offending character. And `isSpaceCode` spells out all 25 code
points JavaScript's `\s` matches, because a `code <= 32` approximation silently stops
matching NBSP and `\uFEFF`. Both implementations were then run over **759 files** —
691 corpus plus 10 fixtures — and their facts compared byte-for-byte across symbols,
relationships with metadata, and imports: **0 differing files**.

**The gate.** `script/m60/powershell-zero-regex.ts` strips block comments (not line
comments: this file holds four template literals containing `//`, the precedence-chain
diagrams, which a `//` stripper corrupts), then counts regex operations and stored
literals, and asserts all seven helpers are still present. It was verified to FAIL by
injecting one `.replace(/^-/, "")` back into `stripLeadingDash`, and to pass again on
removal. The helper-presence assertion exists because a zero-regex gate is trivially
satisfiable by deleting the work, and a green "zero regex" meaning "nothing left to be
wrong about" is the vacuous pass this repo refuses elsewhere.

## The ontology types

The ten types in the table below (plus `part_of`, stated beneath it) are **EMITTED**, and
every count in it is a positive measurement. **This section previously read "there is no RULED type in this lane", and
that is no longer true**: the lane's applicable set is fourteen, and it reads **11
implemented / 11 applicable / 3 excluded** in the coverage gate
(`script/m14/spec/powershell-completeness.json`, which is the denominator and the
authoritative wording). The three it does not emit — `decorates`, `renders`, `mixes_in` —
are **RULED**, each with a population, a falsifier and an overturn ladder: `renders` and
`mixes_in` were ruled on 2026-10-27 and are recorded under "PS-B20" below, and
`decorates`' ruling is stated in that same spec block. Their three rows are in the table
because a reader who scans it must see that these types are absent **by ruling and not by
omission**; the `0` in each is a measured zero over the whole admitted population, not a
cell that was never filled.

`part_of` is implemented as well — which is why the gate reads 11/11 — and it is **not
one of the ten rows below**; this document does not restate its counts.

**Instrument, corpus, admission.** `validation/m14/fixtures/powershell/census.ts`, run
through production `parseFile` from `src/ast/pool-worker.ts` (not `analyze()`, which is a
per-file unit that skips the pool, the timeouts, the truncation and the enhancements).
Corpus admission is identical to the arbiter's, so the two measure one population and not
two that happen to look alike: `git ls-files` over every repo under
`BB_CORPUS_ROOT` (`$HOME/fixtures/repositories`), gated on
`detectLanguageFromPath(abs, text) === "powershell"`.

**Sampling method: the WHOLE admitted set — 1,108 of 1,108 files, no sampling cut.**
The project's stated floor is 200 files per family; PowerShell's admitted
population is 5.5x that, so the rate is 100% and nothing here is extrapolated. Per
repo: `powershell` 553, `PSScriptAnalyzer` 271, `ansible` 196, `fsharp` 47,
`terragrunt` 7, `kubernetes` 6, `boundary` 4, `gh-cli` 4, `packer` 4, `zig` 3,
`docker`/`helm`/`openapi-spec`/`scala3` 2 each, `cabal`/`elixir`/`nomad`/`rebar3`/
`swift-nio` 1 each. 1,108 attempted, **1,108 parsed, 0 failed, 0 excluded**; 188
files carry parse errors (counted, listed below, not hidden). 22,861 symbols,
156,225 relationships.

**Every count in this section moved once, and the reason is stated rather than
quietly absorbed.** Pass 1 measured 1,092 admitted files; the shared corpus has
since grown by 16 (`boundary` 4, `terragrunt` 7, `packer` 4, `nomad` 1, and one
more `scala3`), so re-running the same census against the same analyzer reads
1,108. Restated on the grown corpus and BEFORE pass 2's fixes, the ten types
were `calls` 67,344, `uses` 64,562, `contains` 21,750, `imports` 556,
`references` 577, `exports` 113, `extends` 47, `implements` 3, `overrides` 2,
`instantiates` 1,268 — 156,222 relationships, 22,861 symbols.

**Pass 3 re-ran the same census at the same commit with the pass-2 analyzer and
every number reproduced EXACTLY** — all ten edge counts, all ten `distinctFiles`,
both resolution columns, both intra-file columns, the heuristic count, the
missing-line count, the confidence histogram and the `evidenceClass` histogram.
The admitted set did not move either: the same 1,108 files from the same 20
repos. That is the answer to "does every number in this document reproduce from a
clean corpus": for the pass-2 figures, yes, and the corpus did not grow under
them. The table below is that population with PS25–PS28 applied and then **PS29
and PS30**, whose delta is `uses` +37, `instantiates` −41, total −4.

**The percentage columns are the stable part**: across the corpus growth every
rate moved by at most 0.11 points, which is what says the growth was additive
rather than a change of population. Across PS29 they moved by MORE than that and
in the direction that needs explaining rather than celebrating — see
"`instantiates` resolution FELL, and that is the right direction".

`files` below is the exact distinct-file count. The census originally printed a
400-entry display cap here, which made `calls`, `uses` and `contains` each print
`files 400` — a number that reads as exact and is not one. The cap remains for the
example list; `distinctFiles` in the census JSON is the uncapped set.

| Relationship type | Emitted? | Edges | Files | corpusBoth | intraBoth | `conf < 0.7` | Tier | What it means **in PowerShell** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | EMITTED | 67,344 | 963 | 60.66% | 8.23% | **55.38%** | `usage_contextual` | a cmdlet or function invoked by name (`Get-ChildItem`), a method call (`$obj.Method()`), a static call (`[Type]::Static()` → the qualified name `Type.Static`, PS-B22), or a script run through an invocation operator (`. ./x.ps1`, `& ./x.ps1`). Flow keywords excluded. |
| `uses` | EMITTED | 64,599 | 887 | 92.87% | 55.96% | 0.00% | `usage_contextual` | a name READ rather than invoked: a type literal's spec, a variable read, a hashtable key, a cmdlet parameter name, an attribute, hashtable-literal and array-literal composition, and — since PS29 — a `New-Object` **type name held in a variable**. The largest channel after `calls` and the one with the highest corpus-wide resolution rate in the lane. |
| `contains` | EMITTED | 21,750 | 1,022 | 99.87% | 99.73% | 0.00% | `structural` | lexical nesting: a module contains its functions, a class its members, a function its locals and parameters. The only type whose endpoints resolve at both ends on ~99.9% of edges, because both ends are symbols this same pass declared. **Lexical nesting is not ownership, and the size of the difference is now measured rather than declared open** — see "PS31" below. |
| `imports` | EMITTED (PS23) | 556 | 207 | 69.42% | 37.77% | 0.00% | `import_based` | one module dependency, from `Import-Module` (361 edges), `using namespace` (105), `#requires` list or hashtable (90). **This is the type the lane did not have** — see below. |
| `references` | EMITTED | 577 | 223 | 68.98% | 36.40% | 0.00% | `import_based` | the sibling channel for the same module dependency — **every one of the 577 edges is accounted for: 556 `import_sibling` plus 21 `requires_version`** — and nothing else. The Contract's composition claim is false and the measurement is below. |
| `exports` | EMITTED | 106 | 45 | 98.11% | 95.28% | 0.00% | `structural` | what `Export-ModuleMember -Function`/`-Variable`/`-Alias`/`-Cmdlet` publishes, read from the command's argument list. A wildcard target publishes nothing, which is why the count is 106 and not 113. **`metadata.via` names the FLAG since PS30** — before it, every row carried the command name and 0 of 106 named the flag. |
| `extends` | EMITTED | 47 | 7 | 87.23% | 61.70% | 0.00% | `structural` | the FIRST name in a class header's `: Base, IFoo, IBar` list. The header cannot say which base is a class and which are interfaces — the language resolves that at run time — so position is the only information the grammar carries. |
| `implements` | EMITTED | 3 | 2 | 83.33% | **0.00%** | 0.00% | `structural` | every name after the first in the same header list. 3 edges over 2 files, both in the `powershell` repo's own inheritance test suite; `intraBoth 0.00%` because a base or interface declared in another file is not declared in the same file — this is the expected rate for a cross-file type reference, not a resolution failure. |
| `overrides` | EMITTED | 12 | 1 | 100.00% | 100.00% | 0.00% | `inferred` | a subclass member that overrides a member of its resolved base: same name, same kind, base member neither `hidden` nor `static`. PowerShell has no `override` keyword — class methods are virtual by default — so this is the lane's only genuinely INFERRED edge type, which is why it is the only one on tier `inferred` and the only one at 0.9 rather than 1.0. All 12 edges are in ONE file, and pass 1 published 2 of them. |
| `instantiates` | EMITTED | 1,227 | 256 | 61.53% | 15.97% | 0.00% | `usage_contextual` | an object construction: `[Type]::new(...)` (854 edges) or `New-Object` in its three spellings (373 after PS29). Type-accelerator names are suppressed — they construct nothing the graph should name — and a **type name held in a VARIABLE is not published as an `instantiates` target at all**, since the edge would assert the variable is a type. |
| `renders` | RULED — not applicable | 0 | — | — | — | — | — | **0 sites over 1,181 admitted files.** The vocabulary's relation is *a component renders another component*, and **0 of the 32 `SymbolKind` values name a component**; `ConvertTo-Html` (15 sites, 1 file) is a serializer of objects to HTML **text**, `Out-GridView`/`Show-Command` display data (0/0), and `[Windows.Markup.XamlReader]::Parse` builds UI from XAML **text**. All are already published as `calls`, which is the true relation. Population, falsifier and ladder: "PS-B20". |
| `mixes_in` | RULED — not applicable | 0 | — | — | — | — | — | **0 sites over 1,181 admitted files.** `mixes_in` is member-set composition with **no conformance declared**; PowerShell's one declaration-level composition construct is the class base list (50 entries), which **is** conformance and is already emitted as `extends`/`implements`. The runtime family is the impostor and it is **not one construct**: 144 real member attachments (`Add-Member` 127 + `Update-TypeData` 17, in 34 files) beside 172 `Add-Type` sites (which compile a source string) and 10 `Update-FormatData` sites (a display view), all published as `calls`. Over the 144 attachments the `-Value`/`-NotePropertyValue` arguments are **121 — 0 of them a named declaration** (script block 25, string literal 49, array-literal value expression 33, bare value token 14), plus 23 attachments that supply no `-Value` at all (18 of them parameter-shape tests), and 121 + 23 = 144. ONE declaration-shaped argument in that family is a member NAME (`Add-Member -Name Build`) and a name is not a set; `Add-Type -Name` is a different role entirely — it names the type the compilation CREATES, so its 18 arguments are counted as HOST arguments beside the 18 `-TypeName` ones (36 in all, 22 naming no corpus declaration). Population, falsifier and ladder: "PS-B20". |

`corpusBoth` is the share of edges whose BOTH endpoints name a symbol declared in ANY of
the 1,108 sampled files; `intraBoth` is the share whose both endpoints are declared in
the SAME file. The second is the rate the analyzer is answerable for (its own symbol
table); the first is the rate a corpus-wide consumer sees. CSS `references` at 66.8% on both ends
is the project's reference point, and this lane's `references` sits at 68.98% corpus-wide
— 2.2 points above it.

### `instantiates` resolution FELL, and that is the right direction

PS29 removed 41 edges from `instantiates` and the type's `corpusBoth` went
**62.78% → 61.53%** and `intraBoth` **18.69% → 15.97%**. Every removal rule in this
lane so far has RAISED a resolution rate — PS25 published that as the signature of
having removed edges that named nothing — so this one is the opposite and needs the
explanation, not a victory lap.

The reason is that the 41 removed edges were **better-resolving than average**. Each
was `New-Object $var` inside a function that also assigns `$var`, so the target was a
name the same file declares — a high-resolution target by construction. Removing 41 of
them raises the mean of what is left even though every one of them was wrong. **A
resolution rate is a property of a population, not a quality score, and a fix that
removes well-resolving edges will always lower it.** The number that says whether the
fix worked is the count of edges whose target was a variable node, and that is 41 → 0.

The same applies in the other direction and is worth stating so the two are not
confused: had the 41 been mislabeled type names that resolved to nothing, the rate
would have risen and the fix would have looked free.

### The `imports` type was a GAP, and it is now EMITTED (PS23)

The lane held every module name in `imports[]` and published the dependency as
`references` only. Across the 1,092-file corpus pass 1 measured (1,108 today) the
`imports` type was emitted **0 times**
while `imports[]` was populated for all four PowerShell import forms — a real construct,
read correctly, recorded, and absent from the graph as an `imports` edge.

That is a GAP rather than a modelling preference. `grep -l 'RelationshipType.Imports'
src/ast/real-*-analyzer.ts` names **23 of the 48** analyzers after this change and 22
before it. bash — the same construct in the same family, a shell sourcing another file —
emits BOTH channels for one `source ./x.sh` (`real-bash-analyzer.ts:1299` `imports`,
`:1304` `references`), because a file-level dependency answers two different consumers,
and the store's M60/#910 file-level seam keys on the `references` row's
`metadata.fileLevel`. So `references` was KEPT and `imports` added, both at 0.9 with
identical metadata — the value this function has always put on this exact fact. The module
NAME is read off the tree; the module's RESOLUTION to a file on disk happens at run time,
so the edge is a read of a dependency, not a proof of a file on disk.

`metadata.via` was added to the edge because `file -> Module` does not say which of the
four declarations produced it, and those four are read by three different grammar
branches. A `#requires` hashtable row and a bare `#requires -Module X` row were
otherwise identical in every field the output carries.

### The `#requires` module LIST was unread, and two corpus files were affected (PS24)

`#requires -Module[s]` has three shapes and the pre-PS24 reader answered none of the two
list-shaped ones — it stopped at the first space, tab or comma.

| Shape | Pre-PS24 | Corpus population | Effect |
| --- | --- | --- | --- |
| `#requires -Modules A, B` | `A` only | **1 of 1,092** files (pass 1's population) — `ansible/test/lib/ansible_test/_util/controller/sanity/pslint/pslint.ps1:2` (`PSScriptAnalyzer, PSSA-PSCustomUseLiteralPath`) | `PSSA-PSCustomUseLiteralPath` was a declared dependency read and dropped |
| `#requires -Modules @{ ModuleName = 'X'; ModuleVersion = '1.0' }` | the literal `@{` as the module name | **2 of 1,092** files (pass 1's population) — `ansible/.../win_app_control/files/{New-AnsiblePowerShellSignature,Set-ManifestSignature}.ps1`, both `@{ ModuleName = 'OpenAuthenticode'; … }` | `imports[]` stored `path: "@{"` and an edge was published to `@{` |

The hashtable rows were the ENTIRE gap between `imports[] 552` and `imports 550` edges,
because `filterNoiseRelationships` in `src/ast/pool-worker.ts` drops any target whose leaf
contains `{`. **A garbage edge killed by shared machinery is still a garbage row already
written**: the filter removed the edge, not the ImportInfo, so the store received a
dependency on a module named `@{`.

Measured delta through production `parseFile` over the whole admitted corpus, before →
after: `imports[]` records **552 → 553**, `imports` edges **550 → 553**, `references`
edges **571 → 574**, total relationships **155,426 → 155,432**. The records/edges gap of 2
that existed BEFORE the fix is **0 after it** — `imports[] 553` against `imports 553` — and
that equality is the check that the `@{` rows are gone rather than merely still dropped.
The `+3` on both channels is the comma list's second name plus the two hashtables, which
now survive the brace filter because they name real modules.

Only a file carrying a `#requires -Module(s)` directive can be affected, and 59 of the
1,092 admitted files did at the time (1,108 today), so those 59 are the whole population
and the delta is exact
rather than sampled. The reader stays regex-free, and it recognises three shapes and
nothing else: a bare list, a comma-continued bare list, and a hashtable whose
`ModuleName` key names the module. A hashtable with no `ModuleName` names no module and
yields nothing — `@{ ModuleVersion = '1.0' }` is not a module declaration.

### Payload and latency, measured rather than asserted

`validation/m60/analyzer-budget-register.json` has **no scored row for this lane**: its
`powershell` entry reads `verdict: "unscorable"`, `severity: 5`, `status: "open"`, with the
reasons "no loadRule (#871: a row without load context is not scored)" and "no corpusManifest
(#909: which files were measured is not recorded)". So PS23's addition cannot regress a
budgeted lane — there is no budget for it to regress — and **no shared budget file is
re-baselined by this work.**

The growth is measured anyway, on the whole affected population rather than an arbitrary
draw. The 59 admitted files that carry a `#requires -Module(s)` directive are the files
PS23 and PS24 can affect at all, and they were parsed through production `parseFile`:

| | Files | Relationships | Relationship payload |
| --- | --- | --- | --- |
| Before (`imports` not emitted) | 59 | 12,419 | 2,502,191 B |
| After | 59 | 12,521 (**+102**) | 2,527,143 B (**+24,953 B, +0.997%**) |
| Per added edge | | | **244.6 B** |

**57 of the 59 files gain the `imports` type.** 10,657 ms for the 59 files on a machine at
load average 15+ with six other agents indexing concurrently; that figure is contention,
not a lane budget, and it is reported as a measurement rather than as a performance claim.

### The arbiter's own verdict, and where two instruments disagree

`script/m14/ontology-coverage-gate.ts` **cannot report this lane at all**: it exits 2
with "no RULING TABLE for powershell" because `RULED_BY_LANG` has no `powershell`
entry. Run as a `/tmp` copy with exactly one change — `powershell: []` in that record
literal, which is the correct registration for a lane with zero RULED types, since
every row then resolves on the EMITTED branch — the arbiter reports, over the same
1,108 admitted files and the same production `parseFile`:

```
type          status     detail
calls         EMITTED    67,335 edges
uses          EMITTED    64,546 edges
contains      EMITTED    21,737 edges
imports       EMITTED    556 edges
references    EMITTED    577 edges
exports       EMITTED    106 edges
extends       EMITTED    47 edges
implements    EMITTED    3 edges
overrides     EMITTED    12 edges
instantiates  EMITTED    1,268 edges
emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0
```

**The arbiter and the census disagree, and the disagreement is 38 edges in one file.**
`calls` 67,335 vs 67,344, `uses` 64,546 vs 64,562, `contains` 21,737 vs 21,750; the
other **seven types agree exactly**, including both types this pass changed
(`exports` 106 and `overrides` 12). Both instruments admit the identical 1,108 files
(same `git ls-files` walk, same 512 KB size cap), so the delta is not admission.

It is attributable rather than left open, exactly as pass 1 found for a different
file. The arbiter logged
`[BB-HANG] parser stuck 120s on fsharp/eng/common/retain-build.ps1 — exiting`, which
is `src/ast/engine.ts:1412`'s per-file self-destruct timer firing — production
behaviour, since a synchronous WASM `parse()` cannot be interrupted from the event
loop. Parsed on its own through production `parseFile`, that file contributes
**38 relationships — `contains` 13, `uses` 16, `calls` 9 — which is the delta
exactly, edge for edge and type for type.** Three sequential isolated parses return
38 relationships every time, so the parse is reliable when it is not competing with
concurrent in-process workers; what is measured here is that this one file's parse
is load-sensitive, not that either instrument is wrong. Pass 1 saw the same class on
a different file (`fsharp/eng/release/scripts/GetAssemblyVersions.ps1`,
`memory access out of bounds`, 26 edges), which is what says it is a property of
this wasm under load and not of one unlucky input.

The census is the figure this document quotes. It shards the corpus across child
processes and re-runs a dead shard without the offending file, and it reports what
it excluded rather than dropping it silently. Its totals reproduced across two runs
at this commit: 156,225 relationships and 22,861 symbols both times, 0 differing
values across all ten types for edge count, both resolution rates, the intra-file
rates, the heuristic count, the missing-line count, the confidence histogram and the
`evidenceClass` histogram.

## Pass 2 — the adversarial half: four defects, and how each was found

Pass 1 established that all ten types are EMITTED. That is a statement about the
analyzer's OUTPUT and says nothing about whether any output is right. Pass 2's job
was the other half: for every emitted type, write the strongest argument that the
LABEL is wrong, and measure whether the corpus supports it. The instrument is
`validation/m14/fixtures/powershell/adversarial-probes.ts` — eleven probes, each
carrying its argument, its instrument (A: grammar-inventory, or B: parse-tree-count),
its measured count and the condition that would overturn it. It reads the PRODUCTION
output (`parseFile`, never `analyze()`) for edge questions and the pinned wasm
(`getParser("powershell")` from `src/ast/engine.ts`) for tree questions, and it
shards both across child processes so one pathological file cannot take the run.

**It found four defects. Three of the four were invisible to the census by
construction, and the fourth was a doc row that was simply false.**

| # | Type | What was wrong | Corpus delta | Where |
| --- | --- | --- | --- | --- |
| PS25 | `exports` | a wildcard was published as a symbol name | **−7 edges** (113 → 106) | `addExport` |
| PS26 | `overrides` | the match ignored `hidden`, `static` and member kind | **0 edges** — corpus carries 0 of the three | `memberOverrides` |
| PS27 | method symbols, `contains`, `overrides` | the pinned wasm splits a member's NAME; the analyzer published the suffix | **0 edges** — corpus carries 0 splits | `memberHeaderFacts` |
| PS28 | `overrides` | `classMembers` reset on redeclaration, and the match was case-sensitive | **+10 edges** (2 → 12) | `classMembers`, the `find` |

### PS25 — `exports` published a wildcard as a name

`addExport`'s guard was `name.startsWith("*")`, which is **positional**: it caught
the bare `*` and nothing else. `Export-ModuleMember -Function Measure*` is the same
kind of declaration — the module publishes every function matching a PATTERN and
the expansion happens at run time — so there is no single name to publish, and `*`
is not a legal character in a PowerShell identifier, so `Measure*` names nothing by
construction.

Measured over all 1,108 admitted files through production `parseFile`: `exports`
edges carrying a wildcard in **any** position = **7**, every one of them the target
`Measure*`; edges whose target is exactly `*` = **0**. `filterNoiseRelationships` in
`src/ast/pool-worker.ts` does not drop a `*` target — it bans `<>{}` backtick and
whitespace, not `*` — so all 7 reached the store. The fix scans the whole string
for `*` (code 42) or `?` (code 63).

**Two rows of this document were false about it and are corrected here.** The
Contract table and the declared-limitations list both said `-Function *` "publishes
the literal `*`". A controlled probe through `parseFile` reads `-Function *` as
publishing **nothing**, while `-Variable Get-Foo` and `-Alias 'Get-Bar','Get-Foo'`
both publish. So the code was already right about `*` and wrong about `Measure*`,
and the prose was wrong about both.

The `exports` resolution rate is the receipt: corpusBoth **95.13% → 98.11%** and
intraBoth **89.38% → 95.28%**. Removing edges RAISED the resolution rate, which is
the signature of having removed edges that named nothing — a narrowing that makes
the graph more true, not less.

### PS26 — `overrides` ignored the two things PowerShell uses to say "not an override"

`classMembers` held bare `string` names, so the matcher was a pure name comparison
and discarded three facts the analyzer had **already parsed off the same node**:

| Fact | Where it was already read | What PowerShell uses it for |
| --- | --- | --- |
| `hidden` | `isHidden` on the symbol | a `hidden` member is **not inherited** by derived classes |
| `static` | `isStatic` on the symbol | a static member is **not virtually dispatched** |
| node kind | the node's own type | a method does not override a property |

`overrides` is the lane's only `inferred`-tier edge and its only name-match
derivation, so these were the three ways it could publish a fabrication.

**The corpus cannot reach any of the three**, measured on the parse tree over all
1,108 admitted files: class members carrying `hidden` = **0**, carrying `static` =
**0**, same-name derived/base pairs whose kinds differ = **0**. So the corpus delta
is **0 edges** and the change is pinned by fixture
(`overrides-modifiers-psb12`) rather than by the census. Saying otherwise would be
the same failure as the two doc rows above.

The rule REMOVES and does not add. A derived **property** over a base property of
the same name is deliberately still not an override: PowerShell resolves it to the
derived property for a derived instance, so it shadows in the same observable sense
a method overrides, but the corpus carries 0 examples and adding an edge for a
construct nothing exercises is the fabrication rule running backwards. The
pre-fix asymmetry is worth recording because it was in BOTH directions and neither
was right: `classMembers` was filled from properties as well as methods (line 1446)
while `overrideCandidates` took methods only (line 1424), so a derived method over a
base property DID publish and a derived property over a base property never could.
PS26 removes the first and pins the second as a decision rather than an accident.

### PS27 — the pinned wasm splits a class member's NAME, and the analyzer published the suffix

Found by a probe on PS26, not by looking for it. An `overrides` edge on
`static [int] StaticOpen() { … }` came back with `overridesMember: Open` — the
SUFFIX. The tree says why:

```
[int] StaticOpen() { return 40 }
  -> attribute "[int]" · class_attribute "Static" · simple_name "Open"
```

**Root cause, named to the line.** `grammars/tree-sitter-powershell/grammar.js:1266`
builds `class_attribute` as `choice(token(reservedWord('hidden')), token(reservedWord('static')))`;
`reservedWord` (line 1820) is `alias(reserved(caseInsensitive(word)), word)`; and
`caseInsensitive` (line 1839) emits `[sS][tT][aA][tT][iI][cC]` — **no word
boundary**. So the token matches the first six characters of any identifier
beginning `Static` or `Hidden`. Measured on a controlled ten-class probe:
`StaticOpen`, `StaticThing`, `StaticOpen2`, `HiddenThing`, `HiddenOpen`, `HiddenX`
all split; `Stat` does not; and `static [int] StaticOpen()` — the same identifier
WITH a leading modifier — parses correctly, which isolates the trigger to the
ABSENCE of a modifier rather than to the identifier's text.

The second half of the split was the more dangerous one, because it does not
produce an obviously wrong name: `classAttributeTexts` collected the
`class_attribute` node whether it was a modifier or a name prefix, so
`[int] StaticOpen()` came back **`isStatic: true`** — a modifier the language would
act on, stamped on a method the author never marked static.

**The fix is a position scan, and the first position scan was wrong.** Text cannot
decide it: a genuine modifier and a split name prefix are the same token. The first
version used "a `class_attribute` after a type node is a name prefix" and a corpus
probe refuted it within one file — `class C7b { [hashtable] static $x; }` at
`powershell/test/powershell/Language/Classes/Scripting.Classes.BasicParsing.Tests.ps1:35`
is a REAL modifier in that position (the test file's own comment reads "order
doesn't matter"), so the rule would have reported one live defect and, acted on,
dropped `isStatic` from a real static property. Both readers now require **both**
halves: the `class_attribute` must be immediately preceded by an `attribute`/
`type_literal` AND immediately followed by a `simple_name`. A property's name is a
`variable`, which is what separates the two `attribute · class_attribute · X`
shapes. Both `C7a` and `C7b` read `isStatic: true` after the fix, which is the
receipt.

**What the fix does NOT repair, stated rather than implied.** When the remainder
starts with a digit or is empty — `[int] Hidden2() { … }`, `[int] Static() { … }` —
the split leaves an ERROR where the parameter list and body were, and the ERROR
**swallows the next class declaration**. No analyzer can recover a node the tree
does not contain. That needs the grammar fix and a wasm rebuild, which moves the pin
hash; the pin record and the wasm are verified together by
`script/m14/verify-grammar-pins.ts` and the pin registry
(`validation/m14/grammar-pins.json`) is a cross-lane file. Reported, not attempted.

**Corpus measurement: 0 split members** across 704 class members on 1,108 files.
So the naming delta is also 0 edges and this is pinned by fixture.

### PS28 — `overrides` under-fired by 10 of 12 edges, from two defects in the matcher

Both are in the matcher rather than in the tree, and both are measured on ONE file:
`powershell/test/powershell/Language/Classes/scripting.Classes.inheritance.tests.ps1`,
a Pester suite that redeclares `A`, `B`, `C`, `bar`, `baz`, `MyIntList` and
`TestHost` across roughly forty `It` blocks.

**(a) `classMembers` reset on redeclaration.** `classMembers.set(className, new Set())`
ran on **every** `class_statement`, so only the LAST declaration of a class name kept
its members. The last `class B` in that file declares only a constructor, so
`classMembers['B']` was **empty**; the last `class A` declares only properties `i` and
`s`, so `classMembers['A']` held **no methods**. The parse tree holds **8** same-name
derived/base method pairs in that one file and the matcher could see **2**.

**(b) The match was case-SENSITIVE**, in a language whose identifiers are not. That
file's base declares `foo` and the derived class declares `fOo` — the same member
under PowerShell's rules. Every other name comparison in the analyzer lowercases
first, and `pushSymbol` states the rule in so many words: "`$Foo` and `$foo` are ONE
variable". Case-sensitive, the final declaration matched nothing, so **the two edges
the lane did publish came from EARLIER declarations of the same class** — the type
fired on a file where its own last member does not match.

After the fix the file yields **12** `overrides` edges instead of 2. Accumulating is
the honest direction and not the convenient one: every pair the union exposes is a
`class B : A` and a `class A` that BOTH appear in the same file, so `B.GetName`
really does override `A.GetName`. The reset was losing facts, not suppressing
fabrications.

`baseClassByClass` deliberately does **not** get the same treatment: its `set` is
already inside `if (baseClass)`, so a base-less redeclaration leaves the earlier base
in place. That asymmetry is correct — a redeclaration with no base says nothing about
the base of the earlier one — and it is recorded so the two maps are not "fixed"
together by a later reader.

**Where the recovered edges live, honestly.** All 12 `overrides` edges are in that
one file, and that file redeclares class names — which PowerShell itself rejects at
run time ("Cannot define class X because the name is already in use"). So the edges
are correct about the parse tree and describe code PowerShell will not execute. The
fixes are right regardless of where they fire; the delta's location is what is being
reported.

### A `references` claim that was false, and a probe that was wrong twice

Two more findings, one in this document and one in the instrument, both of which had
to be corrected rather than reported as wins.

**The `references` composition claim.** The Contract table said hashtable literals
and array literals emit `references` for their member and element targets. Every one
of the 577 `references` edges was classified by its metadata and the accounting
closes with no composition class at all: **556 `import_sibling` + 21
`requires_version` + 0 other**. The code emits `uses` (0.7–0.9) for a hashtable key
and an array element, which is the right type — a composition is a name READ, and
`uses` is the ontology's label for that. The Contract row is corrected above; the
type was never wrong, only the prose.

**The probe produced two false readings of its own, and both are recorded in the
file.** (i) The reserved-word probe reported **73** fabricated `calls` edges, and 68
of them died on the source line: `$respawnPipeline.Process($manifest)` is a .NET
method whose NAME is a PowerShell keyword, and `$shell.NameSpace($src)` is another.
A reserved word alone does not make a call fabricated; the question is whether the
target is in COMMAND position, and only the source line can say which — the two
`calls` emission sites publish identical metadata at the same confidence, so the edge
cannot distinguish them. Re-classified per edge, the command-position offenders are
aliases (`Foreach`, `foreach`), which PowerShell ships in every edition, so the type
holds. (ii) The tree probe's first name-map collapsed duplicate class names
FIRST-wins while the analyzer is LAST-wins, and reported
`sameNameDerivedBasePairs: 0` on a corpus where the analyzer emits `overrides` — **a
false zero from an instrument that did not model the rule it was auditing**, which is
the shape honesty contract §5.4 refuses. A third variant of that probe used one
global name map across files and reported 8 pairs against the analyzer's 2 edges;
the 6-pair difference was cross-file pairs the analyzer cannot see by construction.
Each correction is in the file with the reason.

## Pass 3 — the third instrument: two defects, one settled question, one new grammar limit

Pass 1 established that all ten types are EMITTED. Pass 2 attacked the LABEL of every
emitted type and found four defects. Pass 3 had two specific jobs and no third:

1. **Settle what pass 2 declared open.** `contains` is the lane's most trusted type at
   99.87% both-ends resolution, and pass 2's P10 wrote down the strongest argument
   against it — *lexical nesting is not ownership* — measured only the structural half
   (0 self-edges) and **declared the nesting-depth half UNSETTLED**. A declared open
   question is an unfinished measurement, so P12 below is that measurement.
2. **Ask each type a question pass 2 did not.** Pass 2 wrote the strongest argument it
   could find per type and stopped. Pass 3 asks a different question of each: not *is the
   label right for the shape I picked* but *what OTHER shape does this code path accept,
   and what does the lane do with it*.

The instrument is `validation/m14/fixtures/powershell/pass3-probes.ts` — **seven
probes**, each carrying its argument, its instrument (A: grammar-inventory, or
B: parse-tree-count), its count and its overturn condition, in the same shape as pass
2's eleven. It reads PRODUCTION `parseFile` for edge questions and the pinned wasm
through `getParser("powershell")` for tree questions, shards both across child
processes, and **asserts the population before trusting any verdict**: a run whose
shard population is smaller than the admitted set prints a WARNING and every number
below it is declared a lower bound. That assertion earned its place — a mid-run
measurement of P14 read 1,033 `instantiates` edges against the census's 1,227 because
one of ten shards died on a WASM load race, and the run said so instead of reporting a
whole-population number.

Final run: **1,108 / 1,108 admitted files on both halves, 0 shard failures**,
156,221 relationships.

| # | Type | What was wrong | Corpus delta | Where | Verdict |
| --- | --- | --- | --- | --- | --- |
| PS29 | `instantiates` | a `New-Object` **type name held in a VARIABLE** was published as an `instantiates` target | **−41 `instantiates`, +37 `uses`, net −4** | the `New-Object` reader; the shape work is reused from `commandArgs` | FIXED |
| PS30 | `exports` | the edge carried the COMMAND NAME as `via`; 0 of 106 rows named the flag | **0 edges** — metadata only | `addExport`, the `Export-ModuleMember` reader | FIXED |
| PS31 | `contains` | lexical nesting is not ownership — **now measured** | 950 declaration sites (2.78% of the control) | not a code change | SETTLED, quantified |
| PS32 | `calls` | the dot-source path cannot reach the store's file-level seam | 38 edges carry no `fileLevel` | `looksLikeModulePath` branch | MEASURED, fix **DECLINED** with a number |
| PS33 | every type | the pinned grammar has no `clean` block | 46 ERROR nodes across 3 files | upstream of the analyzer | REPORTED |
| PS34 | `overrides` | the chain-walk's hop-2+ branch is unexercised | 0 transitive pairs exist | `overrideCandidates` loop | UNTESTED AT DEPTH |
| PS35 | `uses` | does `uses` ever name a declaration? | 151 name collisions, all member reads | not a code change | HOLDS as a name collision |

**Two of PS29's own arms were dead code and were deleted**, which is why the proof script
re-runs five reverts rather than three: see "PS29's predicate was written with three arms
and now has one".

### PS29 — `New-Object` published a VARIABLE as a type name

`New-Object`'s constructed name is `comObject ?? typeName ?? positional`, and all three
readers produce **TEXT**. Nothing asked whether that text came from a `variable` node or
a literal one, so `New-Object $type` published `instantiates -> type` — an edge asserting
the target **is** a type, where the source says "constructs whatever that variable
holds", resolved at run time.

Measured over all 1,108 admitted files through production `parseFile`, cross-referenced
against the symbol table **of the file that published the edge**: **41 edges** arrived by
`New-Object` with a variable argument node. `instantiates` 1,268 → 1,227, `uses`
64,562 → 64,599, total 156,225 → 156,221. The `+37` against the `−41` is the fourth
edge in the arithmetic and it is not noise: 4 of the 41 became a `uses` edge at a site
where the variable-read pass had **already** published the same `(source, target, line)`,
so the relabelled edge merged into an existing one rather than adding a row. Net −4.

**This is the defect class the lane already declares fixed for `calls`.** F9 turned
`$type::$method()` from `calls -> $method` into `uses -> method` precisely because a
`$`-prefixed member is a VARIABLE, not a name. `instantiates` is the channel that did
not get the same treatment, and it is read by the same reasoning. The fix routes the
variable form to `uses` at the same 0.9, carrying `isDynamicTypeName: true` so a
consumer can tell "reads the variable holding the type name" from "reads a variable for
some other reason".

**The shape is not one thing, and the shape work belongs to `commandArgs`, not to the
predicate that reads it.** Measured on the pinned wasm, a `New-Object` argument always
arrives wrapped:

| Source | Tree shape | What `commandArgs` hands over | Route |
| --- | --- | --- | --- |
| `New-Object $t` | `array_literal_expression > unary_expression > variable` | the `variable` | `uses` |
| `New-Object "$t"` | `… > string_literal > expandable_string_literal > variable` | the `variable` | `uses` |
| `New-Object -TypeName $t` | `command_parameter`, then the same wrapper | the `variable` | `uses` |
| `New-Object -ComObject $p` | `command_parameter`, then the same wrapper | the `variable` | `uses` |
| `New-Object -TypeName 'lit'` | `… > string_literal > verbatim_string_characters` — **no `variable`** | the `string_literal` | `instantiates` |
| `New-Object System.Version` | `generic_token` | the `generic_token` | `instantiates` |

`'lit'` and `"$t"` are the pair that decides the implementation: single quotes are a
literal string in PowerShell and double quotes are an interpolation, and the pinned
grammar wraps **both** in the same `array_literal_expression > unary_expression >
string_literal`. They are separated by what is inside — `verbatim_string_characters`
versus an `expandable_string_literal > variable` chain — so a `$`-in-text test would get
the single-quoted case backwards. `commandArgs` already makes that distinction, because
it has to in order to produce the argument's text at all, so the fix reuses it: each
reader now also reports **the node its text came from**, and the routing test is one
node-type comparison against `variable`. The text is never consulted.

### PS29's predicate was written with three arms and now has one, and the revert proof is why

The first version of the predicate tested the node for `expandable_string_literal`, then
for `array_literal_expression || unary_expression` with its own descendant search. **Both
arms were dead, and the revert proof is the only thing that found them** — reverting
either one alone left the fixture suite green:

- the `expandable_string_literal` arm is unreachable because the grammar always wraps, so
  the argument node is never the quoted node;
- the wrapper arm is unreachable for a sharper reason: **`commandArgs` has already done
  that descendant search** and pushes the *unwrapped* `variable`, so the first arm answers.

Both were **removed rather than commented**, because a branch that cannot affect any
output is an L2 dead branch and this file already records two earlier mutants that
survived because of one. The proof now pins what replaced them: **PS29b** reverts the
handover to pass the wrapper instead of the variable it unwrapped, and **PS29c** removes
the handover entirely. Both are caught, along with **PS29a** (the routing condition) and
**PS30a/b** — **5 / 5 against a control measured at 0 failing fixtures.**

**And the proof script itself had a vacuous pass, which is the fourth time this lane has
hit one.** Its first version asked "does any fixture fail", so when the control went red
for an unrelated reason — a fixture comment was edited, which shifted the line numbers
its own expectation pinned — all five reverts reported CAUGHT against that same
pre-existing failure. Five green results, none of them evidence. It now captures the
control's failing set and requires each revert to **ADD** a failure, and prints both
counts beside every verdict.

### PS30 — `exports` named the command, never the flag

`Export-ModuleMember` publishes a name under one of four flags — `-Function`,
`-Variable`, `-Alias`, `-Cmdlet` — and the four are not the same kind of thing. A
`-Cmdlet` target is a name the file cannot declare at all, so a consumer cannot even
tell whether it should go looking for it.

The reader **computed the flag and threw it away**: `if (!isFlag(flag)) continue` is a
test on the very string that was then passed to `addExport` as `leaf`, the COMMAND NAME.
So `via` was the literal `Export-ModuleMember` on every row — measured over all 1,108
admitted files, **106 of 106 `exports` rows carried `via: "Export-ModuleMember"` and 0
named the flag**. `via` is now the flag (`-Function`, `-Variable`, `-Alias`,
`-Cmdlet`) on both the edge and the `exports[]` record, and the unflagged branch keeps
the command name because there the flag genuinely is not in the source.

**Delta: 0 edges.** PS30 changes one metadata key. Nothing in the census can see it,
which is why the four mutants for PS29/PS30 and the five source reverts are the evidence.

PS30 is what made P18's question answerable at all: asked to classify the `exports`
residual by flag, the probe found **no row carried a flag** — and after the fix the same
probe reads the residual as **3 `-Function` + 2 `-Alias`**, and the two aliases
(`gfoo`, `gbar` in `PSScriptAnalyzer/Tests/Rules/TestManifest/ManifestBadAliasesWildcard.psm1`)
are structurally unresolvable because an alias is created by `New-Alias` at run time.
So 5 of 106 exports targets name nothing their own file declares, and 2 of those 5 are
that by the language's own rules.

### PS31 — `contains` says lexical nesting, and the size of the gap is now a NUMBER

Pass 2 declared this UNSETTLED. It is settled, and the answer is not zero.

`addContains` reads `top().owner`, and the owner frame is pushed at exactly four node
types — `function_statement`, `class_statement`, `enum_statement`,
`class_method_definition` — plus three DSC/interface sites. **`named_block` is not one of
them**, and `named_block` is how the grammar spells `begin` / `process` / `end` /
`dynamicparam`. PowerShell runs each of those in its **own scope**: a variable assigned
in `process` is not visible in `end` without `$script:`. So `contains fn -> x`, where
`$x` is assigned inside `process`, asserts the function **owns** `x`, and the language
says the binding ended with the block.

Measured on the parse tree over the whole admitted set (instrument B, 35,474 declaration
sites located — 28,838 assignment LHS, 5,403 `script_parameter`, 838 `foreach`, 395
class property):

| | Count |
| --- | --- |
| declaration sites inside a `named_block`, i.e. where `contains` crosses a PowerShell scope boundary | **950** |
| declaration sites in the owner's own body — the control | 34,129 |
| divergence rate | **2.78%** |
| `named_block` nodes on the corpus | 277, across 69 files |
| declaration sites inside a `& { … }` child-scope invocation | **49** |
| declaration sites inside a `. { … }` same-scope invocation — the control | 31 |

By block: `end` 180+42+9+3, `process` 235+43+30+7, `begin` 16+19+6+1,
`dynamicparam` 79+12+6. By declaration kind: 880 assignment, 61 `foreach`, 9 parameter.

**`&` and `.` are separated because they mean different things**, and that is the half
that makes the count a finding rather than a curiosity: `&` invokes in a CHILD scope, so
a variable assigned inside it does not outlive it; `.` runs in the CURRENT scope, so the
same edge there is correct. The control (31 same-scope against 49 child-scope) is what
says the test discriminates.

**No fix, and the reason is a design decision the lane already made.** Attributing a
declaration to its `begin`/`process`/`end` block requires a SYMBOL for that block, and
the lane's Contract states "**No synthetic `global` scope symbol is ever emitted**". A
fix here would introduce exactly the synthetic scope the lane refuses, for 950 of 35,474
declaration sites, and would make `contains` stop resolving at the 99.87% that makes it
the lane's most trusted type. So this is stated as a **quantified limitation**, not left
open: `contains` is lexical nesting, nesting is not ownership, and on this corpus the two
differ on 2.78% of declaration sites.

**The instrument was wrong twice before it was right, and both corrections are in the
file.** (i) The first walk had no lower bound, so it reported **89 class properties
inside a `named_block`** — a shape PowerShell cannot express, because a property is
declared in a class body and the walk had crossed the class boundary upward. The owner
node is now the lower bound. (ii) The assignment walk looked for the `variable` as an
ANCESTOR of `left_assignment_expression`, and it is a DESCENDANT, so it reported **0
assignments** on a corpus where `$x = 1` is the most common declaration in the language.
A zero on the dominant shape of the construct is an instrument reporting on itself.

### PS32 — the dot-source cannot reach the file-level seam, and the fix is declined with a number

`. ./lib.ps1` and `& ./run.ps1` publish one `calls` edge carrying
`metadata.invokationOperator` and nothing else. The store decides an edge is a
FILE-LEVEL dependency from exactly one key —
`rel.metadata?.fileLevel === true` at **`src/ast/parallel-indexer.ts:3481`** — and only
then sets `source_external` to the project-relative path. So a PowerShell file dependency
expressed by dot-sourcing is invisible to every file-level surface, while the lane's
`imports` (533), `references` (554) and `exports` (92) edges all carry the key —
**1,179 edges in this same lane carry `fileLevel` and the 38 dot-source edges carry 0.**

This is an asymmetry **inside the lane**, not a project-wide convention nobody adopted.

**The fix was written, measured, and declined.** The obvious change is to route a
dot-source through `addImport`, which is what PS23 did for `Import-Module` and what
bash does for `source ./x.sh`. Measured over the 38 dot-source edges:

| Target shape | Count |
| --- | --- |
| `$`-interpolated path (`$PSScriptRoot\tools.ps1`, `$TestDrive\class.ps1`) | **37** |
| literal path (`.\eng\common\tools.ps1`, `fsharp/eng/common/vmr-sync.ps1`) | **1** |
| whitespace, parens or quotes | 0 |

So the change would add **2 edges to fix 1** and write **37 `imports[]` rows naming
things like `$PSScriptRoot\tools.ps1`** — which names no module and resolves to nothing.
That is the same shape PS24 called out: *a garbage edge killed by shared machinery is
still a garbage row already written*. The decline is the measurement, not a preference.

`&` is deliberately not included even if the same fix were made: `.` executes in the
CURRENT scope, which is a dependency, while `&` executes in a child scope, which is a
script **invocation** and belongs where it already is.

### PS33 — the pinned grammar has no `clean` block, and the corpus carries 31 of them

The declared-limitations table listed 6 grammar limits and `clean` was not one of them.
It should have been the seventh.

`begin`, `process`, `end` and `dynamicparam` all parse as `named_block` + `block_name`.
The corpus inventory is **12 distinct spellings and no `clean`** — `Begin`/`begin`/`BEGIN`,
`Process`/`process`/`PROCESS`, `End`/`end`/`END`, `DynamicParam`/`dynamicparam`/
`DYNAMICPARAM`. `clean` is not a `block_name` in the pinned wasm, and the ERROR it leaves
is **not local**: on a controlled two-function input the ERROR consumes the **second**
function's declaration, so a symbol the file really declares is absent from every channel.

Measured on the corpus: **46 ERROR nodes carrying `clean` across 3 files** — 34 in
`powershell/test/powershell/Language/Scripting/PipelineBehaviour.Tests.ps1`, 11 in
`CleanBlockErrorHandling.Tests.ps1`, 1 in `FileSystem.Tests.ps1` — against 31 `clean {`
occurrences in the corpus. This is a **grammar** defect, so it is reported and not
attempted: fixing it needs `grammar.js` to emit a word boundary for the block-name
tokens, a wasm rebuild, and a re-stamp of `validation/m14/grammar-pins.json`, which is a
cross-lane registry.

### PS34 — `overrides` is UNTESTED AT DEPTH, which is not the same as correct

The `overrides` resolution loop walks `baseClassByClass` up to 8 hops and `break`s at the
**first** hop that declares the member — which is right, because PowerShell resolves
`D.GetName` to the nearest declaration in the chain. The question is whether any corpus
file is deep enough to exercise the hop-2+ branch. It is not:

| | Count |
| --- | --- |
| classes whose base chain resolves in-file | 26 (22 at depth 1, 4 at depth 2) |
| classes at depth 3 or more | **0** |
| same-name pairs resolved at hop 1 | 12, all 12 published |
| **transitive pairs — the matching base member 2+ hops up** | **0** |

So the branch exists, is correct by reading, and **has never run on real code**. That is
a different statement from "correct", and it is the honest one.

**This probe produced a FALSE POSITIVE first, and the correction is the finding.** It
walked the whole chain and recorded a pair at *every* matching hop, so `class D : C : A`
with `GetName` on both C and A produced `D -> A`, the join found no such edge, and the
probe printed `WRONG (under-firing) — 1 of 1 transitive pairs are in the tree and not in
the output`. The analyzer had published `D -> C` and was right. A probe that does not
model the rule it audits manufactures a defect, which is the shape honesty contract §5.4
refuses and the third time this lane has hit it.

### PS35 — `uses` does name declarations, and it is a name collision rather than a mislabel

`uses` is the lane's largest type. Its strongest available counter-example is a `uses`
edge whose target the same file declares as a function, class or enum. Measured:

| | Count |
| --- | --- |
| `uses` edges whose target is declared in their own file | 36,152 |
| …of which the target is a `function` / `class` / `enum` / `method` / `constructor` | **151** (method 99, class 44, enum 7, function 1) |
| …naming a local `variable` or `property` — **the control** | **35,957** |

Every sample carries `isMemberAccess: true`: `$x.GetString` publishes `uses -> GetString`,
and `GetString` also happens to be a method name elsewhere in the file. That is a **member
leaf colliding with a declaration's name**, and the edge is a correct read of a member. The
control is what separates "this shape is rare" from "this shape is wrong": a large count
with a large control is a different finding from a large count with an empty one.

### Two more of this pass's own instrument readings were wrong, and both are corrected in the file

1. **P14 reported 123 defects where there were 41.** It joined every `instantiates` target
   against the publishing file's variable table, but two routes reach `instantiates` and
   only one can be wrong: `viaNewObject` reads a command ARGUMENT, while `dotNetNew` reads
   a `type_literal` node — and a type name can coincide with a variable's name, because
   `powershell/build.psm1:4053` is `$assemblies = [assemblies]::new()`. **80 of the 123
   were exactly that**, plus 2 more on the `New-Object` route
   (`New-Object Point 100,200` constructing `class Point` and assigning it to `$point`).
   The routes are now counted separately and the collisions are reported as collisions.
   Accusing 82 correct edges is the fabrication rule running backwards.
2. **P15's measurement object had a DUPLICATE KEY** — `ofWhichTheAnalyzerPublishes`
   appeared twice, so the second silently overwrote the first and the hop-1 count was
   lost from the JSON while the verdict string still printed it. The instrument and its
   own summary disagreed, which is the only reason it was found. `tsc` does not flag a
   duplicate key in a field typed `unknown`.

And one driver bug worth recording because it produced a clean-looking file:
`--only P14` as the FIRST argument selected **nothing** — a guard meant to detect a
missing value tested `onlyIdx >= 1`, and `P14` is at index 1 of a 0-based argv. The run
wrote a JSON with an empty `results` array and reported `0 probes recorded`, which on
disk is indistinguishable from a clean sweep. The run now **exits 7** on zero recorded
probes.

### One shared-machinery finding from pass 2 is FIXED, and it unblocked this lane's mutation gate

Pass 2 reported that `script/m60/powershell-mutants.ts` (51 mutants) was referenced by
nothing and that `BB_MUTANT_ONLY="powershell/"` printed `matched 0 of 1521` and exited 3.
At HEAD that is **fixed**: `script/m14/mutate-analyzer.ts:28` imports `POWERSHELL_MUTANTS`
and `:2429` spreads it into `MUTANTS`. A scoped run on 2026-10-27 reports **65 of 65
caught, 0 survivors** — the set has grown past the original 51 plus the 4 added here for
PS29/PS30, and the four survivors an earlier run of that same day reported are now CAUGHT
(PS-B23); each was a no-op transform keyed on a field the published shape does not have,
not a missing fixture.

That matters for PS29 and PS30 specifically, because **neither moves an edge count**:
PS29 relabels and PS30 writes a metadata key, so a count-based expectation cannot tell
the pre-fix state from the post-fix one. All four new mutants are therefore LABEL
mutants, and each has a counterpart that fails in the **opposite** direction — relabel
the variable form as a type name, and downgrade every literal type name to a read;
put the command name back in `via`, and hardcode `-function`. A fix that simply
suppressed the wrong behaviour would pass one of each pair.

### Two changes pass 3 considered and did NOT make

- **PS32's dot-source `imports`** — declined with the measurement above (1 literal path
  against 37 interpolated).
- **`contains` block-scoped ownership** — declined because it needs synthetic scope
  symbols, which the lane's own Contract forbids, for 2.78% of declaration sites.

Both are recorded with the number that decided them, which is the difference between a
declined change and a missing one.

Functions with `param()` blocks, typed/optional parameters, attributes
(`[CmdletBinding()]`, `[Parameter()]`, `[Validate*()]`), classes with
properties, constructors, instance and static methods, inheritance and
interface lists, enums and members, script-level `param()`, assignments
with command/type/method RHS, `foreach`/`for`/`while`/`do`/`switch` loops,
`try`/`catch`/`finally`, pipelines, `Import-Module`, `using` directives,
`#requires` directives, dot-sourcing, call-operator invocation, `[Type]::new()`
instantiation, static and object method calls, and property reads (which
intentionally produce no edges).

## The six questions, per emitted type

Established separately, because they fail independently. "Exists" is derived from
source and "Fires" from the census above; "Correct" is the differential's, and its
limitation is stated rather than glossed; "Labelled" is the pass-2 adversarial probe
per type; "Resolved" is the census's two resolution columns; "Confident" is the
confidence distribution, where anything below 0.7 is a heuristic under honesty
contract §4 and is counted as one.

Pass 1 answered questions 1, 2, 5 and 6 by counting. Pass 2 re-ran question 4
adversarially for all ten types and **found a defect in three of them** (PS25
`exports`, PS26 + PS28 `overrides`) plus a defect in a fourth channel the census
counts but does not label (PS27, method symbols). Question 3 is unchanged in kind
and re-measured; question 2 changed for one type, because `overrides` was
under-firing.

| Type | 1 Exists | 2 Fires | 3 Correct | 4 Labelled | 5 Resolved (corpus / intra) | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 67,344 | in the compared set | **HOLDS** — 73 edges name a reserved word; read at their own source line, 68 are member accesses on .NET objects whose method name is a keyword, 5 are the `Foreach` alias. 0 in command position name a word the language has ruled silent. Pass 3 added the file-level question and found an asymmetry, not a mislabel: 38 dot-source edges carry no `metadata.fileLevel` while 1,179 other edges in the lane do (PS32) | 60.66% / 8.23% | **55.38% under 0.7** (0.6:37,296 of 67,344) |
| `uses` | yes | 64,599 | in the compared set | **HOLDS** — a name READ rather than invoked; the composition channel the Contract mis-attributed to `references` is here, at 0.7–0.9, which is right for a read. Pass 3: 151 edges name a `function`/`class`/`enum`/`method` in their own file and **every one is a member read whose leaf collides with a declaration's name** — a collision against a control of 35,920 (PS35) | **92.87%** / 55.96% | 0 under 0.7 (0.7:3,564 / 0.8:27,140 / 0.9:33,895) |
| `contains` | yes | 21,750 | in the compared set | **HOLDS structurally, and the semantic half is now a NUMBER** — 0 self-edges, and 950 of 35,474 declaration sites sit inside a construct PowerShell scopes separately, so `contains` says "owns" where the language says the binding ended with the block. Not fixed, and the reason is a design decision the Contract already makes (PS31) | **99.87%** / 99.73% | 0 under 0.7 (all 1.0) |
| `imports` | yes (PS23) | 556 | **NOT audited** — DERIVATION finding, 556 edges compared against nothing | **QUALIFIED** — 361 `Import-Module`, 90 `#requires`, and **105 `using namespace`**, which is a NAMESPACE and not a module. `metadata.via` names the form on every row, so the type is self-describing, but the row's noun is right for 451 of 556 edges | 69.42% / 37.77% | 0 under 0.7 (all 0.9) |
| `references` | yes | 577 | in the compared set | **HOLDS** — the accounting closes exactly: 556 `import_sibling` + 21 `requires_version` + **0 other**. The Contract's composition claim measured 0 and the row is corrected | 68.98% / 36.40% | 0 under 0.7 (all 0.9) |
| `exports` | yes | 106 | in the compared set; **COMPARED WITH NO TRUTH on both differential lanes** (17 comparable, 0 truth; 8 comparable, 0 truth) | **WAS WRONG, now fixed (PS25, PS30)** — 7 of 113 edges published a wildcard pattern as a symbol name (0 do), and **106 of 106 rows named the COMMAND rather than the flag that published them** (0 do) | 98.11% / 95.28% | 0 under 0.7 (all 1.0) |
| `extends` | yes | 47 | in the compared set, **0 truth**, and **no oracle derivation exists** (see DERIVATION below) | **HOLDS** — the positional rule reads the shape the grammar produces: all `class_statement` headers on the corpus carry at least one `simple_name`, and the enumerated header shapes are the one the rule reads | 87.23% / 61.70% | 0 under 0.7 (all 1.0) |
| `implements` | yes | 3 | in the compared set, **0 truth**, and **no oracle derivation exists** | **HOLDS** — 3 edges, every one auditable; all three are a name after the first in a real header | 83.33% / 0.00% | 0 under 0.7 (all 0.85) |
| `overrides` | yes | 12 | in the compared set; **0 edges fell in either 60-file draw**, so the differential says nothing about it either way | **WAS WRONG twice, now fixed (PS26, PS28)** — the match published overrides of `hidden` and `static` members and across member kinds, and it MISSED 10 of 12 real pairs by resetting on redeclaration and comparing case-sensitively. **Pass 3 adds: the hop-2+ chain branch is UNTESTED, not correct** — 0 transitive pairs exist in the corpus (PS34) | 100.00% / 100.00% | 0 under 0.7 (all 0.9) |
| `instantiates` | yes | 1,227 | in the compared set; 60 edges land `unexplained` | **WAS WRONG, now fixed (PS29)** — 41 edges published a **variable** as a type name, because all three of `New-Object`'s readers produce text and none asked whether the text came from a `variable` node. The `[Type]::new()` route reads a type node and is untouched: its 80 same-name-as-a-variable rows are a type sharing a variable's name, and they are correct | **61.53%** / 15.97% | 0 under 0.7 (all 0.9) |

**Question 2 changed for one type, and the old number was an under-count.** Pass 1
recorded `overrides` at 2 edges. The parse-tree census of same-name derived/base
pairs found **8** in a single corpus file, and after PS28 the analyzer publishes
**12** there. A type that fires is not the same claim as a type that fires on every
construct that reaches it, and only the second one is worth anything.

**Question 3, and what the oracle cannot see.** The powershell oracle is
`derivePowershellEdges` in `script/m14/differential.ts:24297` (517 lines), which
shares no rule table, helper or classification set with the analyzer. The limitation
is stated rather than glossed: **it is a second walker over the same grammar**, so a
grammar-level bug present in both paths is invisible to it — and PS27 is exactly
such a bug, sitting in the wasm both paths read, so no oracle built on this grammar
could have caught it. That is the strongest single argument for the corpus-census
instrument over the differential, and it is why the ontology workstream exists.

**Question 4 for `contains`, SETTLED WITH A NUMBER rather than declared open.** Pass 2
recorded this as the largest open question on the lane's most trusted type: lexical
nesting is not ownership, and the probe had measured only the structural half. Pass 3's
P12 measures the rest. **950 of 35,474 declaration sites (2.78% of the 34,129-site
control) sit inside a `named_block` — `begin`, `process`, `end` or `dynamicparam` — which
PowerShell scopes separately**, plus 49 inside a `& { … }` child-scope invocation against
a 31-site same-scope control. The gap is real, it is sized, and it is not fixed, because
fixing it needs a synthetic scope symbol the Contract forbids. The full table is under
"PS31".

### DERIVATION findings: 1 by the gate's definition, 3 by the measurement — re-measured at HEAD, unchanged

**By `script/m60/rel-type-coverage-gate.ts` CHECK 1's own definition — an emitted type
absent from the language's audited set — the count is 1: `imports`.** The gate prints
`powershell 1 un-audited: ["imports"]`, and that is **re-measured at HEAD and unchanged**.
CHECKS 2, 3 and 4 are clean for this lane.

**By measurement, it is 3, and the gate cannot see two of them.**
`derivePowershellEdges` (`script/m14/differential.ts:24297-24813`, 517 lines) pushes
exactly seven labels — `contains` (9 sites), `uses` (5), `calls` (4), `instantiates` (2),
`exports` (2), `references` (1), `overrides` (1), by `push("…")` count over the function
body — and pushes **zero** `extends`, **zero** `implements`, **zero** `imports`.
PowerShell's audited set nevertheless contains 9 of the 10 types. So `extends` and
`implements` are **audited in name only**: declared comparable, with no derivation behind
the declaration, which is why the differential prints `COMPARED WITH NO TRUTH` for them
and why their edges land in `unexplained` as confidently as an invented edge would.

Pass 3 re-derived this by reading the oracle rather than trusting pass 2's count, and the
numbers are identical. **The lane's DERIVATION count did not change in pass 3, and no
type was added or removed from it.**

| Label | Edges | In the audited set | Oracle derivations | Verdict |
| --- | --- | --- | --- | --- |
| `imports` | 556 | **no** | 0 | DERIVATION, gate-visible |
| `extends` | 47 | yes | **0** | DERIVATION, gate-invisible |
| `implements` | 3 | yes | **0** | DERIVATION, gate-invisible |

**606 edges across 3 types are stored and compared against nothing.** The fix is
one derivation per label in `derivePowershellEdges`, which is shared machinery
(`script/m14/differential.ts`) and therefore a report item, not a lane edit.

## Verified limitations (named, never hidden)

The grammar is a **patched local rebuild**, not an upstream snapshot, so this list is
re-measured rather than inherited. It is written against the **pinned product wasm**
(`df867849…`, G10) replayed through `script/m60/powershell-0264-repro-battery.ts`, which
carries 15 controls specifically so that a limit cannot be "fixed" by breaking the
ordinary form of the same construct.

### Still broken on the product runtime — 5 of 34 battery cases, plus 2 found after the battery was written

| # | Limit | Construct | Errors | Cause |
| --- | --- | --- | --- | --- |
| 1 | `hash-in-interpolation` | `"$Repo#$PR"` | 1 | `#` in a variable NAME; the name class is `/[a-zA-Z0-9_]+\|\?/` |
| 2 | `ddash-quoted-interp` | `--git-dir="$RepoRoot/.git"` | 2 | **the wired wasm predates G10**, which is the patch for it — see below |
| 3 | `multiplier-suffix-case` | `$($_.Length/1KB)` | 1 | suffix listed lowercase-only, fatal in operand position |
| 4 | `invokation-path-slash` | `& $Destination/pwsh -x` | 2 | `path_command_name_token` allows `\` but not `/` |
| 5 | `invokation-path-slash-literal` | `& /usr/bin/pwsh` | 2 | same cause; fails with no variable involved |
| 6 | `class-member-name-split` (PS27, pass 2) | `[int] StaticOpen() { return 40 }` | 0, but the member is renamed | `caseInsensitive` (grammar.js:1839) emits no word boundary, so the `static` keyword token matches the first 6 characters of the identifier. **NOT in the battery** — adding it is finding 6 |
| 7 | `clean-block-unsupported` (PS33, pass 3) | `function f { clean { … } }` | 1, and **it consumes the NEXT declaration** | `clean` is not a `block_name` in the pinned wasm: the inventory is `begin`/`process`/`end`/`dynamicparam` in 12 spellings and no `clean`. **46 ERROR nodes across 3 corpus files.** **NOT in the battery** — same finding 6 |

**Limits 1, 3, 4 and 5 are already fixed in a candidate stack (G11+G12+G13) that is
safety-verified but NOT admitted.** Native A/B over the 691-file corpus: 0 clean files
changed, 0 newly broken, 5 newly clean. They are not admitted because F11 on
`web-tree-sitter@0.25.9` has not run — a wasm build needs load < 8 and the machine has
been at ~30. **Native safety is not product effect**, which is limit 2's lesson.

**Limit 2 was diagnosed wrong, and the correction matters more than the limit.** It
appeared to be a native/product runtime divergence. It is not: web-tree-sitter 0.27.0
produces output *identical* to 0.25.9 for this case. The real cause is that **the wired
wasm does not contain G10 at all** — the patch that addresses this construct — so the
limit is a build boundary, not a grammar gap. A behavioural probe
(`script/m60/powershell-patch-liveness.ts`) reports **8 of 9 claimed patches live and
G10 absent**, and exits non-zero. The pin record claims G10; the pin gate cannot see the
disagreement because this lane has no vendored-source entry, so its source↔wasm check
does not run. See `reviews/powershell/grammar-worklist.md`.

### Fixed, and no longer listed as limitations

`??` / `?.` null-coalescing and null-conditional (G5a/b, G5c), `?:` ternary (G5a/b),
bracketed generic type arguments `[[string], [PkgVer[]]]` (G9), script-level `param()`
after another statement (G1), bare-word command argument lists (G6), sigil-led paths as
command arguments (G7), and `+` as a nested-type separator (G8). G10 — a value glued to a
double-dash parameter — is **admitted but inert on the product runtime**; see limit 2.

### Corpus damage, measured

`script/m60/powershell-surface-measure.ts` over the production draw, re-run at this
commit: **49 files, 8 damaged (56 ERROR / 6 MISSING), 2,588 symbols, 12,051
relationships, line coverage 12,051/12,051, unknownTargets 0, dupKeys 0, reserved 0** —
against pass 1's 12,028, the difference being PS23's `imports` channel plus PS25–PS30.
`instantiates` is 78 on this draw and `imports` 20; the `absent` list is down to
`extends, implements, overrides`, which the draw excludes because it skips `test/` trees.
**This gate REWRITES `validation/m60/results/powershell-surface.json` as a side effect and
that file was restored rather than committed**, following pass 1's precedent for
§8-owned evidence: the numbers are reported here and in the commit message, and the
artifact is regenerated by whoever owns it.

The repo's own `test/` tree is the PowerShell parser/engine torture suite and
deliberately embeds invalid syntax as parser-error test data; those files are audited,
counted, and never hidden, and are excluded from strict acceptance. 62% of the residual
sampled differential disagreement came from exactly this set — model differences against
deliberately-invalid input, not analyzer defects.

## Evidence

Measured, with the instrument named. Every number below is re-derivable by the command or
file in its row; none is carried forward from a previous wave without one.

### Analyzer correctness

| Claim | Instrument | Result |
| --- | --- | --- |
| Fixtures | `validation/m14/fixtures/powershell/` | **23 pass / 0 fail** measured 2026-10-27 (`script/m14/run-fixtures.ts --lang powershell`). The ledger at PS-B20 read **17/17** (15 at pass 2, plus `new-object-variable-psb14` (PS29) and `export-flag-psb15` (PS30)); `ruled-extended-types.ps1` is the both-directions control for `renders`/`mixes_in`, and `static-call-psb22.ps1` is the qualified-target control for ordinary static calls. The runner is the count, not this sentence |
| Mutation coverage | `script/m60/powershell-mutants.ts`, **now reachable** | **65 of 65 caught, 0 survivors** measured 2026-10-27 (`BB_MUTANT_ONLY="powershell/" npx tsx script/m14/mutate-analyzer.ts`; a scoped run, so it writes no canonical evidence; log `validation/m14/fixtures/powershell/measurements/mutants-powershell-2026-10-27-green.txt`). The PS-B22 mutant (`static-call-target-source-spelling`) is caught by `static-call-psb22` plus two external fixtures. The four survivors the earlier same-day run reported (`contains-on-reassignment`, `here-string-interpolation-unread`, `assignment-read-pre-empts-new-object`, `assignment-read-reads-the-left`) are now caught after PS-B23: one was an ANALYZER defect (the dedicated here-string marker was pre-empted by the assignment reader in every fixture), and three were transforms that had gone inert against the current field names (`startLine` vs `range.startLine`, bare vs qualified targets). **This row is GREEN and the prior red row is superseded, not deleted** — the older text here said 55/55 because the set had grown to 63 without the row being re-measured |
| **The 5 pass-3 fixes, by SOURCE revert** | `validation/m14/fixtures/powershell/mutant-proof-psb14.sh` | **5/5 CAUGHT**, control clean, source restored byte-identical |
| The 6 pass-2 fixes, by SOURCE revert | `validation/m14/fixtures/powershell/mutant-proof-psb12.sh` | **6/6 CAUGHT** at pass 2; not re-run this pass, and the fixtures it depends on are among the 17 still passing |
| Ontology census | `validation/m14/fixtures/powershell/census.ts` | **10/10 types EMITTED** over 1,108/1,108 admitted files, **156,221 relationships** (156,225 before PS29/PS30). This is the census over the **ten registered types**; the lane's applicable set is now fourteen and the coverage gate reads **11/11 with 3 excluded** — see "PS-B20", whose population is the grown 1,181-file set |
| Census reproducibility | the same command, re-run at HEAD | **every pass-2 figure reproduced EXACTLY** — 10 edge counts, 10 `distinctFiles`, both resolution columns, both intra columns, the heuristic count, the missing-line count, and both histograms. The admitted set did not move either: the same 1,108 files from the same 20 repos |
| **Adversarial probes (pass 2)** | `validation/m14/fixtures/powershell/adversarial-probes.ts` | **11 probes**, 4 defects found; each carries its argument, instrument, count and overturn condition |
| **Adversarial probes (pass 3)** | `validation/m14/fixtures/powershell/pass3-probes.ts` | **7 probes**, 2 defects fixed, 1 declared-open question settled with a number, 1 fix declined with a number, 1 new grammar limit, and **3 of the probe's own readings corrected** (a false positive, a 3x over-count, and a duplicate object key) |
| Probe population assertion | the same file | `edgePopulationIsWholeAdmittedSet: true`, `treePopulationIsWholeAdmittedSet: true`, **0 shard failures of 10 and 10**. A run with a dead shard reports a lower bound and says so — the assertion caught a real WASM load race mid-measurement |
| Zero regex | `script/m60/powershell-zero-regex.ts` | **PASS** — 0 operations, 0 literals, 7/7 helpers |
| Relationship line numbers | `script/m60/powershell-surface-measure.ts` | **12,051 / 12,051 = 100%** |
| Standing rules, re-measured this pass | census, same population | 0 empty/unknown `SymbolKind`, 0 empty symbol names, 0 `unknown` endpoints, 0 types outside the ontology, 0 relationships missing a line |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | clean |
| Grammar limits (battery) | `script/m60/powershell-0264-repro-battery.ts` | 5 broken / 34 cases, **15/15 controls holding**. PS27 and PS33 are TWO MORE limits and neither is in the battery — see finding 6 |

**The revert proof is the load-bearing evidence for this pass, because three of the
four defects have a corpus delta of 0.** A fixture that nothing in the corpus can
reach is exactly the case a mutation gate exists for, and this lane's mutation gate
is inert (finding 2). So `mutant-proof-psb12.sh` reverts the SOURCE one hunk at a
time and requires the lane's own fixture suite to fail:

| Revert | Result |
| --- | --- |
| PS25 — `addExport`'s guard back to `startsWith("*")` | **CAUGHT** |
| PS26 — `memberOverrides` back to a bare name match | **CAUGHT** |
| PS27a — `memberHeaderFacts` stops rejoining a split name | **CAUGHT** |
| PS27b — `memberHeaderFacts` stops reading a post-type `class_attribute` as a modifier | **CAUGHT** (2 fixtures fail) |
| PS28a — `classMembers.set` on every `class_statement` | **CAUGHT** |
| PS28b — the `overrides` name match back to case-sensitive | **CAUGHT** |

The first version of that script had a wrong `cd`, so every python heredoc failed
with `FileNotFoundError`, the untouched suite passed, and the script printed
SURVIVED four times — then printed `RESTORE: byte-identical` on two **empty** hashes,
which compared equal. Both failure modes are now closed: the revert must land (a
`REVERTED` marker must be present in the source) or the result is reported as
meaningless, and the restore comparison refuses empty strings.

### Completeness (M14.0.SPEC)

`script/m14/spec/powershell-completeness.json` classifies every one of the **154 named
node types** (`validation/m14/measurements/powershell-grammar-nodes.json` reads
`namedTypes: 154`; the 152 this file carried was a miscount, and the number is now read off
the live registry rather than remembered); the gate reports **0 unclassified**. Its three
type buckets are **mutually disjoint**: **50 handled**, **86 internal-silent**, and **18**
classified by the **13 `design_decision` rows** — 50 + 86 + 18 = **154**, the arithmetic that
closes. The **8 recorded gap records** (10 node types, every one already inside the handled or
internal-silent bucket) are CLOSED defects, not a fourth bucket: all eight were fixed, each
with a fixture row and a mutant. An earlier draft of this file wrote "50 + 86 + 18 = 152,
classified exactly once", which was wrong in the total AND in the addends; the sentence is
kept here only to say so.

Sections A–D, G, H **pass**. Two sections do not, and the lane is not closed while they
do not:

- **Section E — `section-e-differential`:** no baseline floor row for
  `powershell:powershell`, and **the lane-scoped sweep has now been run to find out whether
  one can be pinned: it cannot, and the reason is a measurement rather than an absent
  cell.** Two lane-scoped sweeps on 2026-10-27 found a residual both times: an earlier
  draw measured `powershell:powershell` at **703 MISSING / 936 unexplained (22.2%)** over
  4,206 truth edges, and the post-PS-B22 draw measured **109 / 82 (1.5%)** over 6,012 — with
  `ansible:powershell` at **902 / 891 (17.1%)** and then **62 / 46 (0.8%)**. The draw is a
  rotating cold-pool sample, so neither pair is a delta; both are in the Differential
  section below. `mergeBaseline()` pins a lane only when `missing === 0 && unexplained === 0`
  (#871 §2, and it says so: pinning a lane that carries its own residual "would bake a real
  anomaly into the allowance"), so the writer REFUSES this lane by design. Pinning a
  residual of either size would not close the section, it would convert a red cell into a
  green one that has buried a measured wall — which is the exact failure the refusal exists
  to prevent. **What closing it needs is not a pin but a reconciliation:** in the latest run
  the 82 unexplained rows are `uses` 43, `contains` 16, `imports` 8, `references` 8 and
  `calls` 7, and the sampled MISSING rows are concentrated in one torture file
  (`TryCatch.Tests.ps1`) where the oracle derives `calls`/`part_of` rows whose targets are
  script-block TEXTS — a sample, not a census. A documented floor ruling (the `SOL-SCOPE`
  shape) would additionally need every disagreement adjudicated to `unclassifiable: 0` —
  which is a lane-sized campaign and not a transcription.
- **Section F — `section-f-perf-budget`:** no `avgMsPerFile` for
  `powershell:powershell`. The only figure that exists is **50.7 ms/file, measured at
  `loadAvg1` 39.42 on 8 cores with `loadAvgRetried: true`** — contention at 4–5× load, not
  a lane budget. (For calibration: the baseline's own `loadContext` reads 41.85 → 39.16,
  so its existing 182 rows were themselves pinned at ~5× load.)

Both sections stay red deliberately, and the full measurement is in
`validation/m14/results/powershell-lane-record.json` and in the 2026-10-27 run below. A red
section here is a statement the lane stands behind: for E it now means the residual was
MEASURED and cannot be pinned without burying it, and for F it means no honest perf figure
exists yet — either is cheaper than a green one that measures the machine.

### Differential

F5 is lane-scoped and **carries no pass claim.** Its 60-file cold-pool sample rotates
between runs, so cross-run deltas are invalid unless the file set is fixed — the
pass-1 fact hash and this pass's differ partly for that reason and partly because
the analyzer changed. Deterministic full-corpus fact hashes are the sound instrument
and are what the residual analysis used. A hand audit of the `New-Object` family
found and fixed a real defect this way in pass 1 (measured deterministically over 760
files: 66 files changed, +168 relationships), and the oracle's `$`-prefixed-target
bug was also fixed. The remaining sampled disagreement is dominated by the `test/`
torture suite described below.

Re-measured on the current analyzer, `--lang powershell --force-fresh`, 2 lanes:

| Lane | Files | tree-truth | covered | MISSING | analyzer edges | unexplained | heuristic | fact hash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `powershell:powershell` | 60 (rot 25) | 4,206 | 3,490 (83.0%) | 716 | 4,027 | 783 (19.4%) | 0 | `00d5982e5cf1f4c6` |
| `ansible:powershell` | 60 (rot 24) | 5,473 | 4,535 (82.9%) | 938 | 4,767 | 634 (13.3%) | 0 | `8ecb1c63e3d36758` |

**2026-10-27, the run that answered the section-E question — `--lang powershell`, no
`--force-fresh`, 2 lanes:**

| Lane | Files | tree-truth | covered | MISSING | analyzer edges | unexplained | heuristic | fact hash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `powershell:powershell` | 60 | 4,206 | **3,503 (83.3%)** | **703** | **4,217** | **936 (22.2%)** | 0 | `00d5982e5cf1f4c6` |
| `ansible:powershell` | 60 | 5,588 | **4,686 (83.9%)** | **902** | **5,213** | **891 (17.1%)** | 0 | `b316cd3dd025ab43` |

**The primary row is comparable with the table above and the second-corpus row is not.**
The file-set hash is IDENTICAL for `powershell:powershell` (`00d5982e5cf1f4c6`), so the two
measurements drew the same 60 files — and against that pinned set the numbers moved:
MISSING 716 → **703**, analyzer edges 4,027 → **4,217 (+190)**, covered 3,490 → **3,503
(+13)**, unexplained 783 → **936 (+153)**. `src/ast/real-powershell-analyzer.ts` was clean at
HEAD when that pair was measured and is no longer: PS-B22 changed the static-call target
spelling afterwards, and the re-run below is a new draw. So the older pair is kept as the
record of what was measured then, and it is not offered as a baseline for the new row. The
`.corpus` is not tracked, so a corpus change cannot be ruled out as part of the older delta
either; the honest statement is that it was a contradiction between two measurements at one
hash, not a rebase. The `ansible` hash DIFFERS (`b316cd3dd025ab43` vs `8ecb1c63e3d36758`), so
that row rotated and no delta is offered. Per-label unexplained, primary lane: `uses`
**806**, `contains` 47, `instantiates` 34, `references` 32, `exports` 17; ansible: `uses`
**760**, `references` 54, `contains` 43, `instantiates` 26, `exports` 8.

**2026-10-27, THE POST-PS-B22 RE-RUN — `--lang powershell`, no `--force-fresh`, 2 lanes:**

| Lane | Files | tree-truth | covered | MISSING | analyzer edges | unexplained | heuristic | fact hash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `powershell:powershell` | 60 (rot 8, corpus 546) | 6,012 | **5,903 (98.2%)** | **109** | **5,575** | **82 (1.5%)** | 1 | `dec20c26edab3af6` |
| `ansible:powershell` | 60 (rot 8, corpus 61) | 6,509 | **6,447 (99%)** | **62** | **5,938** | **46 (0.8%)** | 0 | `9ef5dc9f565f92e5` |

**Both hashes differ from every row above, so this is a CURRENT-STATE measurement, not a
delta.** The cold pool rotated (both lanes drew rotation 8) and the population is larger on
the ansible side; comparing these numbers with the 703/936 pair would compare two different
file sets. The post-fix analyzer is what it measures: the static-call target now resolves as
the store's qualified `Type.Member`, which is why the four-call controlled project reads its
two in-file static calls (`Counter.Add`, `Counter.Zero`) as resolved while the whole-arm
`calls` bucket moved +211 resolved (see the PS-B22 record). Per-label unexplained, primary lane: `uses` 43,
`contains` 16, `imports` 8, `references` 8, `calls` 7; ansible: `uses` 36, `references` 4,
`contains` 3, `calls` 2, `imports` 1. ALL TWELVE printed primary MISSING rows are from
`test/powershell/Language/Scripting/TryCatch.Tests.ps1`, where the oracle's derived
`calls`/`part_of` target is a SCRIPT BLOCK TEXT (`{ try { ... } ... }`) — the sample is
reported as it stands, not generalised into a cause.

`unexplained-by-label`, primary lane: `uses` 653, `contains` 47, `instantiates` 34,
`references` 32, `exports` 17. Ansible: `uses` 503, `references` 52, `contains` 45,
`instantiates` 26, `exports` 8. **`COMPARED WITH NO TRUTH` on both lanes:
`exports`** (17 comparable / 0 truth, and 8 / 0).

The post-PS-B22 row's unexplained list does not carry `exports` at all — its labels are
`uses` 43, `contains` 16, `imports` 8, `references` 8 and `calls` 7 — so the earlier 17 / 0
and 8 / 0 observation for `exports` is the only measurement of that label, and it is not
re-read as clean here.

**The 703/936 pair is not comparable with pass 1's and is not offered as a delta.**
The sample rotated (`rot 25` and `rot 24` against pass 1's set), and PS25 removed 7
`exports` edges and PS28 added 10 `overrides` edges. Pass 1's figures were
3,768/3,080/688/3,410/631 at hash `3009d2b23fc3da21` and
5,477/4,550/927/4,775/631 at `ef8e3ab571f6d703`; the document keeps them only as the
record of what was measured then. The honest instrument for a cross-run comparison
is a pinned file set, which a lane-scoped run does not give.

The run reports `M14.0.F5 NOT written` for a scoped invocation, by design: the
canonical artifact belongs to the 60-file 43-language sweep and writing a 2-lane
result here would replace that claim with a smaller one.

### Known gap carried deliberately

A PowerShell 5.0 `interface` has bodiless method signatures, so they are not
`class_method_definition` nodes and **an interface is declared with no members.** The
grammar has no node for `interface` at all; the analyzer declares the symbol from a `command`
named `interface` and does not publish it as a call. Recorded rather than papered over.

### Ontology-lane findings that need shared machinery

Six were reported at pass 2. **Two are FIXED at HEAD and were re-verified by reading the
shared source, not taken on the lane's word: findings 1 and 2.** The other four are open,
and pass 3 adds one of its own (finding 7). `script/m14/differential.ts`,
`script/m14/mutate-analyzer.ts`, `script/m14/run-fixtures.ts` and
`script/m14/ontology-coverage-gate.ts` are shared, and this lane owns
`src/ast/real-powershell-analyzer.ts` and this document.

0. **FIXED — finding 1, `meta.<key>: null` asserted nothing.** Pass 2 measured through the
   exported `matchConstraints` that a `meta.x: null` constraint resolved against the
   TOP-LEVEL key `actual["meta.x"]`, which never exists on a relationship, so the
   assertion was true for every analyzer. At HEAD the null branch reads
   `if (v === null && !k.startsWith("meta."))` (`script/m14/run-fixtures.ts:395`) and the
   comment above it credits this lane. The 16 inert rows across 6 lanes are live again.
1. **FIXED — finding 2, `script/m60/*-mutants.ts` was dead code.** At HEAD
   `script/m14/mutate-analyzer.ts:28` reads
   `import { POWERSHELL_MUTANTS } from "../m60/powershell-mutants"` and `:2429` spreads it
   into `MUTANTS`. Where pass 2 measured `matched 0 of 1521 — nothing was verified` and
   exit 3, a scoped run on 2026-10-27 reports **65 of 65 caught, 0 survivors** over a pool
   of 2,071 (the set had grown past the 55 the earlier text recorded; the first run of the
   day read 60/64 and PS-B23 names what changed). **This lane's mutation gate is live for
   the first time**, and it is what pins PS29 and PS30, neither of which moves an edge
   count. It is live and GREEN, and the four re-aimed transforms are part of that claim.
2. **OPEN — `script/m60/rel-type-coverage-gate.ts` writes its evidence on every run.**
   Running it unmodified rewrote `validation/m60/results/rel-type-coverage.json`
   (**+253 / −68 lines**) as a side effect, dropping other lanes' rows from the ledger
   view. That file was restored with `git checkout --` and **not committed**. The gate
   needs an `--out` or a `--check` mode that prints without writing, or the discipline has
   to be repeated by every lane that runs it. Pass 1 and pass 2 both hit this on other
   files; it is now the third occurrence on this lane.
3. **OPEN — the arbiter cannot report a lane that emits all ten types.**
   `script/m14/ontology-coverage-gate.ts` exits 2 with "no RULING TABLE for <lang>" when
   `RULED_BY_LANG[LANG] === undefined`, and the table is a hardcoded
   `const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED }`
   at line 192 with no per-language discovery. An empty table is the correct registration
   for a lane with zero RULED types — every row then resolves on the EMITTED branch — but
   registering it is an edit to a shared file. The one-line change is `powershell: []` in
   that record literal. This lane's ten-type table above was produced by running a copy of
   the gate with exactly that one change, in `/tmp`, with the real corpus admission and the
   real `parseFile`. **Unchanged at HEAD.**
4. **OPEN — 3 of the 10 types have no oracle, and the coverage gate can see only 1 of
   the 3.** `script/m60/rel-type-coverage-gate.ts` CHECK 1 prints
   `powershell 1 un-audited: ["imports"]` — correct, and incomplete.
   `derivePowershellEdges` (`script/m14/differential.ts:24297-24813`, 517 lines) pushes
   exactly seven labels — `contains` (9 `push` sites), `uses` (5), `calls` (4),
   `instantiates` (2), `exports` (2), `references` (1), `overrides` (1) — and pushes
   **zero** `extends`, **zero** `implements`, **zero** `imports`. PowerShell's audited set
   nevertheless contains 9 of the 10 types, so **`extends` (47 edges) and `implements` (3)
   are audited IN NAME ONLY**: declared comparable with no derivation behind the
   declaration. **606 edges across 3 types are stored and compared against nothing**, and
   pass 3 re-derived the seven-label count from the source rather than carrying pass 2's
   figure forward. The fix is one derivation per label in `derivePowershellEdges`
   (shared), and the gate fix is to compare the audited SET against the labels the oracle
   actually pushes rather than against a hand-maintained list, so an audited label with no
   derivation cannot read as covered. **Unchanged at HEAD.**
5. **OPEN — `script/m14/verify-doc-truth-emissions.ts` drops the first row of every claim
   table.** `parseClaimTable` skips the header with `if (i === chosen.at) continue`, skips
   the `---` rule with `if (isRuleRow(cs)) continue`, and then has a third guard —
   `if (!started) { started = true; continue }` at lines 465-467 — which consumes the
   **first body row** and never pushes it. Measured through the exported `parseClaimTable`
   on this lane's doc: the table at line 200 returns **9 rows for a 10-row table**, and
   the missing one is `calls` at line 202. The same gate reports
   `UNDOCUMENTED [python] calls` — python's first row — which is the same defect seen
   from another lane. **Every lane's first relationship claim is therefore invisible to
   the gate, so a FALSE claim in that cell would pass.** The fix is to delete the
   `!started` branch: `chosen.at` and `isRuleRow` already cover the two rows it was
   standing in for. This lane's ten-type table header was renamed from
   `| Type | Verdict |` to `| Relationship type | Emitted? |` so the gate can read it at
   all — before that it reported `NO_CLAIM_TABLE [powershell]`, which is the "no claim is
   checkable" bucket, and after it 9 of 10 cells are machine-checked and agree with the
   analyzer (0 FALSE_POSITIVE, 0 FALSE_NEGATIVE for powershell). The tenth is the gate's
   bug. **Still present at HEAD and re-measured in pass 3**: the gate's single powershell
   row is `UNDOCUMENTED [powershell] calls`, and `calls` is at
   `docs/analyzers/powershell.md:214` — the first body row of the table.
   Repo-wide the gate reads `48 analyzers, FALSE_NEGATIVE=7 FALSE_POSITIVE=0
   UNDOCUMENTED=41 MISSING_DOC=1 NO_CLAIM_TABLE=19 -> FAIL`; the other lanes'
   `UNDOCUMENTED` rows are bash, c and clojure's `calls`, which is the same defect seen
   from three more directions.
6. **OPEN — the grammar battery does not know about PS27 or PS33.**
   `script/m60/powershell-0264-repro-battery.ts` carries 34 cases and 15 controls, and
   none of them is a class member whose name begins `Static` or `Hidden`, nor a `clean`
   block — so the two defects passes 2 and 3 found were invisible to the battery that
   exists to enumerate the grammar's limits. The two cases to add are
   `[int] StaticOpen() { return 40 }` with a control of `static [int] StaticOpen() {…}`,
   which isolates PS27's trigger to the ABSENCE of a leading modifier, and
   `function f { clean { $z = 5 } }` with a control of the same function with `end {…}`,
   which shows PS33's ERROR consuming whatever follows. Fixing PS27 needs `caseInsensitive`
   (`grammars/tree-sitter-powershell/grammar.js:1839`) to emit a word boundary, a wasm
   rebuild, and a re-stamp of `validation/m14/grammar-pins.json` — a cross-lane registry,
   so not this lane's to edit. PS33 is the same shape of fix in the block-name tokens.
7. **NEW AT PASS 3 — a PowerShell module that publishes an alias cannot be written as a
   fixture at all.** `script/m14/run-fixtures.ts:1419` runs a global invariant on every
   fixture in every language: every export name must resolve to a **top-level symbol**,
   because the export list is the index's importable-unit set. PowerShell's `-Alias` and
   `-Cmdlet` flags publish names the file cannot declare — an alias is created by
   `New-Alias` at run time and a cmdlet comes from a module — so `export-flag-psb15` uses
   only `-Function` and `-Variable`. The first draft used all four flags and would have
   failed this lane's own gate **for stating a true fact**. The corpus carries 2 `-Alias`
   exports (`gfoo`, `gbar` in
   `PSScriptAnalyzer/Tests/Rules/TestManifest/ManifestBadAliasesWildcard.psm1`), so this
   is not hypothetical. The fix is for the invariant to carry a per-language exemption
   naming the flags whose targets are not importable units — and PS30 is what makes the
   exemption expressible, because `metadata.via` now says which flag published the name.

### Declared limitations of this lane's own coverage

Named rather than left blank, because PowerShell can express unbounded computation and an
empty limitations list would be a claim about the world rather than about a parser.

- **No dynamic resolution.** Module resolution, type resolution and cmdlet binding all
  happen at run time in PowerShell. `imports -> Foo` records that the source DEPENDS ON
  `Foo`, never that a file for `Foo` exists. Every resolution rate in the ten-type table is
  name-resolution against the sampled files' own symbol tables, which is a different
  question and the only one a static reader can answer.
- **`overrides` is name-matching against a base's declared member set, in one direction.**
  PowerShell class methods are virtual by default and there is no `override` keyword, so
  the lane cannot distinguish an intentional override from an accidental same-name member,
  and it cannot see an override of a member declared in another file. 12 edges over 1 file
  is the honest size of that population, not a small defect.
- **`extends` vs `implements` is positional, not semantic.** `: Base, IFoo, IBar` sends
  `Base` to `extends` and the rest to `implements`, and the language does not say which is
  which. `class C : Dictionary` is therefore published as `extends` even when `Dictionary`
  is a .NET class and `IFoo` is a class too.
- **`Export-ModuleMember -Function Measure*` publishes nothing, and a consumer wanting
  the exported SET has to expand the pattern itself.** Since PS25 the analyzer refuses
  any wildcard target, so the graph carries the NAMES a module publishes and never a
  pattern. **This row previously read "`-Function *` publishes the literal `*`", which
  was false in both directions** — the code refused `*` and published `Measure*`, and a
  controlled probe through `parseFile` reads `-Function *` as publishing nothing. The
  consequence of the fix is a real limitation and is stated as one: a module that
  publishes its whole surface by wildcard is now invisible in the `exports` channel,
  and 7 of 113 corpus edges were that case.
- **`overrides` cannot see a base class declared in another file, and cannot see a
  member whose name the wasm split.** Both are the same limitation from two sides. The
  first is stated below; the second is new: PS27 rejoins a name the lexer split, so the
  NAMING half is recovered, but when the split destroys the member outright
  (`[int] Hidden2()`, `[int] Static()`) there is no node to read and no edge is
  published for a method that exists in the source. The known limit of the mitigation
  is also declared: `[int] static Foo()` — a modifier after the type on a METHOD — is
  structurally identical to the split shape and would be read as a name prefix. The
  corpus carries 0 instances of it.
- **`overrides` now fires MORE, and every recovered edge is in code PowerShell refuses
  to run.** All 12 `overrides` edges are in one Pester file that redeclares `A`, `B`,
  `C`, `bar` and `baz` across ~40 `It` blocks. PowerShell rejects a duplicate class
  definition at run time ("Cannot define class X because the name is already in use"),
  so the file is a parse-error fixture. The edges are correct about the parse tree and
  describe code that will not execute. A corpus of PowerShell that redeclares classes in
  one file is rare outside test suites, so this type's measured population should be
  read as "what test code exercises", and its count will not grow on production code
  the way `calls` and `uses` do.
- **`contains` says lexical nesting, and lexical nesting is not ownership — MEASURED at
  2.78%, not fixed.** Pass 2 declared this UNSETTLED; pass 3 measured it. A local declared
  inside a `begin` / `process` / `end` / `dynamicparam` block is lexically inside the
  function but its binding ended with the block, and PowerShell runs each of those in its
  own scope. **950 of 35,474 declaration sites (against a 34,129-site control) sit inside
  one**, plus 49 inside a `& { … }` child-scope invocation against a 31-site `. { … }`
  same-scope control. The structural half holds (0 self-edges). It is **not fixed**, and
  the reason is a decision rather than an omission: attributing a declaration to its block
  requires a SYMBOL for that block, and the Contract states that no synthetic scope symbol
  is ever emitted. A fix would introduce exactly that synthetic scope, for 2.78% of
  declaration sites, and would cost `contains` the 99.87% resolution that makes it the
  lane's most trusted type. Read `contains` as **lexical nesting**, not ownership.
- **`instantiates` can no longer see a type name held in a variable, and that is a real
  loss.** Since PS29 a `New-Object $type` publishes `uses -> type`, not
  `instantiates -> type`, because the edge would assert the variable is a type. So the
  construction is no longer in the `instantiates` channel at all: a consumer asking "what
  does this file construct" sees the read of the variable and must resolve it to learn
  the type. **41 corpus edges are in this state**, all `New-Object` with a variable
  argument. The alternative — publishing the edge and marking it low-confidence — would
  put a name in the graph that no symbol can have, which is the fabrication rule.
- **`New-Object '$literalType'` publishes a target carrying a `$` sigil.**
  `unquoteTarget` strips quotes but not a sigil, so a single-quoted argument that is not
  a variable reaches `instantiates -> $literalType`, which names nothing. It is pinned as
  an `instantiates` row in `new-object-variable-psb14` with the residue named in its
  comment, and it is **0 on the admitted corpus** (P14 measures
  `targetsBeginningWithADollarSigil: 0` over 1,227 edges). The reader that should strip
  the sigil is the invocation-operator one, which this fix does not touch.
- **`overrides`' hop-2+ chain branch has never run on real code.** The resolution loop
  walks up to 8 hops and breaks at the first match, which is right, but the corpus has
  **0 classes at depth 3 or more and 0 transitive pairs** (26 classes resolve in-file, 22
  at depth 1 and 4 at depth 2). The branch is correct by reading and unexercised by
  measurement, and those are different statements.
- **A dot-sourced file dependency does not reach the store's file-level surfaces.** `.`
  `./lib.ps1` publishes a `calls` edge with no `metadata.fileLevel`, and
  `src/ast/parallel-indexer.ts:3481` keys the file-level seam on exactly that key, so no
  file-level surface can answer "what does this file include" for a PowerShell
  dot-source. **38 edges**, against 1,179 edges elsewhere in the lane that do carry it.
  Not fixed: **37 of the 38 targets are `$`-interpolated paths** that name no file, and
  the fix would add 37 unresolvable `imports[]` rows to serve 1 literal path.
- **The pinned grammar has no `clean` block, and 3 corpus files lose declarations to it.**
  `clean` is not a `block_name` in the pinned wasm (the inventory is `begin`, `process`,
  `end`, `dynamicparam` in 12 spellings) and the ERROR it leaves is not local — on a
  controlled input it consumes the NEXT function declaration. **46 ERROR nodes across 3
  files** in the corpus. Reported, not fixed: it needs a grammar change and a wasm
  rebuild.
- **PowerShell classes have no cross-file inheritance read.** A base class in another
  module is not in the file's parse tree, so `overrides` against it, and `extends` to it,
  are not derivable per file. `imports` is the only channel that carries that dependency,
  and it carries the module NAME rather than a member map.
- **188 of 1,108 admitted files carry parse errors** (worst:
  `kubernetes/cluster/gce/windows/k8s-node-setup.psm1` at 50 ERROR nodes). The counts in
  the ten-type table include whatever the analyzer recovered from those regions; 62% of the
  sampled differential disagreement comes from that set, which is the `powershell` repo's
  own `test/` tree embedding invalid syntax as parser-error test data.
- **One file in the corpus kills the parser rather than erroring.**
  `fsharp/eng/release/scripts/GetAssemblyVersions.ps1` reports
  `[BB-PARSE-ERR] memory access out of bounds` — a WASM out-of-bounds in the pinned
  grammar, not a recoverable ERROR node. The census shards and re-runs without it, and
  this admission run reports 0 excluded because the engine returned a result; the earlier
  single-process census run died on it.
- **`calls` at 0.6 is 23.87% of the lane's relationships.** Those 37,296 edges are
  heuristics under honesty contract §4, not facts. They are counted as such in the six
  questions table rather than averaged into the type's confidence. They are also the
  only heuristic class in the lane, and they are concentrated in bare command names,
  where 0.6 is honest: PowerShell resolves a command name at run time against the
  session's PATH, its function table and its aliases, so a static reader cannot do
  better than a name match.
- **The corpus GREW between passes and every count moved.** 1,092 -> 1,108 admitted
  files (`boundary` 4, `terragrunt` 7, `packer` 4, `nomad` 1, one more `scala3`). A
  number copied from the pass-1 commit does not describe the corpus as it stands, which
  is why every count in this document is restated from a run at this commit and why the
  restated pre-fix figures are given alongside. Percentage columns moved by at most
  0.11 points, which is the evidence that the growth was additive rather than a change
  of population.
- **84.8% of the admitted corpus is test code** (926 of the 1,092 pass-1 admitted files
  sit under a `test/` or `Tests/` path: 503 under `powershell/test/`, 247 under
  `PSScriptAnalyzer/Tests/`; on 1,108 admitted files the shape is unchanged).
  Real-world distribution is therefore skewed toward test code, which is where the
  `test/`-only defect classes (`extends`/`implements`/`overrides`) live — those three
  types' entire measured population is inside that tree, and their resolution and count
  figures should be read as "what test code exercises", not "what production code
  contains".

### Documentation note

The "Regex census: 0 powershell usages" row this section used to carry was **false twice
over and has been removed**: there is no powershell regex census instrument, and the real
count was 8, not 0. The Regex inventory section above already said so; the Evidence
section contradicted it. The live claim is the gated one — `script/m60/powershell-zero-regex.ts`
— which counts the analyzer's own source and fails if a regex returns.

## PS38 (append-only record, 2026-10-09) — the incoming side: the arbiter's key, the ambiguity column, and `overrides`

This section is APPENDED rather than woven in, because every number above it was measured at a
different revision and rewriting them would destroy the comparison. The lane's incoming column
was the worst unresolved-to-edge ratio in the fleet; this is what it was, what moved, and what
was RULED rather than chased.

### 1. `isExternalTarget` — the claim was published under a key the arbiter does not read

`script/m14/incoming-gate.ts powershell ps1 60`, before PS38:

```
VERDICT: FAIL — 1192 ambiguous + 5877 unresolved of 9911 edges
totals: resolved 2842 · ambiguousByDecl 1192 · unresolved 5877 · markedExternal 0
```

1,938 of those 5,877 already carried this analyzer's PS-B16 externality reading
(`externalTarget` + `externalVia`). The gate takes a claim from an EXPLICIT list
(`EXTERNAL_KEYS`, `script/m14/incoming-rule.ts`) and `externalTarget` is not in it, so all
1,938 arrived unmarked — and an unmarked external is indistinguishable at the gate from a
broken edge. PS38 emits `isExternalTarget: true` (in the list; the same claim word for word)
on the edges the existing reading marks: `declaredInFile(target)` and `externalReadingOf` are
unchanged and **not one edge is added**.

It is NOT published on every marked edge, and that restriction is the measured half. The
arbiter asks about the TARGET ITSELF when the target has no dotted owner, and about the OWNER
— a string the edge does not name — when it has one. Corpus-wide, 82 marked edges were
REFUTED, every one with a BARE owner, zero with a qualified one:

| target | arbiter owner | answering declaration |
|---|---|---|
| `Text.UTF8Encoding` (`[Text.UTF8Encoding]::new()`) | `Text` | Grace/scripts/capture-artifact-size.ps1:115 |
| `powershell.exe`, `cmd.exe`, `whoami.exe` | `powershell`, `cmd`, `whoami` | unrelated names in the same repos |
| `3.0` (`#requires -Version 3.0`) | `3` | a symbol named `3` |
| `Test.User32::GetPlacement` | `Test` | `class Test`, Scripting.Classes.BasicParsing.Tests.ps1:508 (the type itself is created by `Add-Type -Name User32 -Namespace Test`, ConsoleHost.Tests.ps1:1012) |

So the readable key is published only where the arbiter asks about the target itself or about
an owner that is ITSELF QUALIFIED (`System.IO` in `System.IO.Path.Combine`). The withheld
edges keep `externalTarget`/`externalVia` exactly as before; nothing claims less than it did.

After (`powershell ps1 60`, analyzer digest `52392fbdd74156f2`):

```
VERDICT: FAIL — 1192 ambiguous + 3988 unresolved of 9911 edges; 1711 external claim(s)
         unverifiable (178 verified + 1711 unverifiable external)     [externalRefuted = 0]
```

Whole corpus (978 `.ps1` files, 160,306 edges, census `--nf 60 --all`):

```
unresolved 75,964 -> 50,558     26,773 edges carry the key
  2,296 verified · 23,110 unverifiable · 0 REFUTED · 1,367 the project answers (mark inert)
  payload +642,552 B (1.815% of the lane's relationship JSON)
```

Artifacts: `validation/m14/fixtures/powershell/measurements/` — `incoming-gate-ps1-60-before.json`,
`incoming-gate-ps1-60-after-narrowed.json`, `incoming-split-ps1-60-all-{before,after-narrowed}.json`.
The census re-measures the gate's own numbers exactly (`COMPARE … AGREE`), because it imports
the rule rather than copying it. Pinned by `externality-arbiter-psb17` (19/19 powershell
fixtures pass): every positive row has a negative twin of the same shape, including the
withheld broad-owner row.

### 2. The 1,192 ambiguous — RULED irreducible, with the split

`validation/m14/fixtures/powershell/incoming-split.mts --nf 60 --all`, 219 distinct names
behind the 1,192 edges:

| bucket | edges | why it cannot move |
|---|---|---|
| `multiFile` | 927 (77.8%) | the colliding declarations are in DIFFERENT files of one repo; PowerShell binds a bare name at RUN time (dot-source, caller scope, module exports), and no field an edge can carry names which file is meant. `$expected` is declared 9 times across 6 files of one repo. |
| `oneFileDiffOwner` | 142 | one file, different owner scopes |
| `oneFileSameOwnerDiffKind` | 123 | one file, one owner, the name published under two KINDS (kind signatures: `variable` 546, `property\|variable` 323, `property` 297, `class\|property` 22, `constructor` 4) — a variable and a hashtable key of one spelling are different symbols |
| `oneFileSameOwnerSameKind` | 0 | — |

The only conceivable repair (the 123 kind-distinct groups, 10.3%) would require the analyzer to
stop publishing one of two distinct symbols — changing SYMBOL identity to move a resolution
metric. Corpus-wide the same walk reads 48,866 ambiguous of 160,306 (30.5%), so the sample is
not an outlier. Ruled in `script/m14/spec/powershell-completeness.json` PSD9.

### 3. `overrides` — SILENT in the stride, EMITTED on the corpus

The firing instrument's default stride (120 files of the corpus) reads
`8 types fired — implements overrides SILENT`. That is a SAMPLING ARTIFACT, and the whole-corpus
measurement says so in two independent instruments:

* `npx tsx validation/m14/fixtures/powershell/pass3-probes.ts --only P15` over all 1,181
  admitted files: **273 class declarations** (chain depth 0:247, 1:22, 2:4), **26 with a base
  clause declared in the same file**, **12 hop-1 derived/base member pairs**, **12 of 12
  published**, 0 transitive pairs;
* `NFILES=1000 bun script/m14/firing-check.mjs POWERSHELL` — the whole admitted population, no
  stride: **10 types fired**, `overrides:12`, `implements:3`, nothing silent.

All 12 `overrides` edges come from ONE file,
`powershell/test/powershell/Language/Classes/scripting.Classes.inheritance.tests.ps1` (13 corpus
files carry a base clause at all), which is why an even stride keeps missing them: 400 files
went on missing it after 120 did. The hop-2+ branch of the chain walk and
derived-property-over-base-property remain UNEXERCISED (0 sites each) and P15 reports them as
untested rather than correct. No analyzer change was made for this type. Ruled in PSD8.

### 4. What was NOT marked, and why

The re-spelling leaves 3,988 unresolved. The obvious widening — mark the 2,104 command-position
`calls` edges carrying `noDeclarationInFile` — measures well (2,099 would verify, 5 unverifiable,
0 refuted) and is REJECTED: `noDeclarationInFile` is a fact about the emitting FILE, and this
lane's own docstring rules it non-actionable ("a `$local` no file declares and a cmdlet are
indistinguishable under it, and only the second is external by construction"). The class has no
shape evidence (`dotnet`, `WriteLine`, `Describe`, `It`, `Should`), and 74 of its 2,102 edges
name a declaration the same repository publishes, which the analyzer cannot see from one file.
Ruled in PSD10 with the gain recorded (unresolved would fall to ~1,884) so a later round can
take it deliberately rather than by accident.

## #419 completeness inventory (2026-10-17) — the reading

The lane's config was already present; this round measured it and closed one spec-shape defect.
`bun run script/m14/completeness-inventory.ts --lang powershell` reads **6 of 8 sections**:

```
pass  A  154 types, 50 handled, 86 silent, 8 gaps, 13 decisions
pass  B  11 kinds pinned, the same 11 emitted — all accounted for
pass  C  complexity payload row
pass  D  4 tiers: import_based · inferred · structural · usage_contextual
FAIL  E  no baseline floor row for powershell:powershell
FAIL  F  no avgMsPerFile for powershell:powershell
pass  G  this doc + the analyzer head comment
pass  H  M14.CC1.json, 12 checks
```

**B WAS FAILING WHEN THIS SECTION WAS FIRST WRITTEN, AND THE READING ABOVE IS THE REPAIR.**
The contract row listed ten kinds while the analyzer published eleven: `part_of` joined the
lane with the dot-source relabel (PSD12, 38 edges over 37 files) and the powershell entry in
`script/m14/completeness-inventory.ts` was never updated, so section B's reverse check —
"EMITTED but absent from requiredKinds" — reported real drift, not a missing construct.
`part_of` is in that row now, pinned by
`validation/m14/fixtures/powershell/part-of-dot-source-psb19`, and B passes. The `13 decisions`
in section A are the 13 `design_decision` rows, which carry 18 node types between them: that
18 is what closes 50 + 86 + 18 = 154.

**E/F are one absent baseline cell, and the cell is absent because the lane's own measurement
is not pinnable — checked by running it on 2026-10-27, twice: 703 MISSING / 936 unexplained
on the pre-PS-B22 draw and 109 / 82 on the post-PS-B22 draw (the harness refuses a nonzero
pin by design, see the Differential section). Until that residual is reconciled, a green E
would be a transformed red, not a closed one.**
`script/m14/differential.ts` already
carries and wires `derivePowershellEdges` (`:23812-23819`, M60 #278 F5), and `:24083` records powershell
being joined to the calls/uses/contains/exports/references audited set so the oracle's truth edges are
not dropped before comparison. The `powershell:powershell` row (`<repo>:<lang>`) is what a baseline
sweep supplies; the baseline's existing `powershell:javascript`, `powershell:c`, … rows are the OTHER
analyzers over the powershell corpus.

**The spec-shape audit** (the four shapes the fleet keeps finding) is clean: `handled_verified.types` and
`internal_silent.types` are string arrays (50 / 86), `design_decision.decisions` exists (13, carrying 18 node types), and
`gaps[].node_type` holds type names, not prose. Coverage is real: **154 wasm types, 154 classified, 0
unclassified, 0 stale**, of which 18 are classified by the 13 decision rows.

**One defect fixed.** PSD7-PSD10 carried PROSE in `node_type` (`"relationship metadata: …"`,
`"relationship:overrides (…)"`), a field the inventory gate comma-splits into its classified-type set —
the same shape as lua's sentence-valued `gaps[].node_type`, one bucket over. Harmless only because all
154 types were already covered, and fixed anyway: the four `node_type` fields were removed while the
rulings remain intact in each record's `question`/`resolution`, and the spec records the removal in
`_spec_shape_2026_10_17`. Section A is unchanged after the edit. Full record:
`validation/m14/verification/POWERSHELL-STATE.md`.

---

## PS-B18 (append-only record, 2026-10-20) — the relative-path escape, and the SECOND refuted claim

**THE RULE, AND WHY IT IS NOT A RULE ABOUT SPELLINGS.** A dot-sourced path is a PROJECT FILE
reference, not an external target. The 2026-10-19 form of the rule read "a relative path ending in
`.ps1`"; the ARBITER asks a different question — "is this path one of the PROJECT's admitted files?"
(`pathTargetInProject`, `script/m14/incoming-rule.ts`) — and the two disagreed on three axes, each
MEASURED:

- **THE EXTENSION.** The gate admits `powershell: "ps1,psm1,psd1"` (`incoming-gate.ts:134`) and
  `pathTargetInProject` matches the admitted list by SUFFIX, so the extension is irrelevant to the
  arbiter and decisive to the rule. Population census by the arbiter's own match (1,181 files /
  30 repos): **47** distinct target spellings name an admitted project file — **26** `.ps1`,
  **13** `.psm1`, **8** `.psd1`.
- **THE SEPARATOR.** The old rule required one; the arbiter's suffix match does not — a bare
  `Helper.psm1` matches any admitted file with that basename.
- **THE ABSOLUTE CASE.** `/usr/lib/x.ps1` and `C:\x.ps1` were WITHHELD — a TRUE claim thrown away,
  because the gate's project facts are REPO-RELATIVE (`path.relative(repoRoot, abs)`,
  `incoming-gate.ts:577`) and no admitted path can answer an absolute norm.

**THE SECOND REFUTED CLAIM.** `powershell/test/powershell/Modules/Microsoft.PowerShell.Security/
FileCatalog.Tests.ps1:365` and `:366` publish `uses -> DSCResources\UserConfigProviderModVersion1\
UserConfigProviderModVersion1.psm1` with `externalTarget: true`, and that file IS in the project; the
arbiter's own `verifyExternalClaim` answers `externalRefuted` on both. The lane's `extFAIL` column
read 0 anyway, because PS38 withholds the arbiter-readable key on a bare owner and `externalTarget`
is not in `EXTERNAL_KEYS` — **the false claim was published AND INVISIBLE.**

**THE RULE AS IT NOW STANDS.** Withhold the externality reading when the target ends in one of the
lane's ADMITTED spellings (`.ps1`, `.psm1`, `.psd1`) AND its spelling is a RELATIVE path — not
`/unix-rooted`, not `C:\drive`, not a URI scheme. This is the bash lane's rule ("withheld for all
non-absolute paths now, kept only for /unix-rooted and C:\ drive", RESOLUTION-LEDGER) applied to
powershell's own admitted spellings.

**THE CLASS, NAMED.** THE ESCAPE WAS WRITTEN FROM A SPELLING RATHER THAN FROM THE ARBITER'S
QUESTION, and a spelling-keyed answer to a project-keyed question hides in BOTH directions: it
publishes false claims and discards true ones.

**PINS.** Fixture `powershell/relative-path-psb18` — 9 path rows, the production shape (a
CONSTANT-KEY ELEMENT ACCESS, published UNQUOTED), **8 of the 9 FLIP** between the 2026-10-19 rule and
this one, and the 9th is a control that does not. Two mutants, both CAUGHT, each failing only that
fixture: `relative-path-psb18-escape-narrowed` (the 2026-10-19 rule VERBATIM) and
`relative-path-psb18-escape-widened`. Arms, the row-level reconciliation and the wall dispositions:
`validation/m14/verification/POWERSHELL-VERDICT-2026-10-20.md`.

## PS-B20 (append-only record, 2026-10-27) — `renders` and `mixes_in` RULED, and the lane reads 11/11

**Population for every number below:** the whole admitted set — **1,181**
`.ps1`/`.psm1`/`.psd1` files over **30** repositories, per-repo `git ls-files`,
≤ 512 KiB (this lane's census cap), routed by `detectLanguageFromPath`. Instrument:
`script/m14/powershell-extended-census.ts`; artifact:
`validation/m14/measurements/powershell-extended-census.json`. Its **control
PASSED**, and the claim is narrowed to what the control covers: every counter THIS RULING
READS trips on a synthetic site before any corpus number is reported — and the
command-qualified role split is pinned in BOTH directions (`memberNameArgs` 3 and
`hostArgs` 2, asserted, not merely non-zero) — so a zero below is a measured zero rather
than a probe that never ran. The artifact's administrative counters (the file counts, the
per-shape maps, the non-attachment bucket) are NOT tripped by the control and are not read
as evidence; an earlier version of this paragraph said "every counter" and that was false
about ten of them.
Both types are recorded in `script/m14/spec/powershell-completeness.json`
(`coverage.excluded`), which is what the coverage gate reads.

### `renders` — RULED (ontological), 0 sites

The vocabulary's relation is *a component renders another component*: source =
the rendering symbol, target = the rendered **component**, and the host renderer
constructs the element. Three facts settle it here:

| fact | measured |
| --- | --- |
| component symbol kinds in the vocabulary | **0 of 32** `SymbolKind` values (read from `src/ast/types.ts` by the instrument) |
| `ConvertTo-Html` (objects → HTML text) | **15** sites, 1 file |
| `Out-GridView` / `Show-Command` / `XamlReader` | **0 / 0 / 1** mention |

`ConvertTo-Html` is a **serializer**: it turns an object into text. `Out-GridView`
and `Show-Command` display *data*, not a component. `[Windows.Markup.XamlReader]::Parse`
constructs UI from XAML **text**, so what it renders is a document, not a
component a source declaration names. All of them are **already published as
`calls`** at their own sites — the true relation, and not a relation to relabel.

**Falsifier:** a site where a declaration renders a component and the target is a
declared component symbol — **0** over 1,181 files. (Four of the fifteen sites name
a declaration anywhere in their own arguments; every one is the **object being
serialized**, which is a `uses`/`calls` fact.) **Ladder:** R1 unavailable (the
served grammar's 154 distinct named types carry no render/component/view node);
R2 unavailable (a patch would have to invent a component model and a host
renderer — PowerShell's rendering surfaces are .NET types and cmdlets invoked at
runtime, not declaration syntax); R3 unavailable (no node type carries a
component→component relation).

### `mixes_in` — RULED (ontological), 0 sites

`mixes_in` is the fleet's **member-set composition**: implementation attached to a
type with **no conformance declared** (go struct embedding, zig `usingnamespace`,
dart `with`, scss `@include`, elixir `use`). PowerShell has exactly **one**
declaration-level composition construct — the class base list — and it **is**
conformance, already published:

| construct | sites | published as |
| --- | --- | --- |
| class statements | 273 | `contains` |
| class base-list entries | **50** | `extends` (first name) / `implements` (rest) |
| `Add-Member` | 127 | `calls` |
| `Add-Type` | 172 | `calls` |
| `Update-TypeData` / `Update-FormatData` | 17 / 10 | `calls` |

The runtime family is the impostor — and it is **not one construct, so it is not one
number**. Splitting it was not tidiness: the first version summed all 326 sites into
one "member attachment" bucket and tallied `-Value`, `-MemberName` and `-Name`
arguments as one "member set", which made 232 arguments against 326 sites and put
the `-Name` hits inside the member-set number.

| bucket | sites | is it member attachment? |
| --- | --- | --- |
| `Add-Member` + `Update-TypeData` | **144** (in 34 files) | **yes** — the construct the ruling is about |
| `Add-Type` | 172 | no — it **compiles a source string** |
| `Update-FormatData` | 10 | no — a display **view** |

The falsifier reads the `-Value`/`-NotePropertyValue` **argument** of a member
attachment. Over the 144: **121 member-set arguments, 0 of them a named
declaration** — script block 25, string literal 49, array-literal value expression
33, bare value token 14 (the 14 are listed verbatim in the artifact: `$value`,
`$module.ExportedAliases.Keys`, `$null`, `(Get-ExpectedComputerInfoValue $propertyName)`,
a literal `something`, `Length`). **23 attachments supply no `-Value` at all**, and
they are listed rather than inferred — 18 parameter-shape and error tests in
`Add-Member.Tests.ps1` (`-Name` alone, `-MemberType` alone, `-InputObject`,
`-PassThru`), an `Update-TypeData -AppendPath`, a bare `-PassThru`, an
`Update-TypeData` naming only serialization parameters, and two commands with no
arguments. `121 + 23 = 144` closes exactly, and no `-NotePropertyMembers` hashtable
form occurs anywhere in the population.

**One** member-name argument in the whole family is declaration-shaped, and `-Name` is not
the member-set parameter:

- `Add-Member -Name Build` (`kubernetes/cluster/gce/windows/k8s-node-setup.psm1:146`) — a member **name** that collides with a function declared in the same module. It is listed by file and line in `memberNameDeclaredSites` in the artifact, and a name is not a set.

`Add-Type -Name` is the last role error the artifact carried: it names the **type the
compilation creates** — a HOST, whose members `-TypeDefinition` supplies — so the population's
18 `Add-Type -Name` arguments are counted with its 18 `-TypeName` ones, for **36 host arguments
of which 22 name no corpus declaration**. Two of them (`-Name TestClass`,
`powershell/test/powershell/engine/Api/GetMethodInfoOverloadDefinition.Tests.ps1:7,14`) name a
class the corpus does declare. Keying the role table on the bare parameter had put those two
into the member-name tally, where they read as member sets naming a declaration; the table is
now keyed on (command, parameter) and the control asserts the split.

**Ladder:** R1 unavailable (no mixin/trait/composition node in the served grammar);
R2 unavailable (a patch would have to invent member-set composition; PowerShell's
answer to reuse is single inheritance plus interfaces, and the runtime glue is cmdlet
invocation); R3 unavailable (the candidates that could be misread are the 144 member
attachments, whose 121 member-set arguments are inline and name no declaration).

### Pins

Fixture `powershell/ruled-extended-types` contains, in one file, every shape a
wrong rule would fire on: a class base list (`extends` + `implements` fire), a
param-block function calling a declared function, `ConvertTo-Html` **and**
`[Windows.Markup.XamlReader]::Parse` (both published as `calls`, **forbidden** as
`renders`), and `Add-Member` **and** `Update-TypeData` (both published as `calls`,
**forbidden** as `mixes_in`). `expectRelationshipCount` pins **0** `renders`,
**0** `mixes_in`, and **exactly 1** `extends` / **1** `implements` — the last two
stop a rule that reads every base-list entry as a superclass. Suite:
**23 pass / 0 fail** (`bun run script/m14/run-fixtures.ts --lang powershell`).

## PS-B22 (append-only record, 2026-10-27) — a static member call targets `Type.Member`, not `Type::Member`

**THE DEFECT IS A TARGET SPELLING THAT NO STORED SYMBOL CAN HAVE.** `[Counter]::Add(1, 2)`
published `calls -> Counter::Add`. A class method is stored with `name = "Add"` and
`qualifiedName = "Counter.Add"`; `Counter::Add` is neither, so the arbiter's exact-key
lookup — which indexes a symbol under BOTH its name and its qualified name — can never
bind the row. The edge is a real call, the member is declared in the same file, and the
graph could not see the connection. The externality pass then made it worse: `declaredInFile`
folds BARE names, so `Counter::Add` was "not declared here" and collected the lane's
external reading — a **false external claim** about a project-local call.

**MEASURED, WHOLE ADMITTED POPULATION** (1,183 `.ps1`/`.psm1`/`.psd1` files, the parse tree
and production `parseFile`):

| | count |
| --- | --- |
| static member call sites (`[T]::M(...)`, `M != new`) | **3,458** |
| …whose type is a class the EMITTING FILE declares | **254** |
| …of those, whose member that class really declares | **219** |
| …of those, whose member the class does NOT declare (inherited .NET member) | **35** |
| …whose type is itself dotted (BCL/namespace) | 1,830 |

**THE FIX.** The target is `${typeName}.${memberName}` — the store's own qualified-name
separator, the spelling the variable-read retarget pass already uses (`Get-Targets.index`).
`metadata.staticType` keeps the type recoverable without splitting the target. The `::`
spelling remains in the SOURCE and in comments; it is never a target.

**TWO CONTROLS, BOTH DIRECTIONS.**

1. `[System.Math]::Max(1, 2)` becomes `System.Math.Max`: still no declaration, still an
   external row. The change moves the project-local rows into resolution and leaves the
   BCL rows where they were.
2. `[Counter]::ReferenceEquals(1, 2)` — the owner is in-file, the member is not. The generic
   external reading would ask the arbiter about `Counter`, find it, and **REFUTE** the claim.
   The row now carries the fleet's `ownerMemberAbsent` claim (`{owner: "Counter",
   member: "ReferenceEquals"}`), which the project's own member map VERIFIES. The gate's
   owner-member check now accepts the qualified spelling `owner.member` as well as the bare
   member, because PowerShell must publish the qualified target; a target qualified by a
   DIFFERENT owner is still refuted, and the gate's self-test pins both.

**MEASURED ON A CONTROLLED PROJECT** (`validation/m14/fixtures/powershell/static-call-psb22.ps1`;
`incoming-gate.ts --json powershell ps1 0`). The FINAL control carries four calls: two in-file
(`Counter.Add`, `Counter.Zero`), the inherited member and the BCL twin:

| | calls edges | resolved | markedExternal | externalVerified | externalUnverified | externalRefuted |
| --- | --- | --- | --- | --- | --- | --- |
| before, 3-call probe | 3 | 0 | 1 | 0 | **1** | 0 |
| after, 4-call control | **4** | **2** (`Counter.Add`, `Counter.Zero`) | 2 | **2** (`ownerMemberAbsent` + BCL) | **0** | **0** |

The two unresolved rows left in the control are `uses` of the class method's parameters —
the adjacent shape below, refused rather than half-fixed.

**THE ADJACENT SHAPE, MEASURED AND REFUSED.** A class method's parameters are not
declarations today. Declaring them in the method's frame — the obvious fix — is WRONG, and
a two-method twin proves it:

```powershell
class Twice {
    [int] First([int] $x)  { return $x }
    [int] Second([int] $x) { return $x + 1 }
}
```

The frame's owner is the CLASS (PS3), and `declareSymbol` dedupes on (owner, name, kind),
so the second `$x` is silently dropped and BOTH reads bind to `First`'s parameter — a wrong
declaration, which is worse than the unresolved row it replaced. The correct unit is
method-qualified ownership (`Twice.Second.x`) plus a retarget pass that reads it; PS3 keeps
the edge SOURCE as the method's bare name (`Second`) so `bb_graph Second` works, so a
class-qualified scope is invisible to today's visibility rule. Class-method LOCALS have the
same collision (two methods' `$sum` are one class-owned symbol). That is a lane-sized change
and it is recorded, not half-done. Function parameters are unaffected — a function frame's
owner IS the function, so its parameters are already unique (PS-B21).

**PINS.** `validation/m14/fixtures/powershell/static-call-psb22.ps1` fires
`Counter.Add`, `Counter.Zero`, the `ownerMemberAbsent` shape on `Counter.ReferenceEquals`
and the BCL twin `System.Math.Max`; its FORBID rows name `Counter::Add`, `Counter::Zero`
and `System.Math::Max`, so a revert to the old spelling goes red in every direction, and a
fourth negative forbids the generic external key on the in-file owner. Suite:
**23 pass / 0 fail**. The external-claim fixtures whose static targets were spelled with
`::` (`externality-arbiter-psb17`, `ruled-extended-types`) were re-pinned to the dot
spelling; their source-syntax comments are unchanged.

## PS-B23 (append-only record, 2026-10-27) — the four surviving mutants, and the analyzer defect one of them found

**THE MUTATION GATE WAS LIVE AND NOT GREEN.** The first full scoped run this day reported
`60 of 64 caught, 4 survivors`. All four survivors were `0 -> 0`: the transforms had gone
inert against the shape the harness actually sees, and one of them was masking a real
analyzer bug. This section records each cause and what now pins it.

**1. `here-string-interpolation-unread` — AN ANALYZER DEFECT, not a fixture gap.**
`expandable_here_string_literal` publishes its reads with `isHereStringInterpolation` so
the construct is independently revertible. Measured over every powershell fixture through
production `parseFile`: **0 of 115 `uses` edges carried the marker.** The reads existed; the
marker did not. `emitAssignmentReads` (PS36) and the command-argument reader both descend
into the here-string BEFORE the switch reaches its dedicated case, so the first row won
`addRel`'s source|type|target|line dedupe and the later, marked row was discarded. On
`variable-reads-psa4` the two here-string reads were published as plain `isAssignmentRead`
rows — the right edges with the wrong reason, which is why the fixture passed and the
mutant could not fail.

The fix is two stops, one per pass: `emitVariableReads` does not descend into an
expandable here-string unless it was called FOR that node with its own marker, and
`emitAssignmentReads` stops at it exactly as it stops at a `command`. Edge count is
unchanged; the two rows now carry `isHereStringInterpolation`, and line 36 additionally
carries `isBracedVariable`, both asserted in `variable-reads-psa4.expectation.json`. The
mutant was already correct and now fails 1 fixture.

**2. `contains-on-reassignment` — a transform keyed on fields that do not exist.** It read
`s.line ?? s.range?.start?.line` and compared `x.target` to the BARE symbol name. Neither
is in the published result: a symbol's line is `startLine` and a `uses` target is the
store-qualified `file.name`. It therefore emitted no extra containment edge on any fixture.
Re-aimed to read both shapes (native `range.startLine` and normalized `startLine`), match
qualification by suffix, and take the edge SOURCE off the symbol's own `contains` edge.
Caught by `reserved-words-psb4`'s `contains -> value == 1` row (`$value = 1` then
`$value = $(…)` adds a second site) and by `externality-arbiter-psb17`.

**3. `assignment-read-pre-empts-new-object` — the transform was aimed at the wrong key.**
It required `isArgumentReference` on an assignment line. The rows the defect costs are the
dedicated `New-Object` reads, which carry `viaNewObject` / `isDynamicTypeName` and NO
`isArgumentReference`; and its symbol filter read `kind === "Variable"` and `s.line`, while
the native symbol is `kind: "variable"` with `range.startLine`. Two independent reasons for
a no-op. Re-aimed to strip `viaNewObject` + `isDynamicTypeName` from a `uses` row on an
assignment line and stamp `isAssignmentRead` instead — the measured pre-fix shape. Caught
by `new-object-variable-psb14`'s four positive rows, which assert both keys.

**4. `assignment-read-reads-the-left` — the direction was wrong for what the transform can
observe.** The defect ADDS a fabricated edge (a read of the variable the assignment is
defining); the transform tried to MUTATE an existing row whose target equalled a bare
symbol name on the same line, a predicate that can never be true when targets are
qualified. Rewritten to add the edge the pre-fix bug added: a `uses` from the variable's
owner to its qualified name, on its declaration line, wherever an assignment's RHS was
also read. Pinned in two ways — `new-object-variable-psb14` now FORBIDS `uses -> New-Dynamic.a`
at line 29 and `uses -> New-Dynamic.d` at line 45 (the positional and interpolated
readers), and the fixture's `uses == 12` count is the aggregate backstop.

**RESULT.** `BB_MUTANT_ONLY="powershell/"` reports **65 of 65 caught, 0 survivors** over
2,071 mutants; log
`validation/m14/fixtures/powershell/measurements/mutants-powershell-2026-10-27-green.txt`.
The lesson recorded for other lanes: a `0 -> 0` survivor is not proof the fixture is weak.
Three of these four were instrument bugs, and the fourth was a real analyzer defect the
instrument could not see. Reading the transform against the shape `runLang` passes is the
step that separates the two.

## PS-B24 (append-only record, 2026-10-27) — a numeric dotted chain is not a member read

**THE DEFECT WAS FOUND BY THE INCOMING GATE'S REFUTED-CLAIM WORKLIST, NOT BY A FIXTURE.**
A whole-population run (`incoming-gate.ts --json powershell ps1 0`) reported 85 external
claims the project REFUTES. Three of them were `uses` edges whose targets were `2.3`, `3.4`
and `1.2`, all from `PSScriptAnalyzer/Tests/Rules/InvalidMultiDotValue.tests.ps1`:

```powershell
$1.2.3.4
$intKeys.1.2.3.4
```

The grammar hands each numeric run to the `member_access` case as a `member_name`, and
`emitMemberUses` published the leaf verbatim. `isPlausibleSymbolName` does not reject them:
it permits digits and dots because a DECLARED name may contain both. So the graph named
symbols no project can declare — and because the rows carried `externalTarget`/`externalVia`,
the arbiter looked them up and the project's own declaration table refuted the claim.

**THE FIX IS ONE PREDICATE, AT THE LEAF.** A member leaf must contain at least one letter
or underscore; anything else (a numeric run, a bare dot) is a parse shape, not a name. The
receiver is unchanged — it is still not published, per the family leaf contract (R2/M60 R10)
— so a numeric chain now publishes nothing at all rather than three fabrications.

**PINS.** `member-reads-psb5` gained form 7 (both spellings) and three `forbidRelationships`
rows for `2.3`, `3.4` and `1.2`; its `uses == 6` count would become 9 on a re-add. The new
mutant `powershell/member-numeric-leaf-published` re-derives the pre-fix rows from the
source text and is CAUGHT by that fixture (`0 -> 1`). Suite: **23 pass / 0 fail**. Mutation:
**65 of 65 caught, 0 survivors** over 2,071.

**WHAT REMAINS, STATED RATHER THAN IMPLIED.** The re-run after this fix reads **82** refuted
claims, not 85, and they are NOT one class:

- **19 `calls`** to native executables (`whoami.exe`, `powershell.exe`, `ping.exe`, …). A project
  file or function carries the same spelling, so the owner lookup refutes the external mark.
- **37 `instantiates`** to .NET type spellings (`Text.UTF8Encoding`, `Diagnostics.ProcessStartInfo`,
  and two fixture types `Foo.Bar` / `MyTest.Root`). The arbiter asks about the OWNER (`Text`,
  `Diagnostics`), not the member, and a project declaration can carry that bare name.
- **22 `uses`** of `[Language.VariableExpressionAst]`-style type spellings, same owner-only rule.
- **4 `references -> 3.0`** from `#Requires -Version 3.0`: a deliberate version constraint the
  lane publishes with `requiresVersion` (and `imports-psb12` pins). A version is not a symbol the
  project can declare, but the arbiter's generic external rule does not know that claim kind.

All four are the owner-only heuristic's coarseness on qualified external targets, or a claim kind
the shared arbiter does not recognise. They are a different defect class from this one and are
recorded with their counts rather than folded into this fix.

## PS-B27 (append-only record, 2026-10-28) — a .NET type literal claims a NAMESPACE, not an owner; and a literal is not a name

**FOUND BY THE GATE'S REFUTED-CLAIM WORKLIST, over the whole admitted population, after the depth
pass landed.** `BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts powershell ps1,psm1,psd1 0 --index --json`
read **113** refuted claims on 197,028 edges. One shape dominated: `instantiates Text.UTF8Encoding`
from `[Text.UTF8Encoding]::new($false)` (Grace/scripts).

**WHY THEY WERE FALSE.** The analyzer published `externalTarget: true`, and the arbiter verifies that
claim by asking about the target's OWNER — everything before the LAST dot, so `Text`. The project
publishes a **variable** named `Text`, so the owner lookup answered "the project declares that name"
and refuted a claim about a .NET type. No file declares a TYPE named `Text`, and PowerShell classes
cannot nest, so no project type can be spelled `Text.UTF8Encoding` at all. The refutation was a name
collision, not a fact about the dependency; the same class is the lane's own W2 ruling.

**THE FIX IS THE CLAIM, NOT THE READING.** A bracketed type literal's root is resolved by the ENGINE:
`[Text.UTF8Encoding]` is `System.Text.UTF8Encoding` under PowerShell's documented implicit-`System.`
rule. So the row now claims the **LIST** — `languageNamespace: ["Text"]`, whose evidence a reviewer
diffs entry by entry and whose verification never asks about a name the edge does not carry (the
fleet's own `NAMESPACE_CLAIM_KEY`, which cannot raise `resolved`). The table it is checked against
(`DOTNET_SYSTEM_NAMESPACES`) is the framework's **documented direct children of `System`**, so a root
it does not carry keeps the old reading. Two further parts:

- **`instantiates` joined the namespace pass.** The pass read `uses`/`calls` only, and the whole
  `.NET`-constructor population is `instantiates` — the one type that had no list claim was the one
  carrying the targets that needed it. The claim certifies a ROOT, not an edge kind.
- **A target with no ASCII letter is not a name.** `#Requires -Version 5.1` publishes
  `references -> 5.1` with `requiresVersion: true` (pinned by `imports-psb12`); the qualified reading
  fired on it because a version separator is a dot, and the arbiter then asked about `5` — the MAJOR
  VERSION. 25 rows (13 refuted + 12 verified) carried that reading. The EDGE STAYS and
  `noDeclarationInFile` still publishes; only the externality READING is withheld.

**MEASURED.** Same population, same 1,181 files / 30 repos, **197,028 edges**, **101,352 resolved**,
**17,762 ambiguous**, **49,207 unresolved** (was 48,952: the 255 literal rows keep their edges and lose
only the claim). Refuted claims **113 → 60**, every one re-attributed by
`validation/m14/fixtures/powershell/refutation-row-probe.mts`, which reproduces the gate's own number
row by row (`REFUTED: 60`, by claim kind `owner` 47 + `sourcePath` 13):

| shape | rows | why the arbiter still refutes it |
|---|---:|---|
| `Language.*` type literals under `using namespace System.Management.Automation` | 22 | the root is a namespace reached through the FILE'S OWN `using namespace`; the table carries `System`'s children, not every imported namespace's |
| `whoami.exe`, `powershell.exe`, `cmd.exe`, … | 20 | a real executable invocation; the arbiter's owner (`whoami`) is answered by a VARIABLE of that spelling |
| `$PSScriptRoot/../build.psm1` path claims | 13 | the claim is TRUE-shaped but the traversal lands on a file the project ADMITS, so the row is a resolution gap the analyzer cannot close from one file |
| `Foo.Bar`, `MyTest.Root`, `TestHost.TestHost` | 3 | types created at runtime by `Add-Type`; the owner is answered by an unrelated declaration |
| `'pr.number'` (a QUOTED property key) | 2 | the target is a quoted literal, not a type path |

**All 60 are the arbiter's owner question being asked about a name the edge does not carry** (or a
claim kind it does not model); the lane-side fixes that remain possible are the `using namespace`
list and a quoted-literal provenance check, and both are recorded here rather than taken, because
each needs its own measurement. The structural fix — an `owner` claim refutable only by a
declaration that could BE an owner (a TYPE) — is **the shared instrument's**, and it is filed with a
patch rather than taken (`validation/m14/verification/POWERSHELL-DEPTH-PASS-2026-10-28.md` §4).

**PINS.** New fixture `dotnet-shorthand-psb27` (4 positive rows, 3 negative twins: an uncarried root
`Foo.Bar`, a letter-bearing command that keeps both keys, and a withhold row for the bare owner).
Two new mutants — `powershell/dotnet-shorthand-root-unclaimed` and
`powershell/letterless-target-marked` — both CAUGHT: **67 of 67 caught, 0 survivors**
(`BB_MUTANT_ONLY="powershell/" npx tsx script/m14/mutate-analyzer.ts`). Suite **25 pass / 0 fail**.
Zero-regex PASS (0 operations / 0 literals). Spec-shape audit PASS (152 named types).

## PS-B28 (append-only record, 2026-10-28) — a numeric index is not a dependency, and the 2,377 "resolutions" it produced were FALSE BINDINGS

**THE DEFECT WAS PUBLISHED DELIBERATELY, WITH A DEFENCE THAT THE MEASUREMENT DOES NOT SUPPORT.**
PS-B10 emitted `uses -> <digits>` for `$tags[0]`, carrying `metadata.isNumericIndex: true`, on the
argument that *"a numeric index is a read of an ELEMENT, not of a name: there is no symbol to point
at, so the honest record is the site itself."* The row does not record a site — it records a
**dependency on a symbol named `0`**, and every consumer that reads `target` sees exactly that.

**MEASURED over the whole admitted population: 3,734 such rows, and 3,731 of them were still there
when this record was written.** The reframing — PS-B24's sentence, applied to the element access —
is that a target no declaration can have is a fabrication, and the name model will bind it to
whatever it finds. What it found:

```
repo          numeric sites   target declared in the project
powershell         3,100              3,039          (target "0" alone: 1,819 rows)
ansible              268                266
PSScriptAnalyzer     407                 54
```

The `powershell` repository declares **exactly one** symbol named `0` — a hashtable PROPERTY
(`Parsing.Tests.ps1`) — so 1,819 array indices in unrelated files bound to that one property. **Those
are not resolutions, they are the arbitrary-pick class the gate reports separately for `contains`.**

**THE FIX REMOVES THE ROW.** The `element_access` case keeps its two real branches — the STRING KEY
(`$h['Retries']`, a name in the hashtable sense) and the VARIABLE KEY (`$a[$i]`, a read of `$i`) —
and publishes nothing for an integer or real index. A graph that wants "who indexes" needs a SITE
record, which is not a relationship between symbols and must not be spelled as one.

**MEASURED, same population, A/B by analyzer digest:**

| column | before PS-B28 | after |
|---|---:|---:|
| edges | 197,028 | **193,297** |
| resolved | 101,352 | **98,975** |
| ambiguous(decl) | 17,762 | **17,030** |
| unresolved | 49,207 | **48,585** |
| extOK / ext? / extFAIL | 25,285 / 3,362 / 60 | **25,285 / 3,362 / 60** |

**THE RESOLVED COUNT FALLS BY 2,377, AND THAT IS THE POINT**: 2,377 of the removed rows were bound
to a declaration that provably could not be their target (the single property named `0` above, plus
its siblings `1`/`2`/…). The verified-class RATE moves 51.44% → 51.20%, and the honest reading of that
number is that a *false* resolution was counted as a success while it was being published. The WALL
(ambiguous + unresolved) falls 66,969 → **65,615**, and no claim, no external bucket and no `contains`
row is touched.

**PINS.** `data-shapes-psb10` loses its `uses -> 0` expectation row and gains a `forbidRelationships`
row for it; the string-key and variable-key rows in the SAME fixture are the controls, so a rule that
silenced the whole element-access branch fails them. New mutant
`powershell/numeric-index-published` re-derives the pre-fix rows from the source text and is CAUGHT
by that forbid row: **68 of 68 caught, 0 survivors**. Suite **25 pass / 0 fail**, `tsc` 0.

## PSD10 (append-only record, 2026-10-28) — the command-position reading, and the 28,597 rows of wall it names

**THE GAP WAS THE LANE'S OWN, RECORDED AS "NOT DONE" AND NOW MEASURED.** The externality reading was
SHAPE-based: a Verb-Noun spelling (`Get-ChildItem`) or a qualifier byte (`System.IO.Path`,
`./build.psm1`). Both are correct tests for *"this name cannot be a local declaration"*, and both are
silent on a bare command name — `git`, `cd`, `mkdir`, `dotnet`. The spec's own note called the
widening "the obvious one" and left it undone, because an earlier measurement of **3,680** names
another file declares looked like a refutation price.

**IT IS NOT A PRICE, AND THE ARBITER'S RULE IS WHY.** `externalTarget` is published only where THIS
file declares no symbol of that spelling (`declaredInFile`, the guard this pass has always had), and
`classifyEdge` reaches `verifyExternalClaim` **inside `decls === 0`**. Where the project declares the
name, the row keeps its declaration answer: `resolved`, or ambiguous with disposition
`ownFileSilent`, which the arbiter reports and does **not** count as a refutation.

The split, measured over the whole admitted population before wiring:

```
bare command-position rows      36,916
  name nothing project-wide     34,158   <- the rows that had no claim and no resolution
  declared once elsewhere        1,899   <- never reached: the claim is not consulted
  declared many                    859   <- never reached
```

**WHAT CHANGED.** A `calls` row emitted from a `command` node, or from an invocation operator with a
bare name, now carries `externalVia: "command"` — the CHANNEL is the fact, not the spelling. Three
shapes are refused by construction: a member call's leaf (`methodCall: true`), a static member call
(handled by `ownerMemberAbsent`), and everything the three existing refusals withhold (a quoted
literal, a relative script path, a scope prefix the file can declare into). The first run of the
change proved the last of those is load-bearing: `& .\lib\Helper.psm1` collected
`externalVia: "command"` through a `??` fallback that could not tell "no shape fired" from "this
shape is deliberately refused", and `relative-path-psb18` went red.

**MEASURED, same population, A/B by analyzer digest:**

| column | before PSD10 | after |
|---|---:|---:|
| edges | 193,297 | **193,297** |
| resolved | 98,975 | **98,975** |
| ambiguous(decl) | 17,030 | **17,030** |
| unresolved | 48,585 | **19,988** |
| markedExternal | 28,707 | **57,304** |
| extOK | 25,285 | **53,882** |
| ext? | 3,362 | **3,362** |
| **extFAIL** | 60 | **60** |

**+28,597 rows moved out of `unresolved` and into a claim the project verifies, and NOT ONE row moved
in the other direction**: no resolution lost, no ambiguity created, no refutation added. The clause-1
gap reads **37,018** (was 66,969 at the start of this campaign).

**PINS.** New fixture `command-position-psd10`: three positives (`git`, `cd`, `whoami`), three twins
(the same bare spelling declared in-file, a member call's leaf, and PS-B18's withheld relative path),
plus a `forbidRelationships` row on each twin. Two new mutants, both CAUGHT — one that drops the
reading and one that extends it to member calls: **70 of 70 caught, 0 survivors**. Suite **26 pass /
0 fail**, `tsc` 0.

## PSD11 (append-only record, 2026-10-28) — `$env:NAME` is a NAMESPACE root, and the 855 claims no check could reach

**THE CLAIM WAS TRUE AND UNCHECKABLE, WHICH IS A CLAUSE-1 DEBT IN ITS OWN RIGHT.** PSD10's table ends
with `ext? 3,362` — rows carrying a marker that the arbiter cannot turn into a verdict. 855 of them
were ONE shape: an environment-provider read (`$env:PSModulePath`, `$env:TEMP`, `$env:GRACE_TOKEN`;
220 admitted files, 159 of `PSModulePath` alone). The analyzer had always refused to call it a project
name — `RUNTIME_TABLE_SCOPE_PREFIXES` keeps the qualified external reading on `env:`/`variable:`/`using:`
because the runtime binds them from outside the parse — but it published only the GENERIC marker, and
`verifyExternalClaim` refuses an owner that is not identifier-shaped. `env:TEMP` carries a colon, so the
verdict was UNVERIFIABLE and stayed there.

**THE FACT IS NOT DOUBTFUL AT ALL.** PowerShell's Environment provider is part of the engine: the
prefix is case-insensitive, `$Env:TEMP` and `$ENV:TEMP` are the same binding, and no admitted file can
declare a symbol spelled `env:Something` — a scope-qualified name is never a declaration (PS8's rule,
unchanged since the first wave). The namespace claim is the fleet's kind for exactly this statement:
the LIST is the evidence, the root is matched by segment, and the claim can never raise `resolved`.

**THE ROOT IS CARRIED AS WRITTEN, AND THAT IS THE WHOLE CORRECTNESS ARGUMENT.**
`namespaceMatchOf` compares the target's own first SEGMENT against the list **byte for byte**, so a
list folded to `["env"]` REFUTES `$ENV:TEMP`. Measured directly against the arbiter before writing the
pass: `namespaceMatchOf("ENV:TEMP", ["env"]) === null` · `namespaceMatchOf("ENV:TEMP", ["ENV"]) === "ENV"`.
Folding case looks like normalisation and is a false claim — it would have converted 855 unverifiable
rows into as many refuted ones, which is worse than the debt it repairs. The list therefore carries
`env`/`ENV`/`Env` as the source spells it, which is also PS-B27's standing convention for every list
root (`System`, `Text`).

**MEASURED, same population (1,181 files / 30 repos), same arbiter, A/B by analyzer digest:**

| column | before PSD11 | after |
|---|---:|---:|
| edges | 193,297 | **193,297** |
| resolved | 98,975 | **98,975** |
| ambiguous(decl) | 17,030 | **17,030** |
| unresolved | 19,988 | **19,988** |
| extOK | 53,882 | **54,737** |
| **ext?** | **3,362** | **2,507** |
| **extFAIL** | 60 | **60** |

**+855 rows left the unverifiable column, and nothing else moved in either direction**: no resolution
gained (a claim may not buy one), none lost, no ambiguity created, no refutation added. The
before-arm was taken in a hard-linked copy of the tree with only this analyzer file replaced by
`git show HEAD:…`, so both arms ran the same arbiter and the same corpus.

**PINS.** New fixture `env-provider-psd11`: two positives (`$env:PSModulePath`, `$ENV:TEMP` — the
second is the case row), two negative twins (`$envLocal`, a plain variable whose name merely starts
with the same three letters; and `global:Helper`, a scope prefix the project CAN declare into), and
four `forbidRelationships` rows — the folded list on `ENV:TEMP` (the refutation twin), the claim on the
project binding, the claim on `global:`, and a claim on a cmdlet leaf. Two new mutants, both CAUGHT:
one drops the list (claim-loss) and one folds it (false-claim). Suite **27 pass / 0 fail**;
`tsc` 0; zero-regex **0 operations / 0 literals**.

**WHAT IS LEFT IN `ext?`, NAMED.** The remaining 2,507 rows are **2,256 `ownerMemberAbsent` + 251
`owner`** — and the first of those is the lane's own claim emitted where the owner is not a project
type at all (`string.IsNullOrWhiteSpace`, `IO.Path.Combine`, `powershell.Create`,
`Ansible.Basic.AnsibleModule.Create`), which the arbiter can only answer UNVERIFIED. That class is the
next target, not this one's.

## PSD12 (append-only record, 2026-10-28) — a static call names the TYPE it reaches, and 2,172 claims become checkable

**THE LARGEST CLAIM DEBT IN THE LANE WAS A TARGET SPELLING, NOT A MISSING CLAIM.** PSD11's table ends
with `ext? 2,507`; **2,256 of those were `ownerMemberAbsent`** — a claim that says *"the owner is
published and the member is not"*, emitted on static member calls whose owner the project does not
publish at all (`string.IsNullOrWhiteSpace`, `IO.Path.Combine`, `powershell.Create`,
`Ansible.Basic.AnsibleModule.Create`). The arbiter can only answer UNVERIFIED, and it is right to: the
claim is false in its own terms.

**THE ROWS NAMED THE WRITTEN SPELLING INSTEAD OF THE TYPE.** `[string]::IsNullOrWhiteSpace($x)` IS
`System.String.IsNullOrWhiteSpace`; `[guid]::NewGuid()` is `System.Guid.NewGuid`. Three mechanisms,
each measured on its own, fix the name:

| mechanism | rows | what it does |
|---|---:|---|
| **type-accelerator table** | 1,134 | a documented alias (`string`, `guid`, `regex`, `wmi`, …) or a framework type the resolver reaches (`Convert`, `Math`, `Environment`, `Tuple`, `[powershell]`, …) is published under its **documented namespace-qualified name**, so the existing namespace claim certifies the root (`System`) |
| **dotted-owner split** | 1,038 | `IO.Path.Combine` keeps its spelling and takes the GENERIC externality claim: no published symbol can be keyed by a dotted name (class names cannot contain `.`; variables/functions/parameters are stored bare), so the question is answerable and the project answers it by finding nothing |
| **declared-spelling rewrite** | 6 resolved | `[counter]::Zero()` calls `class Counter`'s method — PowerShell identifiers are case-insensitive — so the target is built from the DECLARATION (`Counter.Zero`), which is the store's qualified name |

**THE TABLES ARE CLOSED AND CITED.** `RESOLVED_FRAMEWORK_TYPES` carries the documented type-accelerator
list plus the implicit-`System.` / loaded-assembly types this population names, each mapped to a type
whose namespace-qualified name the .NET documentation states. A literal the table does not carry is left
EXACTLY as it was — `[Path]`, `[File]`, `[Directory]`, `[Process]` have no documented resolution
(`System.Path` does not exist and the assembly search can answer more than one type of that name), and
project/test types (`[MyCSMU]`, `[NullStringTest]`) are not framework names at all. 83 rows remain in
that residual, named below.

**MEASURED, same population (1,181 files / 30 repos), same arbiter, A/B by analyzer digest:**

| column | PSD11 | PSD12 |
|---|---:|---:|
| edges | 193,297 | **193,297** |
| resolved | 98,975 | **98,981** |
| ambiguous(decl) | 17,030 | **17,030** |
| unresolved | 19,988 | **19,983** |
| extOK | 54,737 | **56,909** |
| **ext?** | **2,507** | **334** |
| **extFAIL** | 60 | **60** |

**+2,172 rows entered the verified column (1,134 + 1,038), SIX rows resolved, ONE row left `ext?` for a
resolution, and NOT ONE refutation was added.** The six resolutions come from the declared-spelling
rewrite: five from `unresolved` and one out of the claim column (`[foo]::Bar2()` in powershell's own
`Scripting.Classes.BasicParsing.Tests.ps1:127`). The clause-1 sum falls **39,585 → 37,407**.

**A DEFECT FOUND WHILE WRITING THE NEGATIVE TWIN.** The in-file class check was an EXACT key read
(`classMembers.get("Regex")`), so `[counter]::Add()` missed `class Counter` — PowerShell's class lookup is
case-insensitive, so the MISS was the analyzer's. It mattered twice: the row lost its in-file member
check, and PSD12's table could have shadowed a class the file declares. The lookup is folded now, and the
fixture's row 3 (`class Regex` vs `[Regex]::Pattern()`) is the pin.

**PINS.** New fixture `type-accelerator-psd12`: two resolved-target positives, the shadow twin, the
undocumented-resolution twin (`[Path]`), the dotted twin (`[IO.Path]`), and the declared-spelling twin
(`[counter]::Zero()`), plus four forbid rows (the pre-fix spelling, an invented `System.Path.Combine`,
the accelerator shadowing a declared class, and the two claim shapes on one row). `externality-arbiter-psb17`
had its BCL static-call row UPDATED — the PS-B22 expectation it carried (`ownerMemberAbsent` on
`System.IO.Path.Combine`) was the unverifiable treatment, and the fixture now pins the verification
instead, with a forbid row so a revert is caught. Three new mutants, all CAUGHT: literal-kept,
accelerator-shadows-declaration, dotted-owner-keeps-absent-claim. Lane battery **75 of 75 caught**,
suite **28 pass / 0 fail**, `tsc` 0, zero-regex **0 operations / 0 literals**, spec-shape PASS.

**WHAT IS LEFT IN `ext?`, NAMED EXACTLY.** 334 rows = **251 `owner` + 83 `ownerMemberAbsent`**.
The 251 are colon/backslash targets the arbiter refuses to look up (`it:skip` 67,
`Microsoft.PowerShell.Management\Join-Path` 23, `TestDrive:\…` 8, `stage3-release\bin\zig.exe` 6) — a
module-qualified COMMAND name and a Pester DSL key are not paths, which is a real class for the next wave.
The 83 are the static calls whose literal resolution is not documented (`Path.Combine` 16 and 67 more).

## PSD13 (append-only record, 2026-10-28) — the module claim, the `using:` scope, and the key that is DATA

**THE LAST 334 `ext?` ROWS WERE THREE SPELLINGS AND ONE NOISE CLASS, and every one of them had a false
or unanswerable claim rather than a missing mechanism.** Split by the construct that produced them
(`script/m14/tmp/ps-owner-residual.mts`, reading the analyzer's own metadata for each dumped row):

| class | rows | what the claim said | what it should say |
|---|---:|---|---|
| module-qualified command | 65 | "outside the project", owner `Microsoft.PowerShell` | **a member of MODULE `Microsoft.PowerShell.Management`** |
| `$using:` scope read | 66 | "outside the project", owner `using:X` | **the `using` scope is a runtime table** |
| quoted NAME key | 93 | "outside the project" about `it:skip` | **nothing: a colon in quoted data is not a qualifier** |
| paths, expressions | 110 | "outside the project" | unchanged — the arbiter's documented "exists nowhere" limit |

**THE THREE FIXES, EACH THE FLEET'S OWN CLAIM FOR THAT FACT.**

1. **`moduleNamespace` for `Module\Command`** (25 verified, 13 demoted). PowerShell's documented way to
   name one module's command is this spelling, so the target states which module owns the command, and
   the arbiter checks that module against the project's own file/directory space. Fail-closed by
   construction: a module the project DOES carry demotes to `ext?` and never refutes — which is what the
   13 are (`PSDSCxMachine`, a project `.psm1`).
2. **`languageNamespace: ["using"]` for `$using:Name`** (66 verified). A reserved scope keyword the
   runtime binds from the caller's scope; zero `function using:…` declarations exist in the population,
   so no admitted file can be spelled that way. Root carried AS WRITTEN (PSD11's rule), and the
   distinction from `global:`/`script:` — scopes a file CAN declare into — is the whole reason
   `FILE_DEFINABLE_SCOPE_PREFIXES` and `RUNTIME_TABLE_SCOPE_PREFIXES` are different lists.
3. **No name claim on a quoted NAME key** (93 rows leave the claim column). `$PSDefaultParameterValues
   ["it:skip"]` publishes `uses -> it:skip` with `isConstantKey`; the qualified reading fired on the
   colon, which is punctuation in DATA. The row stays and keeps `noDeclarationInFile`; only the
   meaningless claim goes.

**THE CONTROL THAT KEPT THE GUARD HONEST.** The first version withheld the reading on EVERY constant
key, and `relative-path-psb18` went red on four rows: `$x["/usr/lib/Helper.ps1"]` is a quoted PATH, and
its claim is answered by the project's admitted FILE list — a different question from the owner question.
The guard now fires only on a NAME-shaped key (no `/`, no `\`), and the fixture pins both sides of that
boundary (`module-and-scope-psd13` rows 3 and 6).

**MEASURED, same population (1,181 files / 30 repos), same arbiter, A/B by analyzer digest:**

| column | PSD12 | PSD13 |
|---|---:|---:|
| edges | 193,297 | **193,297** |
| resolved | 98,981 | **98,981** |
| ambiguous(decl) | 17,030 | **17,030** |
| unresolved | 19,983 | **20,076** |
| extOK | 56,909 | **57,000** |
| **ext?** | **334** | **150** |
| **extFAIL** | 60 | **60** |

**+91 claims became checkable, 93 meaningless claims were withdrawn, and no refutation was added.** The
unresolved rise is the third fix and it is the point: a row whose claim was meaningless now reads as the
wall it always was. The clause-1 sum falls **37,407 → 37,316**.

**WHAT IS LEFT IN `ext?`, EXACTLY.** **83 `ownerMemberAbsent`** (the static-call literals whose
resolution is not a documented fact — `Path.Combine` 16 and 67 more; PSD12's table deliberately refuses
to invent `System.Path`), **54 `owner`** (25 relative paths with a script/executable leaf, 11 drive
paths, 8 path-plus-variable targets, 7 expression-shaped `./$var` targets, 3 kubectl/Pester colon
strings — all of them the arbiter's documented "exists nowhere" case 2, where the corpus cannot tell
external from dangling), and **13 `moduleNamespace`** demoted because the module is project layout. Every
one is a NAMED class with a count; none is a bare marker.

**PINS.** New fixture `module-and-scope-psd13`: three positives and three twins (a two-segment path, an
extension leaf, and the PATH-key control). Four new mutants, all CAUGHT: module-claim-dropped,
module-claim-on-any-path, using-scope-unclaimed, data-name-key-qualified. Lane battery **79 of 79**,
suite **29 pass / 0 fail**, `tsc` 0.

## PSD14 (append-only record, 2026-10-28) — clause 4 reached: `extFAIL 60 → 0`, and the five shapes that produced it

**CLAUSE 4 IS MET ON THIS LANE: `extFAIL 0 · bindFAIL 0 · causeFAIL 0`.** The 60 claims the project
refuted were not sixty mistakes; they were FIVE shapes, and each shape's claim had the same defect —
it asked a question the name it named could not answer. Four are withdrawn, one is resolved.

### The five shapes, measured, each from the dump rather than from a sample

| shape | rows | what the row names | why the claim was false |
|---|---:|---|---|
| native program with its extension (`whoami.exe`, `cmd.exe`, `powershell.exe`, `ping.exe`, `node.exe`, `reg.exe`, `pwsh.exe`) | **17** | a FILE on the machine | the qualified reading fired on the dot; the arbiter asked about `whoami` and a project symbol of that spelling refuted it |
| runtime-variable path (`$PSScriptRoot/../../build.psm1`, `$repoRoot/build.psm1`, `$ProjectRoot/build.ps1`) | **13** | a path resolved at RUN time | the arbiter's source-path candidates include the **BASENAME**, so any repo with `build.psm1` at its root refutes the claim wherever the path actually points |
| quoted member name (`$build.triggerInfo.'pr.number'`) | **2** | ONE property called `pr.number` | the dot is punctuation in data; the owner question was asked about `pr`, which the project answers with a VARIABLE |
| type the file compiles (`Add-Type` + `[Foo.Bar]::new()`, `[TestHost.TestHost]::New()`, `New-Object MyTest.Root`) | **3** | a type that does not exist until the script runs | no project declaration table can own it, and the owner question about `Foo` hit an unrelated `class Test` |
| type literal under `using namespace System.Management.Automation` (`[Language.VariableExpressionAst]`) | **22** | `System.Management.Automation.Language.VariableExpressionAst` | the source spells a name the USING PREFIX makes addressable; the claim carried the spelling, not the type |

### The four withdrawals, and the one resolution

- **Program name → the PATH claim.** A program is a file; `sourcePathClaim` is the claim whose truth is
  "nothing the project admits resolves to this written string". 17 refutations became 17 verifications,
  and the owner claim is gone. A program under a directory is refused (`.\tools\whoami.exe`), because a
  path may name a project file.
- **Runtime-variable path → NO claim.** This REVERSES a deliberate earlier decision (W9), and the
  reversal is driven by W9's own measurement: the same shape VERIFIED 123 rows and REFUTED 13, because
  the candidate list is basename-based. A claim that answers by coincidence is not a claim. The price is
  stated: **123 verified rows become unresolved**.
- **Quoted member name → NO claim** (the name stays). The rule is PSD13's, applied to member names: a
  quoted spelling is data, and only a quoted name CONTAINING a dot needs it.
- **Runtime-created type → NO claim.** The evidence is the file's own `Add-Type` C# source (a
  keyword scan, no regex): `namespace`/`class` names and the `-Namespace`/`-Name` values. The price is
  stated: **62 verified claims withdrawn**, because those rows name types the same construction creates.
  A later round can publish the C# types as SYMBOLS instead (they are declarations the file makes); that
  is named as the next step, not done here.
- **Using-namespace type literal → RESOLVED, not withheld.** `about_Using`: a type name inside
  `using namespace U` is tried under each U. The expansion fires only when `<U>.<first segment>` is a
  DOCUMENTED nested namespace (`FRAMEWORK_NESTED_NAMESPACES`, 31 entries, each a child namespace of a
  parent this corpus writes in a directive), the file declares no type of that root, the root is not a
  child namespace of `System` (the implicit-`System.` reading governs those), and the name carries no
  generic brackets. The row publishes both the expansion and the spelling the source wrote
  (`viaUsingNamespace`, `typeSpellingAsWritten`), so the step is visible. **22 refuted rows became 22
  verified claims, and the target is byte-identical to the explicit spelling's** — one type no longer
  has two spellings in the graph.

### And one more, found by the fixture's own twin: relative program and assembly paths

The program rule refused `.\tools\whoami.exe` and the row then carried the QUALIFIED reading, whose
owner (`.\tools\whoami`) the arbiter refuses — a claim no check can reach. **MEASURED: 4 rows**
(`.\warp-packer.exe`, `.\warp\buckaroo-windows.exe`, `.\test-x86_64-windows-msvc.exe` ×2), all
`externalUnverified`. The relative-path refusal (`isRelativeProjectFilePath`) was widened from the three
admitted SCRIPT spellings to the program/assembly spellings (`exe cmd bat com msi dll nupkg zip`) for the
same reason it existed: a relative path may name a project file, and this file does not know the root.
**ext? 150 → 134** (16 rows: those 4 plus 12 more of the same shape).

### The arm, same population (1,181 files / 30 repos), same arbiter, A/B by analyzer digest

| column | PSD13 | PSD14 |
|---|---:|---:|
| edges | 193,297 | **193,297** |
| resolved | 98,981 | **98,981** |
| ambiguous(decl) | 17,030 | **17,030** |
| unresolved | 20,076 | **20,295** |
| extOK | 57,000 | **56,857** |
| ext? | 150 | **134** |
| **extFAIL** | **60** | **0** |

**NO RESOLUTION MOVED, IN EITHER DIRECTION**: `resolved` and `ambiguous` are byte-identical before and
after, every movement is inside the claim columns, and the join was checked on the gate's own
`(label, target, file:line)` key — 22 keys changed target (the using-namespace rows), 0 appeared, 0
disappeared. The clause-1 sum falls **37,406 → 37,325**, and `extFAIL` reaching 0 is what makes clause 4
read PASS for the first time on this lane.

**`ext?` IS 134 AND IT IS FULLY NAMED**: 83 `ownerMemberAbsent` (the static-call literals PSD12 refuses to
invent a namespace for), 38 `owner` (drive paths, path-plus-variable targets, expression-shaped
`./$var` targets, colon strings — the arbiter's documented "exists nowhere" case 2), 13 `moduleNamespace`
(demoted because the module IS project layout). No bare marker, no unclassified row.

**PINS.** New fixture `name-context-psd14`: five positives and four twins (a program under a directory,
an unquoted member, a `System` child namespace under a using prefix, a framework type in a file that
compiles C#, plus a runtime path through `Import-Module`). Six new mutants, all CAUGHT:
native-program-owner-claim, runtime-path-claim-restored, quoted-member-name-qualified,
using-namespace-unexpanded, runtime-type-claimed, using-expansion-overreach. Lane battery **85 of 85
caught, 0 survivors**, suite **30 pass / 0 fail**, zero-regex **0/0**, `tsc` 0.

## PSD15 (append-only record, 2026-10-28) — the compiled types: two claim classes withdrawn, and the publication PRICED

**The 62 rows PSD14 withdrew a claim from name types the file itself compiles. This round asked the
obvious next question — if the file declares them, why not publish them? — and answered it with a
measurement instead of an opinion.**

### 1 · The publication, measured, and NOT taken

The change was small: push a `class` symbol per `namespace N { class C }` pair (and per
`-Namespace N -Name C`), named with the full dotted .NET name and carrying `metadata.fqn`, the key the
index resolves an edge target by. Then run the arm.

| column | PSD14 | with the symbols published |
|---|---:|---:|
| unresolved | 20,295 | **20,233** (−62) |
| resolved | 98,981 | **99,043** (+62) |
| extOK | 56,857 | **56,817** (−40) |
| **extFAIL** | **0** | **39** |

The 62 are exactly the rows the publication was for, and they resolved with no new key. **The 39 are the
finding:** a published type makes `declCount` answer its own name, and the arbiter's owner question
strips the LAST segment, so

```
calls -> DotNetInterop.CodeMethods.GetMethod      owner question: DotNetInterop.CodeMethods
uses  -> Ansible.AccessToken.Win32Exception       owner question: Ansible.AccessToken
```

now find declarations — the type itself in the first case, and a DIFFERENT file's `class AccessToken`
in the second — and REFUTE a claim that was never about them. Withholding the static-call reading (which
is right on its own terms: a call into a file-compiled type is not external) removed 33; six remained,
all `catch [Ansible.AccessToken.Win32Exception]` in files that compile nothing, where this analyzer has
no evidence at all. Clause 4 would go 0 → 6, so **the publication is not shipped.**

**What this prices, exactly:** the arbiter's `typeNames` patch (an owner claim may be refuted only by a
declaration that could BE an owner — a TYPE) is worth **+62 resolved, 0 refuted** on this lane, measured
rather than estimated. It is already filed with the Lead.

### 2 · What IS shipped: the call reading, and the type mention

- **A static call through a compiled type carries NO externality reading.** `[T]::M()` where `T` is a
  type this file compiles targets `T.M`, so the owner IS the file's own type; the dependency is internal.
  MEASURED: 35 whole-population `calls` rows were carrying a verified "external" claim about a type the
  file creates. They are now unclaimed. The members of a C# body are NOT published (no member scan is
  safe enough to mint declarations), so those rows cannot resolve either — they join the wall, correctly.
- **A type mention of the file's compiled type keeps no reading**, in every emitter that reaches this
  pass (`isTypeReference` covers the literal and the cast; measured on both). The `catch [T]` gap is
  named above.

### 3 · The arm, same population, A/B by analyzer digest

| column | PSD14 | PSD15 |
|---|---:|---:|
| edges | 193,297 | **193,297** |
| resolved | 98,981 | **98,981** |
| ambiguous(decl) | 17,030 | **17,030** |
| unresolved | 20,295 | **20,330** |
| extOK | 56,857 | **56,822** |
| ext? | 134 | **134** |
| **extFAIL / bindFAIL / causeFAIL** | **0 / 0 / 0** | **0 / 0 / 0** |

**35 verified claims withdrawn, 0 refutations added, 0 resolutions moved.** The clause-1 sum rises
37,325 → 37,360 and that rise is the price of two classes of claim that were true only by the name
table's accident. The join was checked on the gate's own `(label,target,file:line)` key: 35 keys moved
`externalVerified → unresolved`, all `calls`; 0 appeared; 0 disappeared.

**PINS.** `name-context-psd14` grows two positives (`Get-Gadget`'s static call and `Convert-Gadget`'s
cast) and two forbid rows; two new mutants (`compiled-type-call-external`, `runtime-type-mention-claimed`)
both CAUGHT. Lane battery **87 of 87 caught, 0 survivors**, suite **30 pass / 0 fail**, zero-regex
**0/0**, `tsc` 0.

## PSD17 (append-only record, 2026-10-28) — the remaining wall, measured and named

After PSD15 the arm reads **193,297 edges · 98,981 resolved · 17,030 ambiguous · 20,330 unresolved ·
56,822 extOK · 134 ext? · 0 refuted**. The wall is **37,360**, and this is what it is made of — by SHAPE
of the target, counted from the run's own dump, not sampled:

| class | rows | what it is | disposition |
|---|---:|---|---|
| bare `uses` | **12,614 unresolved + 10,721 ambiguous** | variable reads and member leaves | **cross-file name space.** The retarget pass already fires where the file declares the variable visibly; the residual names are declared in many files (`index`, `path`, `result`, `Name`), and no edge field can say which file's binding is meant. Not the analyzer's to close. |
| scope-qualified reads (`$script:x` 710 · `$global:x` 31 · `$local:x` 8) | **749 unresolved** | a variable in a DEFINABLE scope | **NOT TAKEN — needs a scope model.** See below. |
| quoted data keys (`$x['it:skip']`) | **73 unresolved** | a string key | PSD13 already withholds the name claim; nothing can declare the key, and the `binding` claim is unavailable (`decls === 0` holds, but a quoted key has no separator to verify). Recorded, not claimed. |
| dotted `uses` | 2,646 ambiguous + 28 unresolved | namespace-qualified targets | the namespace/`typeNames` patch class. |
| `calls` | 6,055 unresolved + 3,534 ambiguous | cmdlets/aliases and `$obj.Method()` | PSD10 already claims the bare command channel; the rest are members whose receiver type is unknowable (see the `$this` measurement). |

### Why the 749 scope-qualified reads are NOT collapsed to their bare names

`$script:testWorkspace` is a read of the variable `testWorkspace` in the SCRIPT scope, and the file's own
`$script:testWorkspace = …` publishes no symbol at all (`pushSymbol` refuses a qualified name on purpose,
PS8). So the row names a spelling no declaration has, and 749 of them read unresolved.

The tempting fix — strip the definable prefix on both sides — is a **possible wrong bind**, and that is
worse than an unresolved row. `$script:x` and `$x` are the SAME variable only at script scope; inside a
function `$x` is LOCAL while `$script:x` reaches the script's. The store has no scope model (this file's
own note on method-owned locals says so), so collapsing the two would let a script-scope read bind to a
function-local declaration of the same spelling. The honest unit is a scope identity on the frame plus a
retarget pass that reads it — the same lane-sized change that note already names, and it stays named
here rather than half-built.

**One more thing this round measured, for the record:** publishing the compiled C# types as symbols is
worth **+62 resolved, 0 refuted** on this lane the moment the arbiter's owner question becomes
type-aware (`typeNames`); until then it costs 6 refutations (PSD15 §1). Nothing else in the wall moved
by a mechanism this lane owns.

## PSD18 (append-only record, 2026-10-28) — the scope-selector model: BUILT, MEASURED, REVERTED

PSD17 named 749 scope-qualified reads (`$script:x` 710 · `$global:x` 31 · `$local:x` 8) and said the
collapse "needs a scope model". This round built that model, because "needs a model" is not an answer
until the model is priced.

**What was built.** A definable prefix (`script`/`global`/`local`/`private`/`function`) is a SCOPE
SELECTOR, not part of the name: the declaration publishes the BARE name at the scope it selects
(`script`/`global` → owner = the FILE symbol; the others → the enclosing frame), and a read targets
`<owner>.<name>`. The scope is kept as the owner, so `$script:x` and a function's own `$x` keep
different owners and can never bind to each other — the wrong-bind PSD17 refused. Four declaration
sites that tested `isQualified` were relaxed to `isDeclarableVariable`; the `env:`/`variable:`/`using:`
prefixes were untouched (the runtime owns those), and `$env:` stays external.

**The arm said no.**

| column | PSD17 | with the scope model |
|---|---:|---:|
| edges | 193,297 | **193,616** (+319) |
| ambiguous | 17,030 | **17,198** (+168) |
| unresolved | 20,330 | **19,524** (−806) |
| extOK | 56,822 | **56,813** (−9) |
| **extFAIL** | **0** | **51** |

**AND THE 51 ARE THE FINDING, not a side effect.** Every one is a row whose target became
`<file>.name` — the exact qualified form the read retarget produces — and every one refuted on the
**owner** question, because the owner is the FILE symbol (`build-utils.ps1`, `compiler.test.ps1`,
`TypeInference.Tests.ps1` …) and a file symbol is always declared. So a qualified target owned by a
file is, to the arbiter, a claim that the project does not declare its own file: false by construction.
The 51 are the rows whose declaration spelling did not match exactly (case, or not declared), so the
row did not resolve and the claim pass ran on it.

**What this prices.** A scope model is not enough on its own: it must also teach the claim pass to
leave a FILE-OWNED qualified target alone (no externality reading when the target's owner is the
emitting file's own symbol). That is a second, independent change — and until both land together the
lane's clause 4 would go 60 → 0 → 51, which is not a trade this bar allows.

Reverted byte for byte to the PSD17 state (193,297 edges · 98,981 resolved · 17,030 ambiguous ·
20,330 unresolved · 56,822 verified · ext? 134 · **refuted 0**); suite 30/0 on the restored tree.

## PSD18b (append-only record, 2026-10-28) — the guard the scope model needed, and the model SHIPPED

The PSD18 record above ends with the model REVERTED and the reason named: every row retargeted to
`<file>.name` was handed to the arbiter's OWNER question, the owner is the FILE symbol, and a file
symbol is always declared — 51 refutations. That reason was a defect in the CLAIM PASS, and this
round fixed it and re-took the model.

**The guard:** a target whose OWNER is a symbol THIS FILE declares is a local child, not an external
dependency, so the claim pass publishes no reading on it (and keeps `noDeclarationInFile` for
`calls`/`uses`). That is what the arbiter's own division of labour implies: it asks the owner question
of a name the edge does NOT name, and for `<file>.x` the owner is the emitting file itself. The same
guard covers a member of a class this file declares (`Counter.Add` with no matching member), which
the static-call path already answers with `ownerMemberAbsent`.

**The model, re-measured with the guard — SHIPPED.**

| column | PSD17 | PSD18b |
|---|---:|---:|
| edges | 193,297 | **193,616** (+319) |
| resolved | 98,981 | **99,896** (+915) |
| ambiguous | 17,030 | **17,198** (+168) |
| unresolved | 20,330 | **19,585** (−745) |
| extOK | 56,822 | **56,803** (−19) |
| ext? | 134 | **134** |
| **extFAIL** | **0** | **0** |

**Wall 37,360 → 36,783 (−577), and `resolved + extOK` 155,803 → 156,699 (+896).** The scope prefix
is now a scope SELECTOR: `$script:x`/`$global:x` declare and target the FILE's scope, `$local:`/
`$private:`/`$function:` the enclosing frame, and the prefix is never part of the name. `$env:` /
`$variable:` / `$using:` are untouched — the runtime owns those and they stay external (pinned by
`variable-reads-psa4`'s `env:TEMP` row and by `suppression-and-params-psb7`'s `PATH` forbid).

**The 19 lost verified claims are the honest price**: a bare read that used to verify as external now
has a project declaration of the same spelling to answer to (the file's own `$script:` variable), so
the claim is no longer consulted — the row resolves instead. +915 resolved for −19 claims is the right
direction for clause 1.

**PINS.** `variable-reads-psa4` — the scoped read targets `<file>.cfg`, carries
`isScopedVariableRead`/`scopeQualifier`, resolves, and pins `meta.isExternalTarget: null` (the guard);
`cfg` moved from `forbidSymbols` to `expectSymbols`. `suppression-and-params-psb7` — `Shared`/`Upper`
are declarations now, with the prefixed SPELLINGS still forbidden (`contains Script:Upper`), so the
prefix can never return as a symbol name. New mutant `file-owned-target-claimed`, CAUGHT by two
fixtures. Lane battery **88 of 88**, suite **30 pass / 0 fail**, zero-regex **0/0**, `tsc` 0.

## PSD19 (append-only record, 2026-10-29) — a bare variable read is a runtime binding, and the claim says so

The lane's largest unresolved class was `uses` rows with a bare, undeclared name — **12,614** of them,
41,686 of the lane's unresolved edges (59.43 %). PS16 had deliberately left them UNCLAIMED, on the
reasoning that PowerShell binds `$fromElsewhere` from a dot-sourced file, a caller's scope or a module
export, all at run time — so the file cannot say where it comes from.

That reasoning is right and it is the claim's premise, not its refutation: **the project's name model
has NOTHING of this spelling**, which is the one fact the arbiter can check, and it checks it exactly
the same way for a bare command name (PSD10). The row keeps `noDeclarationInFile` as well — it is
genuinely both facts — and the claim is consulted ONLY where `decls === 0`, so a variable the project
really declares keeps its resolved answer and this row can never refute it.

**MEASURED, same population:** unresolved 19,585 → **18,388**, extOK 56,803 → **57,974**, ext? 134 →
160, ambiguous unchanged, **refuted 0**. Wall 36,783 → **35,586**.

**What it does NOT reach, and the reason is a case trap worth naming:** the remaining 11,568 bare
unresolved `uses` are MEMBER names (`CompletionMatches`, `Count`, `Length`), whose unresolved state is
partly a CASE artifact — PowerShell identifiers are case-insensitive, the gate's `declCount` is not,
so `Count` and `count` are different keys. Claiming those would verify a claim the language says is
false. They stay wall rows.

Pins: `externality-psb16`'s `fromElsewhere` row now carries the claim and `noDeclarationInFile`
together (the reversal is documented on the row); mutant `runtime-binding-unclaimed`, CAUGHT. Lane
battery **89 of 89**, suite 30/0, `tsc` 0.

## PSD20 (append-only record, 2026-10-29) — the case convention, resolved instead of claimed

PowerShell identifiers are **case-insensitive**; the store's key space is not. So `$obj.Count` and a
declaration `[int]$count` are ONE binding in the language and two names to the index — and the lane's
wall paid for it twice: **11,568 bare `uses` rows** unresolved, led by `CompletionMatches`, `Streams`,
`Count`, `Params`, `Length`, and **1,633 ambiguous** rows that were the same collision in the other
direction. PSD19 refused to CLAIM those (a claim would assert something the language says is false).

**The right move is a RESOLUTION.** When the file declares the name with a different spelling and
**exactly one** declaration matches case-insensitively, the read is published under the DECLARED
spelling — the name the store actually holds — with `caseFoldedTo` as its evidence. Only the VALUE
namespace participates (`variable`, `property`, `parameter`): folding a member read onto a same-named
FUNCTION would bind a property to a command. Two declarations differing in case among themselves are a
real ambiguity and are left alone.

**MEASURED, same population:**

| column | before PSD20 | after |
|---|---:|---:|
| resolved | 99,896 | **106,523** (+6,627) |
| ambiguous | 17,198 | **15,565** (−1,633) |
| unresolved | 18,388 | **17,762** (−626) |
| extOK | 57,974 | **53,606** (−4,368) |
| ext? | 160 | **160** |
| **extFAIL / bindFAIL / causeFAIL** | **0 / 0 / 0** | **0 / 0 / 0** |

**Wall 35,746 → 33,487 (−2,259), and `resolved + extOK` 157,870 → 160,129 (+2,259).** The `extOK` drop
is the direction the lane wants: 4,368 rows that used to VERIFY as external now RESOLVE to the file's
own declaration — a claim replaced by a resolution.

Pins: `method-scope-psb3` grows a `FoldedRead` method whose `$this.name` read is published as `Name`
(and the unfolded `name` is forbidden); mutant `case-fold-dropped`, CAUGHT. Lane battery **90 of 90**,
suite 30/0, zero-regex 0/0, `tsc` 0.

## PSD21 (append-only record, 2026-10-29) — the case fold, project-wide (an instrument change, taken with its A/B)

PSD20 folded case INSIDE one file (2,259 rows). The rest of the collision lives across files, and only
the project's key space can see it: `$obj.Count` in one file, `[int]$count` declared in another. The
gate now builds a **folded key space per repo** — lowercased name → how many declarations carry it and
the single spelling if exactly one — and, for a language that opts in (`CASE_INSENSITIVE_LANGUAGES`,
today powershell only), a row whose exact key has NO declaration is retargeted to that one declaration.

**ONE-WAY BY CONSTRUCTION**, which is why it was taken without a ruling: the fold is consulted only
where the exact key is absent and only when the folded name has EXACTLY ONE declaration — so it can
only turn `unresolved` into `resolved`. It cannot refute, cannot add ambiguity, and every lane that
does not opt in reads byte-identical numbers (the gate prints the fold's count on every arm, including
the zero).

**MEASURED, same population:** the disclosure line reads **2,438 rows folded**; `ambiguous` unchanged at
15,565; `unresolved` **17,762 → 16,221 (−1,541)**; **refuted 0**; wall **33,487 → 31,946 (−1,541)**.

Suite 30/0, lane battery 90/90, `tsc` (src) 0. The gate's own `tsc -p tsconfig.scripts.json` is red for
a reason outside this lane: another uncommitted change references `VB_DECLARATION_SPEC`, which
`project-index.ts` does not export — not touched here.
