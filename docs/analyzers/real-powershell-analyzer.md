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
| Overrides | a subclass member whose name matches a member of its resolved base emits `overrides` carrying `meta.overridesMember` = the member name. PowerShell class methods are virtual by default, so there is no `override` keyword to key on — the match is by name against the base's declared member set. Gated by `class-inherit-psa2` (3 rows + a count, so a "base has a member of any name" rule fails) and `drop-class-overrides` |
| Interfaces | PowerShell 5.0 `interface IShape { [string] Describe() }`. The GRAMMAR has no node for it, so it parses as a `command` named `interface`; the analyzer declares `IShape` as an `interface` symbol from that structure and does not publish it as a call. Known gap: the interface's method signatures are bodiless, so they are not `class_method_definition` nodes and an interface is declared with no members |
| Patterns | `CmdletBinding`/`Parameter`/`Validate*` attributes, DSC, Azure/Exchange/SharePoint/AD/VM frameworks, REST/I-O/service patterns — string checks on AST nodes, never source text |
| Line numbers | **every relationship carries a `line`**, measured at 12,028/12,028 = 100% over the production draw. Not a sample: a relationship without a line would be counted as missing, so the ratio is a completeness check on the emit path rather than a quality score. Scoped reads (`$env:X` used as a dependency) carry the line of the READ, not of the declaration |
| Evidence tier | every relationship carries a `tier`, emitted centrally rather than per-call-site so it cannot drift: `structural` (the tree settles it), `usage_contextual` (settled by what the construct means), `import_based` (a `references` edge with `metadata.import: true`), and `inferred` for `overrides`, which is genuinely an inference from name-matching since PowerShell has no `override` keyword |
| Composition | hashtable literals and array literals emit `references` for their member and element targets. PowerShell's composition is a literal, not a declaration, so these are references and not `contains` |
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

**Sampling method: the WHOLE admitted set — 1,092 of 1,092 files, no sampling cut.** The
project's stated floor is 200 files per family; PowerShell's admitted population is 5.4×
that, so the rate is 100% and nothing here is extrapolated. Per repo: `powershell` 553,
`PSScriptAnalyzer` 271, `ansible` 196, `fsharp` 47, `kubernetes` 6, `gh-cli` 4, `zig` 3,
`docker`/`helm`/`openapi-spec` 2 each, `cabal`/`elixir`/`rebar3`/`scala3`/`swift-nio` 1
each. 1,092 attempted, **1,092 parsed, 0 failed, 0 excluded**; 184 files carry parse
errors (counted, listed below, not hidden). 22,690 symbols, 155,432 relationships.

`files` below is the exact distinct-file count. The census originally printed a
400-entry display cap here, which made `calls`, `uses` and `contains` each print
`files 400` — a number that reads as exact and is not one. The cap remains for the
example list; `distinctFiles` in the census JSON is the uncapped set.

