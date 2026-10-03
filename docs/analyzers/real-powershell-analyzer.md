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
1,108. Restated on the grown corpus and BEFORE this pass's fixes, the ten types
were `calls` 67,344, `uses` 64,562, `contains` 21,750, `imports` 556,
`references` 577, `exports` 113, `extends` 47, `implements` 3, `overrides` 2,
`instantiates` 1,268 — 156,222 relationships, 22,861 symbols. The table below is
that population with PS25-PS28 applied. **The percentage columns are the stable
part**: every rate moved by at most 0.11 points across the corpus growth, which is
what says the growth was additive rather than a change of population.

`files` below is the exact distinct-file count. The census originally printed a
400-entry display cap here, which made `calls`, `uses` and `contains` each print
`files 400` — a number that reads as exact and is not one. The cap remains for the
example list; `distinctFiles` in the census JSON is the uncapped set.

| Relationship type | Emitted? | Edges | Files | corpusBoth | intraBoth | `conf < 0.7` | Tier | What it means **in PowerShell** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | EMITTED | 67,344 | 963 | 60.66% | 8.23% | **55.38%** | `usage_contextual` | a cmdlet or function invoked by name (`Get-ChildItem`), a method call (`$obj.Method()`), a static call (`[Type]::Static()`), or a script run through an invocation operator (`. ./x.ps1`, `& ./x.ps1`). Flow keywords excluded. |
| `uses` | EMITTED | 64,562 | 887 | 92.86% | 55.94% | 0.00% | `usage_contextual` | a name READ rather than invoked: a type literal's spec, a variable read, a hashtable key, a cmdlet parameter name, an attribute, and — since the Contract row was corrected — hashtable-literal and array-literal composition. The largest channel after `calls` and the one with the highest corpus-wide resolution rate in the lane. |
| `contains` | EMITTED | 21,750 | 1,022 | 99.87% | 99.73% | 0.00% | `structural` | lexical nesting: a module contains its functions, a class its members, a function its locals and parameters. The only type whose endpoints resolve at both ends on ~99.9% of edges, because both ends are symbols this same pass declared. |
| `imports` | EMITTED (PS23) | 556 | 207 | 69.42% | 37.77% | 0.00% | `import_based` | one module dependency, from `Import-Module` (361 edges), `using namespace` (105), `#requires` list or hashtable (90). **This is the type the lane did not have** — see below. |
| `references` | EMITTED | 577 | 223 | 68.98% | 36.40% | 0.00% | `import_based` | the sibling channel for the same module dependency — **every one of the 577 edges is accounted for: 556 `import_sibling` plus 21 `requires_version`** — and nothing else. The Contract's composition claim is false and the measurement is below. |
| `exports` | EMITTED | 106 | 45 | 98.11% | 95.28% | 0.00% | `structural` | what `Export-ModuleMember -Function`/`-Variable`/`-Alias`/`-Cmdlet` publishes, read from the command's argument list. A wildcard target publishes nothing, which is why the count is 106 and not 113. |
| `extends` | EMITTED | 47 | 7 | 87.23% | 61.70% | 0.00% | `structural` | the FIRST name in a class header's `: Base, IFoo, IBar` list. The header cannot say which base is a class and which are interfaces — the language resolves that at run time — so position is the only information the grammar carries. |
| `implements` | EMITTED | 3 | 2 | 83.33% | **0.00%** | 0.00% | `structural` | every name after the first in the same header list. 3 edges over 2 files, both in the `powershell` repo's own inheritance test suite; `intraBoth 0.00%` because a base or interface declared in another file is not declared in the same file — this is the expected rate for a cross-file type reference, not a resolution failure. |
| `overrides` | EMITTED | 12 | 1 | 100.00% | 100.00% | 0.00% | `inferred` | a subclass member that overrides a member of its resolved base: same name, same kind, base member neither `hidden` nor `static`. PowerShell has no `override` keyword — class methods are virtual by default — so this is the lane's only genuinely INFERRED edge type, which is why it is the only one on tier `inferred` and the only one at 0.9 rather than 1.0. All 12 edges are in ONE file, and pass 1 published 2 of them. |
| `instantiates` | EMITTED | 1,268 | 259 | 62.78% | 18.69% | 0.00% | `usage_contextual` | an object construction: `[Type]::new(...)` (854 edges), `New-Object -TypeName X`, `New-Object -ComObject ProgID`, and the positional `New-Object X` (414). Type-accelerator names are suppressed — they construct nothing the graph should name. |

