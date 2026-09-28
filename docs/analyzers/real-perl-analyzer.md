# real-perl-analyzer.md

## Language

- Analyzer: `src/ast/real-perl-analyzer.ts`
- Parser: `tree-sitter-perl` **1.2.1** (npm source freshly built to
  `wasm/tree-sitter-perl.wasm` during M12.30; the previous pinned WASM was
  retained for the direct comparison)
- Detection: `.pm`/`.pl` → `perl` in `src/ast/language-detection.ts`
- Wiring: `ASTEngine.getAnalyzer("perl")` → `RealPerlAnalyzer`

## Symbol contract

| Construct | Symbol | AST source |
| --- | --- | --- |
| `package Name;` | `class` | `package_statement` → `package` |
| `sub name { ... }` in a package | `method` | `subroutine_declaration_statement` → `bareword` |
| `sub new { ... }` | `constructor` named `constructor` | the same `bareword`, normalized from `new` |
| top-level `our $VERSION` | `constant` | `variable_declaration` → `scalar` → `varname` |
| top-level `our @EXPORT` | `constant` | `variable_declaration` → `array` → `varname` |
| Moose/Moo `has 'name'` | `property` | function-call AST → first string argument |

Lexical `my`, `state`, and `field` declarations, subroutine parameters,
anonymous subroutines, and local temporaries are **never symbols**. The
package symbol is root-level; methods, package globals, and declarative
properties carry `ownerName` and receive one `contains` relationship.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `extends` | `use parent`, `use base`, `Mojo::Base` superclass argument, `extends`, or `@ISA` |
| `implements` | Moose/Moo `with` role declaration |
| `calls` | `function_call_expression` and `method_call_expression`, leaf target, source = enclosing sub |
| `instantiates` | concrete `Package->new()` or `new()` constructor call; dynamic scalar/chained receivers are excluded |
| `overrides` | package method whose name is declared by its inherited base, using local declarations or the project companion index |
| `contains` | one edge for every owned package member |
| imports | every `use_statement`, with module and AST-derived arguments |
| exports | names from an AST `@EXPORT` assignment and `qw(...)` word list |

Perl builtins and control primitives are filtered from ordinary call edges.
Qualified calls preserve the leaf target (`Service::Util::format()` →
`format`); member calls preserve the method leaf (`$self->helper()` →
`helper`). Constructor calls emit `instantiates`, not a duplicate ordinary
`calls` edge.

## Supported AST shapes

- `source_file` with ordered `package_statement` siblings
- `package_statement`, `subroutine_declaration_statement`, and `block`
- `variable_declaration` with `scalar`, `array`, and `hash` children
- `use_statement` with `module` and string/word-list arguments
- `function_call_expression`, `ambiguous_function_call_expression`, and
  `method_call_expression`
- `assignment_expression`, `quoted_word_list`, `string_literal`, and
  `string_content`
- Control-flow nodes for cyclomatic complexity counting

The analyzer is regex-free. It uses AST fields and node types, plus small
character scans for Perl sigils, quoted literals, qualified-name leaves, and
word-list separators where the grammar intentionally exposes the content as a
single token.

## Verification evidence

- Independent manual ground truth: `validation/m12/ground-truth/perl.json`
- Fixtures: `validation/m12/fixtures/perl/{BaseService,Service,Negative}.pm`
- Differential: **32/32 facts, precision 1.000, recall 1.000, 0 FP, 0 FN**
- Corpus: `mojo@93f591742a7dbc0cee36875ab80a38f0666e32ae`, 164 tracked
  `.pm`/`.pl` files; **3 grammar-error files, 0 crashes** after the upgrade
- Residual corpus errors: two valid bareword `true`/`false` calls in
  `lib/Mojo/JSON.pm`, plus two intentionally malformed loader-test fixtures;
  the upgraded parser fixed the valid `CHECK:` phase in `lib/Mojo/Exception.pm`
- Production extraction: **1,681 symbols / 5,991 relationships** in the
  recorded tracked-only run; evidence is in
  `validation/m12/results/perl-corpus-complexity.json`
- Grammar comparison: current pinned parser vs freshly built npm 1.2.1 —
  **4 → 3 error files, 1 fixed, 0 regressions, 0 crashes**
- Grammar shape safety: **12/12** analyzer dispatch references emitted by
  the upgraded grammar; no missing references
- Project regex census: the Perl analyzer contributes **0 regex usages**

## Complexity and limitations

The extraction is a single recursive AST walk over the source tree. Symbol and
relationship identity sets/maps make duplicate suppression and override lookup
O(1); contains and override completion are linear post-passes. No per-symbol
scan of the full symbol or relationship arrays is used.

Perl is dynamically dispatched: ordinary calls are emitted from syntactic AST
shape and builtin filtering, not from pretending runtime dispatch is fully
knowable. A concrete instantiation requires a package-shaped receiver; scalar
and chained receivers remain calls only. Cross-file override precision requires
the optional project companion index; without it, declarations available in the
current file are still handled deterministically.
