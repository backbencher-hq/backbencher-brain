# real-php-analyzer.md

## Language

- Analyzer: `src/ast/real-php-analyzer.ts`
- Parser: `tree-sitter-php` **0.24.2** (npm, upgraded in M12.29 from the stale
  pinned grammar; WASM at `wasm/tree-sitter-php.wasm`, loaded by `engine.ts`
  via `resolveWasm`)
- Detection: `.php` → `php` in `src/ast/language-detection.ts`
- Wiring: `ASTEngine.getAnalyzer("php")` → `RealPhpAnalyzer`

## Symbol contract

| Construct | Symbol | AST source |
| --- | --- | --- |
| `namespace A\B;` | `namespace` | `namespace_definition` → `namespace_name` |
| `class C extends B implements I` | `class` | `class_declaration` → `name`; `base_clause`/`class_interface_clause` for edges |
| `interface I extends J` | `interface` | `interface_declaration` → `name` |
| `trait T` | `trait` | `trait_declaration` → `name` |
| `enum E: string` + `case X` | `enum` + `enum_member` | `enum_declaration` → `name`; `enum_case` → `name` |
| `function f()` | `function` | `function_definition` → `name` |
| `function m()` in a class | `method` | `method_declaration` → `name` |
| `public string $prop` | `property` | `property_declaration` → `property_element` → `variable_name` |
| `public const C = 1` | `constant` | `const_declaration` → `const_element` → `name` |
| promoted constructor params | `property` | `property_promotion_parameter` → `variable_name` |

Locals, parameters, `$this->x` member access, and `global` declarations are
**never symbols**. The legacy phantom symbols (Laravel Eloquent
`getAttribute`/`setAttribute`, WordPress `wp_add_*` hooks) are removed — only
facts that exist in the AST are emitted. Anonymous classes/closures are
expressions, not named declarations, so they emit no symbol.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `extends` | class → superclass, and interface → extended interface |
| `implements` | class → interface |
| `uses` | trait `use` inside a class body |
| `calls` | `function_call_expression`, `member_call_expression`, `nullsafe_member_call_expression`, `scoped_call_expression`; leaf target; source = enclosing function/method (PHP builtins filtered) |
| `instantiates` | `object_creation_expression` (`new Class(...)`, incl. `new self/static/parent`) |
| `overrides` | method whose name exists on the superclass (local declarations or the project companion index) |
| `imports` | module dependencies: `use` clauses (module = the FQN, alias carried in `metadata.aliased`) and `require` / `require_once` / `include` / `include_once` paths. Owner is file scope — `use` is per-compilation-unit in PHP |
| `references` | declared-type references (`metadata.relationshipType = declared_type`), constant fetches, and resolved type names. NOT include paths — those are `imports` |
| `contains` | one edge for every owned symbol |

Member *access* (`$obj->prop`, no call) produces no edge; only member *calls*
(`$obj->method()`) do. Constructor expressions emit `instantiates`, not `calls`.

### `imports` is the kind the file-level reader needs

`src/lsp/graph_request.ts:256` is `relationship_type IN ('imports','exports')`.
This analyzer used to emit **zero** `imports` edges: a `use` clause was
recorded only as `ImportInfo` with no relationship, and an include path was
mislabeled `references` — a file-level module edge presented as an intra-file
symbol read. Every PHP module dependency was therefore invisible to that
reader, while the ontology above already promised otherwise. Fixed in
M12.PHP-IMPORTS: `use` and include paths now share the `imports` kind, with
`metadata.isImport` / `metadata.fileLevel` set.

### `overrides` is emitted only when it is verified

An `overrides` edge requires the base's declaration to be **visible** — in this
file, or via `AnalyzeContext.overrideCompanion` — and is then emitted at 0.95.

This analyzer previously also emitted a 0.5 `first-parent-guess` edge for every
method of a class whose base lives in another file, without checking that the
base declares the method. The companion index that could verify it is never
populated in production (M37.10), so in production *every* cross-file PHP
override was that guess. `script/m12/php-override-audit.ts` measured it on
`phpunit@c8d6921f`; see Verification evidence for the numbers. The guess was
removed: it sat below the 0.7 threshold, so `pool-worker` already dropped it
and it never reached the graph — it bought no real cross-file override while
manufacturing a majority-false unverified bucket. Restoring cross-file
coverage honestly means populating the companion index, not guessing.

## Supported AST shapes

