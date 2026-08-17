# real-zig-analyzer.md

## Language

- Analyzer file: `src/ast/real-zig-analyzer.ts`
- Parser: `tree-sitter-zig` (pinned `wasm/tree-sitter-zig.wasm`; npm
  tree-sitter-zig 0.2.0 and tree-sitter-wasms 0.1.13 verified behaviorally
  identical on the corpus — 19 vs 19 grammar errors, 0 fixes, 0 regressions —
  so no upgrade was warranted; `source_file` → `variable_declaration`/
  `function_declaration`/`container_field`/`error_set_declaration`/
  `struct_declaration`/`enum_declaration`/`union_declaration`/
  `builtin_function`/`switch_expression` tree; `variable_declaration` →
  `pub`/`const` anonymous tokens + identifier + RHS type; `container_field`
  → identifier + type)
- Language detection: `.zig` → `zig` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealZigAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (quote unwrap for @import module names, pure-String
  helpers, no regex — 0 baseline regex usages).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `variable_declaration` first identifier; `function_declaration` identifier; `container_field` identifier; error set member identifiers (direct children of `error_set_declaration`) |
| kind | ✅ | RHS `struct_declaration` → `struct`; `enum_declaration` → `enum`; `union_declaration` → `union`; `error_set_declaration` → `enum` (error set members → `enum_member`); value literals (number/string/bool/char) → `constant`; capitalized type aliases → `type`; container fields → `property` (enum members → `enum_member`); `fn` inside a container → `method`, at file scope → `function` |
| qualified/container name | ✅ | `ownerName`/`scope` = enclosing container symbol for fields/methods/members |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ | `function_declaration` `parameters` → `parameter` name/type pairs (builtin/slice/pointer/error-union types) |
| returnType / type | ✅ | parameter types; container field types |
| documentation/comments | — | n/a (Zig doc comments not extracted as doc) |
| complexity metrics | ✅ | `complexity` = symbol count; `linesOfCode` on file metadata |
| syntax errors | ✅ | ERROR/missing nodes surfaced with `severity: "error"`; counted in `parseErrors` |
| decorators/attributes | ✅ | `pub`/`export` → visibility public (private otherwise); `inline` flag on methods/functions |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | REAL container ownership only: struct/enum/union/error set → member (post-loop over `ownerName`). Never `global contains X`. | 1.0 |
| references | — | NO `references root -> module` for @import — imports stay in the imports array (Rust M12.18 contract: a dangling `references root -> std` never resolves to a symbol) | — |
| calls | — | Zig method dispatch is field access (`a.distance(b)` → field_expression) — an execution artifact; no call-graph edges in this contract set | — |
| uses | — | field access / identifier usage are execution artifacts; no uses edges | — |
| instantiates | — | struct literal construction (`Point{ .x = x }`) is an execution artifact | — |
| extends / implements | — | n/a (Zig has no class heritage) | — |
| imports | ✅ | `const x = @import("std")` / `@cImport` → imports array (module name from the `string`/`string_content` child, quote-unwrapped via pure-String slice) | 1.0 |
| exports | ✅ | exports array (not a relationship — `module` is not a symbol; the `pub` visibility metadata + exports array carry the export fact) | — |

**Relationship source identity:** contains sources are container names — never
a keyword and never `global` for top-level symbols. No phantom edges: switch
is a keyword, not a symbol; `module` is not a symbol; import targets never
resolve in-file.

## Supported constructs

- Structs: `pub const Point = struct { x: f64, ... }` → struct + fields →
  property + methods (fn inside) → method, all contained by the struct
- Enums: `pub const ShapeType = enum { circle, ... }` → enum + members →
  enum_member
- Unions: `pub const Shape = union(enum) { circle: Circle, ... }` → union +
  fields → property + methods → method
- Error sets: `pub const ParseError = error{ InvalidPoint, OutOfMemory }` →
  enum + members → enum_member
- Value constants: `pub const MAX_POINTS: usize = 1024` → constant
- Functions: `pub fn parsePoint(text: []const u8) ParseError!Point` file-scope
  → function with parameters; `main` → function
