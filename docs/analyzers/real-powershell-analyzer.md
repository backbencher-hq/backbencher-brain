# real-powershell-analyzer

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
| Node types | 429 ids / 152 named / 14 fields |
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

## Contract

| Concern | Contract |
| --- | --- |
| Symbol identity | `function_statement` → `function`; `class_statement` → `class`; `class_method_definition` → `method` (or `constructor` when the name matches the class); `class_property_definition` → `property`; `enum_statement` → `enum`; `enum_member` → `enum_member`; assignments / `param()` / `foreach` vars → `variable` |
| Parameters | typed from `type_literal → type_spec` (no bracket stripping needed — the grammar separates the spec); `script_parameter_default` marks `isOptional`; both `script_parameter` and `class_method_parameter` shapes handled |
| Owners | class members and function locals carry `ownerName` = enclosing class/function; top-level declarations are unowned. No synthetic `global` scope symbol is ever emitted; a constructor never contains itself |
| Variables | assignments (including `for` counters and `foreach` loop vars) declare once per scope; `$global:`/`$script:`/`$env:` qualified names and automatic variables (`$this`, `$_`, `$args`, `$PSItem`, …) are never declarations |
| Calls | cmdlets and functions emit `calls` (source = enclosing owner or `global`); flow keywords (`break`, `continue`, `return`, …) excluded; `$obj.Method()` → `calls` with `methodCall`; `[Type]::Static()` → `calls` to `Type::Static`; `. ./file.ps1` and `& ./file.ps1` → `calls` with the invocation operator recorded |
| Instantiates | `[Type]::new(...)` → `instantiates` to the type |
| Imports | `Import-Module` (bare, `-Name` and positional), `using module`, `using namespace`, and `#requires -Module`/`-Modules` populate the import table **and emit BOTH an `imports` and a `references` edge** at 0.9, tier `import_based`, with `metadata.via` naming which of the four forms declared it (char/index scanning only — comments are opaque to the grammar). Both edges carry identical metadata. See "The ten ontology types" for why both and not one |
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

## The ten ontology types

Every one of the ten types is **EMITTED**. There is no RULED type in this lane, so there
is no ruling to state, no probe to name and no overturn condition to publish — the table
below is the positive measurement that replaces them.

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
| `calls` | EMITTED | 67,344 | 963 | 60.66% | 8.23% | **55.38%** | `usage_contextual` | a cmdlet or function invoked by name (`Get-ChildItem`), a method call (`$obj.Method()`), a static call (`[Type]::Static()`), or a script run through an invocation operator (`. ./x.ps1`, `& ./x.ps1`). Flow keywords excluded. |
| `uses` | EMITTED | 64,599 | 887 | 92.87% | 55.96% | 0.00% | `usage_contextual` | a name READ rather than invoked: a type literal's spec, a variable read, a hashtable key, a cmdlet parameter name, an attribute, hashtable-literal and array-literal composition, and — since PS29 — a `New-Object` **type name held in a variable**. The largest channel after `calls` and the one with the highest corpus-wide resolution rate in the lane. |
| `contains` | EMITTED | 21,750 | 1,022 | 99.87% | 99.73% | 0.00% | `structural` | lexical nesting: a module contains its functions, a class its members, a function its locals and parameters. The only type whose endpoints resolve at both ends on ~99.9% of edges, because both ends are symbols this same pass declared. **Lexical nesting is not ownership, and the size of the difference is now measured rather than declared open** — see "PS31" below. |
| `imports` | EMITTED (PS23) | 556 | 207 | 69.42% | 37.77% | 0.00% | `import_based` | one module dependency, from `Import-Module` (361 edges), `using namespace` (105), `#requires` list or hashtable (90). **This is the type the lane did not have** — see below. |
| `references` | EMITTED | 577 | 223 | 68.98% | 36.40% | 0.00% | `import_based` | the sibling channel for the same module dependency — **every one of the 577 edges is accounted for: 556 `import_sibling` plus 21 `requires_version`** — and nothing else. The Contract's composition claim is false and the measurement is below. |
| `exports` | EMITTED | 106 | 45 | 98.11% | 95.28% | 0.00% | `structural` | what `Export-ModuleMember -Function`/`-Variable`/`-Alias`/`-Cmdlet` publishes, read from the command's argument list. A wildcard target publishes nothing, which is why the count is 106 and not 113. **`metadata.via` names the FLAG since PS30** — before it, every row carried the command name and 0 of 106 named the flag. |
| `extends` | EMITTED | 47 | 7 | 87.23% | 61.70% | 0.00% | `structural` | the FIRST name in a class header's `: Base, IFoo, IBar` list. The header cannot say which base is a class and which are interfaces — the language resolves that at run time — so position is the only information the grammar carries. |
| `implements` | EMITTED | 3 | 2 | 83.33% | **0.00%** | 0.00% | `structural` | every name after the first in the same header list. 3 edges over 2 files, both in the `powershell` repo's own inheritance test suite; `intraBoth 0.00%` because a base or interface declared in another file is not declared in the same file — this is the expected rate for a cross-file type reference, not a resolution failure. |
| `overrides` | EMITTED | 12 | 1 | 100.00% | 100.00% | 0.00% | `inferred` | a subclass member that overrides a member of its resolved base: same name, same kind, base member neither `hidden` nor `static`. PowerShell has no `override` keyword — class methods are virtual by default — so this is the lane's only genuinely INFERRED edge type, which is why it is the only one on tier `inferred` and the only one at 0.9 rather than 1.0. All 12 edges are in ONE file, and pass 1 published 2 of them. |
| `instantiates` | EMITTED | 1,227 | 256 | 61.53% | 15.97% | 0.00% | `usage_contextual` | an object construction: `[Type]::new(...)` (854 edges) or `New-Object` in its three spellings (373 after PS29). Type-accelerator names are suppressed — they construct nothing the graph should name — and a **type name held in a VARIABLE is not published as an `instantiates` target at all**, since the edge would assert the variable is a type. |

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
and `:2429` spreads it into `MUTANTS`. A scoped run now reports **55 of 55 caught, 0
survivors** — the original 51 plus the 4 added here for PS29/PS30.

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
| Fixtures | `validation/m14/fixtures/powershell/` | **17/17** — 15 at pass 2, plus `new-object-variable-psb14` (PS29) and `export-flag-psb15` (PS30) |
| Mutation coverage | `script/m60/powershell-mutants.ts`, **now reachable** | **55/55 caught, 0 survivors** — 51 from passes 1-2 plus 4 label mutants added for PS29/PS30. `BB_MUTANT_ONLY="powershell/" npx tsx script/m14/mutate-analyzer.ts`; a scoped run, so it writes no canonical evidence |
| **The 5 pass-3 fixes, by SOURCE revert** | `validation/m14/fixtures/powershell/mutant-proof-psb14.sh` | **5/5 CAUGHT**, control clean, source restored byte-identical |
| The 6 pass-2 fixes, by SOURCE revert | `validation/m14/fixtures/powershell/mutant-proof-psb12.sh` | **6/6 CAUGHT** at pass 2; not re-run this pass, and the fixtures it depends on are among the 17 still passing |
| Ontology census | `validation/m14/fixtures/powershell/census.ts` | **10/10 types EMITTED** over 1,108/1,108 admitted files, **156,221 relationships** (156,225 before PS29/PS30) |
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

