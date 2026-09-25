# real-clean-analyzer.md

## Language

- Analyzer file: `src/ast/real-clean-analyzer.ts`
- Parser: `tree-sitter-clean` **v1.2.7** (authored by the project owner; pinned
  `wasm/tree-sitter-clean.wasm` rebuilt from `tree-sitter-clean@302fb5d0`
  release v1.2.7, adopted 2026-09-25 on the adjudication recorded in
  `reviews/m60-clean-grammar-127-adjudication.md`). The v1.2.4 pin it replaced was
  `tree-sitter-clean@58729d3`, pulled during M12.26.

  **What v1.2.5–v1.2.7 changed, measured on the corpus (312 `.icl`/`.dcl` across the five
  Clean bases on this machine), not read off the release notes:** a lexer correction
  (v1.2.4 split identifiers beginning `mod`/`rem`, so `mode` parsed as `mod`+`e` and
  `removeTabViewItem` as `rem`+`oveTabViewItem`); four grammar node types that did not exist
  before (`monad_bind`, `array_generator_sep`, `char_list`, `open_range_expression`, all four
  currently **unreferenced** by this analyzer — see the shape-safety note below); and named
  terminal types replacing generic ones (`operator` → `monad_bind`, `->` → `arrow`, `where`
  and the other keywords as their own node types). The parse win is large and one-directional:
  damaged files **67 → 37** of 312, MISSING tokens **148 → 9**, ERROR lines **6 508 → 2 426**,
  with **no file newly damaged**.

  Grammar tree shape (as pinned, v1.2.7):
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
  `record_expression`/`record_update`; field access is `field_access`.
  A module-level operator is a DIFFERENT node from a function:
  `operator_definition` with a `name` FIELD holding
  `parenthesized_operator` (`(++|)`) or `parenthesized_name`; an
  instance/synonym body is a `macro_definition`; a signature is `type_signature`
  → `signature_name` → `identifier` / `constructor` / `parenthesized_operator` /
  `parenthesized_name`; an infix use is a `binary_expression`.)
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
| name | ✅ | `module_declaration` → `module_name`; `type_definition` → first `constructor` (type); `record_definition` → `record_field` → `identifier` (property); `data_constructor` → `constructor` (constructor); `class_name` → `constructor` (interface); class members → `class_member` → `type_signature` → `signature_name` → `identifier` (method); `instance_declaration` → named by the TARGET type `constructor` (the Rust `impl User`/Haskell `instance ... User` contract); instance members → inner `function_declaration` `name` FIELD (method); top-level functions → `function_declaration` `name` FIELD (an uppercase name is typed `constructor`, so the field — not the first `identifier` child — is the name); a MODULE-LEVEL `type_signature` → `signature_name` child, normalized across all four shapes (`identifier`, `constructor`, `parenthesized_operator` `(==)` → `==`, `parenthesized_name` `(bitxor)` → `bitxor`; a comma/brace payload is a tuple/record PATTERN mis-shape and publishes nothing); an `operator_definition` → its `name` FIELD unparenthesized (`(++|)` → `++|`) |
| kind | ✅ | module; type_definition → `type`; record fields → `property`; ADT constructors → `constructor`; class → `interface`; instance → `class`; class/instance members → `method`; top-level functions → `function` |
| qualified/container name | ✅ | `ownerName` = enclosing module for all module-level symbols (tracked via `ctx.currentModule`); constructors/fields owned by their type (`Vec`); class/instance methods owned by their interface/class |
| range (start/end line + column) | ✅ | the declaration node |
| parameters | ✅ (metadata only) | function head identifiers after the name |
| visibility | ✅ | always `public`. Clean has no visibility keyword and a module's definition list governs what it offers, so the export list is the module-level symbols: `sym.ownerName === currentModule || !sym.ownerName` (the haskell rule — the module is the namespace, members are importable by name), restricted to exportable kinds and deduped by NAME first-wins, because the exports-family invariant (run-fixtures.ts) requires a name a duplicate cannot identify its provider for. Clean reaches the collision honestly — `instance Eq ParseState` publishes its Class under the instance TARGET type, so a file that both defines the type and implements an instance for it offered the name twice (59 of 312 files). The predicate here used to be `!sym.ownerName`, the exact NEGATION of the rule its own comment stated: measured, 312 of 312 files exported ≤ 1 thing (295 exports against 6,031 module-owned symbols). Now **4,443 exports over 305 of 312 files**; the 7 without one are the `_`-prefixed compiler-internal modules, which are not part of any importable interface |

