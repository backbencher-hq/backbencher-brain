# real-go-analyzer.md

## Language

- Analyzer file: `src/ast/real-go-analyzer.ts`
- Parser: `tree-sitter-go` (pinned `wasm/tree-sitter-go.wasm`; npm
  tree-sitter-go 0.25.0 verified behaviorally identical on the corpus via the
  production `parseFile` path — 5 vs 5 grammar-error files, 0 fixed, 0
  regressed — so no upgrade was warranted; `source_file` →
  `package_clause`/`import_declaration`/`function_declaration`/
  `method_declaration`/`type_declaration`/`var_declaration`/
  `const_declaration` tree; fields via `field_declaration_list` →
  `field_declaration` with `name`/`type`/`tag` fields)
- Language detection: `.go` → `go` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealGoAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (leaf-name extraction, quote stripping, struct-tag
  key/value parsing, signature normalization — no regex; 9 census regex
  usages eliminated in M12.22, census 95 → 86).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `package_clause` `package_identifier` → module; `type_spec` `name` → struct/interface; `field_declaration` `name` (repeated names share the field type); `function_declaration`/`method_declaration` `name`; `var_spec`/`const_spec` `identifier`s at package scope only |
| kind | ✅ | `interface_type` → `interface`; `struct_type` → `struct` (Systems family, was `class`); `method_declaration` → `method` (owner = receiver type, ownerKind `struct`); bare `function_declaration` → `function`; struct fields → `property`; package-scope `var_spec` → `variable`, `const_spec` → `constant`; other `type_spec` bodies → `type` |
| qualified/container name | ✅ | `ownerName` = receiver type for methods, declaring struct/interface for fields and interface methods, `parentStruct` for generic walk |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ | `parameter_list` → `parameter_declaration` (`name` + `type`); interface `method_spec` params via `extractGoMethodSpecParameters`; function-local params are NOT symbols (C# M12.07 negative contract: `ParamsAreNotSymbols`) |
| returnType | ✅ | `result` field / trailing type node (interface method specs too) |
| visibility | ✅ | `isGoExported` (capitalized first letter — pure char check, no regex) → `public`/`private` |

## Relationship ontology

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | ownerName pass (Rust M12.18 line-250 contract): every symbol with an owner gets ONE `contains owner -> member` — struct fields (`contains User -> ID`), interface methods (`contains Repository -> Find`), methods (`contains UserService -> Save`). Never `contains package -> X` (package contains noise removed). | 1.0 |
| extends | ✅ | struct embedding — anonymous `field_declaration` with no name (`type UserService struct { BaseService; ... }` → `extends UserService -> BaseService`, method promotion). ONE extends edge, no contains twin (Java/C++/Swift/ObjC inheritance contract). | 0.8 |
| implements | ✅ | implicit interface satisfaction (Go duck typing): `checkGoInterfaceImplementation` matches interface method signatures against the implementor's value/pointer receiver method sets (own + promoted), and a method matches only on the SAME name AND the SAME canonical signature — parameters by TYPE only (a parameter name is not part of a Go method signature), grouped declarations (`a, b int`) expanded one parameter per name, a VARIADIC parameter rendered `...T` (`...T`, `T` and `[]T` are three different types), named results reduced to their types, no result = `void`. Implementor CANDIDATES are the declared non-interface types PLUS every method-receiver type name with no same-file `type` declaration (Go method sets are package-level: gopls declares `clientDispatcher` in `protocol.go` and all of `Client`'s methods in `tsclient.go`), and interface method sets fold embedded interfaces through alias (`type A = interface{…}`) and diamond (`A { B; C }`, `B { D }`, `C { D }`) embeddings with a PATH mark, not a global visited set. Source = the implementor name as written (was `*UserService`; Java/Rust implements contract). The differential oracle mirrors all of it. | 1.0 |
| calls | ✅ | `call_expression` from `qualified_calls` — LEAF targets incl. stdlib (`s.repo.Save(user)` → `calls Save -> Save` like Rust's `self.repository.find` → `calls find -> find`; `strings.ToUpper(v)` → `calls transform -> ToUpper` like Rust's `calls normalize -> println`). Goroutine (`go f()`) and defer (`defer g()`) spawns are calls edges, deduped against qualified_calls — one edge per (source, target). Go builtins (`append`/`len`/`make`/`new`/...) filtered (`BuiltinsAreFiltered`). | 0.8 |
| instantiates | ✅ | PascalCase top-level FUNCTION calls only (`NewUser(...)` → `instantiates Find -> NewUser` — Go constructor convention). Methods and unresolved stdlib leaves never instantiate. | 0.6 |
| uses | ✅ | selector field access — source = containing function/method, target = field LEAF (`b.name` in `Describe` → `uses Describe -> name`, `s.repo` in `Save` → `uses Save -> repo`; Rust `uses create -> repository` analog). Selectors that are the callee of a `call_expression` are skipped (the calls edge handles them). | 0.7 |
| references | ✅ | imports → `references <package> -> <module>` (`import "fmt"` → `references service -> fmt`; C/C++/Swift/ObjC import-reference pattern). | 0.9 |