`corpusBoth` is the share of edges whose BOTH endpoints name a symbol declared in ANY of
the 1,108 sampled files; `intraBoth` is the share whose both endpoints are declared in the
SAME file. The second is the rate the analyzer is answerable for (its own symbol table);
the first is the rate a corpus-wide consumer sees. CSS `references` at 66.8% on both ends
is the project's reference point, and this lane's `references` sits at 68.98% corpus-wide
— 2.2 points above it.

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

## Supported constructs

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
| `calls` | yes | 67,344 | in the compared set | **HOLDS** — 73 edges name a reserved word; read at their own source line, 68 are member accesses on .NET objects whose method name is a keyword, 5 are the `Foreach` alias. 0 in command position name a word the language has ruled silent | 60.66% / 8.23% | **55.38% under 0.7** (0.6:37,296 of 67,344) |
| `uses` | yes | 64,562 | in the compared set | **HOLDS** — a name READ rather than invoked; the composition channel the Contract mis-attributed to `references` is here, at 0.7–0.9, which is right for a read | **92.86%** / 55.94% | 0 under 0.7 (0.7:3,564 / 0.8:27,140 / 0.9:33,858) |
| `contains` | yes | 21,750 | in the compared set | **HOLDS** — 0 self-edges, which is the analyzer's own stated rule; lexical nesting is not ownership, and that half is declared UNSETTLED below | **99.87%** / 99.73% | 0 under 0.7 (all 1.0) |
| `imports` | yes (PS23) | 556 | **NOT audited** — DERIVATION finding, 556 edges compared against nothing | **QUALIFIED** — 361 `Import-Module`, 90 `#requires`, and **105 `using namespace`**, which is a NAMESPACE and not a module. `metadata.via` names the form on every row, so the type is self-describing, but the row's noun is right for 451 of 556 edges | 69.42% / 37.77% | 0 under 0.7 (all 0.9) |
| `references` | yes | 577 | in the compared set | **HOLDS** — the accounting closes exactly: 556 `import_sibling` + 21 `requires_version` + **0 other**. The Contract's composition claim measured 0 and the row is corrected | 68.98% / 36.40% | 0 under 0.7 (all 0.9) |
| `exports` | yes | 106 | in the compared set; **COMPARED WITH NO TRUTH on both differential lanes** (17 comparable, 0 truth; 8 comparable, 0 truth) | **WAS WRONG, now fixed (PS25)** — 7 of 113 edges published a wildcard pattern as a symbol name; 0 do | 98.11% / 95.28% | 0 under 0.7 (all 1.0) |
| `extends` | yes | 47 | in the compared set, **0 truth**, and **no oracle derivation exists** (see DERIVATION below) | **HOLDS** — the positional rule reads the shape the grammar produces: all 273 `class_statement` headers on the corpus carry at least one `simple_name`, and the enumerated header shapes are the one the rule reads | 87.23% / 61.70% | 0 under 0.7 (all 1.0) |
| `implements` | yes | 3 | in the compared set, **0 truth**, and **no oracle derivation exists** | **HOLDS** — 3 edges, every one auditable; all three are a name after the first in a real header | 83.33% / 0.00% | 0 under 0.7 (all 0.85) |
| `overrides` | yes | 12 | in the compared set; **0 edges fell in either 60-file draw**, so the differential says nothing about it either way | **WAS WRONG twice, now fixed (PS26, PS28)** — the match published overrides of `hidden` and `static` members and across member kinds, and it MISSED 10 of 12 real pairs by resetting on redeclaration and comparing case-sensitively | 100.00% / 100.00% | 0 under 0.7 (all 0.9) |
| `instantiates` | yes | 1,268 | in the compared set; 60 edges land `unexplained` | **HOLDS** — 854 via `[Type]::new()`, 414 via `New-Object`; 417 distinct targets, of which **0** contain a brace, **0** contain a semicolon, **0** have a comma at bracket depth 0, and **0** equal a type-accelerator name. The 19 commas found on the first pass are all generic type arguments — `Dictionary[string,string]` is one type name | 62.78% / 18.69% | 0 under 0.7 (all 0.9) |

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

