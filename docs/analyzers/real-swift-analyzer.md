# real-swift-analyzer.md

## Language

- Analyzer file: `src/ast/real-swift-analyzer.ts`
- Parser: `tree-sitter-swift` (pinned `wasm/tree-sitter-swift.wasm`; npm
  tree-sitter-swift 0.7.1 built and verified behaviorally identical on the
  corpus via the production `parseFile` path — 101 vs 101 grammar-error files,
  0 fixed, 0 regressed — so no upgrade was warranted; `source_file` →
  `protocol_declaration`/`class_declaration` (with anonymous keyword tokens
  `class`/`struct`/`enum`/`extension`/`actor`)/`function_declaration`/
  `init_declaration`/`property_declaration`/`enum_entry`/
  `typealias_declaration`/`associatedtype_declaration`/
  `navigation_expression` tree; kind is decided by the grammar's anonymous
  keyword token, never source-text scanning)
- Language detection: `.swift` → `swift` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealSwiftAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (leaf-name extraction, no regex — 0 baseline regex
  usages, census unchanged at 95).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `protocol_declaration`/`class_declaration` `type_identifier`; extension name = the EXTENDED type's `type_identifier` (inside `user_type`); `function_declaration` `simple_identifier`; `init_declaration` → `constructor` (Java/C# naming); `property_declaration` binding `pattern` → `simple_identifier`; `enum_entry` first identifier; `typealias_declaration`/`associatedtype_declaration` `type_identifier` |