| Type | Verdict | Edges | Files | corpusBoth | intraBoth | `conf < 0.7` | Tier | What it means **in PowerShell** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `calls` | EMITTED | 66,984 | 947 | 60.69% | 8.25% | **55.57%** | `usage_contextual` | a cmdlet or function invoked by name (`Get-ChildItem`), a method call (`$obj.Method()`), a static call (`[Type]::Static()`), or a script run through an invocation operator (`. ./x.ps1`, `& ./x.ps1`). Flow keywords excluded. |
| `uses` | EMITTED | 64,294 | 873 | 92.86% | 55.92% | 0.00% | `usage_contextual` | a name READ rather than invoked: a type literal's spec, a variable read, a hashtable key, a cmdlet parameter name, an attribute. The largest channel after `calls` and the one with the highest corpus-wide resolution rate in the lane. |
| `contains` | EMITTED | 21,595 | 1,009 | 99.87% | 99.73% | 0.00% | `structural` | lexical nesting: a module contains its functions, a class its members, a function its locals and parameters. The only type whose endpoints resolve at both ends on ~99.9% of edges, because both ends are symbols this same pass declared. |
| `imports` | EMITTED (PS23) | 553 | 204 | 69.53% | 37.97% | 0.00% | `import_based` | one module dependency, from `Import-Module`, `using module`, `using namespace` or `#requires -Module(s)`. **This is the type the lane did not have** — see below. |
| `references` | EMITTED | 574 | 220 | 69.08% | 36.59% | 0.00% | `import_based` | the sibling channel for the same module dependency (574 = 553 import edges + 21 non-module references such as `#requires -Version 7.0`), plus hashtable-literal member targets and array-literal elements. PowerShell's composition is a LITERAL, not a declaration, so those are references and not `contains`. |
| `exports` | EMITTED | 113 | 52 | 95.13% | 89.38% | 0.00% | `structural` | what `Export-ModuleMember -Function`/`-Variable`/`-Alias`/`-Cmdlet` publishes. Read from the command's argument list, so `Export-ModuleMember -Function *` publishes the literal `*`. |
| `extends` | EMITTED | 47 | 7 | 87.23% | 61.70% | 0.00% | `structural` | the FIRST name in a class header's `: Base, IFoo, IBar` list. The header cannot say which base is a class and which are interfaces — the language resolves that at run time — so position is the only information the grammar carries. |
| `implements` | EMITTED | 3 | 2 | 83.33% | **0.00%** | 0.00% | `structural` | every name after the first in the same header list. 3 edges over 2 files, both in the `powershell` repo's own inheritance test suite; `intraBoth 0.00%` because a base or interface declared in another file is not declared in the same file — this is the expected rate for a cross-file type reference, not a resolution failure. |
| `overrides` | EMITTED | 2 | 1 | 100.00% | 100.00% | 0.00% | `inferred` | a subclass member whose name matches a member of its resolved base. PowerShell has no `override` keyword — class methods are virtual by default — so this is the lane's only genuinely INFERRED edge type, which is why it is the only one on tier `inferred` and the only one at 0.9 rather than 1.0. |
| `instantiates` | EMITTED | 1,267 | 258 | 62.79% | 18.71% | 0.00% | `usage_contextual` | an object construction: `[Type]::new(...)`, `New-Object -TypeName X`, `New-Object -ComObject ProgID`, and the positional `New-Object X`. Type-accelerator names (`string`, `int`) are suppressed — they construct nothing the graph should name. |

`corpusBoth` is the share of edges whose BOTH endpoints name a symbol declared in ANY of
the 1,092 sampled files; `intraBoth` is the share whose both endpoints are declared in the
SAME file. The second is the rate the analyzer is answerable for (its own symbol table);
the first is the rate a corpus-wide consumer sees. CSS `references` at 66.8% on both ends
is the project's reference point, and this lane's `references` sits at 69.08% corpus-wide
— 2.3 points above it.

### The `imports` type was a GAP, and it is now EMITTED (PS23)

The lane held every module name in `imports[]` and published the dependency as
`references` only. Across the 1,092-file corpus the `imports` type was emitted **0 times**
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
| `#requires -Modules A, B` | `A` only | **1 of 1,092** files — `ansible/test/lib/ansible_test/_util/controller/sanity/pslint/pslint.ps1:2` (`PSScriptAnalyzer, PSSA-PSCustomUseLiteralPath`) | `PSSA-PSCustomUseLiteralPath` was a declared dependency read and dropped |
| `#requires -Modules @{ ModuleName = 'X'; ModuleVersion = '1.0' }` | the literal `@{` as the module name | **2 of 1,092** files — `ansible/.../win_app_control/files/{New-AnsiblePowerShellSignature,Set-ManifestSignature}.ps1`, both `@{ ModuleName = 'OpenAuthenticode'; … }` | `imports[]` stored `path: "@{"` and an edge was published to `@{` |

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
1,092 admitted files do, so those 59 are the whole population and the delta is exact
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

`script/m14/ontology-coverage-gate.ts` cannot report this lane as shipped: it exits 2 with
"no RULING TABLE for powershell" because `RULED_BY_LANG` has no `powershell` entry (see
report item 3 below). Run as a `/tmp` copy with exactly one change — `powershell: []` in
that record literal, which is the correct registration for a lane with zero RULED types —
the arbiter reports, over the same 1,092 admitted files and the same production
`parseFile`:

```
type          status     detail
calls         EMITTED    66,976 edges
uses          EMITTED    64,285 edges
contains      EMITTED    21,586 edges
imports       EMITTED    553 edges
references    EMITTED    574 edges
exports       EMITTED    113 edges
extends       EMITTED    47 edges
implements    EMITTED    3 edges
overrides     EMITTED    2 edges
instantiates  EMITTED    1,267 edges
emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0
```

**The arbiter and the census disagree, and the disagreement is 26 edges in one file.**
`calls` 66,976 vs 66,984, `uses` 64,285 vs 64,294, `contains` 21,586 vs 21,595; the other
seven types agree exactly. Both instruments admit the identical 1,092 files (same
`git ls-files` walk, same 512 KB size cap), so the delta is not admission.

