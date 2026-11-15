# validation/m48 + validation/m25 — 39 RESULT PATHS DISPOSITIONED

**The results rule applied: the newer run kept, the superseded side preserved VERBATIM**, with the class of
each recorded. Every HEAD-side file is still on disk as `<stem>.superseded-e7c9819f4.<ext>`.

**stamp-only: 8 · MEASURED DIFFERENTLY: 31**

| path | class | superseded file |
|---|---|---|
| `validation/m25/results/D1-install.json` | stamp-only | `D1-install.superseded-e7c9819f4.json` |
| `validation/m25/results/D1.json` | stamp-only | `D1.superseded-e7c9819f4.json` |
| `validation/m25/results/E1.json` | stamp-only | `E1.superseded-e7c9819f4.json` |
| `validation/m25/results/E2.json` | stamp-only | `E2.superseded-e7c9819f4.json` |
| `validation/m25/results/E3-render-capture.txt` | MEASURED DIFFERENTLY | `E3-render-capture.superseded-e7c9819f4.txt` |
| `validation/m25/results/E3.json` | stamp-only | `E3.superseded-e7c9819f4.json` |
| `validation/m25/results/E4-openvsx.json` | MEASURED DIFFERENTLY | `E4-openvsx.superseded-e7c9819f4.json` |
| `validation/m25/results/E4.json` | stamp-only | `E4.superseded-e7c9819f4.json` |
| `validation/m25/results/E5.json` | MEASURED DIFFERENTLY | `E5.superseded-e7c9819f4.json` |
| `validation/m25/results/E7-darwin.json` | MEASURED DIFFERENTLY | `E7-darwin.superseded-e7c9819f4.json` |
| `validation/m25/results/E7-linux.json` | stamp-only | `E7-linux.superseded-e7c9819f4.json` |
| `validation/m25/results/E7-windows.json` | stamp-only | `E7-windows.superseded-e7c9819f4.json` |
| `validation/m25/results/F-ANTIGRAVITY.json` | MEASURED DIFFERENTLY | `F-ANTIGRAVITY.superseded-e7c9819f4.json` |
| `validation/m25/results/F-CURSOR.json` | MEASURED DIFFERENTLY | `F-CURSOR.superseded-e7c9819f4.json` |
| `validation/m25/results/F-WINDSURF.json` | MEASURED DIFFERENTLY | `F-WINDSURF.superseded-e7c9819f4.json` |
| `validation/m25/results/G1.json` | MEASURED DIFFERENTLY | `G1.superseded-e7c9819f4.json` |
| `validation/m25/results/V1.json` | MEASURED DIFFERENTLY | `V1.superseded-e7c9819f4.json` |
| `validation/m25/results/X1.json` | MEASURED DIFFERENTLY | `X1.superseded-e7c9819f4.json` |
| `validation/m25/results/manifest.json` | MEASURED DIFFERENTLY | `manifest.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_analyze.json` | MEASURED DIFFERENTLY | `C1-bb_analyze.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_annotate.json` | MEASURED DIFFERENTLY | `C1-bb_annotate.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_annotations.json` | MEASURED DIFFERENTLY | `C1-bb_annotations.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_ask.json` | MEASURED DIFFERENTLY | `C1-bb_ask.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_cross_language.json` | MEASURED DIFFERENTLY | `C1-bb_cross_language.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_doc.json` | MEASURED DIFFERENTLY | `C1-bb_doc.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_edit.json` | MEASURED DIFFERENTLY | `C1-bb_edit.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_graph.json` | MEASURED DIFFERENTLY | `C1-bb_graph.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_health.json` | MEASURED DIFFERENTLY | `C1-bb_health.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_impact.json` | MEASURED DIFFERENTLY | `C1-bb_impact.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_index.json` | MEASURED DIFFERENTLY | `C1-bb_index.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_migrate.json` | MEASURED DIFFERENTLY | `C1-bb_migrate.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_patterns.json` | MEASURED DIFFERENTLY | `C1-bb_patterns.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_search.json` | MEASURED DIFFERENTLY | `C1-bb_search.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_security.json` | MEASURED DIFFERENTLY | `C1-bb_security.superseded-e7c9819f4.json` |
| `validation/m48/results/C1-bb_visualize.json` | MEASURED DIFFERENTLY | `C1-bb_visualize.superseded-e7c9819f4.json` |
| `validation/m48/results/C1.json` | MEASURED DIFFERENTLY | `C1.superseded-e7c9819f4.json` |
| `validation/m48/results/D1.json` | MEASURED DIFFERENTLY | `D1.superseded-e7c9819f4.json` |
| `validation/m48/results/L1-smoke-graph.json` | MEASURED DIFFERENTLY | `L1-smoke-graph.superseded-e7c9819f4.json` |
| `validation/m48/results/L1-smoke.json` | MEASURED DIFFERENTLY | `L1-smoke.superseded-e7c9819f4.json` |

## AND ONE OF THEM IS A REGRESSION REPORT, NOT A STAMP

`validation/m48/results/C1-bb_ask.json` has `failures: []` **on HEAD** and a NON-EMPTY failures array on main —
**main's run FAILED where this side passed.** *So the newer run is not automatically the better one.* **It is kept
because it is the newer MEASUREMENT, and the passing side is preserved beside it** — which is exactly why the rule
preserves rather than overwrites.

**AND THE SAME SHAPE APPEARS IN `validation/m25/results/G1.json` IN THE OTHER DIRECTION**: main reads `passed: 90,
failed: 1` where HEAD reads `passed: 88, failed: 3` — *so here the newer run found FEWER failures.* **Two files, two
directions, and neither side is uniformly better** — the measurement moved, and both numbers are real.

**AND 8 OF THE 39 DIFFER IN NOTHING BUT STAMPS** (`currentCommit`, `generatedAt`, `sealedAt`, `contentSha256`, `bbSeal`).
The comparison was mechanical: strip the volatile keys from both sides and compare. **Only the 8 that survive that strip
are called stamp-only** — the other 31 measured something different.
