# HCL / Terraform analyzer

## Language

- Analyzer: `src/ast/real-hcl-analyzer.ts`
- Parser: vendored `wasm/tree-sitter-hcl.wasm`, loaded as `tree-sitter-hcl`
- Detection: `.tf`, `.tfvars`, `.tofu`, and `.hcl` → `hcl` in
  `src/ast/language-detection.ts`
- Wiring: `ASTEngine` → `RealHclAnalyzer`; `pool-worker` preserves HCL
  data-key relationships (attribute names such as `type` bypass the universal
  identifier sanitizer)

## Symbol contract

| Construct | Symbol kind | AST source | Identity |
| --- | --- | --- | --- |
| `resource` block | `class` | `block` | `<resource_type>.<name>` (Terraform address) |
| `data` block | `class` | `block` | `<data_type>.<name>` |
| `variable` block | `variable` | `block` | `<name>` (single label) |
| `output` block | `variable` | `block` | `<name>` (single label) |
| `module` block | `module` | `block` | `<name>` |
| `provider` block | `module` | `block` | `<name>` |
| `terraform` / `locals` | `module` | `block` | block type (no label) |
| nested block (`lifecycle`, `backend`, `dynamic`, `content`, …) | `class` | `block` | `<block_type>` or `<block_type>.<label>` |
| attribute / argument | `property` | `attribute` | enclosing-block path plus attribute key |

Every emitted symbol carries an AST-derived range (1-based line, byte offsets),
a dot-qualified `scope`, and the enclosing block as `ownerName`/`ownerKind`.
Block symbols also expose `hclBlockType`, `hclLabels`, and `hclBlockKind`;
attribute symbols expose `hclValueKind` (the expression node type).

## Relationship ontology

- `contains`: parent block → nested block, and block → attribute, using
  qualified identities (`aws_instance.web` → `aws_instance.web.lifecycle`).
- `references`: enclosing block → dotted reference path, extracted from the
  `variable_expr` + `get_attr` sequence. Families: `var.<name>`, `local.<name>`,
  `module.<name>`, `data.<type>.<name>.<attr>`, `<resource_type>.<name>.<attr>`,
  and builtins `each.<k>`, `count.index`, `self.<attr>`, `path.<k>`,
  `terraform.<k>`.
- `imports`: a `module` block records its `source` path as an import.

The reference walk excludes object keys (`object_elem` `key` field) and
`for`-loop variables (`for_intro` identifiers); bare single-identifier paths
are type-constraint keywords (`type = string`), not references. Containment and
reference deduplication use a `Set` key, so insertion is O(1) per emitted fact.

## Supported constructs

- `terraform`, `provider`, `variable`, `output`, `module`, `locals`, `resource`,
  and `data` blocks
- Nested blocks: `backend`, `lifecycle`, `ingress`, `dynamic`/`content`, etc.
- Attribute values: literals, references, function calls, template
  interpolation, object/tuple collections, `for` expressions, `depends_on`,
  `for_each`, `count`
- Syntax-error propagation through the engine (`Negative.tf`)

## Unsupported / explicit boundaries

- Bare type-constraint identifiers (`string`, `number`, `list`, …) are not
  references; they are the grammar's `variable_expr` with no accessor and are
  intentionally skipped.
- Splat (`*`) and legacy index/splat edge forms are read best-effort from the
  `get_attr` identifier; no source-text regex is used to recover them.
- Cross-file reference resolution requires a project companion index; the raw
  dotted path is retained as an explicit unresolved reference.

## Regex inventory

The analyzer contains zero regular-expression literals or `RegExp` calls.
Label/string values are read from the `template_literal` grammar field and all
reference extraction is field/type driven. The machine-checked census is
`validation/m12/results/regex-census.json`.

## Complexity envelope

Measured in `validation/m12/results/hcl-corpus-complexity.json`:

- Corpus: 2,295 strict files from clean `terraform@2e1710bf` (2,299 tracked;
  four named intentional-invalid diagnostics fixtures measured separately)
- 14,226 symbols, 10,667 relationships, 6,137.39 ms wall time,
  373.94 files/s, 2,317.92 symbols/s, 1,738.04 relationships/s
- Policy: one iterative DFS over the tree plus one recursive expression walk
  and Set-backed relationship dedupe; no O(n²) or per-symbol relationship scans.

## Differential ground truth

- Manual independent truth: `validation/m12/ground-truth/hcl.json`
- Differential: `validation/m12/results/hcl-differential.json`
- Fixtures: two positive/negative files under `validation/m12/fixtures/hcl`
- The verified result is 107/107 facts, precision 1.000, recall 1.000, with
  zero false positives, false negatives, or unknown facts.

## Evidence

- Contract: `hcl-contract.json` — 38/38 checks
- Shape safety: `hcl-shape-safety.json`
- Corpus errors: `hcl-corpus-errors.json`
- Complexity: `hcl-corpus-complexity.json`
- Manifest: `validation/m12/corpus-manifest.json`

## Issue

M12.37 / GitHub issue #176.