It is attributable to a single file rather than left open: the arbiter logged
`[BB-PARSE-ERR] powershell | fsharp/eng/release/scripts/GetAssemblyVersions.ps1 |
memory access out of bounds`, its worker loop does `catch { continue }`, and the file's
edges were dropped whole. Parsed on its own through production `parseFile`, that file
contributes **26 relationships — `contains` 9, `calls` 8, `uses` 9 — which is the delta
exactly, edge for edge and type for type.** Six sequential isolated parses of it return 26
relationships every time, so the parse is reliable when it is not competing with 8
concurrent in-process workers; what is measured here is that this one file's parse is
load-sensitive, not that either instrument is wrong.

The census was run twice end to end and every measured quantity reproduced: 155,432
relationships and 22,690 symbols both times, `imports[] 553` both times, and **0 differing
values across all 10 types** for edge count, both resolution rates, the intra-file rates,
the heuristic count, the missing-line count, the confidence histogram and the
`evidenceClass` histogram. The only difference between the two runs is the ORDER of the
`distinctFiles` arrays, whose sets are equal (e.g. `calls` 947 files both times, same set).
So the census is the figure this document quotes and the arbiter's 26-edge shortfall is
the outlier.

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

Established separately, because they fail independently. "Exists" is derived from source
and "Fires" from the census above; "Correct" is the differential's, and its limitation is
stated rather than glossed; "Resolved" is the census's two resolution columns; "Confident"
is the confidence distribution, where anything below 0.7 is a heuristic under honesty
contract §4 and is counted as one.

| Type | 1 Exists | 2 Fires | 3 Correct | 4 Labelled | 5 Resolved (corpus / intra) | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `calls` | yes | 66,984 | in the compared set | 66,984 `usage_contextual`; keyword-as-call defect class has 3 mutants | 60.69% / 8.25% | **55.57% under 0.7** (0.6:37,221 of 66,984) |
| `uses` | yes | 64,294 | in the compared set | 64,294 `usage_contextual`; `uses` vs `references` split has 4 mutants | **92.86%** / 55.92% | 0 under 0.7 (0.7:3,549 / 0.8:27,086 / 0.9:33,659) |
| `contains` | yes | 21,595 | in the compared set | 21,595 `structural`, one tier | **99.87%** / 99.73% | 0 under 0.7 (all 1.0) |
| `imports` | yes (PS23) | 553 | **NOT audited** — DERIVATION finding, 553 edges compared against nothing | 553 `import_based`, no other tier | 69.53% / 37.97% | 0 under 0.7 (all 0.9) |
| `references` | yes | 574 | in the compared set, NOT flagged for 0 truth; 14 edges unexplained on the primary draw, 51 on ansible | 574 `import_based`; the import/non-import split is on `metadata.import` | 69.08% / 36.59% | 0 under 0.7 (all 0.9) |
| `exports` | yes | 113 | in the compared set, **0 truth** (18 comparable, 0 truth across both lanes) | 113 `structural` | 95.13% / 89.38% | 0 under 0.7 (all 1.0) |
| `extends` | yes | 47 | in the compared set, **0 truth** (2 comparable, 0 truth) | 47 `structural`; `extends`=first-header-name rule pinned | 87.23% / 61.70% | 0 under 0.7 (all 1.0) |
| `implements` | yes | 3 | in the compared set, **0 truth** (1 comparable, 0 truth) | 3 `structural` at 0.85 | 83.33% / 0.00% | 0 under 0.7 (all 0.85) |
| `overrides` | yes | 2 | in the compared set; 0 edges fell in the 60-file draw | 2 `inferred`, the lane's only inferred tier | 100.00% / 100.00% | 0 under 0.7 (all 0.9) |
| `instantiates` | yes | 1,267 | in the compared set; 0 truth (47 edges land `unexplained`) | 1,267 `usage_contextual`; the accelerator guard is a `forbid` row | 62.79% / 18.71% | 0 under 0.7 (all 0.9) |

**Question 3, and what the oracle cannot see.** The powershell oracle is
`derivePowershellEdges` in `script/m14/differential.ts:24297`, which shares no rule table,
helper or classification set with the analyzer. The limitation is stated rather than
glossed: **it is a second walker over the same grammar**, so a grammar-level bug present in
both paths is invisible to it. The differential also drops a label the ORACLE did not
emit, so an edge type the oracle is silent about cannot be contradicted by it.

That produces two DIFFERENT findings and they are not the same number, so they are kept
apart:

