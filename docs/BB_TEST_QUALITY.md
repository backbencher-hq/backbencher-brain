# Test Quality & Suggestions (M9.11)

Engines: `src/intelligence/testing/quality.ts` (measurement) and
`src/intelligence/testing/suggestions.ts` (recommendations).
Tools: **`bb_test_quality`** and **`bb_test_suggestions`** (sidecar, read-only).

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

`script/verify-test-quality.ts` (26 checks): independent measurement,
unknown-state honesty, evidence-first modified/added/untested/deleted suggestion
scenarios, and existing-test-first recommendations.