- Namespaces, classes (abstract/final/static), interfaces, traits, enums
- Methods and functions with typed parameters (simple, variadic, promoted)
  and return-type hints
- Properties (typed, static, multi-declaration) and class/global constants
- Trait `use`, namespace `use` (with aliases), require/include
- Function/member/scoped/nullsafe calls, object creation, anonymous functions
- Control-flow nodes for cyclomatic complexity (if/elseif/for/foreach/while/
  do/switch/match/try/catch/conditional/`&&`/`||`/`and`/`or`)

## Verification evidence

- Independent manual ground truth: `validation/m12/ground-truth/php.json` —
  **66 facts, precision 1.000, recall 1.000, 0 FP, 0 FN**
  (`bun script/m12/verify-analyzer.ts php`)
- Fixtures: `validation/m12/fixtures/php/{BaseService,Service,Negative}.php`,
  and `validation/m14/fixtures/php/` (16 pass / 0 fail as of the last run)
- Mutants: 45 registered for `php/`, all 45 caught as of the last run
- Completeness (#419): **177 grammar types classified, sections A–H 8/8**;
  `script/m14/spec/php-completeness.json` records 65 handled + 105 silent,
  29 adjudicated decisions (18 FIXED, 11 RULED, none pending) and 2 declared
  gaps. See "Known gaps" below.
- Regex census: the analyzer contributes **0** regex usages, confirmed by the
  AST-driven project census in `validation/m12/results/regex-census.json`
  (which walks for regex literal nodes and `RegExp` constructors, so a
  `String.replace` with a string argument and a regex inside a comment are both
  correctly not counted). A naive `grep` for `\.replace(` false-positives on
  both — use the census artifact, not grep.
- Corpora (both restored at their pins, both reproducible):
  - `phpunit@c8d6921fb601b6988854cd84a672f06c1e49f80e` — 3,231 tracked `.php`
  - `phpmyadmin@4061095a59e1769128776ad24154cc7058de51aa` — 1,232 tracked `.php`
- **Differential over the FULL corpus of both repos** — not the canonical
  60-file sample, because a sample can miss a whole edge class and a full sweep
  cannot:

  | corpus | files | tree-truth | covered | missing | unexplained | heuristic |
  |---|---|---|---|---|---|---|
  | phpunit@c8d6921f | 2,907 | 39,829 | 39,829 (100%) | 0 | 0 | 0 |
  | phpmyadmin@4061095a | 1,232 | 55,402 | 55,402 (100%) | 0 | 0 | 0 |
  | **combined** | **4,139** | **95,231** | **95,231 (100%)** | **0** | **0** | **0** |

- Line-number contract (M60): audited on a 150-file strided sample —
  **0 of 5,830 relationships lack `line_number` (0.00%)**, across every kind
  (`calls` 1501, `uses` 2162, `contains` 904, `imports` 664, `instantiates` 325,
  `references` 158, `extends` 89, `implements` 27).
- Grammar pin: registered in `script/m14/verify-grammar-pins.ts` as
  `unnamed-build-sha-only` — sha256 `d4df6a6ff08c…`, 1,058,041 B, 432 ids /
  157 named / 31 fields, **0 php drifts**. There is no vendored source and no
  `PIN.md`, so the source↔wasm proof does not apply and the grammar is not
  rebuildable offline; that limit is recorded in the entry rather than papered
  over.
- Parse census over all 3,231 phpunit files: **2 error files, 0 crashes**, and
  both errors are intentional test fixtures (`…/parse-error/src/CannotBeParsed.php`
  and a partial-function-application `?` placeholder).
- Grammar upgrade: npm `tree-sitter-php` 0.24.2 fixed **15/17** previously
  failing files with **0 regressions** (PHP 8.4 property hooks, pipe operator,
  `new Class()->method()` dereference, readonly anonymous classes, a vendor
  fluent chain); the 2 remaining are an intentional parse-error test fixture
  and a partial-function-application `?` test fixture.
- Corpus production extraction: **3,073 symbols / 4,276 relationships** on the
  400-file tracked phpunit sample; evidence in
  `validation/m12/results/php-corpus-complexity.json`
- Grammar shape safety: **33/33** dispatch references emitted by the grammar
  (2 remaining refs `and`/`or` are anonymous operator tokens, confirmed live)

### Override audit — how the guess was measured, not assumed

`bun script/m12/php-override-audit.ts` runs the analyzer *directly* (the
`pool-worker` 0.7 threshold hides the guess bucket), resolves each guessed
base class's declaring file across the whole corpus, and asks whether that
file declares the method. Only an unambiguous, non-builtin base yields TRUE or
FALSE, so the tool cannot inflate its own false rate; builtins and ambiguous
leaves are reported separately.

On a 60-file strided sample of phpunit: **99 guess edges, 18 decidable, 12
FALSE (66.7%)**. The undecidable remainder is itself mostly false — hand-checked
cases include `TestCase.testOne`, `Subscriber.notify`, and all 9
`VariousIterableDataProviderTest.as*Provider` edges (the parent declares only
the `*ProviderInParent` methods) — so **66.7% is a floor, not a midpoint**.

Removing the guess took heuristic edges **198 → 0** on phpunit and **171 → 0**
on phpmyadmin with tree-truth coverage unchanged at 100%, confirming it
contributed no real coverage.

## Complexity and limitations

The extraction walk is iterative and linear in AST nodes; contains edges are a
single post-pass and overrides use maps/sets. There is no O(n²) symbol or
relationship lookup.

PHP is dynamically dispatched: ordinary calls are emitted by syntactic AST
shape and builtin filtering, not by pretending runtime call resolution is
knowable. Cross-file override precision requires the optional project companion
index; absent that context, the analyzer remains deterministic and uses
declarations available in the current file — and emits **no** `overrides` edge
rather than guessing one (see the audit above).

### Known gaps

Two are declared in `script/m14/spec/php-completeness.json` and are
deliberate, not forgotten:

1. **(Ruled, not a gap — see PHPD31/PHPD32; the lane declares 0 gaps.)**
   HTML/text interpolation outside `<?php` blocks — `php_tag`,
   `text_interpolation`, `encapsed_string`, `heredoc`, `nowdoc`. The
   interpolated HTML is not PHP and its `$var` slots are not PHP symbols, so
   they are outside this analyzer's contract. The in-PHP string-interpolation
   cases that matter for value flow (`"hello $name"`, `"{$o->p}"`) are handled
   and adjudicated in the spec.
2. **ini directives and hash-bang lines** — `ini_section`, `ini_entry`,
   `preprocessor`, `shell_comment`, `hash_bang_line`. These are
   configuration and shell, not PHP declarations.

Both were adjudicated to `RULED` (PHPD31, PHD32) on 2026-09-29 — the lane now
declares zero gaps. Neither was a coverage or extraction defect: both described
a deliberate language boundary. PHPD33 additionally rules OUT an `exports` kind
for php: make and python emit it syntactically (`export`, `__all__`), PHP has no
export syntax, and a semantic version would be unverifiable from one file.

### Performance

- Phase profile: `bun script/m12/php-perf-profile.ts` →
  `validation/m12/results/php-perf-profile.json` (200-file strided sample of
  phpunit). The split is measured with hrtime over a warmed run, not sampled,
  because a CPU profile attributes tree-sitter's WASM work to `(idle)`.
- **The fused main walk is ~90% of end-to-end time.** `parse` is ~8–11%,
  `collectPhpFileScope` (the one separate full-tree walk) ~2–5%, and the
  symbol-table post-passes ~0.1%. So the cost is in the single walk, and
  optimizing the grammar is not where a speedup lives.
- `msPerFile` from the profile is **not** comparable to the differential's
  6.3–9.5 ms/file: the profile includes parse, and its strided slice is
  file-equal rather than byte-equal, so it is dragged by the large vendored
  sources under `tools/.phpstan/`. The phase *ratios* are the robust result.
- A/B harness: `bun script/m12/php-perf-ab.mts [ref]` →
  `validation/m12/results/php-perf-ab.json`. It reports speed and output
  equality as **separate** claims, interleaves the two analyzers round by round,
  and compares results field-by-field on every file before timing anything.
- Measured machine noise is larger than any available win: the profile moved
  19.21 → 22.31 ms/file between two consecutive runs of *identical* code, and
  two 5-rep A/B runs of the same pair returned 1.883x and then 0.755x (spread
  106% and 300%). The harness therefore reports its speed verdict as
  `INDETERMINATE` above 25% spread rather than publishing a number it cannot
  support. **No performance claim is made for this lane**, and no optimization
  has been applied.

### Not yet measured

- Cross-file `overrides` at project scale, because the companion index is not
  populated in production.
