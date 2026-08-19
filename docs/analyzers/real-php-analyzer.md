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
| `references` | `require` / `require_once` / `include` / `include_once` |
| `contains` | one edge for every owned symbol |
| imports | `use` clauses (module = FQN, item = alias or leaf) |

Member *access* (`$obj->prop`, no call) produces no edge; only member *calls*
(`$obj->method()`) do. Constructor expressions emit `instantiates`, not `calls`.

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

- Independent manual ground truth: `validation/m12/ground-truth/php.json`
- Fixtures: `validation/m12/fixtures/php/{BaseService,Service,Negative}.php`
- Differential: **49/49 facts, precision 1.000, recall 1.000, 0 FP, 0 FN**
- Corpus: `phpunit@c8d6921fb601b6988854cd84a672f06c1e49f80e`, 3,231 tracked
  `.php` files; **2 grammar-error files, 0 crashes** after the grammar upgrade
- Grammar upgrade: npm `tree-sitter-php` 0.24.2 fixed **15/17** previously
  failing files with **0 regressions** (PHP 8.4 property hooks, pipe operator,
  `new Class()->method()` dereference in production code, readonly anonymous
  classes, a vendor fluent chain); the 2 remaining are an intentional
  parse-error test fixture and a partial-function-application `?` test fixture
- Corpus production extraction: **3,073 symbols / 4,276 relationships** on the
  400-file tracked sample; evidence in
  `validation/m12/results/php-corpus-complexity.json`
- Grammar shape safety: **33/33** dispatch references emitted by the grammar
  (2 remaining refs `and`/`or` are anonymous operator tokens, confirmed live)
- Project regex census: the PHP analyzer contributes **0 regex usages**
  (project total 63 → 58)

## Complexity and limitations

The extraction walk is iterative and linear in AST nodes; contains edges are a
single post-pass and overrides use maps/sets. There is no O(n²) symbol or
relationship lookup.

PHP is dynamically dispatched: ordinary calls are emitted by syntactic AST
shape and builtin filtering, not by pretending runtime call resolution is
knowable. Cross-file override precision requires the optional project companion
index; absent that context, the analyzer remains deterministic and uses
declarations available in the current file.
