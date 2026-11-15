# bb_visualize — final gate table

<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — command → exit → summary for every gate that covers
`bb_visualize`, with the runtime that was used. Before/after evidence lives in
logs/; the raw failed battery under logs/GATE_TABLE-final-BREAK-ATTEMPT.txt was
taken while the SHARED tree was mid-edit by another writer (src/brain/schema-ddl.ts
did not parse; src/brain/database.ts referenced a missing function), so those exit
codes describe the checkout, not this tool.
EDIT TOGETHER WHEN A GATE OR ITS RUNTIME CHANGES — run-gates.sh, logs/, AUDIT.md §4.
-->

| Gate | Command | Runtime | Exit | Result | Evidence (before → after) |
|---|---|---|---|---|---|
| V1 contract | `script/m13/verify-visualize-contract.ts` | bun | 0 | VERIFIED 15/15, 4 negatives | crash (node) / 12/15 (bun) → `logs/script_m13_verify-visualize-contract_ts.fixed.log` |
| V2 fidelity | `script/m13/verify-visualize-fidelity.ts` | bun | 0 | VERIFIED 24/24 | `logs/final-v2.log`, `results/door.json` |
| V3 e2e-corpus | `script/m13/verify-visualize-e2e-corpus.ts` | bun | 0 | VERIFIED 21/21 | 20/21 known-gap → `logs/v3.fixed2.log` |
| V4 docs | `script/m13/verify-visualize-docs.ts` | bun | 0 | VERIFIED 25/25 | 20/25 known-gap → `logs/v4.fixed3.log` |
| V5 options | `script/m13/verify-visualize-options.ts` | bun | 0 | VERIFIED 114/114, 28 negatives | 109/114 → `logs/script_m13_verify-visualize-options_ts.fixed.log` |
| V6 target-literals | `script/m13/verify-visualize-target-literals.ts` | bun | 0 | VERIFIED | `logs/script_m13_verify-visualize-target-literals_ts.log` |
| V7 views | `script/m13/verify-visualize-views.ts` | bun | 0 | VERIFIED | `logs/script_m13_verify-visualize-views_ts.log` |
| V8 owner-fold | `script/m13/verify-visualize-owner-fold.ts` | bun | 0 | VERIFIED | `logs/script_m13_verify-visualize-owner-fold_ts.bun.log` |
| V9 honesty | `script/m13/verify-visualize-honesty.ts` | bun | 0 | VERIFIED | `logs/script_m13_verify-visualize-honesty_ts.bun.log` |
| V10 browser | `script/m13/verify-visualize-browser.ts` | node+tsx | 0 | VERIFIED 27/27 (real chromium) | `logs/script_m13_verify-visualize-browser_ts.log` |
| m15 deep | `script/m15/verify-visualize-migrate-deep.ts` | bun | 0 | V1–V4, M1–M4 all VERIFIED | FATAL split-drift → `logs/m15.fixed2.log` |
| verify-visualize-migrate | `script/verify-visualize-migrate.ts` | bun + node+tsx | 0 | PASS | `logs/final-migrate.log`, `logs/final-migrate-npx.log` |
| m26 webview-core (twin) | `script/m26/verify-webview-core.ts` | bun | 0 | VERIFIED 23/23, 6/6 mutants | `logs/final-m26-core.log` |
| m26 graph-transport (twin) | `script/m26/verify-graph-transport.ts` | bun | 0 | VERIFIED | `logs/final-m26-transport.log` |
| m26 graph-docs (twin) | `script/m26/verify-graph-docs.ts` | bun | 0 | VERIFIED 34/34, 3/3 mutants | `logs/final-m26-docs2.log` |
| m26 hub-group-order (twin) | `script/m26/verify-hub-group-order.ts` | bun | 0 | PASS | `logs/final-m26-order.log` |
| regex policy | `script/tools/verify-regex-policy.ts` | node+tsx | 0 | PASS — 0 new, 12 baseline rows paid | `logs/final-regex.log` |
| tool docs (this tool) | `script/verify-tool-docs.ts --only bb_visualize` | node+tsx | 0 | PASS (1 artifact byte-fresh) | `logs/final-docs.log` |
| planted mutants | `validation/tools/bb_visualize/mutants.ts` | node+tsx | 0 | VERIFIED 5/5 red→green, 5/5 restored identical | `results/mutants.json` |
| real MCP door probe | `validation/tools/bb_visualize/probe.ts` | node+tsx | 0 | VERIFIED 127/127, 27 negatives, dbUnchanged=true | `results/door.json` |
| read path | `validation/tools/bb_visualize/read-path.ts` | node+tsx | 0 | byte-read-only across every layer | `results/read-path.json` |
| latency | `validation/tools/bb_visualize/latency.ts t0\|t1\|t2` | node+tsx | 0 | VERIFIED (all tiers inside budget, cold call 723 ms) | `LATENCY.json` |
| real corpus | `validation/tools/bb_visualize/real-corpus.ts index && … door` | node+tsx | 0 | VERIFIED 9/9 checks (5 real repos) | `REAL-CORPUS.json` |
| compiled dist door | `validation/tools/bb_visualize/compiled-door.ts` | node+tsx | 0 | VERIFIED 7/7, dbUnchanged=true | `results/compiled-door.json` |
| tsc --noEmit | `npx tsc --noEmit` | node | 0 | clean (final battery, recovered tree) | `logs/final-tsc.log` |
| m48 P4 matrix | `script/m48/verify-p4-param-matrix.ts` | bun | 1 | BLOCKED — Lead-owned matrix stale (bb_search rows); my 31 rows need `verifiedBy: "C1-bb_visualize.json"` | `logs/script_m48_verify-p4-param-matrix_ts.log` |
