# real-clean-analyzer.md

## Language

- Analyzer file: `src/ast/real-clean-analyzer.ts`
- Parser: `tree-sitter-clean` v1.2.4 (authored by the project owner; pinned
  `wasm/tree-sitter-clean.wasm` rebuilt from `tree-sitter-clean@58729d3`
  release v1.2.4, pulled during M12.26). Grammar tree shape (v1.2.4):
  `module_declaration` → `module_name` → `module_identifier`; imports are
  `import_declaration` with `module_name` children (the `as` alias is a second
  `module_name` child; `import qualified` is an anonymous `qualified` token);
  `type_definition` → `constructor` (type name) + `type_definition_body` →
  `record_definition` → `record_field` → `identifier` (fields) OR
  `data_constructors` → `data_constructor` → `constructor` (ADT constructors);
  `class_declaration` → `class_name` → `constructor` + `class_member` →
  `type_signature` → `signature_name` → `identifier` (interface methods);
  `instance_declaration` → `instance_class` → `constructor` + `constructor`
  (target type) + `instance_member` → `function_declaration` (methods);
  functions are `function_declaration` nodes (first `identifier` = name) with
  `guard_binding`/`guard_body` children; calls are `application` nodes whose
  head is `identifier` (local) or `qualified_identifier` (→ `constructor` +
  `identifier`); constructor application heads are `constructor`; lambdas are
  `lambda_expression`; where-locals live under `where_block` →
  `local_binding` → `function_declaration`; record construction is
  `record_expression`/`record_update`; field access is `field_access`.)
- Language detection: `.icl`/`.dcl` → `clean` in `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealCleanAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (module-name assembly from `module_identifier`
  children — pure char join, no regex). The analyzer has ZERO census regex
  entries.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `module_declaration` → `module_name`; `type_definition` → first `constructor` (type); `record_definition` → `record_field` → `identifier` (property); `data_constructor` → `constructor` (constructor); `class_name` → `constructor` (interface); class members → `class_member` → `type_signature` → `signature_name` → `identifier` (method); `instance_declaration` → named by the TARGET type `constructor` (the Rust `impl User`/Haskell `instance ... User` contract); instance members → inner `function_declaration` first `identifier` (method); top-level functions → `function_declaration` first `identifier` |
| kind | ✅ | module; type_definition → `type`; record fields → `property`; ADT constructors → `constructor`; class → `interface`; instance → `class`; class/instance members → `method`; top-level functions → `function` |
| qualified/container name | ✅ | `ownerName` = enclosing module for all module-level symbols (tracked via `ctx.currentModule`); constructors/fields owned by their type (`Vec`); class/instance methods owned by their interface/class |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ (metadata only) | function head identifiers after the name |
| visibility | ✅ | always `public` (Clean has no visibility keyword; everything is exported by default) |

## Relationship ontology

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | post-loop over `ownerName`: module → every module-level symbol (`contains Service -> User`), type → its constructors (`contains Side -> Bid`), type → record fields (`contains User -> name`), interface/class → methods (`contains Serializable -> serialize`). Self-named edges skipped (`data User = User {...}` would collapse into a self-loop in symbol-ID space) | 1.0 |
| implements | ✅ | `instance_declaration` → `implements targetType -> className` (from `instance_class` + target `constructor`) | 1.0 |
| calls | ✅ | `application` heads with function sources (source = the containing function/method via `currentFunction`). Local calls emit LEAF targets only when the callee is a module-level declared function (pre-pass collects all `function_declaration` names → forward references resolve, e.g. `submitOrder -> describe` declared later). Self-recursion and mutual recursion ARE emitted (`countDown -> countDown`, `mutualA -> mutualB`). Qualified calls emit FULL targets (`M.lookup` — the Erlang `gen_server:cast` precedent, from `qualified_identifier`). Exclusions: stdlib/imported functions (`foldl`, `map`, `fromMaybe`), type variables, pattern vars, record-field selectors (`u.name`), operator/infix syntax, where-local functions (their bodies are scoped noise) | 1.0 |
| instantiates | ✅ | `application` heads that are `constructor` (uppercase) in BODY position → `instantiates fn -> Type` (`makeUser n a = User n a` → `instantiates makeUser -> User`). Pattern-position constructors (`addBid (Book bids asks) price`) and where-local patterns NEVER instantiate — excluded via `isPatternPosition` (pattern vars in function heads / `case_alternative` heads / `where_block` locals) | 1.0 |
| references | ✅ | module dependency edges: `import StdEnv` → `references Service -> StdEnv` (import-list-less form `from Data.List import fromMaybe` also handled; the qualified/`as` import shapes produce the same dependency edge) | 1.0 |
| extends | ❌ | Clean classes have no superclass syntax (type classes stand alone); no edge emitted | — |
| uses | ❌ | intentionally not emitted — variable references are noise under the FP-family contract (Clojure/Elixir/Erlang/Haskell precedent) | — |

## Complexity

- Single-pass iterative walk with an explicit stack (no recursion, no O(n²)
  scans). Multi-clause function merging is O(1) via `functionSymbolIndex`
  (key = `scope::name`). The post-loop contains pass is a single O(symbols)
  linear sweep.
- Corpus envelope (clean_stdlib@6971a8a, 62 files ≥1KB):
  1,307 symbols / 1,416 relationships in 3.0s (435 syms/s) — see
  `validation/m12/results/clean-complexity.json`.

## Verification evidence

- Differential: `validation/m12/ground-truth/clean.json` (68 facts) vs
  observed → **1.000 precision / 1.000 recall, 0 FP / 0 FN / 0 unknown**,
  first run — `validation/m12/results/clean-differential.json`.
- Corpus: clean_stdlib@6971a8a — 41 files ≥1KB → **4 grammar-error files
  (9.8%), 0 crashes**, all classified honestly: `_SystemArray.icl`/`.dcl`
  (inline `code { ... }` machine-code blocks — compiler-runtime assembly, not
  parseable Clean), `_SystemDynamic.icl`/`.dcl` (exotic record-pattern /
  record-update-with-comprehension constructs). Same category as Go's
  testdata / Haskell's TemplateHaskell quasiquotes.
- Grammar: tree-sitter-clean v1.2.4 (fresh release during M12.26, wasm
  rebuilt) — shape-safe **32/32 dispatch refs live** against 119 emitted
  types from the corpus.
- M11 gates: FP probe genuinely **1.000/1.000** (the cached
  `fp-observed.json` was stale — honest regeneration exposed 0.986/0.920,
  fixed by emitting record fields + class-member methods; probe now real);
  lifecycle PASS; census PASS (0 regex entries, census count unchanged).
- Full battery: all **24 completed differentials re-verified at 1.000/1.000**.
