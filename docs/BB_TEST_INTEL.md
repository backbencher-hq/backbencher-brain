# Test Intelligence Reference (M9.10)

Static, evidence-based test intelligence over the current `brain_*` tables.
Engine: `src/intelligence/testing/test-intel.ts`. Three modes: **mapping**,
**gaps**, **impact**.

## What "static test evidence" means (and does not)

A production symbol is considered *tested* when a symbol that lives in a
**test file** (`brain_file.is_test_file = 1`) has a relationship edge whose
resolved `target_symbol_id` is that production symbol. This is **static
structural evidence** from the AST/relationship graph.

It does **NOT** prove:
- that the test actually executes the symbol at runtime,
- that assertions cover the symbol's behavior,
- line/branch coverage percentages.

Runtime coverage is a **separate field** and is only populated from a real
coverage artifact (never inferred from test-file ratios or counts).

## Evidence kinds & confidence

| Kind | Relationship types | Confidence |
| --- | --- | --- |
| `direct_call` | `calls`, `instantiates` | 0.85 |
| `reference` | `references`, `uses`, `extends`, `implements` | 0.6 |
| `import` | `imports` | 0.4 |

Mapping is keyed by **resolved symbol id**, so two same-named symbols in
different files are never conflated (verified).

## Mode: mapping

`testMapping(projectId)` → per production symbol: its `links[]` (each a test
symbol + file + evidence kind + confidence) and `strongestEvidence`. Summary
reports production/tested/untested symbol counts and test-file/test-symbol scan
counts.

## Mode: gaps

`testGaps(projectId)` → risk-ranked gaps. Categories:
- `no_evidence` — no test references the symbol.
- `weak_evidence` — only reference/import evidence, no direct call.
- `indirect_only` — reachable only transitively (reserved for graph-based fill).

Ranking: `riskScore = complexity*2 + gravity*10`, so high-complexity /
high-gravity untested symbols rank above trivial ones (verified).

## Mode: impact

`testImpact(projectId, target)` → which tests exercise a changed symbol, split
into `directTests` (depth 0) and `indirectTests` (transitive, via the shared
graph engine's caller traversal), plus `affectedTestFiles`. `runtimeCoverage`
is `{ available: false }` unless a real artifact is supplied. Unknown target
returns `found: false`.

## Symbol scope

Functions, methods, classes, interfaces, structs, and enums are included
(`includeMethods` defaults true). Hard-noise paths and noise symbol names are
excluded via the canonical `AnalysisExclusions`.

## Examples

- Mapping: `add` called by `testAdd` in `calc.test.ts` → `direct_call`, quality
  `good`. `untested` with no incoming test edge → `strongestEvidence: none`.
- Gaps: `untested` (complex) ranks above a trivial untested `helper`.
- Impact: changing `add` lists `testAdd` as a direct test and `calc.test.ts` as
  an affected test file.

## Verification

`script/verify-test-intel.ts` (17 checks) covers mapping direct-call evidence,
same-name isolation, gap inclusion/exclusion and ranking, impact direct/indirect
tests, the separate runtime-coverage field, and not-found handling.