## Relationship ontology

| Relationship | Supported? | How extracted (AST node/field) | Weight |
| --- | --- | --- | --- |
| contains | ✅ | post-loop over `ownerName`: module → every module-level symbol (`contains Service -> User`), type → its constructors (`contains Side -> Bid`), type → record fields (`contains User -> name`), interface/class → methods (`contains Serializable -> serialize`). Self-named edges skipped (`data User = User {...}` would collapse into a self-loop in symbol-ID space) | 1.0 |
| implements | ✅ | `instance_declaration` → `implements targetType -> className` (from `instance_class` + target `constructor`) | 1.0 |
| calls | ✅ | `application` heads with function sources (source = the containing function/method via `currentFunction`; an `operator_definition` is a callable on the same terms, so its body attributes to the operator's unparenthesized name — `(++) x y = g x y` emits `calls ++ -> g`), and the attribution is released when the callable's scope exits. Local calls emit LEAF targets only when the callee is a module-level declared function (pre-pass collects all `function_declaration` names → forward references resolve, e.g. `submitOrder -> describe` declared later). Self-recursion and mutual recursion ARE emitted (`countDown -> countDown`, `mutualA -> mutualB`). Qualified calls emit FULL targets (`M.lookup` — the Erlang `gen_server:cast` precedent, from `qualified_identifier`). Exclusions: stdlib/imported functions (`foldl`, `map`, `fromMaybe`), type variables, pattern vars, record-field selectors (`u.name`), operator/infix syntax, where-local functions (their bodies are scoped noise) | 1.0 |
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
  `validation/m12/results/clean-complexity.json`. **Disclosed: that artifact is unscorable
  by the M60 envelope instrument** (`validation/m60/results/analyzer-complexity.json`,
  verdict `unscorable`, severity 5) because it records no `loadRule` (#871), no
  `corpusManifest` (#909) and no `userCpuMsPerFile`/`loadAvg1` on its corpus row — so the
  wall-clock figure above is not load-stable and predates the v1.2.7 pin. Re-measuring it
  with load context is owed, and it is the only documented number on this lane that is not
  artifact-backed to the current standard.
- Cyclomatic complexity (`metadata.cyclomaticComplexity`) counts `case_expression`,
  `case_alternative`, `guard_equation` (function guards), `guard` (list-comprehension
  qualifiers) and `binary_expression`. Before the fix it counted `guard` and NOT
  `guard_equation`, i.e. 23 comprehension filters were measured and 1,594 function guards were
  not; `script/m14/verify-probe-battery.ts` (`F9-PROBE-CLEAN-GUARD-COMPLEXITY`) asserts the
  delta now.

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
- Grammar: tree-sitter-clean **v1.2.7** (`302fb5d0`, adopted 2026-09-25). Shape safety
  re-derived against the pinned grammar rather than restated (`script/m14/tmp/clean-127-shape-safety.ts`,
  which reads the analyzer's `node.type ===` literals and intersects them with the grammar's own
  `src/node-types.json`): **37 referenced node-type literals, 0 dead** — 36 are node types the
  grammar defines and the 37th is tree-sitter's reserved `ERROR`. The grammar defines **198**
  distinct node types, so this analyzer dispatches on 36 of them; the 4 types new in v1.2.7
  (`monad_bind`, `array_generator_sep`, `char_list`, `open_range_expression`) are named nowhere
  in it, which is a named worklist rather than a hidden one.
- Differential: **derived, and the lane is enrolled.** `deriveCleanEdges`
  (`script/m14/differential.ts`, keyed to the pinned v1.2.7 shapes rather than translated from
  this analyzer) is the read oracle, and F5 row `M14.0.F5.clean.json` records
  `Clyde:clean` 60 files / 683 tree-truth / 683 covered (100 %, 0 MISSING, 0 unexplained) and
  `clean-stdlib:clean` 60 files / 744 / 744 (0/0). Exhaustively, un-sampled, over every file of
  the lane's 312: Clyde 109 files truth 2,288 / analyzer 1,459, clean-stdlib 74 / 773 / 562,
  Prelude 42 / 130 / 124, cloogle.org 14 / 271 / 182, eastwood 73 / 924 / 777 — 0 MISSING and
  0 UNEXPLAINED on all five. The M12 manual audit (`validation/m12/results/clean-differential.json`,
  68 facts, 1.000/1.000) still stands beside it as the fixture-level audit.
- Parse-success: floor `M14.0.F10.clean.json` — `Clyde:clean` 109 files, 17 carrying damage
  (15.6 %; ERROR 14.7 %, MISSING 3.7 %, damaged lines median 3 / max 81) and `clean-stdlib:clean`
  74 / 1 (1.4 %). Both are still `unpinned` in the shared baseline; a whole-set `--update-baseline`
  rewrites all 48 lanes, so pinning them is a separate, deliberate act. The earlier figure — 4 error
  files of the 41-file ≥1KB draw (9.8 %) measured against v1.2.4, then **1 of 41 (2.4 %)** against
  v1.2.7 (`script/m12/clean-corpus-errors.ts`) — measured a smaller draw; the file that no grammar
  of this pin parses remains `_SystemDynamic.icl` (inline `code { ... }` blocks).
- Fixture coverage (F6, new enrolment): `script/m14/spec/clean-completeness.json`
  classifies all 37 dispatch literals plus the silent wrappers, the three declared gaps and the
  eight rulings, and the gate reads **handled=37, fixtureTypes=91, uncovered=0, deadLiterals=0
  — PASS**. The lane was absent from this gate until now, which is how the analyzer's own
  coverage claim went unchecked: enrolling it is what surfaced that 13 dispatch shapes (case,
  lambda, guards, where, comprehension, the qualified call, records, the class trio) occurred in
  NO fixture parse tree.
- Fixtures (F3): five, each pinning a contract rather than a snapshot —
  `definition-module-interface.dcl` (all four `signature_name` shapes publish AND export),
  `signature-definition-merge.icl` (the merge is one entity whose range is the definition's; an
  operator's call belongs to the operator and is released at scope exit),
  `instance-target-name-collision.icl` (a type and its instance collide on one name; the export
  list dedupes first-wins), `expression-shapes.icl` (the shapes above), and
  `import-modules-alias-884.icl` (#884).
- Mutation hardening (F4): **seven mutants, all caught**, each a revert of a MEASURED state —
  declarations-not-published, declaration-range-wins, declaration-beside-definition,
  operator-not-callable, operator-attribution-leak, export-owner-negation, export-duplicate-name.
  `script/m14/tmp/mutant-catch-reasons.ts` prints WHY each died, so a mutant cannot be "caught"
  by an expectation unrelated to its defect class. Run scoped (`BB_MUTANT_ONLY="clean/"`); the
  canonical whole-set F4 artifact is a separate act.
- Probes (F9): four CLEAN probes in the battery (36 total) — the `.dcl` interface, the
  guard-equation complexity signal, and two SOURCE-AWARE checks (operator scope exit, head-pattern
  attribution) that assert the analyzer and the oracle agree on both the edge and its absence.
- Two defects this enrolment found, both in this analyzer rather than in the data:
  `cyclomaticComplexity` counted the `guard` node type — 23 corpus sites, every one a
  LIST-COMPREHENSION qualifier — while `guard_equation` (1,594 function guards) went uncounted; and
  the function-head pattern gate tested for a child typed `operator` with text `=`, which this
  grammar never produces (a definition's children are name/pattern…/body; the corpora's 1,576
  `operator` nodes are operator symbols under binary_expression/unary_expression/paren_pattern), so
  the gate was dead. Both are fixed and probe-pinned; the pattern gate is a dormant-guard repair,
  and no fixture can catch its regression (head patterns parse as `constructor_pattern`, never as
  applications), which is exactly why the probe asserts it directly.
- M11 gates: FP probe genuinely **1.000/1.000** (the cached
  `fp-observed.json` was stale — honest regeneration exposed 0.986/0.920,
  fixed by emitting record fields + class-member methods; probe now real);
  lifecycle PASS; census PASS (0 regex entries, census count unchanged).
- Full battery: all **24 completed differentials re-verified at 1.000/1.000**.
