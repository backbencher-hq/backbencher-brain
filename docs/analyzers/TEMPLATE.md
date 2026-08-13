# real-<lang>-analyzer.md

<!--
Template for M12 per-analyzer documentation. Every analyzer issue (M12.02–42)
must fill this file out completely and truthfully. Sections marked "TBD" are
not done yet; do not delete them. Delete this comment block when filling in.
-->

## Language

- Analyzer file: `src/ast/real-<lang>-analyzer.ts`
- Parser: `<tree-sitter grammar + WASM path>`
- Language detection: extension(s)/basename(s) → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `<Lang>Analyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | | |
| kind | | |
| qualified/container name | | |
| ownerName / ownerKind | | |
| range (start/end line + column) | | |
| parameters | | |
| returnType / type | | |
| documentation/comments | | |
| complexity metrics | | |
| syntax errors | | |
| decorators/attributes | | |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | | | |
| extends | | | |
| implements | | | |
| instantiates | | | |
| uses | | | |
| imports | | | |
| exports | | | |
| overrides | | | |
| references | | | |
| contains | | | |
| depends | | | |
| field_access | | | |
| <language-specific> | | | |

## Supported constructs

- (enumerate with fixture references: `validation/m12/fixtures/<lang>/…`)

## Unsupported / explicit-unknown constructs

- (each must be declared, never silently dropped; reference fixtures)

## Regex inventory

From `validation/m12/results/regex-census.json` (entries for this analyzer).
Every remaining regex is classified with a justification:

| Line | Regex | Receiver category | Classification | Justification |
| --- | --- | --- | --- | --- |
| | | | | |

Rule: **zero unclassified regex.** Each `replaceable` or `needs_review`
entry is either eliminated (replaced with AST access) or reclassified
`unavoidable` with a written justification and negative fixture.

## Complexity envelope

From `validation/m12/results/<lang>-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |

Declared budget: `<budget>`

Hot-path audit: (confirm no O(n²)/per-symbol O(n) scans; list lookup
structures used)

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/<lang>.json`
  (authority: `<source|compiler|language_service|ide_index|manual_audit>`)
- Result: `validation/m12/results/<lang>-differential.json`
- Precision / recall / FP / FN / unknown rates: <values>

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `<repo>@<rev>`
- Files / symbols / relationships / errors / timeouts: <values>

## Evidence pointers

- Fixtures: `validation/m12/fixtures/<lang>/`
- Ground truth: `validation/m12/ground-truth/<lang>.json`
- Differential: `validation/m12/results/<lang>-differential.json`
- Complexity: `validation/m12/results/<lang>-complexity.json`
- Docs: this file

## Issue

Closes M12.<xx> (GitHub issue #<n>).
