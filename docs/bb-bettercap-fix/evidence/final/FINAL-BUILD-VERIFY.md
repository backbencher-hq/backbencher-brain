# Final-build verification (landed HEAD `4766f2f72`, clean worktree)

Build: clean worktree `.tools/wt-final3` at `main` HEAD `4766f2f72`; the verified build was copied
into the live checkout's `dist/` (the live CLI now serves this code; restart the MCP server to pick it
up).

| check | result |
|---|---|
| `npx tsc --noEmit` | **exit 0 — 0 errors repo-wide** (the external C# error is fixed) |
| `npm run build` | exit 0 |
| `npm run verify:dist` | exit 0 (156 JS chunks / 1069 references) |
| retrieval contract | **48/48** (engine-level R1 assertions included) |
| receiver evidence gate | **VERIFIED (11 checks)** — write-side receiver binding, read-side rejection of a simulated old-index misbinding, `test_impact` exclusion + declaration, stale-source control |
| m57 P0-2 | **GREEN 18/18** (receiver-type basis accepted as proven; P4 asserts the declared receiver binds as receiver-type, never as a package binding) |
| edit family / m71 / search-modes / m14 systems / m21 | all green (edit-batch E13 61/61, m71 23/23, search-modes S1 48/48, systems e2e pass, m21 R3 14/14) |
| m73 payload | 78/78 |
| m28 tool surfaces | 26/26 (2/2 mutants) |

| verify-analyze | PASS |
| docs truth | m31 PASS 71/71 |
| health honesty (R12-R14 durable last-run added) | PASS |
| embedding lifecycle | PASS |
| bettercap **full-specimen copy** reindex (harness `final-bettercap-reindex.sh`) | exit 0 — 1,972/1,973 files (1 declared >5 MB skip), **55,785 symbols / 111,786 relationships / 1,948 imports**, `derived: full`, 130.6 s; harness **12/12** |
| read-time symptom checks on the NEW full index | **38 pass / 0 fail / 2 deferred** (both `deferred` are the old-index-only arms, now covered by index-time checks) |
| full-index read E2E (final build) | `bb_doc Session` single subject (copies 5, declaration-kind); `bb_search` `<projectId>:<path>` + `absolutePath`; `test_mapping` 18 tested / 127 links / **0 unvalidated** (index-time binding resolves the 127 previously-unvalidated rows); `test_quality` aggregate 0.488095 |
| health on full index | 1,972 files / 55,785 symbols; freshness complete; `· last run: 23951 embedded`; derived status names the deliberate 1-file skip with `SKIPPED_FILES` remedy |

The two env-only gate needs are unchanged and documented: `docs/BB_TEST_*` tool-docs needs
`npm run docs:generate` once in a clean worktree, and the health/embedding gates need the
`.tools/triage-fix/embeddings-health` scratch parent to exist.
