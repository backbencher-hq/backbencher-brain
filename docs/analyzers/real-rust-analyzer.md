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
| calls | ✅ | `call_expression` → callee leaf name (member calls `self.repository.add` → `add`, chains `values.iter().map()...` → one edge per call, macros `println!` → macro name, `::new()` → `new` for the CALL while the paired `instantiates` names the receiver type); source = enclosing function/method name — the single emission path (the legacy per-function trace walk that double-emitted every call with a qualified `owner.method` source was removed) | 1.0 |
| uses | ✅ | non-call field access only (`self.counter`, `u.id` — `field_identifier` only; tuple indices `tuple.0` are not symbols and emit nothing); call-target field expressions skip the uses walk (the `calls` edge is the fact) — one edge per pair | 0.9 |
| instantiates | ✅ | struct literals (`User { id, name }` → `instantiates User`) and Rust constructor calls, which name the **RECEIVER TYPE** — `MemoryStorage::new()` → `instantiates MemoryStorage`, paired with `calls -> new` (the `instantiates -> new` form this doc used to claim named a *function* rather than a type and was retired; M12's rust truth carried the same stale rule and was re-grounded row by row on 2026-09-29). A constructor whose receiver is **not declared in the same file** stays silent — the deferred in-file rule, so `Vec::new()` emits `calls` and no `instantiates` | 0.75–0.8 |
| implements | ✅ | trait impls: `impl super::Repository<User> for MemoryStorage` → `implements MemoryStorage -> Repository` (leaf trait name via `extractTraitName` — the full generic text was dropped by the production noise filter) | 1.0 |
| extends | ✅ | trait bounds: `trait Foo: Bar` → `extends Foo -> Bar` (leaf name). A **higher-ranked** bound is a bound (RUST-D15): `trait DeserializeOwned: for<'de> Deserialize<'de>` publishes `extends DeserializeOwned -> Deserialize` on the bound's own line, and the `for<…>` binder is not a name (the F5 oracle used to fabricate `extends -> "for"` from it) | 1.0 |
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
- Constructors: `MemoryStorage::new()`, `User::new(...)` → a `calls` + `instantiates` pair, where the `calls` names the function (`new`) and the `instantiates` names the constructed TYPE (`MemoryStorage`, `User`) — the Rust constructor convention, and the split is what M12 now pins. `Vec::new()` is the control: its receiver is not declared in the file, so the `instantiates` half is silent by the deferred in-file rule
- Macros: `println!(...)`, `format!(...)` → calls edge to the macro name
  - **A macro invocation's NAME is a callee, not a read (RUST-D13).** The `calls`
    edge above is the whole story: a use-imported macro used to publish
    `uses -> bail` *beside* `calls -> bail` for one name at one line (269 sites
    over a 550-file slice). The invocation's **arguments** are reads and still
    publish. An imported *function* called by name never had the problem, which
    is what made this read as a macro quirk instead of a missing guard.
- **Declaration positions never read (RUST-D13).** Besides a macro name: a
  **trait method declaration** (a `function_signature_item`, which carries no
  body — its own name used to publish `uses -> current_dir -> current_dir`, a
  self-edge, when it also resolved) and a **fn-pointer type's parameter**
  (`type Store = extern "C" fn(schema: *const SecretSchema)` — a type alias, so
  no bound-name set excluded the name). A real function's parameters and a real
  method definition were already excluded; these two shapes had no such set.
- Constants: module-level and associated `const`/`static` publish a `variable`
  symbol; so do **function-local** ones (RUST-D17 — a local `const`/`static`
  names a value with a type, an initializer and a line, and is owned by the
  enclosing function), while a function-local `let` publishes nothing (M11.11's
  closure boundary: a local binding declares nothing outside its body).
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

## M14 verification (issue #261, 2026-08-28)

Deep line-by-line review of the analyzer and its differential residuals
against the pinned tree-sitter-rust grammar.

### Differential: ripgrep 1948/1948 (100%), 0 missing, 0 unexplained

Live run on the pinned `ripgrep` corpus (60 sampled files) is now
**0 missing / 0 unexplained** — previously 7 missing / 30 unexplained
(99.6%). The residual investigation found and fixed four analyzer defects
and two oracle defects:

1. **Scoped enum-variant struct literals dropped** (`MatchStrategy::Suffix
   { … }`): the `struct_expression` branch required a plain `type_identifier`
   and silently skipped `scoped_type_identifier` names. The instantiates
   target is now the VARIANT leaf (`Suffix`), matching the oracle's
   lastSegment and the family leaf-target contract.
2. **Turbofish whole-text call targets** (`cap.parse::<u32>()`): the
   `generic_function` branch took `baseNode.text` verbatim, so calls targeted
   `cap.parse` / the whole chain text instead of the callee leaf (`parse`).
3. **Parenthesized-closure callees fabricated** (`(self.0)(…)`): the else
   branch emitted `(self.0)` as a calls target; non-identifier callees are
   now skipped (no static name exists).
4. **`union_item` emitted NO symbol**: the grammar's union declaration node
   (`pub union Pixel { … }`) is `union_item`, not `struct_item`, and was
   unhandled. Unions now emit a struct symbol with fields.
5. **Trait associated types invisible**: trait-body `type Item;` parses as
   `associated_type` (only impl-level `type_item` was handled); both now emit
   Type symbols with correct ownership.
6. **Oracle dead branch**: the constructor-instantiation truth branch in
   `deriveRustEdges` was an `else if` after the first `call_expression`
   branch, so it NEVER ran — the oracle never derived `Foo::new()`
   instantiates. Enabled with an in-file declared-type filter mirroring the
   analyzer's deferred-resolution contract (impl types stored as full text,
   so `io::Error::new()` does not resolve to a local `Error`).
