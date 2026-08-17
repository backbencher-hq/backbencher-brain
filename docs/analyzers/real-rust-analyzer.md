# real-rust-analyzer.md

## Language

- Analyzer file: `src/ast/real-rust-analyzer.ts`
- Parser: `tree-sitter-rust` **0.24.0** (npm, latest — upgraded from the
  previously pinned grammar in this milestone; `source_file` →
  `mod_item`/`struct_item`/`trait_item`/`enum_item`/`impl_item`/
  `function_item`/`use_declaration`/`call_expression`/`field_expression`/
  `struct_expression`/`macro_invocation` tree; `impl_item` → `trait` +
  `type` fields + `declaration_list`; `call_expression` → `function` (→
  `field_expression`/`scoped_identifier`/`generic_function`) + `arguments`)
- Language detection: `.rs` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealRustAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (pure-String helpers, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `mod_item` name; `struct_item`/`trait_item`/`enum_item` `type_identifier` (generics live in `type_parameters`, not the name); `function_item`/method identifier; impl symbol named after the implemented type (generics stripped); field `field_identifier`; enum variant name |
| kind | ✅ | modules → `module`; traits → `trait` (methods → `method`); structs (incl. unit structs) → `struct` (fields → `property`); impl blocks → `impl` named after the implemented type (M11 contract); methods → `method`; enums → `enum` (variants → `enum_member`); free functions → `function`; `pub use` re-exports stay in imports |
| qualified/container name | ✅ | `ownerName` = enclosing struct/trait/impl/impl-target; fields of impl blocks resolve to the implemented type (impl User → methods owned by User); Rust fields default to **private** — only `pub` fields are public (createSymbol no longer defaults missing visibility to public) |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ | function `parameters` → name/type pairs (`self_parameter` → `self`) |
| returnType | ✅ | function `return_type` node text |
| documentation/comments | — | n/a (Rust doc comments not extracted as doc) |
| complexity metrics | ✅ | cyclomatic complexity (match/if/while/loop/for); patterns (`Unsafe Code`, `Error Propagation (?)`, `Explicit Lifetimes`, `Auto Traits`, `Re-exports`, `Testing`, `Derive Macros`, `Must Use`, `Deprecated API`, panic macros) — pure-String scans |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | `pub`/`pub(crate)`/`pub(super)` visibility; `const fn`/`async fn`/`unsafe fn` modifiers; `#[get("/path")]` axum route → Exports edge (pure-String `extractRoutePath`) |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | REAL container ownership only: trait→method, struct→property, impl→method, enum→variant (post-loop over `ownerName`). Never `global contains X` / `root contains X`. | 1.0 |
| calls | ✅ | `call_expression` → callee leaf name (member calls `self.repository.add` → `add`, chains `values.iter().map()...` → one edge per call, macros `println!` → macro name, `::new()` → `new`); source = enclosing function/method name — the single emission path (the legacy per-function trace walk that double-emitted every call with a qualified `owner.method` source was removed) | 1.0 |
| uses | ✅ | non-call field access only (`self.counter`, `u.id` — `field_identifier` only; tuple indices `tuple.0` are not symbols and emit nothing); call-target field expressions skip the uses walk (the `calls` edge is the fact) — one edge per pair | 0.9 |
| instantiates | ✅ | struct literals (`User { id, name }` → `instantiates User`) and Rust constructor calls (`::new()` → `instantiates new`, paired with `calls` — documented, same as C's malloc pair) | 0.75–0.8 |
| implements | ✅ | trait impls: `impl super::Repository<User> for MemoryStorage` → `implements MemoryStorage -> Repository` (leaf trait name via `extractTraitName` — the full generic text was dropped by the production noise filter) | 1.0 |
| extends | ✅ | trait bounds: `trait Foo: Bar` → `extends Foo -> Bar` (leaf name) | 1.0 |
| imports | ✅ | `use` declarations (incl. `pub use`, `use super::`, scoped lists) → imports array — **no references edge** (Java-family contract; unlike C/C++ where `#include` targets header files) | 1.0 |
| exports | ✅ | public free functions/structs/traits; axum route attributes → Exports edge | — |
| overrides | — | n/a (Rust trait impls are captured as implements) | — |

## Supported constructs

- Modules: `mod storage;` → module symbol; `use super::User` / `pub use storage::MemoryStorage` → imports (no dangling references edge)
- Traits: `pub trait Repository<T>` → trait with method symbols; trait methods without `pub` are private (Rust semantics); trait bounds `trait Foo: Bar` → extends
- Structs: `pub struct User { pub id: u32, ... }` → struct + property symbols; non-pub fields are private; unit structs (`struct ForwardOnly;`) are real declarations
- Impl blocks: inherent `impl User` and trait `impl super::Repository<User> for MemoryStorage` → impl symbols named after the implemented type; methods owned by the type (not the impl block); trait impls emit `implements MemoryStorage -> Repository`
- Enums: `pub enum Status { Active, Inactive }` → enum + enum_member symbols
- Generics: `struct UserService<T: Repository<User>>` and `impl<T: Repository<User>> UserService<T>` — generics stripped from names (stored in `genericParameters`)
- Free functions: `pub fn transform(values: &[i32]) -> Vec<i32>` → function symbols
- Method calls: `self.repository.add(user)` → `calls create -> add` + `uses create -> repository` (receiver field access)
- Call chains: `values.iter().map(...).filter(...).collect()` → one calls edge per method (iter/map/filter/collect)
- Struct literals: `User { id, name: name.to_string() }` → `instantiates` (construction)
- Constructors: `MemoryStorage::new()`, `Vec::new()`, `User::new(...)` → `calls` + `instantiates` pair (Rust constructor convention)
- Macros: `println!(...)`, `format!(...)` → calls edge to the macro name
- Closures: `values.iter().map(|v| v * 2)` — closure parameters are execution artifacts (no symbols); field access inside closures still resolves (`u.id == id` → `uses find -> id`)
- Negative fixture: function-local `let` bindings → NO symbols; primitive types (`i32`, `String`, `&[T]`), generic params (`T`), lifetimes (`'a`) → NO type-reference edges; tuple indices (`tuple.0`) → NO uses edge; closure params → NO symbols

## Unsupported / explicit-unknown constructs

- The 79 corpus `grammarErrorFiles` are cargo testsuite files using
  `str![[r#"..."]]` — **double-bracket macro delimiters** (`m![[...]]`), a
  modern Rust macro-invocation syntax the newest available tree-sitter-rust
  grammar (0.24.0) cannot parse — all valid Rust, recorded honestly in the
  manifest (precedent: C 122, C++ 124, kotlin 51, fsharp 108). The cargo
  package manager's own test suite is the most idiomatic real-world Rust
  corpus, but its `str!` helper exercises this grammar-edge syntax
- `type Foo = Bar;` aliases, `if let`/`while let` (cyclomatic counter), and
  trait-bound node names are referenced defensively under names absent from
  both grammars (`type_alias_declaration`, `if_let_expression`,
  `while_let_expression`, `trait_bound`) — pre-existing dead conditions, not
  regressions (`type_item`/`if_let`/`while_let`/`type_identifier` are the real
  node names)
- Cross-file resolution (`User` declared in service.rs, used in storage.rs) is
  per-file by design — the analyzer signature does not consume the engine's
  companion index (production wiring of the cross-file context tracked by
  M12.44, same as Java/C/C++)

## Regex inventory

From `validation/m12/results/regex-census.json`: the Rust analyzer has **0
regex usages** (the 2 baseline regexes eliminated — census 99 → 97 total
across all analyzers). Replaced with pure-String scans: `extractRoutePath`
(axum method-attribute route extraction — the legacy
`/\[(?:get|post|put|delete)\("([^"]+)"\)\]/`) and `stripGenerics` (first-`<`
slice — the legacy `/<.*$/`).

## Complexity envelope

From `validation/m12/results/rust-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 3 | 32 | 54 | 287.0 | 112 | 188 | 196.8 MB |
| corpus_subset | 400 | 11634 | 80199 | 11139.7 | 1044 | 7199 | 341.8 MB |

Declared budgets: fixtures < 2 s (met: 0.29 s); 400-file corpus < 60 s
(met: 11.1 s).

Hot-path audit: single-pass DFS stack over AST children (O(nodes)); per-node
lookups use bounded child scans and the scope stack top; the contains
post-loop is one pass over the symbol list. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/rust.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the M11 Rust contract (M11.10, symbols-only 1.000/1.000) extended with the
  Java-family relationship ontology; 84 facts: 32 symbols (10 method, 4 impl,
  4 struct, 4 function, 5 property, 2 enum_member, 1 module, 1 trait, 1 enum)
  + 52 relationships (21 calls, 17 contains, 7 instantiates, 6 uses,
  1 implements))
- Result: `validation/m12/results/rust-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0` — verified both before and
  after the grammar upgrade (node shapes unchanged for the contract)

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `cargo@94faf917`
  (clean; 1373 tracked `.rs` files — 261 src + 101 crates + 993 tests of the
  Rust package manager: real language-representative Rust)
- Sample: 400 tracked `.rs` files (deterministic first-400 sorted slice of 649
  files ≥ 1KB, reproducible from `git ls-files`)
- Symbols 11634 / relationships 80199 / wall 11.1 s / **0 crashes / 0 timeouts
  / 79 error files** (19.8%) — down from 84/400 (21%) with the previous
  grammar; all 79 are cargo's `str![[...]]` double-bracket macro delimiter
  syntax — a genuine modern-Rust gap of the newest available grammar (see
  Unsupported). Scan script `script/m12/rust-corpus-errors.ts`
- Grammar swap verified: 5 real files fixed (src/ops/cargo_clean.rs,
  cargo_metadata.rs, src/util/cache_lock.rs, credential lib.rs, rustfix test),
  0 regressions, node-types superset (+32 incl. `try_block`, `gen_block`,
  `never_type`, −8 token/internal types, all analyzer-referenced shapes
  present — 4 dead defensive references absent from both grammars);
  differential unchanged at 1.000/1.000

## Evidence pointers

- Fixtures: `validation/m12/fixtures/rust/`
- Ground truth: `validation/m12/ground-truth/rust.json`
- Differential: `validation/m12/results/rust-differential.json`
- Complexity: `validation/m12/results/rust-complexity.json`
- Corpus scan: `script/m12/rust-corpus-errors.ts`
- Grammar compare: `script/m12/rust-wasm-compare.ts` / `script/m12/rust-node-types-compare.ts`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.18 (GitHub issue #157).
