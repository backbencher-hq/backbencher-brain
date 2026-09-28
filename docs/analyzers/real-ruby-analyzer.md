# real-ruby-analyzer.md

## Language

- Analyzer: `src/ast/real-ruby-analyzer.ts`
- Parser: pinned `tree-sitter-ruby` WASM at `wasm/tree-sitter-ruby.wasm`
- Detection: `.rb` → `ruby` in `src/ast/language-detection.ts`
- Wiring: `ASTEngine.getAnalyzer("ruby")` → `RealRubyAnalyzer`

## Symbol contract

| Construct | Symbol | AST source |
| --- | --- | --- |
| `class Name < Base` | `class` | `class` name field |
| `module Name` | `module` | `module` name field |
| `def method(...)` | `method` (or top-level `function`) | `method` name field |
| `def self.method(...)` | static `method` | `singleton_method` name field |
| `class << self` methods | static `method` | `singleton_class > method` |
| `attr_reader` / `attr_writer` / `attr_accessor` | `property` | `simple_symbol` arguments |
| class-body `CONSTANT = value` | `constant` | `assignment > constant` |
| `define_method(:name)` | dynamic `method` | `simple_symbol` argument |

Ranges come directly from the Tree-sitter node and include the complete
construct. Method parameters are extracted from `method_parameters` without
turning parameters or locals into symbols. `ownerName` is the enclosing class
or module. Visibility is lexical (`public`, `protected`, or `private`) and is
captured on traversal frames, so nested classes cannot leak their visibility
state into sibling declarations.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `extends` | Ruby superclass (`class Child < Parent`) |
| `implements` | `include` / `prepend` mixins |
| `extends` | `extend` singleton mixin |
| `calls` | non-builtin `call` nodes, source = enclosing method/module/class |
| `instantiates` | `Class.new(...)` and bare `new(...)` in a class method; constructor calls are not duplicated as `calls` |
| `overrides` | implicit Ruby method override when the method exists on the superclass, using local declarations or the project companion index |
| `references` | `require`, `require_relative`, and `load` string arguments |
| `contains` | one edge for every owned symbol |
| `uses` | ActiveRecord association macros (`has_many`, `belongs_to`, etc.) |

Kernel/builtin methods, `super`, Ruby special methods, Rails declaration
macros, visibility directives, and accessor directives do not become ordinary
call edges. Receiver calls preserve the leaf target (`record.valid?` →
`valid?`) while constructor expressions preserve the class target.

## Supported AST shapes

- Root `program` and nested module/class `body_statement` containers
- `method` and `singleton_method`, including keyword, splat, hash-splat, and
  block parameters
- `singleton_class` (`class << self`)
- `call`, `argument_list`, `scope_resolution`, `simple_symbol`, `string`, and
  class-body `assignment`
- `if`, `unless`, `while`, `until`, `for`, `case`,  `rescue`, and `elsif` complexity nodes

The analyzer has no regex-based parsing or normalization. It uses AST fields,
node text only where the grammar provides a token, and small character scans
for quote/colon/qualified-name normalization.

## Verification evidence

- Independent manual ground truth: `validation/m12/ground-truth/ruby.json`
- Fixtures: `validation/m12/fixtures/ruby/{BaseService,Service,Negative}.rb`
- Differential: **37/37 facts, precision 1.000, recall 1.000, 0 FP, 0 FN**
- M11 Ruby fixtures regenerated through the production parallel indexer;
  `ruby-observed.json` records the rewritten analyzer output and imports.
- Corpus: `rake@dd5e851d75fd850a730aae4482f6ca59843ac869`, 95 tracked `.rb`
  files, **0 grammar-error files, 0 crashes**
- Corpus production extraction: **1,309 symbols / 6,524 relationships** in
  approximately 1.3 seconds in the recorded run; evidence is in
  `validation/m12/results/ruby-corpus-complexity.json`
- Grammar shape safety: **20/20** type-dispatch references emitted by
  the pinned grammar; 0 missing references and 0 corpus parse errors
- Project regex census: the Ruby analyzer contributes **0 regex usages**

## Complexity and limitations

The extraction walk is iterative and linear in AST nodes. Overrides use maps and
sets; contains edges are a single post-pass. Visibility directives are recorded
in a map and applied in one linear symbol pass, avoiding a per-directive symbol
scan. No nested symbol/relationship scan is used for ordinary extraction.

Ruby is dynamically dispatched: ordinary calls are emitted by syntactic AST
shape and builtin filtering, not by pretending that runtime method lookup is
fully knowable. Cross-file override precision requires the optional project
companion index; absent that context, the analyzer remains deterministic and
uses declarations available in the current file.