| kind | ✅ | `protocol_declaration` → `interface`; `class_declaration` → `class`/`struct`/`enum`/`extension`/`actor` via the anonymous keyword token; `init_declaration` → `constructor`; `deinit_declaration`/`subscript_declaration` → NOT symbols (ObjC dealloc / C# indexer precedent); function → `method` when owned by a type, `function` at file scope; type-scope vars → `property`, file-scope → `variable`; `enum_entry` (in enum bodies only) → `enum_member`; `typealias`/`associatedtype` → `type` |
| qualified/container name | ✅ | `ownerName` = enclosing type symbol for members; extensions own their members (no self-owner — the extension symbol itself has NO owner) |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ❌ (not symbols) | function params are NOT symbols (C# M12.07 negative contract: `ParamsAreNotSymbols`) |
| visibility | ✅ | `modifiers` → `visibility_modifier` tokens (`public`/`private`/`fileprivate`/`internal`/`open`), default `internal` |

## Relationship ontology

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | real ownership only (type → member): `contains Repository -> find`, `contains UserService -> countUsers` (extension member), `contains User -> constructor`. Locals carry no owner so nothing to emit. Never `global contains X`. | 1.0 |
| extends | ✅ | `class_declaration` first `inheritance_specifier` base (`class UserService: BaseService, ...` → `extends UserService -> BaseService`). Enum raw types are metadata only — never an edge. | 1.0 |
| implements | ✅ | remaining `inheritance_specifier` bases (adopted protocols) | 0.9 |
| calls | ✅ | `call_expression` — member calls resolve to the LEAF target (`users.first {...}` → `first`, `users.append(...)` → `append`, `[1,2].map {...}` → `map`); source = enclosing method; bare stdlib calls (print/String/Int/...) filtered (C# `BuiltinsAreFiltered` precedent) | 1.0 |
| instantiates | ✅ | bare CAPITALIZED call `User(...)` → `instantiates` ONLY (Swift construction syntax — Java `new Foo()` analog; never also a calls edge) | 0.7 |
| uses | ✅ | ONLY `self.` member reads (Swift's `this`) — source = enclosing METHOD, target = field leaf (`self.name` in `BaseService.init` → `uses BaseService.init -> name`, `self.id` in `User.read` → `uses User.read -> id`). M49 W15 #814 converged the whole family on method-source; the earlier type-source rule is superseded (a read at class level — a property initializer — has no method and falls back to the type). Type references (String/Int/[User]) emit NOTHING. | 0.7 |
| overrides | ✅ | `override` keyword (`modifiers > member_modifier [override]`) → qualified `Owner.method -> Parent.method` resolved via class-hierarchy BFS + shared companion index (Java/C# M12.02-03 semantics): `UserService.describe -> BaseService.describe` | 0.8 |
| references | ✅ | file-scope imports → `references root -> module` (`import Foundation` → `references root -> Foundation`, ObjC M12.19 pattern) | 0.9 |

## Regex census

Baseline at M12.01: **0 usages** — the Swift analyzer was already regex-free.
After M12.21 (pure-AST rewrite): **0 usages**, unchanged. The census gate
confirms zero regex literals or `RegExp` nodes in the source
(`swift entries: NONE`).

## Complexity envelope

Measured by `script/m12/measure-analyzer.ts` (results in
`validation/m12/results/swift-complexity.json`):

- Fixtures: 2 files, 37 symbols, 43 relationships, 320 ms
- Corpus subset: 400 files (swift-nio @ ec51fff0, deterministic first-400 of
  520 tracked `.swift` files ≥ 1KB), **13,464 symbols, 31,189 relationships,
  28.4 s** — 474 symbols/s, 1,098 relationships/s
- All hot paths are single-pass or bounded-BFS (error scan, main iterative
  walk, per-task override BFS, tree helpers) — no O(n²).

## Differential verification

`bun script/m12/verify-analyzer.ts swift` — **1.000 precision / 1.000 recall,
0 FP / 0 FN / 0 unknown** on 80 facts (28 symbols + 23 relationships in the
positive fixture, 9 symbols + 11 relationships in the negative fixture),
against the independently hand-audited ground truth in
`validation/m12/ground-truth/swift.json`.

Defects fixed during the M12.21 audit (all verified by the negative fixture):

1. **Blanket type-reference uses noise** — every `simple_type_identifier`/
   `user_type`/`type_identifier` emitted a `uses` edge (`uses Repository ->
   Repository`, `uses find -> String` twice, etc.). Removed; `uses` is now
   ONLY `self.` member reads.
2. **Params / locals / closures as symbols** — function params, `let`/`var`
   bindings inside bodies, and synthetic `closure_<line>_<col>` symbols are
   gone (C# `ParamsAreNotSymbols`/`LocalsAreNotSymbols`/
   `LambdaParamsAreNotSymbols`).
3. **Extension self-owner** — `extension UserService` previously created a
   `namespace` symbol owned by ITSELF. Now `extension` kind, named after the
   extended type, NO owner; members attach via contains (ObjC category
   precedent).
4. **Switch cases as enum_member** — `case` patterns in `switch` statements
   are no longer symbols (enum_entry gated to enum bodies).
5. **Constructor naming** — `init_declaration` is now named `constructor`
   (was the literal `init` token; Java/C# family).
6. **Capitalized calls double-edge** — `User(...)` emitted both `calls` and
   `instantiates`; now instantiates ONLY (Swift construction syntax).
7. **Member-call targets** — `users.first` → `first`, `users.append` →
   `append` (was the full navigation text, which never resolves).
8. **Override identity** — `overrides describe -> describe` (self-reference)
   is now the qualified, hierarchy-resolved
   `UserService.describe -> BaseService.describe`.
9. **Enum raw type** — `enum Status: String` previously emitted
   `implements Status -> String`; the raw type is now metadata only.
10. **Builtins** — bare `print`/`String(...)`/`Int(...)` calls are filtered
    (C# `BuiltinsAreFiltered` precedent).

## Real-corpus validation

`script/m12/swift-corpus-errors.ts` on swift-nio @ ec51fff0 (400-file sample):
**101/400 files carry grammar errors, 0 crashes, 0 timeouts.** All 101 are
genuine modern-Swift grammar gaps the newest available grammar (npm 0.7.1,
built and verified behaviorally identical) cannot parse, recorded honestly:
`@inlinable package` declarations, `isolated`/`borrowing` parameters, typed
`throws(ErrorType)`, `#isolation` macro expansion, `@_lifetime(borrow self)`
attributes, and Swift Testing macros (`#expect`/`#require`).

Grammar shape-safety: `script/m12/swift-node-types-compare.ts` — 54/88
analyzer node refs are emitted by the pinned grammar; the 34 absent refs are
dead defensive alternatives the grammar never emits (e.g. `actor_declaration`
— the grammar emits `class_declaration [actor]`; `variable_declaration` —
emits `property_declaration`; `public_keyword` — emits `visibility_modifier`
tokens), the same category as C/C++/Rust/ObjC pre-existing dead refs; the
1.000/1.000 differential proves the live shapes fire.

Closes M12.21 (GitHub issue #160).
