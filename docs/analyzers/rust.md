# rust.md

## Language

- Analyzer file: `src/ast/real-rust-analyzer.ts`
- Parser: the wired `wasm/tree-sitter-rust.wasm`, sha256
  `f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57` (1,102,547
  bytes; binding table `validation/m14/verification/GRAMMAR-BINDINGS-2026-10-21.md`,
  served digest = wired digest). Measured 2026-11-03 through `getParser("rust")`:
  **355 type ids, 185 named ids, 163 unique named types**. The npm package
  version this wasm was built from is **not recorded in the tree — unknown**; the
  former "0.24.0 npm" claim is kept only as unverified history. Node shapes in
  use: `source_file` → `mod_item`/`struct_item`/`trait_item`/`enum_item`/
  `impl_item`/`function_item`/`use_declaration`/`call_expression`/
  `field_expression`/`struct_expression`/`macro_invocation`; `impl_item` →
  `trait` + `type` fields + `declaration_list`; `call_expression` → `function`
  (→ `field_expression`/`scoped_identifier`/`generic_function`) + `arguments`;
  `macro_invocation` → macro name + a `token_tree` **child** (there is no
  `token_tree` field — a dead field read was removed on 2026-11-03).
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
| complexity metrics | ✅ | cyclomatic complexity (match/if/while/loop/for branches); patterns are AST-node driven (`Unsafe Code` from `unsafe_block`, `Error Propagation (?)` from `try_expression`, `Explicit Lifetimes` from `lifetime`, `Auto Traits`/`Re-exports` from declared trait bounds and `use` clauses) EXCEPT the four attribute-marker patterns (`Testing`, `Derive Macros`, `Must Use`, `Deprecated API`), which scan the attribute TEXT already extracted from the AST — never source text |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | `pub`/`pub(crate)`/`pub(super)` visibility; `const fn`/`async fn`/`unsafe fn` modifiers; an outer attribute applied to a declaration → `decorates` edge (both classes via `metadata.attributeKind`); `#[derive(…)]` → `mixes_in` per derived trait; `#[get("/path")]` axum route → `Exports` edge (pure-String `extractRoutePath`); inner `#![…]` and nameless-target attributes are refused and counted (`metadata.unattributedEdges`) |

## Relationship ontology