**Question 4 for `contains`, declared UNSETTLED rather than answered.** The strongest
argument against `contains` is semantic, not structural: lexical nesting is not
ownership. A local declared inside a NESTED script block is lexically inside the
function but is not owned by it, and a `contains` edge says owns. The probe measured
the structural half — 0 self-edges, which is the analyzer's own stated rule and
holds — and **did not** measure the nesting-depth half. It is reported as unsettled.
A probe that had settled it is the next piece of work for this lane, and it is not
claimed here.

### DERIVATION findings: 1 by the gate's definition, 3 by the measurement

**By `script/m60/rel-type-coverage-gate.ts` CHECK 1's own definition — an emitted type
absent from the language's audited set — the count is 1: `imports`.** The gate prints
`powershell 1 un-audited: ["imports"]`, and that is re-measured at HEAD. CHECKS 2, 3
and 4 are clean for this lane.

**By measurement, it is 3, and the gate cannot see two of them.**
`derivePowershellEdges` (differential.ts:24297-24813) pushes exactly seven labels —
`contains` (9 sites), `calls` (4), `uses` (5), `exports` (2), `instantiates` (2),
`references` (1), `overrides` (1) — and pushes **zero** `extends`, **zero**
`implements`, **zero** `imports`. PowerShell's audited set nevertheless contains 9 of
the 10 types. So `extends` and `implements` are **audited in name only**: declared
comparable, with no derivation behind the declaration, which is why the differential
prints `COMPARED WITH NO TRUTH` for them and why their edges land in `unexplained`
as confidently as an invented edge would.

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

### Still broken on the product runtime — 5 of 34 battery cases, plus 1 found pass 2