- **DERIVATION, in the sense `script/m60/rel-type-coverage-gate.ts` CHECK 1 defines it
  (an emitted type absent from the language's audited set): 1 — `imports`.** The gate
  prints `powershell 1 un-audited: ["imports"]`. This is the finding this lane introduced
  and it is the one the gate is designed to name. CHECKS 2, 3 and 4 are all clean for this
  lane.
- **A label in the audited set that produced 0 truth rows on the sampled draw: 3 —
  `exports` (18 comparable, 0 truth across both lanes), `extends` (2 comparable, 0 truth),
  `implements` (1 comparable, 0 truth).** The differential prints these as `COMPARED WITH
  NO TRUTH` and says of them that "the published coverage for those labels is not
  coverage". Their edges land in `unexplained`, which is a confident fabrication as far as
  the comparison is concerned. This is a property of the 60-file draw as much as of the
  lane — `instantiates` and `overrides` are audited and simply had too few edges in the
  draw to compare — so it is reported as an observation with its numbers and not folded
  into the DERIVATION count.

Every one of these needs a derivation in `derivePowershellEdges`, which lives in
`script/m14/differential.ts` — shared machinery, so a report item and not a lane edit.

**Question 6, the heuristic ratio, stated as a finding rather than a footnote.** `calls`
publishes **37,221 of 66,984 edges at confidence 0.6** — 55.57% of the type, and 23.8% of
all 155,432 relationships in the lane. Under honesty contract §4 those are heuristics, not
facts. They are the lowest-confidence class in the lane and they are counted here. Every
other type is at or above 0.7 on every edge.

**Standing rules over the same population.** 0 empty or unknown `SymbolKind` values
(`variable` 14,464, `property` 4,995, `function` 1,558, `module` 1,092, `method` 197,
`class` 183, `enum_member` 118, `constructor` 51, `enum` 32); **0 symbols with an empty
name**; **0 relationship endpoints equal to the literal `unknown`**; **0 relationship types
outside the 10-type ontology**.

## Verified limitations (named, never hidden)

The grammar is a **patched local rebuild**, not an upstream snapshot, so this list is
re-measured rather than inherited. It is written against the **pinned product wasm**
(`df867849…`, G10) replayed through `script/m60/powershell-0264-repro-battery.ts`, which
carries 15 controls specifically so that a limit cannot be "fixed" by breaking the
ordinary form of the same construct.

### Still broken on the product runtime — 5 of 34 battery cases

| # | Limit | Construct | Errors | Cause |
| --- | --- | --- | --- | --- |
| 1 | `hash-in-interpolation` | `"$Repo#$PR"` | 1 | `#` in a variable NAME; the name class is `/[a-zA-Z0-9_]+\|\?/` |
| 2 | `ddash-quoted-interp` | `--git-dir="$RepoRoot/.git"` | 2 | **the wired wasm predates G10**, which is the patch for it — see below |
| 3 | `multiplier-suffix-case` | `$($_.Length/1KB)` | 1 | suffix listed lowercase-only, fatal in operand position |
| 4 | `invokation-path-slash` | `& $Destination/pwsh -x` | 2 | `path_command_name_token` allows `\` but not `/` |
| 5 | `invokation-path-slash-literal` | `& /usr/bin/pwsh` | 2 | same cause; fails with no variable involved |

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
| Fixtures | `validation/m14/fixtures/powershell/` (13) | **13/13** |
| Mutation coverage | `script/m60/powershell-mutants.ts` | **51/51 caught, 0 survivors** |
| Mutation coverage, the 5 new ones, by SOURCE revert | `validation/m14/fixtures/powershell/mutant-proof.sh` | **5/5 CAUGHT**, control clean, source restored byte-identical |
| Ontology census | `validation/m14/fixtures/powershell/census.ts` | **10/10 types EMITTED** over 1,092/1,092 admitted files, 155,432 relationships |
| Payload cost of the `imports` type | 59 `#requires`-bearing files through `parseFile` | **+102 relationships, +24,953 B, +0.997%**, 244.6 B/edge |
| Zero regex | `script/m60/powershell-zero-regex.ts` | **PASS** — 0 operations, 0 literals; verified to FAIL on an injected regex |
| Relationship line numbers | `script/m60/powershell-surface-measure.ts` | **12,028 / 12,028 = 100%** |
| Unknown / duplicate / reserved targets | same | **0 / 0 / 0** |
| Production symbols | same | **2,588** |
| Production relationships | same | **12,028** |
| Grammar limits (battery) | `script/m60/powershell-0264-repro-battery.ts` | 5 broken / 34 cases, **15/15 controls holding** |
| Grammar pin consistency | `script/m14/verify-grammar-pins.ts` | pin and wasm verified together |

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
between runs, so cross-run deltas are invalid unless the file set is fixed; deterministic
full-corpus fact hashes are the sound instrument and are what the residual analysis used.
A hand audit of the `New-Object` family found and fixed a real defect this way (measured
deterministically over 760 files: 66 files changed, +168 relationships). The oracle's
`$`-prefixed-target bug was also fixed. The remaining sampled disagreement is dominated by
the `test/` torture suite described above.

Re-measured on the current analyzer, `--lang powershell --force-fresh`, 2 lanes:

| Lane | Files | tree-truth | covered | MISSING | analyzer edges | unexplained | heuristic | fact hash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `powershell:powershell` | 60 | 3,768 | 3,080 (81.7%) | 688 | 3,410 | 631 (18.5%) | 0 | `3009d2b23fc3da21` |
| `ansible:powershell` | 60 | 5,477 | 4,550 (83.1%) | 927 | 4,775 | 631 (13.2%) | 0 | `ef8e3ab571f6d703` |

`unexplained-by-label` on the primary corpus: `uses` 529, `instantiates` 47, `contains` 26,
`references` 14, `exports` 12, `extends` 2, `implements` 1. The primary lane's fact hash
is **unchanged** by PS23 and PS24 (`3009d2b23fc3da21` before and after), which is the
expected result rather than a null one: the `powershell` repo declares no `#requires`
module list and no `#requires` hashtable, so the corpus files PS24 fixes all live in
`ansible` — whose sample rotated between the two runs, which is why its numbers moved
(5,570→5,477 truth, 639→631 unexplained) while the primary lane's did not.

The run reports `M14.0.F5 NOT written` for a scoped invocation, by design: the canonical
artifact belongs to the 60-file 43-language sweep and writing a 2-lane result here would
replace that claim with a smaller one.

### Known gap carried deliberately

A PowerShell 5.0 `interface` has bodiless method signatures, so they are not
`class_method_definition` nodes and **an interface is declared with no members.** The
grammar has no node for `interface` at all; the analyzer declares the symbol from a `command`
named `interface` and does not publish it as a call. Recorded rather than papered over.

### Ontology-lane findings that need shared machinery

Four findings from the ten-type work. None is fixed here: `script/m14/differential.ts`,
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
   script/m14/mutate-analyzer.ts` prints `matched 0 of 1483 mutants — nothing was verified`
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
4. **1 of the 10 types has no oracle: `imports`.** `script/m60/rel-type-coverage-gate.ts`
   CHECK 1 prints `powershell 1 un-audited: ["imports"]`. It needs a derivation in
   `derivePowershellEdges` (`script/m14/differential.ts:24297`), which is shared. This is
   the one this lane introduced: 553 edges of stored truth with no second opinion, on a
   type whose oracle absence is exactly the shape of defect the ontology gate exists to
   catch. CHECKS 2, 3 and 4 of the same gate are clean for this lane.

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
  and it cannot see an override of a member declared in another file. 2 edges over 1 file
  is the honest size of that population, not a small defect.
- **`extends` vs `implements` is positional, not semantic.** `: Base, IFoo, IBar` sends
  `Base` to `extends` and the rest to `implements`, and the language does not say which is
  which. `class C : Dictionary` is therefore published as `extends` even when `Dictionary`
  is a .NET class and `IFoo` is a class too.
- **`Export-ModuleMember -Function *` publishes the literal `*`.** The name is read from
  the argument list because the expansion happens at run time; a consumer wanting the
  exported SET would have to expand it.
- **PowerShell classes have no cross-file inheritance read.** A base class in another
  module is not in the file's parse tree, so `overrides` against it, and `extends` to it,
  are not derivable per file. `imports` is the only channel that carries that dependency,
  and it carries the module NAME rather than a member map.
- **184 of 1,092 admitted files carry parse errors** (worst:
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
- **`calls` at 0.6 is 23.8% of the lane's relationships.** Those 37,221 edges are
  heuristics under honesty contract §4, not facts. They are counted as such in the six
  questions table rather than averaged into the type's confidence.
- **84.8% of the admitted corpus is test code** (926 of 1,092 files sit under a `test/`
  or `Tests/` path: 503 under `powershell/test/`, 247 under `PSScriptAnalyzer/Tests/`).
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
