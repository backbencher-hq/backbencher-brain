# real-powershell-analyzer

Pure Tree-sitter PowerShell extraction for `*.ps1`, `*.psm1`, and `*.psd1`
sources, verified under milestone **M12.40** (issue #179).

- Parser: `tree-sitter-powershell` **0.25.10** (npm, published 2025-12-08; WASM at
  `wasm/tree-sitter-powershell.wasm`, loaded by `engine.ts` via `resolveWasm`).
  **This version was established by BYTE-IDENTITY, not by a prior record** — see
  "Provenance" below. The lane shipped for its whole life with **no parser version
  stated anywhere**, which is what the grammar registry's R1 remainder counts; the
  16 files in R1's list that are powershell are this line's doing, not the grammar's.

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
adjudicated below is provably upstream's. It closes **0 of the 12 reproducible named
grammar limits** on this lane; see `reviews/m60-powershell-grammar-0264-refused.md`.
**The pin therefore stays at 0.25.10** and the lane owes a patch.

## Contract

| Concern | Contract |
| --- | --- |
| Symbol identity | `function_statement` → `function`; `class_statement` → `class`; `class_method_definition` → `method` (or `constructor` when the name matches the class); `class_property_definition` → `property`; `enum_statement` → `enum`; `enum_member` → `enum_member`; assignments / `param()` / `foreach` vars → `variable` |
| Parameters | typed from `type_literal → type_spec` (no bracket stripping needed — the grammar separates the spec); `script_parameter_default` marks `isOptional`; both `script_parameter` and `class_method_parameter` shapes handled |
| Owners | class members and function locals carry `ownerName` = enclosing class/function; top-level declarations are unowned. No synthetic `global` scope symbol is ever emitted; a constructor never contains itself |
| Variables | assignments (including `for` counters and `foreach` loop vars) declare once per scope; `$global:`/`$script:`/`$env:` qualified names and automatic variables (`$this`, `$_`, `$args`, `$PSItem`, …) are never declarations |
| Calls | cmdlets and functions emit `calls` (source = enclosing owner or `global`); flow keywords (`break`, `continue`, `return`, …) excluded; `$obj.Method()` → `calls` with `methodCall`; `[Type]::Static()` → `calls` to `Type::Static`; `. ./file.ps1` and `& ./file.ps1` → `calls` with the invocation operator recorded |
| Instantiates | `[Type]::new(...)` → `instantiates` to the type |
| Imports | `Import-Module` (bare and `-Name` forms), `using module` / `using namespace`, and `#requires -Module` comment directives populate the import table and emit `references` edges (char/index scanning only — comments are opaque to the grammar) |
| Extends / Implements | class header `: Base, IFoo, IBar` → `extends` to the FIRST base and `implements` to the rest. PowerShell's header cannot say which base is a class and which are interfaces — the language resolves that at runtime — so the grammar's positional shape is the only information there is, and this row pins the rule rather than a guess. Gated by `class-inherit-psa2` and three mutants |
| Overrides | a subclass member whose name matches a member of its resolved base emits `overrides` carrying `meta.overridesMember` = the member name. PowerShell class methods are virtual by default, so there is no `override` keyword to key on — the match is by name against the base's declared member set. Gated by `class-inherit-psa2` (3 rows + a count, so a "base has a member of any name" rule fails) and `drop-class-overrides` |
| Interfaces | PowerShell 5.0 `interface IShape { [string] Describe() }`. The GRAMMAR has no node for it, so it parses as a `command` named `interface`; the analyzer declares `IShape` as an `interface` symbol from that structure and does not publish it as a call. Known gap: the interface's method signatures are bodiless, so they are not `class_method_definition` nodes and an interface is declared with no members |
| Patterns | `CmdletBinding`/`Parameter`/`Validate*` attributes, DSC, Azure/Exchange/SharePoint/AD/VM frameworks, REST/I-O/service patterns — string checks on AST nodes, never source text |
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

## Supported constructs

Functions with `param()` blocks, typed/optional parameters, attributes
(`[CmdletBinding()]`, `[Parameter()]`, `[Validate*]`), classes with
properties, constructors, instance and static methods, inheritance and
interface lists, enums and members, script-level `param()`, assignments
with command/type/method RHS, `foreach`/`for`/`while`/`do`/`switch` loops,
`try`/`catch`/`finally`, pipelines, `Import-Module`, `using` directives,
`#requires` directives, dot-sourcing, call-operator invocation, `[Type]::new()`
instantiation, static and object method calls, and property reads (which
intentionally produce no edges).

## Verified limitations (named, never hidden)

The vendored `tree-sitter-powershell` grammar is an older snapshot that does
not model valid modern-PowerShell constructs. In the real corpus these are
recorded explicitly in `validation/m12/results/powershell-corpus-errors.json`:

1. `??` null-coalescing and `?.` null-conditional (PS 7.4) — the GitHub
   markdown-link action scripts
2. `?:` ternary (PS 7) and `${env:ProgramFiles(x86)}` scoped interpolation —
   `tools/wix/wix.psm1`
3. nested type literals `[System.Environment+SpecialFolder]` and generics
   `[[string], [PkgVer[]]]` — `Install-PowerShellRemoting.ps1`,
   `UpdateDotnetRuntime.ps1`
4. `--flag="$var"` native-flag tokens — `build.psm1`, `packaging.psm1`,
   `releaseTools.psm1`
5. comma-separated bare-argument lists — `PSDiagnostics.psm1`, `ci.psm1`
6. `$var\` / `$var/` path continuations — several tools/ and src/ files
7. subexpression interpolation with member chains — `Run-AttackSurfaceAnalyzer.ps1`

Additionally, the repo's own `test/` tree (503 files) is the PowerShell
parser/engine torture suite and deliberately embeds invalid syntax as
parser-error test data; 166 of those files contain grammar-flagged errors.
All are audited, counted, and never hidden; strict acceptance uses the 34
clean production files.

## Evidence

- Differential: **79/79**, precision/recall **1.000**, 0 FP/FN/unknown
  (`validation/m12/results/powershell-differential.json`)
- Contract probe: **36/36** (`validation/m12/results/powershell-contract.json`)
- Grammar shape audit: **142 observed node types, 0 dead references**
  (`validation/m12/results/powershell-shape-safety.json`)
- Regex census: **0** powershell usages
- Corpus audit: **553 tracked / 0 crashes / 0 unexpected / 16 named grammar
  limits / 166 test-suite error files**
  (`validation/m12/results/powershell-corpus-errors.json`)
- Corpus measurement: `validation/m12/results/powershell-corpus-complexity.json`,
  `powershell-corpus-shapes.json`
- Fixtures: `validation/m12/fixtures/powershell/{Module.ps1,Deploy.ps1,Negative.ps1}`
- Ground truth: `validation/m12/ground-truth/powershell.json`
