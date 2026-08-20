# YAML analyzer

## Language

- Analyzer: `src/ast/real-yaml-analyzer.ts`
- Parser: vendored `wasm/tree-sitter-yaml.wasm`, loaded as `tree-sitter-yaml`
- Detection: `.yaml` and `.yml` → `yaml` in `src/ast/language-detection.ts`
- Wiring: `ASTEngine` → `RealYamlAnalyzer`; `pool-worker` preserves YAML data-key relationships

## Symbol contract

| Construct | Symbol kind | AST source | Identity |
| --- | --- | --- | --- |
| YAML document | `module` | `document` | file stem; later documents use `#2`, `#3`, … |
| mapping key with object value | `class` | `block_mapping_pair` / `flow_pair` | qualified mapping path |
| mapping key with sequence value | `variable` | mapping pair + `block_sequence` / `flow_sequence` | qualified mapping path |
| mapping key with scalar/alias value | `property` | mapping pair key node | qualified mapping path |
| object sequence item | `class` | `block_sequence_item` / flow sequence item | parent path plus `[index]` |
| nested sequence | `variable` | sequence node | parent path plus `[index]` |
| anchor | `constant` | `anchor` → `anchor_name` | parent path plus `#anchor` |

Every emitted symbol has AST-derived range offsets, `qualifiedName`, `ownerName`,
`ownerKind`, `parentId`, `valueType`, and `fullPath` metadata. Anonymous scalar
sequence values are intentionally not declarations and do not become symbols.

## Relationship ontology

- `contains`: document → mapping key, mapping/array parent → child, array →
  indexed object item, and mapping property → anchor.
- `extends`: YAML merge key `<<: *anchor`, resolved to the anchor identity.
- `uses`: ordinary aliases, resolved to an anchor when one exists and marked
  unresolved when no declaration is present.
- `references`: `$ref`/fragment-like scalar references, retained as explicit
  YAML references.
- No imports or exports are invented for ordinary YAML values.

Containment and alias relationships use qualified identities and a `Set`-backed
key, so insertion and deduplication are O(1) per emitted fact. The traversal is
iterative and visits each AST node once (apart from bounded type classification
of wrapper children); it performs no per-symbol scan.

## Supported constructs

- Block and flow mappings (`Kubernetes.yaml`, `Docker-compose.yaml`, `Flow.yml`)
- Block and flow sequences, including object items and nested sequences
- Anchors, aliases, and merge inheritance (`Kubernetes.yaml`)
- Multi-document streams (`Kubernetes.yaml`)
- YAML typed scalar nodes: string, integer, float, boolean, null
- Template-variable metadata and framework recognition for Docker Compose,
  Kubernetes, GitHub Actions, GitLab CI, Ansible, and Spring Boot
- Syntax-error propagation through the engine (`Negative.yaml`)

## Unsupported / explicit boundaries

- Unexpanded template placeholders that are invalid YAML (for example bare
  `@grails.profile@`) remain parser errors; the Grails corpus records the named
  file explicitly outside the strict acceptance subset.
- YAML tags, directives, comments, and scalar values have no declaration symbol;
  they remain AST-observed metadata or explicit unsupported grammar constructs.
- Cross-file references cannot be resolved without a project companion index;
  unresolved relationship metadata is retained rather than guessed.

## Regex inventory

The analyzer contains zero regular-expression literals or `RegExp` calls. The
only normalization uses `endsWith`, `slice`, `trim`, and AST node fields. The
machine-checked census is `validation/m12/results/regex-census.json`.

## Complexity envelope

Measured in `validation/m12/results/yaml-corpus-complexity.json`:

- Corpus: 273 strict files from clean `grails-core@a83f8748` (274 tracked;
  one named unexpanded template is measured separately)
- 12,210 symbols, 11,739 relationships, 4,738.00 ms wall time,
  57.62 files/s, 2,577.04 symbols/s, 2,477.63 relationships/s; peak RSS is
  recorded in the result artifact.
- Policy: iterative AST traversal plus Set-backed relationship dedupe; no
  O(n²) relationship or per-symbol scans.

## Differential ground truth

- Manual independent truth: `validation/m12/ground-truth/yaml.json`
- Differential: `validation/m12/results/yaml-differential.json`
- Fixtures: four positive/negative files under `validation/m12/fixtures/yaml`
- The verified result is 87/87 facts, precision 1.000, recall 1.000, with zero
  false positives, false negatives, or unknown facts.

## Evidence

- Contract: `yaml-contract.json` — 19/19 checks
- Shape safety: `yaml-shape-safety.json`
- Corpus errors: `yaml-corpus-errors.json`
- Complexity: `yaml-corpus-complexity.json`
- Manifest: `validation/m12/corpus-manifest.json`

## Issue

M12.36 / GitHub issue #175.
