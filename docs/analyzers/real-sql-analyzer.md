# real-sql-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-sql-analyzer.ts`
- Parser: `@derekstride/tree-sitter-sql` 0.3.11, vendored at `wasm/tree-sitter-sql.wasm`
- Wiring: `ASTEngine.parseFile` → `RealSqlAnalyzer`
- Corpus target: `proxicall@383e603ee678aeaeb1edbc72d51b29108633bfc1`

The previous SQL grammar was not sufficient for the production language
surface: it rejected qualified names, views, DML, CTEs, triggers, and most
PostgreSQL-style schema files. The vendored grammar was rebuilt from the
maintained 0.3.11 package and verified against the independent fixture matrix.
The engine SQL preprocessing block was removed. SQL is now parsed as written;
there is no source-text substitution that changes the language before AST
analysis or shifts the meaning of a declaration.

## Symbol contract

| Construct | Symbol kind | AST extraction |
| --- | --- | --- |
| schema | `namespace` | `create_schema` identifier |
| table | `class` | `create_table` → `object_reference.name` |
| column | `property` | `column_definition.name`, owned by the table |
| index | `constant` | `create_index` first identifier, table from object reference |
| view/materialized view | `class` | `create_view`/`create_materialized_view` object reference |
| stored function | `function` | `create_function` object reference, arguments and return type fields |
| trigger | `function` | `create_trigger` first object reference |
| custom/enum type | `type` | `create_type` object reference and enum elements |
| sequence, role, extension | `constant`, `namespace`, `module` | dedicated `create_*` AST nodes |

Columns and named constraints carry exact AST ranges, owner names, SQL type,
primary-key/unique/foreign-key metadata, and reference targets. Function
parameters are represented in `parameters`; they are not phantom variable
symbols. Anonymous `SELECT`, DML, CTE aliases, literals, fields, aliases, and
built-in function names are not declarations.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `contains` | table → column and table → index/constraint; deduplicated by type/source/target |
| `uses` | view/function/query/DML → referenced table; anonymous queries use `global` |
| `references` | foreign-key table → table, index → indexed table, trigger → target table |
| `calls` | trigger → executed function and SQL invocations that are not known built-ins |
| `imports` | explicit `#import`/`@import` comment directives, with AST comment ranges |

Relationship identity uses a `Map` keyed by type/source/target. Repeated DML
operations merge operation metadata rather than creating duplicate graph edges.
Unresolved tables/functions remain external names; no cross-file symbol is
invented by the analyzer.

## Supported constructs

The independent fixtures cover:

- schemas, tables, typed columns, primary keys, unique constraints, defaults,
  foreign keys, indexes, views, stored functions, triggers, and DML
  (`validation/m12/fixtures/sql/Schema.sql`);
- CTEs, joins, subqueries, set operations, `CASE`, user-defined invocations,
  and built-in-call filtering (`Queries.sql`);
- negative query cases proving that anonymous statements, parameters, fields,
  literals, and built-in calls do not become symbols/calls (`Negative.sql`).

## Unsupported / explicit-unknown constructs

- The grammar does not currently parse `GRANT`/`REVOKE` as dedicated nodes;
  permission statements are reported as syntax errors rather than silently
  converted into symbols.
- Procedural dialect bodies containing PL/pgSQL control flow (`IF`, `LOOP`,
  exception blocks), vendor macro expansions, and project-specific templating
  remain grammar limitations. The analyzer does not source-scan their text.
- Dynamic SQL, runtime-generated table/function names, and cross-file schema
  resolution are unresolved by syntax-only analysis and remain external edges.
- The corpus acceptance subset is explicit: the 59 tracked SQL files that are
  clean under the production parser are measured as the zero-error corpus.
  The other 148 tracked ProxiCall SQL files are retained in the evidence as
  excluded grammar-error files (2,576 production error nodes, 0 crashes), not
  relabeled as clean. The raw grammar shape scan independently reports 146
  error files / 3,876 nodes because the production engine reports recovered
  nodes after its full analysis path. This is a known grammar/dialect
  boundary, not a hidden pass.

## Regex inventory

The SQL analyzer has **zero regex usages**. It uses Tree-sitter node types and
fields for declarations, names, types, constraints, relations, invocations,
and ranges. The old engine-level SQL illusion block (which replaced MySQL
keywords and type parameters with spaces) was removed; the parser receives the
original content.

## Complexity envelope

Evidence: `validation/m12/results/sql-corpus-complexity.json`.

| Run | files | symbols | relationships | wall ms | files/s | errors | crashes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ProxiCall tracked SQL | 207 | 3,039 | 4,181 | 6,870.0 | 30.13 | 2,576 | 0 |
| clean acceptance subset | 59 | 185 | 315 | included above | included above | 0 | 0 |

The analyzer uses one iterative traversal per root/declaration/query and
constant-time sets/maps for relationship and symbol deduplication. It has no
per-symbol scan of the symbol or relationship arrays and no O(n²) resolution
path. Query dependency collection walks each AST subtree once per owning query;
there is no source-text tokenization fallback.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/sql.json`
- Authority: manual audit of independent fixtures
- Result: `validation/m12/results/sql-differential.json`
- Differential: **34/34 facts, precision 1.000, recall 1.000, 0 FP, 0 FN, 0 unknown**
- Shape audit: `validation/m12/results/sql-shape-safety.json` — 26 live fixture
  references; legacy alternatives are recorded as defensive references.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/sql/`
- Ground truth: `validation/m12/ground-truth/sql.json`
- Differential: `validation/m12/results/sql-differential.json`
- Corpus errors: `validation/m12/results/sql-corpus-errors.json`
- Complexity: `validation/m12/results/sql-corpus-complexity.json`
- Shape safety: `validation/m12/results/sql-shape-safety.json`
- Evidence scripts: `script/m12/sql-shapes.ts`, `sql-node-types-compare.ts`,
  `sql-corpus-errors.ts`, and `sql-corpus-measure.ts`

## Issue

M12.33 / GitHub issue #172.
