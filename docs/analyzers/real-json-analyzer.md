# real-json-analyzer.md

## Language and wiring

- Analyzer: `src/ast/real-json-analyzer.ts`
- Parser: vendored `tree-sitter-json`, `wasm/tree-sitter-json.wasm`
- Wiring: `ASTEngine.parseFile` → `RealJsonAnalyzer`
- Language detection: `.json` and `.jsonc` map to the JSON parser. JSONC is
  currently an explicit unsupported dialect boundary, not silently treated as
  strict JSON.
- Corpus: `roslyn@73241b4beaccbdb6e8f7eb78f5377a01c88ddc21` (clean pinned
  repository from the M11 manifest)

The analyzer was rewritten from the legacy heuristic implementation around the
actual JSON grammar vocabulary (`document`, `object`, `pair`, `array`,
`string`, `number`, `true`, `false`, and `null`). It performs one bounded AST
pre-pass for schema `required` arrays and one iterative AST extraction pass.
No source text is scanned to discover symbols or relationships.

## Symbol contract

| Construct | Symbol kind | AST rule |
| --- | --- | --- |
| JSON file | `module` | file root `document`, named from the `.json` stem |
| object-valued key | `class` | `pair.value` is an `object`; key owns the object path |
| array-valued key | `variable` | `pair.value` is an `array` |
| scalar-valued key | `property` | `pair` whose value is `string`, `number`, `true`, `false`, or `null` |
| object inside an array | `class` | actual AST `object`, named with its indexed JSON path (`items[0]`) |
| object/array key | path metadata | `qualifiedName`, `ownerName`, and `metadata.fullPath` are AST-derived |

Every symbol has an exact node range, `returnType`/value type, owner path,
qualified path, and JSON metadata. Scalar values do not become anonymous value
symbols. Repeated array items do not collapse into the same qualified identity:
array object paths are indexed by AST child position. JSON has no functions,
parameters, return declarations, decorators, or comments represented as
symbols; those fields are intentionally absent rather than synthesized.

Schema metadata is AST-backed: `required` is true only when the key is listed
in the sibling `required` array for the same object path. Validation metadata
comes from JSON Schema keyword keys or validation keys in an object value.
Object/array counts, booleans, nulls, maximum path depth, and syntax errors are
reported in file metadata.

## Relationship ontology

| Relationship | Rule |
| --- | --- |
| `contains` | parent JSON path → child key or indexed array object |
| `references` | `$ref` pair → resolved local qualified target when present, otherwise the external ref string |
| `uses` | package manifest module → direct dependency key for `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies` |
| imports | package dependency keys become package-manager imports |
| exports | the JSON file module is exported; object keys are not falsely exported modules |

All relationship sources and targets are derived from symbols or AST pair
fields. Local `$ref` fragments are mapped to a qualified path such as
`schema.$defs.Address`; unresolved/external references retain their explicit
ref string and confidence is reduced. Dependency extraction is direct-child
only, so the `dependencies` container and its version values are not phantom
package imports.

The pool-worker relationship noise filter has a JSON-specific exception because
keys such as `type`, `text`, and `parent` are valid user data, not Tree-sitter
internal method names. This is a production-pipeline correctness fix, not a
post-hoc differential normalization.

## Supported constructs

Independent fixtures cover:

- nested object and array paths, indexed array objects, scalar types, nulls,
  booleans, and empty objects (`validation/m12/fixtures/json/Negative.json`);
- JSON Schema `$schema`, `$defs`, `properties`, `required`, `items`, local
  `$ref`, and validation keywords (`api-contract.json`);
- package name/version, scripts, direct dependencies, dev dependencies, and
  engine constraints (`package.json`).

## Unsupported / explicit-unknown constructs

- JSONC comments and trailing-comma forms are not strict JSON and are not
  rewritten or source-scanned by this analyzer.
- UTF-8 BOM is recognized by the corpus policy as an encoding boundary; the
  current tree-sitter JSON grammar reports the affected file as a syntax error.
- JSON files containing registration/template dialect constructs remain
  explicit corpus exclusions. They are listed in
  `validation/m12/results/json-corpus-errors.json`; no excluded file is counted
  as clean.
- Dynamic meanings of arbitrary configuration keys cannot be inferred from
  JSON syntax alone. The analyzer records their structural type and path but
  does not invent framework-specific declarations.
- Cross-file `$ref` resolution is emitted as an unresolved external relationship
  until the global linker supplies the referenced document.

## Regex inventory

The analyzer has **zero regex usages**. Numeric type, file-stem handling,
references, validation keys, endpoint keys, and path construction use AST node
types, fields, sets, and bounded string operations. The strict census has zero
JSON entries and zero unclassified regexes overall after refresh.

## Complexity envelope

Evidence: `validation/m12/results/json-corpus-complexity.json`.

| Run | files | symbols | relationships | wall ms | files/s | symbols/s | relationships/s | errors | crashes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Roslyn strict JSON acceptance | 119 | 69,512 | 70,074 | 35,540.4 | 3.348 | 1,955.9 | 1,971.7 | 0 | 0 |

The corpus script also audited all 133 tracked `*.json` paths. Fourteen are
explicitly excluded because they are JSONC, contain registration/template
syntax, or use a UTF-8 BOM; three of those produce 16 grammar error nodes. The
full audit is preserved in `json-corpus-errors.json` and reports 0 crashes and
0 strict-JSON grammar gaps. The acceptance measurement does not silently count
those files.

The analyzer uses two iterative AST traversals and constant-time keyword/path
sets. Symbol and relationship creation is O(n) in AST nodes plus O(r) output;
there is no per-symbol scan, nested symbol search, or O(n²) relationship
resolution. Array indexing makes repeated item identities unique without a
second pass over prior symbols.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/json.json`
- Authority: manual audit of independent fixtures
- Result: `validation/m12/results/json-differential.json`
- Differential: **119/119 facts, precision 1.000, recall 1.000, 0 FP, 0 FN,
  0 unknown, 0 parse errors**
- Metadata contract: `validation/m12/results/json-contract.json` — 9/9 checks
  pass for schema-required mapping, validation flags, indexed identities, and
  anonymous-value suppression.
- Shape audit: `validation/m12/results/json-shape-safety.json` — every
  referenced grammar type is live; excluded-file errors are separated from the
  strict acceptance set.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/json/`
- Ground truth: `validation/m12/ground-truth/json.json`
- Differential: `validation/m12/results/json-differential.json`
- Corpus errors: `validation/m12/results/json-corpus-errors.json`
- Complexity: `validation/m12/results/json-corpus-complexity.json`
- Shape safety: `validation/m12/results/json-shape-safety.json`
- Metadata contract: `validation/m12/results/json-contract.json`
- Evidence scripts: `script/m12/json-corpus-errors.ts`,
  `json-corpus-measure.ts`, `json-node-types-compare.ts`, and
  `json-contract-probe.ts`

## Issue

M12.34 / GitHub issue #173.
