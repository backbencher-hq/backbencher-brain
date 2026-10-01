# Real Zig Analyzer

Real, grammar-grounded Zig code intelligence for the Backbencher Brain universal
code-intel engine. Mirrors the declaration-site-only, evidence-tiered, corpus-
verified family contract shared by the go / rust / c / cpp systems analyzers.

## Declaration surface (grounded in tree-sitter-zig, probe-verified 2026-08-29)

- `const X = struct{...}` / `enum{...}` / `union(enum){...}` /
  `error{...}` → container symbols (`Struct` / `Enum` / `Union`).
- `container_field` → `Property` (struct/union member) or `EnumMember`
  (enum member) inside a named container. Anonymous containers returned by
  generic functions produce no symbols (C negative contract).
- error-set members (`error{ A, B }`): identifiers that are DIRECT children of
  the `error_set_declaration` are `EnumMember` symbols.
- `function_declaration` → `Function` at file scope, `Method` inside a
  container. `pub`/`export` → `public` visibility; `inline` recorded in
  metadata.
- `variable_declaration` at file/container scope → `Constant` (value literal),
  `Type` (upper-case alias), or container. Locals inside function bodies are
  execution artifacts and are never emitted.
- `@import("...")` / `@cImport` → an `imports` entry plus a `references`
  relationship with `meta.isImport` (family c-standard), so imports are
  first-class graph facts.

## Relationships (family standard — added in the zig wave)

- `calls`: a `call_expression` emits a `calls` edge to the callee **leaf**
  (`std.math.add` → `add`). Builtin `@`-intrinsics emit no call edge. Same-named
  method calls (`IconDir.writeResData` calling `entry.writeResData`) ARE kept —
  the old `leaf !== enclosingFn` guard silently lost real edges (5 on the
  upstream corpus; removed to reach analyzer↔oracle parity).
- `uses`: a `field_expression` that is not the direct call callee emits a `uses`
  edge to its field leaf.
- `contains`: every owner→member edge for owned symbols.
- `references`: declared-type dependencies (parameter/return/field type leafs;
  builtins excluded) and imports (@import module targets, `meta.isImport`).

Source attribution: calls/uses emitted from inside a function carry the
enclosing function/method name; any field-access or call in a **non-function**
context (top-level `const` initializer, `comptime`, `test` body) emits with
source `(global)` — the go family package-scope-call contract. Without this,
`const assert = std.debug.assert;` (a real dependency in fmt.zig) was silently
dropped; measured as 745 lost edges before the fix.

## Complexity

Per-symbol cyclomatic complexity on every function/method: `if`/`for`/`while`/
`switch`/`else`/`catch`/`orelse` and `and`/`or` binary expressions each
increment from a base of 1. Added in the zig wave (go/rust/c/cpp already had it).

Deep-review fixes (final zig pass 2026-08-29):

- **Expression forms count**: `if_expression` / `for_expression` /
  `while_expression` are Zig's dominant forms (`const a = if (c) 1 else 2;`)
  and were previously never counted — only the statement forms were. All six
  now count, and the anonymous `else` token of an expression form counts like
  `else_clause` does for statements.
- **Operator-token matching, not substrings**: `binary_expression` used
  `text.indexOf("and")` / `indexOf("or")`, which falsely matched identifiers
  (`x + standard + order` gained +2). The operator is an anonymous child token
  (`and`/`or`/`orelse`), matched by type now. Verified: `x + standard + order`
  is complexity 1; `a and b` is +1.

## Symbol kinds & declared-type references (deep-review)

- `var` globals are `Variable`, not `Constant` (a mutable global is not a
  constant); `const` globals stay `Constant`.
- Generic type applications in parameter/field/return positions emit the
  generic BASE leaf: `x: MyList(u32)` → `references -> MyList`. Previously
  `zigTypeLeaf` returned the LAST collected node, which for a generic
  application was the builtin argument (`*std.StringHashMap(usize)` → `usize`,
  filtered) — the real dependency was silently lost.
- Enum members emit NO declared-type references (they are not types);
  builtin-only fields (`sides: u32`) emit none either.

## Design decisions (see `script/m14/spec/zig-completeness.json`)

- **ZIG.D.1** — Zig has no class inheritance / interfaces / overrides, so the
  analyzer emits no `extends`/`implements`/`overrides`/`instantiates` edges.
- **ZIG.D.2** — top-level/comptime/test calls use source `(global)`.
- **ZIG.D.3** — error-set members and `@`-builtins handled as above.

## Verification

- F1 grammar audit: every analyzer literal resolves to a real tree-sitter-zig
  node type (dead `boolean_literal`/`char_literal`/`number_literal`/
  `type_identifier` literals removed in the zig wave).
- F3 fixture: `zig/calls-uses-complexity` pins calls/uses/contains/references
  (declared_type + import), complexity, parameters, and pub visibility.
- F4 mutations: `zig/drop-calls`, `zig/drop-uses`, `zig/drop-import-reference`,
  `zig/drop-symbol-complexity` are all caught.
- F5 differential: `zig:zig` is **0 missing / 0 unexplained** at the pinned
  corpus floor (upstream Zig compiler, ~2,950 .zig files).