## Regex census

Baseline at M12.01: **9 usages** in `real-go-analyzer.ts` (struct-tag parsing,
`@Router` comment scanning, import-path quote stripping, pointer/slice
marker stripping, signature normalization). After M12.22: **0 usages** — all 9
replaced with pure char scans / AST token children (verified by the census
gate; census 95 → 86).

## Complexity envelope

Measured by `script/m12/measure-analyzer.ts` (results in
`validation/m12/results/go-complexity.json`):

- Fixtures: 2 files, 30 symbols, 34 relationships, 1.1 s
- Corpus subset: 400 files (go-tools @ bf54bcd2, deterministic first-400 of
  1,327 tracked `.go` files ≥ 1KB), **7,157 symbols, 28,187 relationships,
  25.1 s** — 286 symbols/s, 1,124 relationships/s
- All hot paths are single-pass over per-file symbol sets; the interface
  implementation check is a bounded interfaces × structs pairwise match (Rust
  family pattern) — no O(n²).

## Differential verification

`bun script/m12/verify-analyzer.ts go` — **1.000 precision / 1.000 recall,
0 FP / 0 FN / 0 unknown** on 64 facts (24 symbols + 22 relationships in the
positive fixture, 7 symbols + 11 relationships in the negative fixture),
against the independently hand-audited ground truth in
`validation/m12/ground-truth/go.json`.

Defects fixed during the M12.22 audit (all verified by the negative fixture):

1. **9 regexes** — struct tags, `@Router` comment, import quotes,
   pointer/slice markers, signature normalization → pure char scans.
2. **Locals as symbols** — function-local `var`/`const` (and their specs) no
   longer become symbols (C# `LocalsAreNotSymbols`).
3. **Struct kind** — `struct_type` → `struct` (was `class`).
4. **Embedding double-edge** — embedded types emitted BOTH `contains` and
   `extends`; now one `extends` edge only; field-type `uses` dropped (Rust
   contract — no dangling type-text targets like `uses UserService -> []*User`).
5. **Pointer-receiver implements** — `implements *UserService -> Repository`
   → `implements UserService -> Repository` (plain source name).
6. **Call targets** — `s.repo.Save(user)` → `calls Save -> Save` (leaf), and
   stdlib `strings.ToUpper(v)` → `calls transform -> ToUpper`; the old
   `targetFunction !== func.name` guard removed (Rust emits self-named leaf
   calls like `calls find -> find`).
7. **Instantiates** — PascalCase top-level functions only (Go `NewXxx`
   constructor convention); methods and unresolved stdlib leaves never
   instantiate.
8. **Selector uses source** — `uses s -> name` / `uses s.repo -> Save` →
   `uses Describe -> name` / `uses Save -> repo` (source = containing
   function, target = field leaf; call-callee selectors skipped).
9. **Package contains noise** — `contains service -> X` for every exported
   symbol removed (Rust GT has no module contains).
10. **Goroutine/defer dedup** — `go process()`/`defer cleanup()` emitted
    duplicate `calls` edges (once from qualified_calls, once from the pattern
    walk); now deduped to one edge per (source, target).
11. **OwnerName contains pass** — struct fields, interface methods, and
    methods all get ONE `contains` edge via the ownerName pass (was
    receiver-only + package exports, missing `contains Repository -> Find`
    and `contains User -> ID`).

## Real-corpus validation

`script/m12/go-corpus-errors.ts` on go-tools @ bf54bcd2 (400-file sample):
**5/400 files carry grammar errors, 0 crashes, 0 timeouts.** All 5 are
testdata files for go vet analysis passes (generic type aliases with
constraints, parenthesized builtin calls, 2025-copyright modernize tests) —
valid Go the pinned grammar cannot parse, recorded honestly.

Grammar shape-safety: `script/m12/go-node-types-dump.ts` — **29/29 analyzer
node refs are emitted by the pinned grammar, 0 dead** (the analyzer only
references shapes the grammar actually produces; the 1.000/1.000 differential
proves the live shapes fire).

Closes M12.22 (GitHub issue #161).
