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
| Extends / Implements | class header `: Base, IFoo, IBar` → `extends` + `implements` edges |
| Patterns | `CmdletBinding`/`Parameter`/`Validate*` attributes, DSC, Azure/Exchange/SharePoint/AD/VM frameworks, REST/I-O/service patterns — string checks on AST nodes, never source text |
| Errors | syntax errors are engine-owned (engine.ts merges `treeErrors`); the analyzer never duplicates them |
| Regex | **zero** regex usages (census 10 → 0) |

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

**None.** The 10 baseline regex usages were replaced:

- `$` stripping → char-code check (`text.charCodeAt(0) === 36`) on `variable` nodes (the grammar keeps `$` in the node text)
- type bracket stripping → `type_literal → type_spec` child text
- `[Type]::new()` bracket stripping → `invokation_expression` with `type_literal` + `member_name` children
- `#requires -Module` extraction → index-based token scan of the comment text

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