7. **Oracle leafOf didn't unwrap `generic_function`**: turbofish calls
   (`crossbeam_channel::bounded::<DirEntry>`) produced no call truth.

### Second deep pass (wave 3, same session)

Re-reading the sections the first pass didn't cover surfaced two more real
defects:

8. **Broken use-list import extraction**: `use std::io::{Read, Write as W}`
   produced `module="std::io::{Read, Write as W}"` with garbage items —
   violating the family contract (module = path prefix, items = individual
   names). `handleUseDeclaration` now separates the path prefix from the
   item names (alias-aware: `{a as b}` binds `b`), matching the JS family
   contract; `use std::io::*` wildcards emit `items:["*"]` (probe-confirmed
   `std::io` → `[Read, W]`, `crate::foo` → `[foo, Bar, B]`, `super::util`
   → `[*]`).
9. **Awaited-call DUPLICATE edge**: the `await_expression` branch pushed a
   raw calls edge with the FULL function text as target, and the DFS then
   visited the inner `call_expression` too — so `do_connect(host,port)
   .await` produced TWO calls edges (one full-text, one leaf-qualified).
   The oracle derives one edge per call site, so the duplicate was a
   fabrication that only appeared on awaited code (ripgrep corpus has
   none). The await branch now records the inner node and the canonical
   call/macro handler attaches `rustSpecific + isAwait` to its SINGLE edge.

Both fixes are pinned: `rust/await-single-edge` (exactly one calls edge
per awaited site, isAwait metadata, leaf target + qualified) and
`rust/use-list-imports` (module/items contract: `std::io` → `[Read, W]`,
alias-aware `Write as W` → W, wildcards → `[*]`, `extern crate` with
externalCrate metadata — the differential oracle derives no import
truth, so the fixture is the SOLE regression guard for the import fix).
Seven rust mutants guard the fixes (incl. `rust/duplicate-awaited-call-edge`
and `rust/raw-use-list-import`), all caught (suite 122/122; 8 rust
fixtures). The floor `ripgrep:rust {missing:0, unexplained:0}` is
enforced in `validation/m14/differential-baseline.json`.

### Completeness contract (#419) — 185 types, A–H 8/8

`script/m14/spec/rust-completeness.json` classifies every named node type
of the pinned grammar (42 handled_verified, 121 internal_silent, 0 gaps,
3 RULED decisions: RUST-D1 trait-hierarchy semantics, RUST-D2 opaque
macro_rules! bodies, RUST-D3 grammar-scoped scope). Registered in
`completeness-inventory.ts` with requiredKinds (uses/references/exports/
contains/calls/extends/implements/instantiates), payload pins
(complexity + qualified_calls via `rust/payload-parity`), and the
`ripgrep:rust` floor. Grammar audit PASS (329 node types, 63 referenced,
0 unknown).

## Evidence pointers

- Fixtures: `validation/m14/fixtures/rust/` (M14) and
  `validation/m12/fixtures/rust/` (M12)
- M14 differential evidence: `validation/m14/results/M14.0.F5.json`
- M14 completeness evidence: `validation/m14/results/M14.0.SPEC.json`
- M14 mutation evidence: `validation/m14/results/M14.0.F4.json`
- Fixtures baseline: `validation/m14/fixture-baseline.json`
- Ground truth: `validation/m12/ground-truth/rust.json`
- Differential: `validation/m12/results/rust-differential.json`
- Complexity: `validation/m12/results/rust-complexity.json`
- Corpus scan: `script/m12/rust-corpus-errors.ts`
- Grammar compare: `script/m12/rust-wasm-compare.ts` / `script/m12/rust-node-types-compare.ts`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.18 (GitHub issue #157).
