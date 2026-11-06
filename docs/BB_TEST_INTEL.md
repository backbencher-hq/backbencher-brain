<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the static test-evidence reference for bb_analyze modes test_mapping,
test_gaps and test_impact: what counts as evidence, how it is ranked, and what it cannot mean.
WHO IT IS FOR — callers reading test evidence and the arithmetic behind its counts.
EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/testing/test-intel.ts,
src/mcp/tools/bb_analyze/handler.ts, docs/tools/bb_analyze.md, validation/tools/bb_analyze/AUDIT.md.
-->

# Test intelligence reference

> **Not a tool.** There is no `bb_test_intel` (or `bb_test_quality`) tool. The test-intelligence
> surface belongs to `bb_analyze` through its `test_mapping`, `test_gaps`, `test_impact` and
> `test_quality` modes. The only public tools are the sixteen in
> `docs/data/public-tools.json`.

Static, evidence-based test intelligence over the current `brain_*` tables.
Engine: `src/intelligence/testing/test-intel.ts`. Three modes: **test_mapping**,
**test_gaps**, **test_impact**.

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

## Mode: test_mapping

`testMapping(projectId)` → per production symbol: its `links[]` (each a test
symbol + file + evidence kind + confidence) and `strongestEvidence`. Summary
reports production/tested/untested symbol counts and test-file/test-symbol scan
counts.

## Mode: test_gaps

`testGaps(projectId)` → risk-ranked gaps. Categories:
- `no_evidence` — no test references the symbol.
- `weak_evidence` — only reference/import evidence, no direct call.
- `indirect_only` — a declared category NO code path emits yet: `testGaps`
  classifies only `no_evidence` / `weak_evidence` from direct edges. Named here
  because the contract reserves it, not because an answer can contain it.

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

- Mapping: `add` called by `testAdd` in `calc.test.ts` → `direct_call`, and the
  entry's `strongestEvidence` is `direct_call`. `untested` with no incoming test
  edge → `strongestEvidence: "none"`. There is no `quality` field.
- Gaps: `untested` (complex) ranks above a trivial untested `helper`.
- Impact: changing `add` lists `testAdd` as a direct test and `calc.test.ts` as
  an affected test file.

## Verification

`npx tsx script/verify-test-intel.ts` covers mapping direct-call evidence,
same-name isolation, gap inclusion/exclusion and ranking, impact direct/indirect
tests, the separate runtime-coverage field, and not-found handling. The
handler-level contract (filePath scoping, the stale/missing flag rule, the
`test_impact` declared bound) is gated by `script/m13/verify-analyze-modes.ts`.

## The population arithmetic

Both report modes publish the denominators, so the counts can be checked against
the store instead of trusted:

- `productionSymbols` — production symbols scanned, under the mode's own filter.
- `excludedAsNoise` — symbols that filter dropped, so
  `productionSymbols + excludedAsNoise` is the store's population under the filter.
- `test_mapping`: `testedSymbols + untestedSymbols = productionSymbols`.
- `test_gaps`: `total + directlyTested = productionSymbols` (`total` counts gaps).
- `returned` / `truncated` — the page, against those populations.