| # | Limit | Construct | Errors | Cause |
| --- | --- | --- | --- | --- |
| 1 | `hash-in-interpolation` | `"$Repo#$PR"` | 1 | `#` in a variable NAME; the name class is `/[a-zA-Z0-9_]+\|\?/` |
| 2 | `ddash-quoted-interp` | `--git-dir="$RepoRoot/.git"` | 2 | **the wired wasm predates G10**, which is the patch for it — see below |
| 3 | `multiplier-suffix-case` | `$($_.Length/1KB)` | 1 | suffix listed lowercase-only, fatal in operand position |
| 4 | `invokation-path-slash` | `& $Destination/pwsh -x` | 2 | `path_command_name_token` allows `\` but not `/` |
| 5 | `invokation-path-slash-literal` | `& /usr/bin/pwsh` | 2 | same cause; fails with no variable involved |
| 6 | `class-member-name-split` (PS27, found pass 2) | `[int] StaticOpen() { return 40 }` | 0, but the member is renamed | `caseInsensitive` (grammar.js:1839) emits no word boundary, so the `static` keyword token matches the first 6 characters of the identifier. Measured on a controlled probe: 6 identifiers split, and 2 forms (`Hidden2`, `Static`) are destroyed outright with an ERROR that swallows the next class declaration. **NOT in `powershell-0264-repro-battery.ts`** — adding it is finding 5 |

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

`script/m60/powershell-surface-measure.ts` over the production draw: **49 files, 8
damaged (56 ERROR / 6 MISSING), 2,588 symbols, 12,028 relationships, line coverage
12,028/12,028, unknownTargets 0, dupKeys 0, reserved 0.**

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
| Fixtures | `validation/m14/fixtures/powershell/` (15) | **15/15** — 13 from pass 1 plus `overrides-modifiers-psb12` and `overrides-redeclaration-psb13` |
| Mutation coverage | `script/m60/powershell-mutants.ts` | **51/51 caught, 0 survivors** (pass 1; unchanged — the file is still referenced by nothing, see finding 2) |
| **The 6 pass-2 fixes, by SOURCE revert** | `validation/m14/fixtures/powershell/mutant-proof-psb12.sh` | **6/6 CAUGHT**, control clean, source restored byte-identical (`7e52026f…` before PS28, `6cbae2a3…` after) |
| Ontology census | `validation/m14/fixtures/powershell/census.ts` | **10/10 types EMITTED** over 1,108/1,108 admitted files, 156,225 relationships |
| **Adversarial probes** | `validation/m14/fixtures/powershell/adversarial-probes.ts` | **11 probes**, 4 defects found; each carries its argument, instrument, count and overturn condition |
| Zero regex | `script/m60/powershell-zero-regex.ts` | **PASS** — 0 operations, 0 literals, 7/7 helpers; verified to FAIL on an injected regex |
| Relationship line numbers | `script/m60/powershell-surface-measure.ts` | **12,028 / 12,028 = 100%** (pass 1) |
| Standing rules, re-measured this pass | census, same population | 0 empty/unknown `SymbolKind`, 0 empty symbol names, 0 `unknown` endpoints, 0 types outside the ontology, 0 relationships missing a line |
| Grammar limits (battery) | `script/m60/powershell-0264-repro-battery.ts` | 5 broken / 34 cases, **15/15 controls holding** (pass 1; PS27 is a SIXTH limit and is not in the battery — see finding 5) |

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

Six findings. None is fixed here: `script/m14/differential.ts`,
`script/m14/mutate-analyzer.ts`, `script/m14/run-fixtures.ts` and
`script/m14/ontology-coverage-gate.ts` are shared, and this lane owns
`src/ast/real-powershell-analyzer.ts` and this document.

1. **`meta.<key>: null` asserts nothing, in any lane.** In `matchConstraints`
   (`script/m14/run-fixtures.ts`), the top-level `if (v === null)` branch at line 338 runs
   BEFORE the `k.startsWith("meta.")` branch at line 358 and `continue`s, so a
   `meta.isComObject: null` constraint is resolved against the TOP-LEVEL key
   `actual["meta.isComObject"]`, which never exists on a relationship. Measured through the
   exported `matchConstraints`, both directions: an edge that DOES carry `isComObject: true`
   satisfies `{ "meta.isComObject": null }` → `true`, and an edge that does not → `true`.
   **16 expectation rows across 6 lanes** (yaml 4, vue 1, typescript 1, svelte 1,
   powershell 1, bash 1) are inert. The array-valued `meta.*` case has the identical
   routing bug and WAS fixed — the comment at line 320 records it, and two elixir mutants
   had survived it — so the fix exists and was not applied to `v === null`. The fix is to
   exclude `meta.` keys from the top-level null branch (`!k.startsWith("meta.")`), which
   lets the existing `meta.` branch's own null handling take them. Lane-side workaround
   applied in `new-object-psa3.expectation.json`: the negative assertion is written as a
   `forbidRelationships` row with a NON-null `meta.isComObject: true`, which routes to the
   working branch and kills `powershell/com-object-keyed-on-a-dot` (it survived until that
   row was added).
2. **`script/m60/*-mutants.ts` is dead code.** `css-mutants.ts` (13), `julia-mutants.ts`
   (16), `markdown-mutants.ts` (15), `powershell-mutants.ts` (51), `scss-mutants.ts` (18),
   `solidity-mutants.ts` (49) and `yaml-mutants.ts` (15) — **177 mutants across 7 lanes** —
   are referenced by nothing: `grep -rn "powershell-mutants" --include=*.ts .` returns no
   hit outside the file itself, and `BB_MUTANT_ONLY="powershell/" bun run
   script/m14/mutate-analyzer.ts` prints `matched 0 of 1521 mutants — nothing was verified`
   (1,483 at pass 1; the mutant pool grew)
   and exits 3. `mutate-analyzer.ts` imports exactly one external mutant file
   (`./fsharp-mutants`). The fix is one import per file and a spread into `MUTANTS`:
   `import { POWERSHELL_MUTANTS } from "../m60/powershell-mutants"` and
   `const MUTANTS = [..., ...POWERSHELL_MUTANTS]`. Until that lands, the mutation gate's
   green says nothing about those 7 lanes. This lane's 51/51 was measured through a
   driver that calls the same `runLang` and the same catch rule
   (`mutate-analyzer.ts:18836-18846`), unchanged.
3. **The arbiter cannot report a lane that emits all ten types.**
   `script/m14/ontology-coverage-gate.ts` exits 2 with "no RULING TABLE for <lang>" when
   `RULED_BY_LANG[LANG] === undefined`, and the table is a hardcoded
   `{ bash: BASH_RULED, json: JSON_RULED }` with no per-language discovery. An empty table
   is the correct registration for a lane with zero RULED types — every row then resolves
   on the EMITTED branch — but registering it is an edit to a shared file. The one-line
   change is `powershell: []` in that record literal. This lane's ten-type table above was
   produced by running a copy of the gate with exactly that one change, in `/tmp`, with the
   real corpus admission and the real `parseFile`.
4. **3 of the 10 types have no oracle, and the coverage gate can see only 1 of the 3.**
   `script/m60/rel-type-coverage-gate.ts` CHECK 1 prints
   `powershell 1 un-audited: ["imports"]` — correct, and incomplete.
   `derivePowershellEdges` (`script/m14/differential.ts:24297-24813`, 517 lines) pushes
   exactly seven labels — `contains`, `calls`, `uses`, `exports`, `instantiates`,
   `references`, `overrides` — and pushes **zero** `extends`, **zero** `implements`,
   **zero** `imports`. PowerShell's audited set nevertheless contains 9 of the 10
   types, so **`extends` (47 edges) and `implements` (3) are audited IN NAME ONLY**:
   declared comparable with no derivation behind the declaration. The two symptoms
   are already visible and are what tipped this off — the differential prints
   `COMPARED WITH NO TRUTH` for `exports`, and pass 1 recorded the same for `extends`
   and `implements`, while CHECK 1 counts none of them.
   **606 edges across 3 types are stored and compared against nothing.**
   The fix is one derivation per label in `derivePowershellEdges` (shared), and the
   gate fix is to compare the audited SET against the labels the oracle actually
   pushes rather than against a hand-maintained list, so an audited label with no
   derivation cannot read as covered.
5. **`script/m14/verify-doc-truth-emissions.ts:465-472` drops the first row of every
   claim table.** `parseClaimTable` skips the header with `if (i === chosen.at)
   continue`, skips the `---` rule with `if (isRuleRow(cs)) continue`, and then has a
   third guard — `if (!started) { started = true; continue }` — which consumes the
   **first body row** and never pushes it. Measured through the exported
   `parseClaimTable` on this lane's doc: the table at line 200 returns **9 rows for a
   10-row table**, and the missing one is `calls` at line 202. The same gate reports
   `UNDOCUMENTED [python] calls` — python's first row — which is the same defect seen
   from another lane. **Every lane's first relationship claim is therefore invisible
   to the gate, so a FALSE claim in that cell would pass.** The fix is to delete the
   `!started` branch: `chosen.at` and `isRuleRow` already cover the two rows it was
   standing in for.
   This lane's ten-type table header was renamed from `| Type | Verdict |` to
   `| Relationship type | Emitted? |` so the gate can read it at all — before that it
   reported `NO_CLAIM_TABLE [powershell]`, which is the "no claim is checkable"
   bucket, and after it 9 of 10 cells are machine-checked and agree with the analyzer
   (0 FALSE_POSITIVE, 0 FALSE_NEGATIVE for powershell). The tenth is the gate's bug.
6. **The grammar battery does not know about PS27.**
   `script/m60/powershell-0264-repro-battery.ts` carries 34 cases and 15 controls, and
   none of them is a class member whose name begins `Static` or `Hidden` — so the
   defect this pass found was invisible to the battery that exists to enumerate the
   grammar's limits. The case to add is `[int] StaticOpen() { return 40 }` with a
   control of `static [int] StaticOpen() { return 40 }`, which isolates the trigger to
   the ABSENCE of a leading modifier. Fixing it needs `caseInsensitive`
   (`grammars/tree-sitter-powershell/grammar.js:1839`) to emit a word boundary, a wasm
   rebuild, and a re-stamp of `validation/m14/grammar-pins.json` — a cross-lane
   registry, so not this lane's to edit.

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
- **`contains` says lexical nesting, and lexical nesting is not ownership — UNSETTLED.**
  A local declared inside a NESTED script block is lexically inside the function but is
  not owned by it, and `contains` says owns. The structural half is measured (0
  self-edges, the analyzer's own stated rule, holds); the nesting-DEPTH half is **not
  measured** and is not claimed. This is the largest open question on the lane's most
  trusted type, and it is named here rather than left for a reader to assume.
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