`script/m14/spec/powershell-completeness.json` classifies every one of the **152 named
node types**; the gate reports **0 unclassified**. Its three type buckets are **mutually
disjoint** and hold 144 rows — **50 handled**, **86 internal-silent**, **8 recorded gaps,
all 8 now fixed** — and **6 rationale decisions** (flow keywords, DSC resource types,
workflow keywords, `--%` stop-parsing, redirection, comments) cover the remainder.
The buckets are disjoint, so the counts are meant to be added, and an earlier draft of
this file that wrote "50 + 86 + 18 = 152, classified exactly once" was arithmetic that
does not close.

Sections A–D, G, H **pass**. Two sections do not, and the lane is not closed while they
do not:

- **Section E — `section-e-differential`:** no baseline floor row for
  `powershell:powershell`. Closing it requires a **canonical unscoped** differential
  baseline, and a lane-scoped run cannot supply one: `mergeBaseline()` writes
  `loadContext` and `samplePerLang` unconditionally from the current run while merging
  `counts` per lane, so a powershell-scoped run would re-stamp the load context of all
  **182** existing rows. It also pins a lane only when `missing === 0 && unexplained === 0`,
  and the lane-scoped F5 artifact records neither count for this lane — so the attempt
  could rewrite the shared file without pinning powershell at all.
- **Section F — `section-f-perf-budget`:** no `avgMsPerFile` for
  `powershell:powershell`. The only figure that exists is **50.7 ms/file, measured at
  `loadAvg1` 39.42 on 8 cores with `loadAvgRetried: true`** — contention at 4–5× load, not
  a lane budget. (For calibration: the baseline's own `loadContext` reads 41.85 → 39.16,
  so its existing 182 rows were themselves pinned at ~5× load.)

Both sections stay red deliberately, and the full measurement is in
`validation/m14/results/powershell-lane-record.json`. A red section here says the
ceremony has not happened; it is cheaper than a green one that measures the machine.

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

`unexplained-by-label`, primary lane: `uses` 653, `contains` 47, `instantiates` 34,
`references` 32, `exports` 17. Ansible: `uses` 503, `references` 52, `contains` 45,
`instantiates` 26, `exports` 8. **`COMPARED WITH NO TRUTH` on both lanes:
`exports`** (17 comparable / 0 truth, and 8 / 0).

**These numbers are not comparable with pass 1's and are not offered as a delta.**
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
   exit 3, a scoped run now reports **55 of 55 caught, 0 survivors** over a pool of 1,727.
   **This lane's mutation gate is live for the first time**, and it is what pins PS29 and
   PS30, neither of which moves an edge count.
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
   `docs/analyzers/real-powershell-analyzer.md:214` — the first body row of the table.
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