- Generic functions: `pub fn GenericStack(comptime T: type) type` → function
  symbol (the generic function itself); the anonymous returned struct's
  fields/methods have NO stable container identity and are NOT symbols (C
  negative contract)
- Imports: `@import("std")` → imports array with module name; `@cImport`
  recognized as import

## Noise rules (negative contract)

- Function-local variables (`var doubled = ...` / `const tripled = ...` inside
  a function body) — NO symbol (execution artifacts; the walk carries
  `inFunction` and skips declaration symbols)
- Control flow (`while`/`if`/`switch` arms, `for`, `return`) — no symbols
- Field access (`self.x`, `a.distance(b)`) — no uses/calls edges
- `switch` — a keyword, never a symbol; no phantom `references -> switch`
- `@import` — imports array only; no dangling `references root -> module`
- `pub`/`export` modifiers — visibility metadata from the anonymous token
  child, never `node.text.startsWith`
- Members of an anonymous struct returned by a generic function — not symbols
  (no stable container identity)
- Enum/struct field identifiers used as values (`.circle => |c|`) — no
  additional symbols

## Regex inventory

From `validation/m12/results/regex-census.json`: the Zig analyzer has **0
regex usages** (0 baseline — the analyzer was already regex-free; the
`nodeText.startsWith`/`includes` source-text scans for `pub`/`export`/`inline`
were replaced with anonymous-token-child scans in this milestone, so the
analyzer is now fully AST-derived; census total unchanged at 95).

## Complexity envelope

Measured via `bun script/m12/measure-analyzer.ts zig <corpusDir>`
(`validation/m12/results/zig-complexity.json`):

- Fixtures: 3 files, 39 symbols, 24 relationships — 683 ms wall, 57 syms/s,
  35 rels/s, peak RSS 206 MB
- Corpus (400-file deterministic sample from zig@738d2be9): 29,771 symbols,
  16,559 relationships — 22.9 s wall, 1303 syms/s, 725 rels/s, peak RSS 453 MB

The analyzer is a single-pass iterative-stack walk (O(N) nodes) with O(1)
constant-time child scans — no O(n²) or per-symbol O(n) scans. Contains edges
are built in one post-loop over symbols; imports are collected during the walk.

## Corpus validation

`script/m12/zig-corpus-errors.ts` scans the deterministic 400-file sample
(first-400 of 1248 files ≥ 1KB from zig@738d2be9 — the Zig compiler itself:
lib/std, lib/compiler_rt, lib/compiler, doc/langref):

- **381/400 parse clean, 19 grammar errors, 0 crashes, 0 timeouts**
- npm tree-sitter-zig 0.2.0 and tree-sitter-wasms 0.1.13 verified behaviorally
  identical (19 vs 19, 0 fixes, 0 regressions) — no grammar upgrade warranted
- Shape-safety: all 12 analyzer node-type references exist in the pinned
  grammar (0 missing)

## Limitations (honest gaps)

- Inline asm output-constraint structs — `asm volatile (... : .{ .rcx =
  true, ... })` in `lib/compiler_rt/*` (outline atomics, ARM builtins) — the
  grammar emits ERROR nodes on the constraint struct literal
- Function-pointer struct fields with doc comments — `await: *const fn (...)` /
  `.await = await` in `lib/std/Io/*` (Kqueue/Threaded/IoUring) — doc comments
  between field name and type break the parser
- Both are valid modern Zig that the newest available grammar cannot parse;
  recorded honestly in the manifest note
- Cross-file type resolution (e.g. `Point` declared in one file used in
  another) is per-file by design in the differential — the production
  companion-index wiring is tracked separately (same note as Java/C/C++/Rust)

## Evidence

- Fixtures: `validation/m12/fixtures/zig/` (geometry.zig, storage.zig,
  Negative.zig)
- Ground truth: `validation/m12/ground-truth/zig.json` (63 facts: 39 symbols
  + 24 relationships)
- Differential: `validation/m12/results/zig-differential.json` —
  **1.000/1.000 precision/recall, 0 FP, 0 FN, 0 unknown** on first run
- Corpus: 400-file sample, 29,771 symbols / 16,559 relationships measured
- M11 gate: `validation/m11/probe-systems.ts` — 1.000/1.000 (geometry.zig
  symbols intact, no regression)
