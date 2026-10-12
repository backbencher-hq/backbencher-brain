// VERIFY_PY10 — the module `script/m60/rel-type-coverage-gate.ts` looks for.
//
// WHY THIS FILE EXISTS. The gate resolves a lane's own oracle labels by reading
// `script/m14/<lang>-truth.ts` and pulling `export const <LANG>_ORACLE_LABELS = [...]` out
// of it with a narrow regex. Python's oracle lives at
// `script/m14/oracles/python-truth.ts`, so the read returns `null` and the gate falls back
// to the shared differential filter — which audits
// `["calls","extends","implements","instantiates","overrides","references","uses"]` and
// therefore reports three registered DERIVATION findings for python:
//
//   DERIVATION|python|emits `contains` but the differential audits [...] — stored and
//       compared against nothing
//   DERIVATION|python|emits `exports`  …
//   DERIVATION|python|emits `imports`  …
//
// (validation/m60/rel-type-coverage-baseline.json, `at: 2026-10-01`, 104 findings, and the
// gate now reports 120 across 37 lanes.) All three ARE derived by the oracle —
// `add("contains", …)`, `add("exports", …)`, `add("imports", …)` — and
// `oracles/python-truth-diff.ts` compares all nine. The debt is a WIRING debt.
//
// This is a re-export shim and nothing else. It adds no derivation, no rule and no
// edge: `derivePythonTruth` is imported from the one module that implements it, so there
// is still exactly one oracle and the shim cannot drift away from it in behaviour.
//
// THE LITERAL IS RESTATED, AND THAT IS THE ONE THING TO CHECK HERE. The gate's regex needs
// the array INLINE in this file, so the canonical `PYTHON_ORACLE_LABELS` in
// `oracles/python-truth.ts` cannot simply be re-exported. A restated list is a stale list
// read as a current one — the failure ruby's ORACLE_LABELS header warns about, and worse
// than an empty set because an empty set is visible. So
// `script/m14/verify-python-oracle-labels.ts` runs the oracle over a real corpus and
// asserts, in BOTH directions, that this list and the canonical one equal the labels the
// oracle actually produces. A derivation added without a label fails that check; a label
// with no derivation fails it too.

export {
  derivePythonTruth,
  PYTHON_ORACLE_LABELS,
  type TruthEdge,
} from "./oracles/python-truth"

/**
 * The labels this lane's oracle derives. Kept inline because the gate reads it with a
 * regex and cannot follow a re-export; verified against a real corpus, in both
 * directions, by script/m14/verify-python-oracle-labels.ts.
 */
export const PYTHON_TRUTH_ORACLE_LABELS: ReadonlyArray<string> = [
  "calls",
  "contains",
  "exports",
  "extends",
  "implements",
  "imports",
  "instantiates",
  "overrides",
  "references",
  "uses",
]