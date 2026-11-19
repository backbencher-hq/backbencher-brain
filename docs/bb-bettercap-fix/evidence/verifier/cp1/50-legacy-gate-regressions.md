# CP1 pre-final — legacy-gate regressions from the P1-4 envelope (FOUND, blocking)

Status: **pre-final** (found on the wave-1-frozen tree without the cross-lang retro-honesty landing;
re-verify after the FINAL build). Method: every gate run via `script/m-fix/verify-fix-campaign.ts`
with `BB_DATA_DIR` scratch; each failure replayed on the pre-fix byte copy
(`.tools/verifier/pre-fix` = `git archive 75448b02`) with the same runner/env.

## Classification table

| gate | fixed HEAD | pre-fix bytes | verdict |
|---|---|---|---|
| `script/verify-graph.ts` | **FAIL (exit 1)** — `FAIL: D11: bb_graph edges expose the stored enrichment why (role/criticality + inferredAt) []` and `TypeError: Spread syntax requires ...iterable not be null or undefined` at `script/verify-graph.ts:416` | PASS (exit 0) | **REGRESSION** |
| `script/m13/verify-analyze-modes.ts` | **FAIL (exit 1)** — `FAIL: impact: returns the fields it exists to return {"summary":{...}}` (the assertion sees the new `summary` wrapper where it expects the legacy flat fields) | PASS (exit 0) | **REGRESSION** |
| `script/m65/verify-graph-blindspots.ts` | **FAIL (exit 1)** — `FAIL unattributed-count-names-itself-in-provenance  provenance.unknowns carries an 'unattributed-source' note: false` | PASS (exit 0) | **REGRESSION** |
| `script/m13/verify-visualize-views.ts` | **FAIL (exit 1)** — `FAIL: json: view=graph undefined` | PASS (exit 0) | **REGRESSION** |
| `script/m13/verify-visualize-honesty.ts` | FAIL (exit 1) — `FAIL: attribution: the fixture excludes the vendored symbol` | **FAIL (exit 1)** | **PRE-EXISTING** (not a regression) |
| `script/m13/verify-analyze-handler.ts` | PASS | — | no change |
| `script/m65/verify-edge-kind-scoping.ts` | PASS | — | no change |
| `script/m13/verify-visualize-contract.ts` | PASS | — | no change |

Root cause of all four regressions is the **P1-4/P2-5 envelope representation change**: the four
graph-family handlers now return `{ summary, data }` (summary-first; graph/visualize also carry a
node table) and the legacy gates read the old flat access paths (`json.callers`, `json.callee`,
flat `provenance`, `json.view`). The envelope's behavior assertions are covered by the new
`script/m73/verify-payload-envelope.ts` (GREEN), but the campaign's rule "a fix that regresses another
gate is not done" (FIX-CHARTER §4.4) makes these CP1 blockers until the affected gates are adapted by
the same bounded access-path method used for `script/m28/verify-mcp-tools.ts` and
`script/m48/verify-p1-impact-unity.ts` (path-only flatten, predicates unchanged) and re-run GREEN with
the underlying content assertions re-evaluated (not merely bypassed).

## Non-regressions / environment (recorded, not blockers)

- `script/m26/verify-polyglot-e2e.ts` — FAIL under `bun` (better-sqlite3/bun driver mismatch), **PASS
  under its documented `npx tsx` runner** (12.4 s). Environment/runner, not code.
- `script/m28/verify-mcp-tools.ts` — FAIL under `bun` (`ERR_DLOPEN_FAILED: 'better-sqlite3' is not yet
  supported in Bun`; gate loads `dist/` via node driver), **PASS under `npx tsx`** (7.2 s).
- `script/m57/verify-t5-predicate-unity.ts` — pre-existing P3 source-governance RED (same file class
  as baseline; now lists `src/intelligence/documentation/doc-engine.ts:458` shifted from :438).
- `script/m57/verify-closure.ts`, `verify-gate-selftest.ts`, `verify-governance.ts` — pre-existing RED
  (campaign-state / gate-rot / offline-network) as recorded in `verifier.md` §2.
- `script/m48/verify-p1-impact-unity.ts` — pre-existing known-gap (79 passed / 1 failed on pre-fix
  bytes too; `evidence/verifier/cp1/m48-p1-prefix.log`).
- `script/m13/verify-visualize-honesty.ts` — pre-existing RED, see table.

## Evidence

- Records: `docs/bb-bettercap-fix/evidence/verifier/runs/` (`cp1f-regress/*`, `cp1f-prefix/*`)
- Logs: `docs/bb-bettercap-fix/evidence/verifier/cp1/regress-*.log`
- Pre-fix re-run logs: same dir, `cp1f-prefix` records