The single canonical claim table for this analyzer: one row per value of the 14-value register,
in register order (`src/ast/types.ts`). Emission sites measured against
`src/ast/real-rust-analyzer.ts` at HEAD 2026-11-03; the current whole-population counts are the
2026-10-23 arm (`validation/m14/measurements/rust-gate-whole-2026-10-23.txt`, 2,532 files, 326,101
edges, closure exact — see `## Corpus validation`). `evidenceClass` is the value the shared tier
classifier (`classifyEvidenceTier`) writes onto the edge.

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | `call_expression` → callee LEAF read from the tree (bare identifier; `field_expression` field → `self.repository.add` gives `add`; `scoped_identifier` name → `cap.parse::<u32>()` gives `parse`; turbofish `::<T>` unwrapped). A macro invocation is a callee too (`macro_invocation` → macro name, one edge per site). Source = enclosing function/method; `Self(…)` resolves to the enclosing impl type; a file-scope invocation has no owner and is REFUSED, counted in `metadata.unattributedEdges`. Qualified targets are re-spelled `T::m` only when the file declares the member (`publishQualifiedCallTargets`). | 1.0 (`usage_contextual` fallthrough) |
| extends | ✅ | `trait Foo: Bar` supertrait bounds → `extends(trait Foo -> Bar)`; a `higher_ranked_trait_bound` is unwrapped to its inner type node; `metadata.traitBound`. Generic parameters are skipped. | 1.0 (`structural`) |
| implements | ✅ | `impl Trait for Type` → `implements(Type leaf -> trait leaf)`; source is the implemented TYPE (nominal leaf), target the trait's leaf name. | 1.0 (`structural`) |
| uses | ✅ | Two sites. (a) non-call `field_expression` field reads (`self.counter`, `u.id`; tuple indices are not symbols) → `uses(owner -> field)`, one edge per pair. (b) bare `identifier` reads that resolve to a file-visible VALUE owner (fn/const/static/local binding) → `uses(owner -> name)`; declaration positions are never reads (macro names, trait-method signatures, fn-pointer parameters, attributes, `use` paths, where-bounds), and a name bound inside an UNEXPANDED macro argument is published at 0.6 with `reasonCode: "unexpanded-macro-argument"`. | 0.9 field reads · 1.0 identifier reads · 0.6 macro-argument reads (`usage_contextual`) |
| imports | ✅ | `use_declaration` at file, module or function scope → `imports(scope symbol -> written module PATH)`: the path is the import's dependency (`use std::io::{Read, W}` → `std::io`), the bindings ride `metadata.items`; file scope sources the edge as `(file)` (`fileLevel: true`). Claims: `importProjectFile` (a project-relative file statted before it is written) and `languageNamespace` (`std`/`core`/`alloc`). Payload channel: `import-site: ImportInfo[]` is populated too (`ctx.imports`). | 1.0 (`import_based`, declared in metadata) |
| exports | ✅ | Two sites. (a) `publishExport`: every file-scope `pub` item, `pub use` re-export and `#[macro_export]` macro → `exports(module -> name)`, one row per published unit, file-scope source = `(file)` (`fileLevel: true`). (b) an actix/axum route attribute (`#[get("/path")]`) → `exports(handler fn -> route path)`. Payload channel: `export-site: ExportInfo[]` is populated too (`ctx.exports`). | (a) 1.0 (`structural`); (b) no confidence written (tier classifier reads 1.0; `structural`) |
| contains | ✅ | Post-loop over the symbol table: REAL container ownership only, from `ownerName`/`scope` — trait → method, struct/union → field (`property`), impl → method (owned by the IMPLEMENTED type), enum → variant, enclosing module → member. No `global`/`root` synthetic source: a file-scope declaration publishes no contains edge. | 1.0 (`structural`) |
| references | ✅ | Two sites. (a) declared-type surface — fn params/returns, struct/union field types, enum-variant field types, type-alias right-hand sides, const/static types → `references(declaration -> type leaf)`, `metadata.relationshipType: "declared_type"`, generic params and primitives skipped, `Self` resolves to the enclosing impl type. (b) where-clause bounds (`where T: Trait`) → `references(declaration -> bound leaf)`, `metadata.whereBound`. | (a) 0.9 (`import_based` per the classifier's references branch) · (b) no confidence written (`reference_qualified`) |
| overrides | ✅ | `impl Trait for Type` methods → `overrides("Type.m" -> "m")`, target the MEMBER LEAF. For a trait declared IN THIS FILE, only methods the trait declares emit (`reasonCode: "local-trait-signature"`, 1.0); when the trait is declared outside the file, the impl's methods emit for the named trait (`"cross-file-trait-signature"`, 0.85). No signature comparison: a same-named method is paired. | 1.0 local · 0.85 cross-file (`structural` at 1.0, `usage_contextual` at 0.85) |
| instantiates | ✅ | Three sites, all `metadata.isConstructor: true`. (a) `struct_expression` `User { … }` → `instantiates(owner -> type leaf)` (scoped enum-variant literal targets the VARIANT leaf; `Self` resolves to the enclosing impl type). (b) constructor calls naming the RECEIVER TYPE (`MemoryStorage::new()`) → `instantiates(owner -> receiver type)`, deferred until the file declares that type (the `inFile` filter). (c) a BARE tuple-shape constructor `Unit()` only when the file declares a tuple-shape struct of that name visible at the call site. Nothing std/foreign is fabricated. | 0.8 (`usage_contextual`) |
| decorates | ✅ | An OUTER `attribute_item` applied to its following named declaration → `decorates(declaration name -> attribute name as written)`, e.g. `Config -> derive`, `run -> tokio::main`; `metadata.attributeKind` splits `builtin_directive` from `applied_callable_candidate`, `isQualifiedPath` keeps the path fact. An inner `#![…]` attribute (no declaration sibling) and an attribute whose sibling is not a nameable declaration are REFUSED AND COUNTED (`decorates:inner_attribute`, `decorates:unnamed_declaration`, …). Whole population: 16,195 outer sites = 15,930 rows + 265 counted; 202 inner sites all counted (`validation/m14/measurements/rust-extended-census.json`). | 1.0 (`usage_contextual` fallthrough) |
| renders | ✅ | UI-framework macros `view!`/`html!`/`rsx!`/`render!`/`maud!`/`markup!` whose `token_tree` carries an angle-tag shape (`<` identifier … `>`/`/>`) whose tag identifier names a SAME-FILE callable or type → `renders(enclosing fn -> component)`; `metadata.renderMacro`, `isComponentTag`. Bare HTML tags (`div`) and undeclared tags are refused and counted. IMPLEMENTED AND CORPUS-UNEXERCISED: 0 render-macro invocations over the whole admitted population. | 1.0 (`usage_contextual` fallthrough) |
| mixes_in | ✅ | `#[derive(A, B)]` → one `mixes_in(declaration name -> derived trait)` per derive ARGUMENT; the derived trait is the RIGHTMOST segment of a qualified path (`serde::Serialize` → `Serialize`), because `::` flattening puts the segments in the token_tree as sibling identifiers. `metadata.isMixin`, `deriveComposition`. Whole population: 11,176 rows = the census's `derive_args_total` 11,176 exactly. The measured alternative `use Trait as _` (431 `use_as_clause`, 132 `as _`) is a SCOPE import, not a type's chain, and is not this relation. | 1.0 (`usage_contextual` fallthrough) |
| part_of | ✅ | `include!("path.rs")` — TEXTUAL file inclusion: the fragment's tokens land in the INCLUDING file's scope and it has no module identity. `part_of(enclosing scope -> written PATH, quotes stripped)`; file scope sources as `(file)` (`fileLevel: true`); `metadata.partRole: "library"`, `isFileInclusion`. The target is a PATH because a fragment has no symbol, and the `importProjectFile` claim is statted before it is written, so a confirmed row lands `extOK`. `include_str!`/`include_bytes!` are data inclusion, not textual splicing, so they publish only their macro-call edge (census: 20 + 2 sites), never `part_of`; a non-literal `include!` argument is refused and counted (`part_of:include_non_literal`). NOT `mod x;` (fleet ruling L-2026-10-21-06: ownership/split — a resolvable module is the opposite of a fragment; the census counts 1,898 file-declarations + 227 inline as the rejected near miss). Whole population: 3 rows, all extOK = the census's 3 single-string-literal sites. | 1.0 (`usage_contextual` fallthrough) |

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
- Type aliases and trait associated types (`type_item` / `associated_type`): publish `Type` symbols; the alias right-hand side and associated-type bounds are `references` — there is no `type_alias_declaration` node to defend
- Unions: `pub union Pixel { … }` (`union_item`) → a struct-kinded symbol with its fields
- Attributes (2026-10-23): an OUTER attribute applied to a declaration → `decorates` (declaration name → attribute name as written, e.g. `Config -> derive`, `run -> tokio::main`), both classes published via `metadata.attributeKind`; `#[derive(A, B)]` → one `mixes_in` per derived trait, the RIGHTMOST segment of a qualified path. An inner `#![…]` attribute and an attribute whose sibling is not a nameable declaration are refused AND COUNTED (`metadata.unattributedEdges`, keys `decorates:*`) — 16,195 outer sites = 15,930 edges + 265 counted, 202 inner sites all counted
- File inclusion (2026-10-23): `include!("path.rs")` → `part_of` — textual splice: the fragment shares the including file's scope and has no module identity. Source = enclosing scope (`(file)` at file scope), target = the written PATH with an `importProjectFile` claim statted before it is written; `include_str!`/`include_bytes!` are data inclusion (they publish only their macro-call edge — census 20 + 2 sites), and a non-literal `include!` argument is refused and counted (`part_of:include_non_literal`). `mod x;` is OWNERSHIP, not `part_of` (fleet ruling L-2026-10-21-06: a resolvable module is the opposite of a fragment)
- UI-framework render macros (2026-10-23): `view!`/`html!`/`rsx!`/`render!`/`maud!`/`markup!` whose `token_tree` carries an angle-tag shape naming a SAME-FILE callable or type → `renders` (enclosing fn → component); bare HTML tags and undeclared tags are refused and counted. IMPLEMENTED, CORPUS-UNEXERCISED: 0 render-macro sites over the whole 2,532-file admitted population
- Negative fixture: function-local `let` bindings → NO symbols; primitive types (`i32`, `String`, `&[T]`), generic params (`T`), lifetimes (`'a`) → NO type-reference edges; tuple indices (`tuple.0`) → NO uses edge; closure params → NO symbols

## Unsupported / explicit-unknown constructs

- The corpus `grammarErrorFiles` are cargo files using the `str!` macro —
  **CORRECTED 2026-09-30: this was recorded for years as a double-bracket
  delimiter gap (`str![[r#"..."]]`) and that diagnosis was WRONG.** Minimal cases
  settle it: `str![1]` and `str!["x"]` fail to parse with EITHER bracket count,
  while `Str![1]`, `xstr!["x"]`, `my_str![1]` and `vec![1, 2]` all parse clean.
  `str` lexes as the **primitive-type keyword** in tree-sitter-rust, so it can
  never be a macro name. The double-bracket form is a second, smaller gap on top.
  `str!` is the most common macro in modern cargo code, and this one token costs
  more than any other grammar limitation in the lane: **475 of the 476 affected
  files parse completely after a same-length substitution** — `str!` → `Str!` are
  both three characters, so every line and offset survives. Still valid Rust,
  still recorded honestly in the manifest (precedent: C 122, C++ 124, kotlin 51,
  fsharp 108). See `RUST-D23`.
- **Dead grammar spellings are GONE, not defended (measured 2026-11-03).**
  The former bullet here claimed `type Foo = Bar;` aliases, `if let`/`while let`
  and trait-bound names were "referenced defensively" under
  `type_alias_declaration` / `if_let_expression` / `while_let_expression` /
  `trait_bound`. All four are deleted from the analyzer and the grammar-audit
  register records rust at **0 dead literals**
  (`validation/m14/grammar-audit-baseline.json`); the real node names are
  `type_item`/`associated_type`, `if_let`/`while_let`, and `trait_bounds` (a
  direct `type_identifier` child — no `trait_bound` node exists). This wave
  removed the last two dead reads: `childForFieldName("token_tree")` on
  `macro_invocation` (the grammar declares no such field; the `token_tree` is a
  named CHILD) in the `part_of`/`renders` emitters. The audit at HEAD is
  **PASS refs=88 unknown=0 unknownFields=0**; before the fix it was
  `unknownFields=2` and FAIL.
- Cross-file resolution (`User` declared in service.rs, used in storage.rs) is
  per-file by design — the analyzer signature does not consume the engine's
  companion index (production wiring of the cross-file context tracked by
  M12.44, same as Java/C/C++)

## Regex inventory

The Rust analyzer has **0 regex literals at HEAD**: the AST census over the
committed blobs (`validation/m12/results/regex-census.json`, "HEAD blobs") has
no `real-rust-analyzer.ts` row, and the fleet total at that artifact is **0** —
not the 97 this section used to quote. The last ten literals this analyzer
carried (six `Cargo.toml` manifest reads, two `^[A-Z]` leaf tests, a `-`→`_`
replacement and one two-segment path-shape test) were removed on 2026-10-23:
the manifest reads became the section-aware TOML reader `rustManifestFacts`,
proved equal to the served `wasm/tree-sitter-toml.wasm` over **746 tracked
`Cargo.toml` files with 0 disagreements**
(`script/m14/rust-manifest-ast-verify.ts`); the rest became code-point helpers
(`startsUpperAscii`, `isTwoSegmentIdentPath`). Earlier removal history: the two
baseline regexes were replaced by the pure-String `extractRoutePath` and
`stripGenerics`.

## Complexity envelope

From `validation/m12/results/rust-complexity.json` — the **2026-08-28 M12
measurement, kept as history**: the "fixtures" row is the three-file perf
fixture, not today's 34-fixture `validation/m14/fixtures/rust/` suite, so it is
not a current whole-suite timing and the current arm has not been re-benchmarked
on this box (unknown).

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
- **Current wire (2026-11-03).** The M14 differential's rust arm now pushes
  independently derived truth for `calls`, `uses`, `declared-type references`,
  `where-bound references`, `contains`, `imports`, `exports`, `overrides`, and
  the four extended labels (the attribute/derive/include!/render branches in
  `deriveRustEdges`), plus rust's 14-label allowlist — `script/m14/differential.ts`,
  the `if (lang === "rust")` arm. The two historical harness gaps this page used
  to report are CLOSED: `contains` truth is pushed (it was imported and never
  called) and `overrides` truth is pushed (it was unwired); both derivations are
  in the current file.

## Corpus validation

Two measurements live here and they are NOT comparable: the CURRENT one over the
admitted population (2026-10-23, 2,532 files, closure exact) and the HISTORICAL
M12 / full-extent sweeps, which predate the admitted-population rule (the disk
sweeps counted every `.rs` present, the arm counts the git-tracked ≤ 1 MiB set).
Each block names its own scope and artifact.

### Current admitted population (2026-10-23 arm) — 2,532 `.rs` files, closure exact

The current measurement is the lane's ONE whole-population arm over the ADMITTED
set (per-checkout `git ls-files`, `.rs`, present on disk, ≤ 1 MiB; **never the
disk alone**): **parsed=2,532/2,532 admitted=2,532, 9 repositories, 0 parse
failures, 0 degraded**, **326,101 edges** = 130,039 resolved + 110,581
ambiguous(decl) + 77,932 unresolved + 7,549 extOK (imports 7,546 + `part_of` 3),
unclassed 0. Closure is exact at every level. Artifacts: arm log
`validation/m14/measurements/rust-gate-whole-2026-10-23.txt`; per-type closure
and cause rulings `validation/m14/instruments/rust/incoming-declaration.json`;
extended-types construct census
`validation/m14/measurements/rust-extended-census.json`. The analyzer bytes the
arm measured are `sha256:d8f03293…` (the declaration's `analyzerDigest`); the
only later analyzer changes were refusal counters and a derive line-index
correction, which the declaration records as moving no edge. The M12 400-file
record and the 13,101-file full-extent sweep below are HISTORY — they predate
the admitted-population rule and are not comparable with this number.

### Historical M12 pass (2026-08-28) — 400 tracked `.rs` files

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

### Corpus validation at full extent (2026-09-30) — 13,101 real `.rs` files

The record above is the 2026-08-28 M12 pass and is kept as history. The lane is
now validated against **13,101 real `.rs` files across six pinned corpora**:

| corpus | pin | `.rs` files |
|---|---|---|
| rust-lang/rust `src/` | `master` (library + compiler + tools, incl. rust-analyzer and clippy) | 10,505 |
| cargo | `523e530` | 1,372 |
| tokio | `aa18e84` | 807 |
| serde | `6693a89` | 208 |
| ripgrep | `3fce3b5` | 110 |
| hyper | `e60932d` | 99 |

**`tests`, `test`, `benches` and `examples` are included.** They are where
`macro_rules` takes its strangest forms and where a declaration-position bug hides
most easily; an audit that skips them audits a corpus nobody ships, so the skip
list is down to non-source trees only (`.git`, `target`, `node_modules`, `vendor`).

Two findings came out of that scope change, both recorded in the spec:

- **RUST-D21 — a wasm tree must be released explicitly.** Sweeping this corpus
  aborted mid-run: 4,000 files clean, 5,000 aborts in `ts_parser__reduce` →
  `ts_malloc_default`, while **all 7,773 rustc files parse individually**. The
  grammar rejects nothing; web-tree-sitter simply never frees a `Tree` without
  `tree.delete()`, so one retained tree per file exhausts the wasm heap. Because
  these tools print their report at the END, exhaustion produced **no output at
  all** — indistinguishable from an empty corpus. The first fix (recycling the
  parser) was wrong and the growth curve is what proved it: monotonic
  375 → 491 → 936 MB before, flat 311 → 149 → 103 MB after. Production is immune
  by design — `parallel-indexer`'s worker `exit` handler respawns the worker and
  re-routes its batch, and a fresh worker's fresh heap succeeds.
- **RUST-D19 — a trait method signature's parameters declare.** Found only at
  full extent: cargo's `src/compiler/mod.rs:142-143` published `uses` edges for
  `on_stdout_line`/`on_stderr_line` parameters of a bodiless
  `function_signature_item`, because `collectFunctionBindings` collects
  `function_item` only. Two sites in 13,101 files — the whole argument for a
  full-extent gate as its own run rather than a larger sample.

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

### Completeness contract (#419) — 163 unique named types, A–H 8/8

`script/m14/spec/rust-completeness.json` classifies the served grammar's
**163 unique named types** plus the universal `ERROR`/`MISSING` pair = 165
accounted rows: **43 handled_verified, 122 internal_silent, 0 gaps**, and a
**43-entry design-decision register** (RUST-D1…RUST-D43: 33 RULED, 8 FIXED, 2
mixed/superseded — e.g. RUST-D1 trait-hierarchy semantics, RUST-D2 opaque
`macro_rules!` bodies, RUST-D3 grammar-scoped scope). The spec's `coverage`
block lists the **14 implemented relationship types**, with `renders` declared
implemented-and-corpus-unexercised (never an exclusion). Registered in
`completeness-inventory.ts` with requiredKinds (uses/references/exports/
contains/calls/extends/implements/instantiates), payload pins
(complexity + qualified_calls via `rust/payload-parity`), and the
`ripgrep:rust` floor. **Grammar audit at HEAD 2026-11-03: PASS refs=88,
unknown=0, unknownFields=0** (`npx tsx script/m14/audit-analyzer-grammar.ts
--lang rust`); the register records rust at 0 dead literals. (The former
"185 types / 42 / 121 / 3 RULED / 329 node types / 63 referenced" numbers were
stale-era counts from before the vocabulary grew; corrected here.)

## Ontology measurements — INCOMING_RUST census (2026-10-04)

> **SUPERSEDED IN FOUR PLACES (corrected 2026-11-03).** The ONE canonical claim
> table for this analyzer is `## Relationship ontology` above; this section is the
> 2026-10-04 nine-type census (ripgrep@3fce3b5), kept as measured history. What
> changed after it: (1) `imports` and `exports` now emit RELATIONSHIP edges as
> well as their payload channels — the "0 relationship edges"/"dormant" cells
> below are annotated; (2) `contains` and `overrides` differential truth IS now
> pushed (the §2(3) "compared with no truth" harness gap is closed); (3) the
> census-era claim "no edge below 0.7, no reasonCode" is contradicted by the
> current analyzer (0.6 macro-argument reads, 0.85 cross-file overrides) and is
> corrected in §2(6); (4) the four extended labels
> (`decorates`/`renders`/`mixes_in`/`part_of`) were implemented on 2026-10-23
> and are not part of this nine-type census. Every other number here is the
> census's own measurement and is kept.

Lane: `analyzer/INCOMING_RUST2`. Corpus: `ripgrep@3fce3b5` — 110 tracked `.rs`,
110 parsed, 0 parse errors, 5,150 symbols, 27,963 relationships, via
`ASTEngine.parseFile` (the production entry: detectLanguage → getParser → parse →
getAnalyzer → analyze).

### 1. Every type, with a verdict and the number behind it

| type | verdict | count | files | where it comes from |
| --- | --- | --- | --- | --- |
| calls | EMITTED | 17,083 | 96 | `call_expression` + `macro_invocation`, callee leaf |
| uses | EMITTED | 3,207 | 86 | `field_identifier` reads (0.9) + bare value reads (1.0) |
| contains | EMITTED | 3,809 | 70 | post-loop over `ownerName`/`scope` |
| references | EMITTED | 2,928 | 84 | declared types (params, returns, fields, aliases, consts) + where-bounds |
| instantiates | EMITTED | 661 | 56 | struct literals 288, `path_new` 325, `bare_tuple_shape` 48 |
| implements | EMITTED | 252 | 44 | `impl Trait for Type`, trait leaf |
| overrides | EMITTED (new) | 16 | 3 | a trait method an impl block supplies |
| extends | EMITTED | 7 | 3 | trait bounds, incl. higher-ranked |
| imports | EMITTED **as a channel** at this census → **relationship edges also emitted since 2026-10-23** | 449 rows / 404 `use` declarations | — | `imports[]` → `brain_import` AND `RelationshipType.Imports` rows (`use_declaration` → written module path, 1.0, `evidenceClass: import_based`, with `importProjectFile`/`languageNamespace` claims); current whole-population count 11,822 edges — see the canonical table above |
| exports | EMITTED **as a channel** at this census → **edges also emitted since 2026-10-23** | 150 rows / 105 `pub` items | **0** | `exports[]`; relationship edges now published for every file-scope `pub` item / `pub use` re-export / `#[macro_export]` (`publishExport`, 1.0, `structural`) in addition to the web-route attribute edge; current whole-population count 6,185 edges |

Nothing is RULED for rust at this census, and STILL NOTHING IS EXCLUDED at HEAD:
the completeness spec's `excluded` list is empty and all fourteen types are
implemented (`renders` as implemented-and-corpus-unexercised, which is a count,
never an exclusion). The two types with no edge at this census were not ruled:
`imports` and `exports` are the two channels the store reads directly
(`brain_import`, `brain_file`/`brain_symbol` visibility), and their relationship
projection is a family choice, not a language fact. A ruling needs a measurement
of the CONSTRUCT, and the construct is plentiful in both cases (404 `use`
declarations, 105 `pub` items) — the 2026-10-23 lane paid that measurement and
now emits both edges.

### 2. The six questions, per already-emitted type

Every number below is from the lane's own census
(`script/lanes/incoming-rust/ontology-census.ts --json …`), which runs the
production path over the whole corpus and tallies per type: edges, files,
endpoint resolution, confidence distribution, `evidenceClass`, and the R7
placeholder scan.

**(1) Exists** — all nine constructible types are constructed in the source.

**(2) Fires** — see the table above; at this census every one of the nine
produced edges on ripgrep except `exports`, whose single relationship site then
needed a web framework (since 2026-10-23 the `pub`-item export edge fires
without one, and ripgrep's 105 `pub` items would produce it).

**(3) Oracle agrees** — measured on the F5 differential's own 60-file ripgrep draw
(`bun script/m14/differential.ts --repo ripgrep --lang rust`, rotated sample, so
the pinned baseline counts are not comparable to it):

| label | truth | comparable | MISSING | verdict |
| --- | --- | --- | --- | --- |
| calls | 1,606 | 1,605 | 1 | agrees |
| uses | 435 | 435 | 0 | agrees |
| references | 431 | 431 | 0 | agrees |
| extends | 7 | 7 | 0 | agrees |
| implements | 75 | 49 | — | 26 truth rows the analyzer does not emit |
| instantiates | 105 | 87 | 1 | agrees, after this lane's fix (was 13) |
| **contains** | **0** | **1,127** | — | **COMPARED WITH NO TRUTH** |
| **overrides** | **0** | **37** | — | **COMPARED WITH NO TRUTH** |

Two disclosures the harness itself demands:

- The oracle is a second walker over the SAME wasm grammar, so a shared grammar
  bug is invisible to it. Nothing here claims more than the harness supports:
  the rule behind an agreeing label is evidenced by the fixtures and the mutants,
  not by the oracle.
- **CLOSED 2026-11-03: both derivations are now pushed.** At this census
  `contains` was allowlisted while `deriveRustContainsTruth` was imported and
  never called (1,127 correct edges reported as fabrications, run exits 6), and
  `overrides` had no derivation wired. The current `differential.ts` rust arm
  (`if (lang === "rust")`) pushes `deriveRustContainsTruth` and
  `deriveRustOverridesTruth`, so those two rows no longer mean "compared with no
  truth"; the numbers remain this census's own harness state.

**(4) Labelled** — no mislabelling found. `instantiates` names the constructed
TYPE (never the constructor function), `calls` names the callee, `implements`
the type-level relation, `overrides` the method-level one, and the pair
`calls new` + `instantiates MemoryStorage` is preserved on both sides of the
comparison. `references` carries `evidenceClass: import_based`, which is the
family's own convention for that label (objc, julia, dart and zig all map
`references` to it), not a rust-local choice.

**(5) Resolved** — measured per endpoint, and the honest answer is three-way,
because an analyzer reads ONE file:

| type | target declared in this file | declared elsewhere in the corpus | declared nowhere |
| --- | --- | --- | --- |
| contains | 3,800 | 9 | 0 |
| instantiates | 646 | 15 | 0 |
| overrides | 0 (qualified label — see below) | 16 | 0 |
| uses | 3,034 | 113 | 60 |
| calls | 6,377 | 6,331 | 4,375 |
| references | 1,795 | 1,133 | 0 |
| implements | 154 | 98 | 0 |
| extends | 3 | 4 | 0 |

Two things that census column cannot say on its own, so they are said here:

- `overrides` endpoints are `Owner.member`, the qualified label csharp, java, go,
  scala and objc use, because a bare method name cannot be both endpoints of an
  override edge. The census resolves that form owner-aware: all 16 name a real
  `method` symbol owned by the named type.
- A target "declared nowhere in the corpus" is not a fabrication — it is a fact
  about a name declared in **another crate** (`to_string`, `unwrap`, `Vec`,
  `Display`, `Send`). Publishing the name is the honest record; inventing a
  symbol for it would not be.

**(6) Confident (CORRECTED 2026-11-03).** At this census no edge was below 0.7
and none carried a `reasonCode`; that is no longer true and the analyzer says so.
The current sub-0.7 class is the bare identifier read inside an UNEXPANDED macro
argument: **0.6** with `reasonCode: "unexpanded-macro-argument"` and
`metadata.macroArgument` (the analyzer's own comment records 36 of 29,660
ripgrep edges when introduced — a macro argument is not an expression the file
evaluates). `overrides` also pairs a cross-file trait method at **0.85** with
`reasonCode: "cross-file-trait-signature"`. The census-era distribution is kept
as the 2026-10-04 record: `calls` 1.0 (17,083), `contains` 1.0, `implements` 1.0,
`extends` 1.0, `overrides` 1.0, `uses` 1.0 (1,497 identifier reads) + 0.9 (1,710
field reads), `references` 0.9 (2,928), `instantiates` 0.8 (661).

**(7) R7 — placeholders and empties** — 0 empty targets and 0 empty sources in
all 27,963 edges. The R7 scan also flags literal placeholder strings
(`unknown`, `anonymous`, `n/a`, …) and reports 60 `calls`/`uses` targets and 9
`contains` sources among them — all of them **real Rust identifiers** the scan
happens to match (`Error`, `Self`-adjacent spellings, a field literally named
`var`), not placeholder literals. One declared synthetic name exists and is
declared rather than inferred: `RUST_UNNAMED_IMPL = "anonymous_impl"` for an impl
whose implemented type has no nominal name, with the source spelling kept in
`metadata.implementedType`.

### 3. INCOMING vs OUTGOING — the lane's charter, as a number

Every edge this analyzer emits is **outgoing from the file that was read**; that
is structural, not a choice. The question worth measuring is what the STORE can
do with that, and the answer is a property of the endpoints rather than of
direction:

`brain_relationship` stores one row per edge with `source_symbol_id` and
`target_symbol_id`, and `graph-engine.ts` traverses both directions off that one
row (the callers arm joins `brain_symbol` on `r.source_symbol_id` and cascades on
`r.target_symbol_id`; the callees arm swaps the two). So no separate incoming
subsystem is needed — **but an edge whose target resolved to no symbol has no far
end at all**, and such a row is an outgoing fact forever. Measured against the
project-wide name inventory (what the store's resolver can bind):

| type | edges | target name declared in the project |
| --- | --- | --- |
| contains / instantiates / overrides | 4,486 | 100.0% |
| uses | 3,207 | 98.1% |
| calls | 17,083 | 74.4% |
| implements | 252 | 71.8% |
| references | 2,928 | 71.1% |
| extends | 7 | 28.6% |
| **all** | **27,963** | **80.8%** (5,358 edges have no far end) |

The three 100% rows are the result of this lane's rules rather than luck, and
the low rows are the language talking: an auto trait (`trait Flag: Send`) and a
declared type (`-> Vec<i32>`) name things outside the project by definition.

The **store-level** count (`target_symbol_id IS NULL` per type) could not be
taken, and the instrument built to take it refuses to print a zero over a
non-empty corpus: `script/lanes/incoming-rust/direction.ts` indexes ripgrep
through `indexProjectParallel` and exits 6 because 110 files parse and 110
succeed while 0 symbols reach `brain_symbol`. The cause is in a file this lane
does not own — `insertSymbol` at `src/ast/parallel-indexer.ts:2154` carries TWO
`VALUES` clauses in one statement, which SQLite refuses to prepare
(`near "VALUES": syntax error`, proven by preparing the statement in isolation).
Every symbol and relationship insert fails for every language. Details and the
one-line fix are in the lane report.

### 4. What was added, and the before/after on the differential

| change | before | after |
| --- | --- | --- |
| bare tuple-shape construction (`instantiates`) | RUST-D30 banned every bare callee | 46 decidable sites publishable; `instantiates` 613 → 661 |
| `overrides` | not emitted (ruled without a measurement) | 48 construct sites measured; 16 published, 32 held silent as generic-parameter impls |
| fixture count (rust) | 23 | 25 |
| lane mutants | none | 10, all caught |
| F5 draw: MISSING | 13 | 1 |
| F5 draw: coverage | 99.5% | 100% (2,658 / 2,659) |
| F5 draw: unexplained | 112 (all `contains`) | 1,164 (`contains` 1,127 + `overrides` 37) — both harness gaps, §2 |

The two counts that GROW are current at HEAD 2026-11-03: the rust fixture suite is
**34 fixtures** in `validation/m14/fixtures/rust/` (34 pass / 0 fail,
`bun script/m14/run-fixtures.ts --lang rust`), not 25; and
`script/m14/mutate-analyzer.ts` registers **45** rust mutants, not 10.

The 1 remaining MISSING row is an **oracle** defect, not an analyzer one: an
impl-level `type Err = Error;` puts `Err` into the oracle's in-file declared-type
set, after which every bare `Err(...)` — the prelude's `Result::Err` — derives a
phantom `instantiates -> Err` (3 files on ripgrep:
`crates/globset/src/glob.rs`, `crates/printer/src/color.rs`,
`crates/printer/src/hyperlink/mod.rs`). The analyzer's answer, silence, is the
correct one, and `script/lanes/incoming-rust/construct-probe.ts` counts the class
so the ruling is falsifiable.

### 5. Declared limitations

- **Macro expansion.** `macro_rules!` bodies are templates, not code: no
  relationship is derived from one. A macro that expands to a call therefore
  contributes a `calls` edge to the macro's own name and nothing else. Measured
  population: `println!`-class invocations are the 4th-largest `calls` target
  group.
- **Trait impls of a trait declared in another module** (37 of ripgrep's 85) and
  **trait impls for a reference-to-generic-parameter** (32 of the 48 in-file
  ones) publish nothing. Both are absences on purpose, and both are counted.
- **Cross-file resolution.** Per-file by design; the store's project-wide name
  resolution is the other half, and 19.2% of the lane's edges have no far end in
  it (§3).
- **No signature matching** in `overrides`: a method is paired with a
  same-named method of the implemented trait without comparing parameter lists.
  A file that does not compile is already reported through `metadata.errors`, and
  the edge is the method-level relation either way.
- **The `inFile` kind filter's drop half is not falsifiable by a valid-Rust
  fixture** (`struct Unit;` followed by `Unit()` does not compile), so the mutant
  battery says so in its header rather than claiming a kill for it.
- **The performance delta cannot be scored on a loaded box.** Load average was
  15.8–28.7 on 8 cores during the measurement; the mean per-file cost moved
  between +25 ms and +54 ms depending only on which arm ran first, while the
  median moved +2 ms. Reported, not re-baselined.

### 6. Lane instruments (all under `script/lanes/incoming-rust/`, no regex in any of them)

| script | what it answers |
| --- | --- |
| `ontology-census.ts` | per-type counts, files, endpoint resolution, confidence, evidenceClass, R7 scan, project-wide reach |
| `construct-probe.ts` | construct measurements that rule or GAP a type: bare tuple constructors, trait method impls, `use` declarations, `pub` items |
| `oracle-probe.ts` | per-file, per-oracle truth vs analyzer output — which of the two walkers produced a row |
| `oracle/overrides.ts` | the `overrides` derivation for the F5 differential, plus a self-check that compares it with the analyzer over the corpus |
| `mutants.ts` | 10 source-level mutants, each run against the fixture suite with the analyzer restored byte-identical afterwards |
| `perf.ts` | payload/latency: two arms in separate processes, per-file minimum over N passes, arm order switchable |
| `derivation.ts` | this lane's DERIVATION debt, read with `rel-type-coverage-gate.ts`'s own `runGate()` without writing its artifact |
| `direction.ts` | the store-level INCOMING/OUTGOING arm counts (currently blocked — §3) |

## The import file claim — the arbiter's `importProjectFile` (M14 residual, 2026-10-17)

An `imports` edge names a MODULE, and a Rust module is defined by exactly one file. For the
internal module paths the analyzer can locate from the importing file alone, the edge now carries
the arbiter's FILE claim (`metadata.importProjectFile`) — the shared claim kind
`script/m14/incoming-rule.ts` verifies against the project's own UNSAMPLED admitted file list
(`FILE_CLAIM_KEY`, `verifyFileClaim`). It is a statement about a FILE, never about a declaration:
it cannot refute a name the project declares, which is the trap a bare-name externality marker
falls into (`clone`, `new`, `default` are declared all over, and `extFAIL` must stay 0).

**The rule** (`rustModuleFileCandidates` / `confirmModuleFile` in `src/ast/real-rust-analyzer.ts`):

| written path | candidate file(s) |
| --- | --- |
| `crate::a::b` | `<crate source root>/a/b.rs` · `<crate source root>/a/b/mod.rs` |
| `self::a` (file scope) | `<dir of this file>/a.rs` · `<dir of this file>/a/mod.rs` |
| `super::a` (file scope) | `<parent module dir>/a.rs` · `<parent module dir>/a/mod.rs` |
| `member::a::b` (workspace member) | `<member lib dir>/a/b.rs` · `<member lib dir>/a/b/mod.rs`; `member` alone → the member's `lib.rs` |
| `crate` (root group) · `crate::Item` (root item) | `<crate source root>/lib.rs` or `main.rs` — refused when BOTH are there (`lib`+`bin` in one dir: the edge does not say which crate the file belongs to) |
| `super` (bare word, a group of the parent's items) | the PARENT MODULE's own file: `x.rs`/`x/mod.rs` at the parent's directory |
| `std::a::b` / `core::a::b` / `alloc::a::b` | **not a file claim** — the `languageNamespace` claim with the root (`std`/`core`/`alloc`) as its declared list; verified by the arbiter's list matcher, never by the project's declaration table |

The crate source root is the nearest ancestor directory holding `lib.rs`/`main.rs`; a Cargo target
directory (`src/bin`, `tests`, `examples`, `benches`) is a crate root of its own. The workspace
member rule reads the manifest of the WORKSPACE THE IMPORTING FILE BELONGS TO (nearest ancestor
`[workspace]` manifest, else the file's own crate): members from its `members` list (globs
expanded), package name `-`→`_`, library root from `[lib] path` or `src/lib.rs`. **Membership, not
"any manifest under the project", is load-bearing:** a plain walk of every `Cargo.toml` under cargo
found a TEST-FIXTURE crate named `serde`
(`tests/testsuite/cargo_remove/gc_keep_used_patch/out/serde/src/lib.rs`) and would have claimed it
for 11 real `use serde::…` edges — a false statement the admitted-file check cannot catch, because
the fixture file really is admitted. The membership rule refuses it, and the census artifact shows
zero `serde` claims.

**Refused, with the count each refusal costs on the cap-400 sample:** one-segment paths that are not
workspace members (`serde`, `axum`, `tokio` — 381 unresolved), `std::` paths (233), `self::`/`super::`
inside an inline `mod` (the edge does not carry the mod path — 7), two-segment `crate::Foo` (the
dependency is the crate root, not a file named `Foo.rs`), a workspace member with a same-named local
module in the importing crate, and any candidate whose file the filesystem does not confirm (155).
A claim is written ONLY where `statSync` confirms the file (admitted extension, a file, under the
population's 1 MB cap), which is why the arbiter has never refuted one: `extFAIL 0`.

**Measured, `bun run script/m14/incoming-gate.ts rust rs 400`** (same population, three readings):

| axis | baseline | after internal paths | after workspace members | after crate-root/super | after system-crate namespace |
| --- | --- | --- | --- | --- | --- |
| `imports` unresolved | 1,660 | 1,284 | 863 | 799 | **565** |
| `imports` extOK / extFAIL | 0 / 0 | 376 / 0 | 797 / 0 | 861 / 0 | **1,095 / 0** |
| TOTAL unresolved | 23,637 | 23,261 | 22,840 | 22,776 | **22,542** |
| TOTAL extOK / extFAIL | 0 / 0 | 376 / 0 | 797 / 0 | 861 / 0 | **1,095 / 0** |
| TOTAL resolved / ambiguous | 9,419 / 9,874 | 9,419 / 9,874 | 9,419 / 9,874 | 9,419 / 9,874 | **9,419 / 9,874** |
| `arbitraryTwin` (binding intent) | 13,191 | 13,191 | 13,191 | 13,191 | **13,191** |

**The system-crate namespace claim.** A path rooted at `std`, `core` or `alloc` names a module that
ships with every toolchain and in NO project's source tree, so its honest terminal state is the
arbiter's `languageNamespace` claim: the analyzer declares the root (`["std"]`) and the arbiter
checks the target against THAT LIST, never against the project's declaration table — so a project
that ships a same-named symbol cannot refute it, and a target outside the list is refused rather
than sheltered. The emission (`rustSystemNamespaceOf`) fires only when the file claim did NOT (a
system path names no project file) and refuses a single-segment `std` (a legal project module name).
The matcher (`namespaceMatchOf`, Lead-owned) now splits `::` as well as `.`; before that change Rust
paths collapsed to one dotted segment and the claim was structurally unreachable. **Pre-registered
falsifier: any `extFAIL` on the rows this reaches refutes the emission rule.** Measured: 234 claims
(`std` 233 · `core` 1), **234 verified · 0 refuted**; imports unresolved 799 → **565**.

**The instrument and its control:** `validation/m14/fixtures/rust/import-claim-census.mts` reruns
the real analyzer over the gate's stride sample, verifies EVERY emitted claim against the gate's
admitted-file rule (git ls-files · `.rs` · ≤ 1 MB) for file claims and against the arbiter's own
segment matcher for namespace claims, and exits non-zero if zero claims verify or any claim is
refused; its row-by-row artifact is `import-claim-rows.json` (869 file-claim rows, 861 of them on
unresolved edges; 234 namespace rows). Result: all verified, **0 refused**, deterministic.

**What this claim is not.** It resolves the import's FILE, not a symbol declaration — the honest
terminal state for an import whose declaring file is outside the run's population. The 799 imports
still unresolved are: **342 one-segment** (311 external crate names — `serde`, `anyhow`, … — and 31
bare `crate`/`super`/`self` words), **233 `std::` paths**, **101 `crate::` paths whose module file
did not exist in the sample** (inline modules, `#[path]`, or a tracked-but-absent corpus file), **34
`super::x` whose leaf is an ITEM rather than a module**, and **89 external-crate-rooted paths**
(`axum::` 16, `cargo::` 10, `cargo_util_terminal::` 5, …) whose crate is not a workspace member. A `::`-aware namespace claim for `std`/`core`/`alloc` is a proposal
(`validation/m14/proposals/`), not an emission: Rust call edges carry the bare leaf as their TARGET,
so a namespace claim can only reach PATH-shaped targets, and the shared matcher is dot-segment-based.

## Evidence pointers

- Fixtures: `validation/m14/fixtures/rust/` (M14) and
  `validation/m12/fixtures/rust/` (M12)
- M14 import-claim evidence: `validation/m14/fixtures/rust/import-claim-census-after6.txt`,
  `import-claim-rows.json`, `gate-400-before.txt`, `gate-400-after.txt`, `gate-400-after2.txt`,
  `gate-400-after3.txt`, `gate-400-after4.txt`, `gate-whole-after.txt`
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
- Current whole-population arm (2026-10-23): `validation/m14/measurements/rust-gate-whole-2026-10-23.txt`
- Extended-types construct census: `validation/m14/measurements/rust-extended-census.json`
- Whole-population declaration, per-type closure + cause rulings: `validation/m14/instruments/rust/incoming-declaration.json`
- Completeness spec: `script/m14/spec/rust-completeness.json`
- Served-grammar binding table: `validation/m14/verification/GRAMMAR-BINDINGS-2026-10-21.md`
- Grammar audit register: `validation/m14/grammar-audit-baseline.json` (rust: 0 dead literals)
- Docs: this file

## Issue

Closes M12.18 (GitHub issue #157).


## Namespace claims (`std::` / `core::` / `alloc::` imports) — iteration 4

Import rows whose written path is rooted at a Rust SYSTEM crate carry `metadata.languageNamespace`
(`NAMESPACE_CLAIM_KEY`, `languageNamespace`). The authority is the analyzer's own three-literal root
list (`RUST_SYSTEM_NAMESPACES`), never the project's declaration table: a root the list does not name
reads `externalRefuted` (extFAIL), and the internal resolution still wins first. The claim is emitted
only where the file claim did not fire, and single-segment targets are refused. The arbiter half
(`namespaceMatchOf` splitting `.` and `::`) is Lead-owned. Measured at cap 400: imports unresolved
799 → 565, extOK 861 → 1,095, extFAIL 0, arbitraryTwin byte-identical at 13,191, fixtures 26/4
unchanged.


## Item-leaf module paths — iteration 5

An upper-case leaf is an ITEM, not a module: `crate::diagnostics::Applicability` and `super::GraceClient`
depend on the PREFIX module's file, so `rustModuleFileCandidates` drops the item leaf before resolving
candidates (2-segment `crate::Item` keeps the crate-root rule from iteration 3). Lower-case leaves and
`self::Item` stay refused (ambiguity; a self-confirming claim is not evidence). The file claim is the
correct terminal state for an internal-dependency row; `arbitraryTwin` is untouched because the edge
identity is untouched. Measured cap 400: imports unresolved 565 → 548, extOK 1,095 → 1,112, extFAIL 0,
census 886 claims / 878 verified / 0 refuted, internal unresolved without a claim 166 → 149, fixtures
26/4.
