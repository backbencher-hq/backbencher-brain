# real-r-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-r-analyzer.ts`
- Parser: pinned `tree-sitter-r` WASM at `wasm/tree-sitter-r.wasm`
  <!-- provenance: find-grammar-provenance -->
  Provenance of the shipped bytes: byte-identical to the published
  `@eagleoutice/tree-sitter-r@1.1.2` wasm (sha256 `b11a872a88ad8a9e…`).
  Established by `script/m60/find-grammar-provenance.ts` (exact sha256 match, no inference from
  size or date); evidence in `validation/m60/results/G-PROVENANCE.json`.
- Wiring: `ASTEngine.getAnalyzer("r")` → `RealRAnalyzer`
- Corpus: clean `dplyr@d5e94e7f` tracked R sources

## Symbol contract

| Construct | Symbol | AST rule |
| --- | --- | --- |
| `name <- function(...) {}` | `function` | `binary_operator` assignment whose RHS is `function_definition` |
| `generic.class <- function(...) {}` | `method` | same assignment with a dotted S3 name |
| `R6Class(...)` assignment | `class` | assignment RHS call with function `R6Class` |
| R6/R5 method list entry | `method` | named `argument` whose value is an AST function definition |
| `setClass("Name", ...)` | `class` | first string argument of the AST call |
| S4 `slots = c(name = ...)` | `property` | named arguments inside the `c` call |
| `setGeneric("name")` | `function` | first string argument |
| `setMethod("name", "Class", ...)` | `method` | first and second string arguments; method owner is the class |
| other module-level identifier assignment | `variable` or `constant` | `binary_operator` LHS identifier; all-uppercase names are constants |

Function parameters, local assignments, field mutations (`$`/`@`), indexed
assignments, anonymous function expressions, and call-shaped LHS expressions
are not declarations. Every emitted range is taken from the corresponding
Tree-sitter node. Function parameters retain optional/default information.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `contains` | one deduplicated global edge per module-level symbol and owner edge per R6/R5/S4 member |
| `calls` | calls inside a named function or named R6/S4 method, sourced from the enclosing callable |
| `instantiates` | `DeclaredR6Class$new()` / equivalent constructor receiver only when the class is AST-declared in the file |
| `extends` | R6/R5 `inherit`/`contains` and S4 `contains` class arguments |
| `implements` | dotted S3 method assignment to its generic name |
| `references` | `library()` / `require()` module dependencies |

The analyzer deduplicates relationship identity by type/source/target. It does
not guess that arbitrary capitalized calls or external `$new` receivers are
constructors. Qualified external calls remain syntactic call targets, preserving
information without inventing an in-file class.

## Supported AST shapes and metadata

The iterative AST walk covers `program`, `binary_operator`, `call`,
`function_definition`, `argument`, `arguments`, `namespace_operator`,
`extract_operator`, `subset`, `unary_operator` formulas, comments, and the
`if_statement`/`for_statement`/`while_statement`/`repeat_statement` complexity
nodes. It records Roxygen comments, pipe operations, data frames, formulas,
vectorized subsetting, S3/S4/R5/R6, NSE, imports, Shiny, Rcpp, and statistical
patterns as metadata rather than phantom declarations.

No regex-based parsing or source-wide scanning is used. String literals are
unquoted through the grammar's `content` child, with a bounded first/last-token
fallback only for grammar-provided string nodes.

## Verification evidence

- Independent fixtures: `validation/m12/fixtures/r/{Base,Service,Negative}.R`
- Manual ground truth: `validation/m12/ground-truth/r.json`
- Differential: **46/46 facts, precision 1.000, recall 1.000, 0 FP, 0 FN**
- Grammar shape safety: **20/20 dispatch references live**, including an
  explicit control-flow/formula probe; 0 shape-probe parse errors
- Corpus parser scan: **195 tracked R files, 0 grammar-error files, 0 error
  nodes, 0 crashes**
- Production extraction: **3,509 symbols / 6,127 relationships**, 0 parse
  errors; recorded in `validation/m12/results/r-corpus-complexity.json`
- R analyzer regex census: **0 usages**

## Complexity and limitations

Extraction uses an iterative AST walk, a set-based declared-type check, and
linear relationship/contains deduplication. There is no per-symbol scan of the
symbol or relationship arrays and no O(n²) resolution path. Corpus measurements
use the production `pool-worker.parseFile` path on tracked files only.

R is dynamically dispatched. S3 method dispatch, NSE, and external package
classes cannot be resolved completely from syntax alone. The analyzer therefore
emits syntactic calls and only resolves constructor edges for classes declared
in the current AST. S4 method bodies represented as anonymous function values
are attributed to their explicit `setMethod` name/class; arbitrary anonymous
closures remain expression noise by contract.

The pinned dplyr corpus is language-representative and clean, but it does not
claim to cover every CRAN package or every grammar extension.
