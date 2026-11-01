<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the test-quality reference for bb_analyze mode test_quality: the
dimensions, how each is measured, and the states it refuses to fabricate.
WHO IT IS FOR — callers reading test-quality evidence and its declared unknowns.
EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/testing/quality.ts,
src/mcp/tools/bb_analyze/{descriptor,handler}.ts, docs/tools/bb_analyze.md,
validation/tools/bb_analyze/regex-edge-cases.ts.
-->

# Test quality reference

Engine: `src/intelligence/testing/quality.ts`, reached through the public tool as
**`bb_analyze mode=test_quality`**. The recommendations engine
(`src/intelligence/testing/suggestions.ts`) is NOT exposed as a public tool —
there is no `bb_test_suggestions` tool; historical per-mode tool names
(`bb_test_quality`, `bb_test_suggestions`) were retired into `bb_analyze` and are
not registered.

## Framework/metric independence

Each dimension is **independently measured** from its own evidence — never a
multiplier of one synthetic score. Aggregate is a confidence-weighted mean of
only the measured dimensions; `null` where nothing is measurable.

| Dimension | Evidence | Metric (evidenceStrength) | Penalty |
| --- | --- | --- | --- |
| `assertions` | `assert*(` / `expect(` / `should.` | clamps(count/6) | 1 − count/6 |
| `error_handling` | `rejects` / `try{}` / `toThrow` / `catch(` | clamps(count/3) | 1 − count/3 |
| `parameterization` | `it.each` / `test.each` / template cases | clamps(count/3) | 0 |
| `docs` | comments + long descriptive test names | clamps(count/6) | 1 − count/6 |
| `fixtures` | distinct imports (graph `brain_import`) | clamps(n/4) | null |
| `mocking` | mock-lib import (graph) OR spy/mock call sites (content) | 0.5·import + min(sites,4)/8 | 0 |

## Unknown states (never fabricated)

- A test file whose content cannot be read (beyond `maxFiles`, missing, or
  bounded `maxBytes`) leaves **content-backed** dimensions `supported:false`
  and lists them under `unsupported[]`. Graph-only dimensions (fixtures,
  mocking-by-import) still report. `overall` is `null` when nothing measurable.
- A dimension is absent only when there is genuinely no evidence; absence of an
  optional signal (parameterization, mocking without a mock framework) is **not**
  fabricated as 0 when content is unread.

## Suggestions (evidence-first)

For declared changed symbols (`added`/`modified`/`deleted`):

1. **Modified/added with evidence** → `extend_existing_test`: existing tests
   from the static mapping/impact graph (resolved-symbol edges, no same-name
   contamination) — confidence 0.85 direct, 0.6 transitive.
2. **No relationship evidence** → `create_test` via naming convention, but only
   as an explicit `naming_fallback=true`, low-confidence (0.3) suggestion.
3. **Deleted** (caller-decided; works even before reindex) →
   `review_deleted_symbol_coverage` for residual referencing tests.

Priority = f(complexity, blastRadius from graph-engine caller closure, kind);
effort = f(complexity, existing-test presence). Blast radius = unique reachable
callers. **No test code is generated or written** — recommendations are text with
evidence, priority, target basis, and effort methodology.

## Limitations

Static AST measurement only: it cannot prove runtime execution, assertion
correctness, branch/line coverage, or mock fidelity. Content-backed metrics use
framework-agnostic token evidence (assert/expect/try/catch etc.); a bespoke
assertion helper using none of those tokens scores low on `assertions` by design
and is surfaced as a `no_assertion_evidence` issue rather than fabricated.

## Verification

`npx tsx script/verify-test-quality.ts` (inline checks, exit non-zero on failure):
independent measurement and unknown-state honesty. The shipped mode's bounds
(`limit` bounds the rows returned, `summary.returned`/`totalFiles`/`truncated`),
its `filePath` rule (exact file or segment-bounded prefix) and the missing-file
`stale` flag are gated by `script/m13/verify-analyze-modes.ts` and
`script/verify-analyze.ts`; the content classifiers are tested edge-case by
edge-case in `validation/tools/bb_analyze/regex-edge-cases.ts`.
