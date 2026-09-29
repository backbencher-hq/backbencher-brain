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
| Imports | `Import-Module` (bare and `-Name` forms), `using module` / `using namespace`, and `#requires -Module` comment directives populate the import table and emit `references` edges (char/index scanning only — comments are opaque to the grammar) |
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

The grammar is a **patched local rebuild**, not an upstream snapshot, so this list is
re-measured rather than inherited. It is written against the **pinned product wasm**
(`df867849…`, G10) replayed through `script/m60/powershell-0264-repro-battery.ts`, which
carries 15 controls specifically so that a limit cannot be "fixed" by breaking the
ordinary form of the same construct.

### Still broken on the product runtime — 5 of 34 battery cases

| # | Limit | Construct | Errors | Cause |
| --- | --- | --- | --- | --- |
| 1 | `hash-in-interpolation` | `"$Repo#$PR"` | 1 | `#` in a variable NAME; the name class is `/[a-zA-Z0-9_]+\|\?/` |
| 2 | `ddash-quoted-interp` | `--git-dir="$RepoRoot/.git"` | 2 | **native and product runtimes disagree** — see below |
| 3 | `multiplier-suffix-case` | `$($_.Length/1KB)` | 1 | suffix listed lowercase-only, fatal in operand position |
| 4 | `invokation-path-slash` | `& $Destination/pwsh -x` | 2 | `path_command_name_token` allows `\` but not `/` |
| 5 | `invokation-path-slash-literal` | `& /usr/bin/pwsh` | 2 | same cause; fails with no variable involved |

**Limits 1, 3, 4 and 5 are already fixed in a candidate stack (G11+G12+G13) that is
safety-verified but NOT admitted.** Native A/B over the 691-file corpus: 0 clean files
changed, 0 newly broken, 5 newly clean. They are not admitted because F11 on
`web-tree-sitter@0.25.9` has not run — a wasm build needs load < 8 and the machine has
been at ~30. **Native safety is not product effect**, which is limit 2's lesson.

**Limit 2 is the one that must be fixed against the product runtime directly.** It parses
on native tree-sitter 0.26.9 and fails on the pinned 0.25.9, with the *same* wasm and the
*same* patch set. A fourth design validated natively would be validated on the one
runtime where the construct already works, which is close to unfalsifiable — so it waits
for a build. Full measurement in `reviews/powershell/grammar-worklist.md`.

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
| Fixtures | `validation/m14/fixtures/powershell/` (12) | **12/12** |
| Mutation coverage | `script/m60/powershell-mutants.ts` | **46/46 caught** |
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

### Known gap carried deliberately

A PowerShell 5.0 `interface` has bodiless method signatures, so they are not
`class_method_definition` nodes and **an interface is declared with no members.** The
grammar has no node for `interface` at all; the analyzer declares the symbol from a `command`
named `interface` and does not publish it as a call. Recorded rather than papered over.

### Documentation note

The "Regex census: 0 powershell usages" row this section used to carry was **false twice
over and has been removed**: there is no powershell regex census instrument, and the real
count was 8, not 0. The Regex inventory section above already said so; the Evidence
section contradicted it. The live claim is the gated one — `script/m60/powershell-zero-regex.ts`
— which counts the analyzer's own source and fails if a regex returns.
