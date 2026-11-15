# `bb_security` Phase B — defect → fix → proof

The Phase A audit (`AUDIT-PHASE-A.md`) is the starting contract: a read declared
`mutability: read` that wrote to the index it read, a CLI door that answered a
clean report for code it had never scanned, a history writer that silently
dropped one of two findings at the same sink, a false staleness claim in the
generated page, and seven of its own verifiers red. This phase closed them and
made each claim falsifiable.

Committed in three checkpoints (see `git log --oneline` for the tool):

```
44dad52b9  src + docs: read-only reads, declared bounds, state-aware history identity
4b648f6e1  gates: evidence-based anchors, scoped generator legs, truthful invariants, mutant targets
e97fe9457  gates follow-up: the m15 pair carries its own isolated data dir
a8a61fef6  engine + gate: keyed endpoint resolution (T2 default-scan budget)
(this commit)  evidence: gate outputs, planted mutants, read-path, latency, corpus, T2 budget
```

## 1 · What was wrong, what changed, and the check that now fails if it returns

| # | Defect (Phase A) | Change | Proof |
|---|---|---|---|
| C1 | `mutability: read` but every call opened the index read-write and ran open-path migrations; controlled read-write open committed a transaction (`schema_version` 157→161) | handler and engine open with `{ readonly: true }`; an unindexed project is refused by preflight before any scan | `audit/readpath.json` A/A2/C: `brain.db` + `-wal` byte-identical; `audit/write-attribution.json`: header `changeCounter`/`schemaVersion` unchanged, no changed pages; mutant `handler-read-not-readonly` turns `m13/verify-security-contract` RED |
| C2 | CLI/library doors created an empty index for an unindexed project and printed a clean zero | the read-only preflight refuses at **every** door and creates nothing; the shared CLI gate added by the Lead covers the CLI path | `audit/readpath.json` D: MCP `No index found`, CLI `exit 1` + same message, library `isError` — all with `createdFiles: []`; handler gate `library-door` legs |
| C3 | History fingerprint collided: a confirmed and a mitigated flow at one sink shared one identity, so `completeAnalysisRun` dropped the second while the response counted both | recorded identity includes the flow state: `taint:<type>:<sinkType>:<state>:<file>:<line>` | `m20/verify-security-history` asserts two persisted findings at one sink with distinct ids; mutant `history-fingerprint-drops-state` turns it RED |
| C4 | A history page rendered the whole persisted set: 600 findings → 590,549-byte response; `limit` did not bound findings at all | findings page capped at 200 with `findingsTotal`/`findingsShown`/`findingsTruncated` + `census` object | `m13/verify-security-handler` bounds section (510 persisted → 200 shown, 310 truncated); mutant `history-page-cap-removed` turns it RED |
| C5 | The explicit `CAPPED at …` sentence existed only on the recordRun branch; the ordinary read showed just “(N beyond the cap)” | both branches emit the sentence, and it is asserted on the live read | handler gate: `[scan: 510 … (10 beyond the cap)] — CAPPED at 500; 510 finding(s) exist and 10 were not examined`; mutant `live-cap-note-dropped` turns it RED |
| C6 | The generated page claimed “reads auto-refresh stale files… `refresh=false`” for a tool with no refresh option | handler emits the manual repair footer only when something is stale; the page now says so (generator branch `83054f66a`), silence when fresh | page description/staleness assertions in `m13/verify-security-docs`; the page is a fresh `--only bb_security` render |
| C7 | `limit` was accepted without `history` and silently ignored | refused by name: `limit only applies to the history page` | `m13/verify-security-adversarial` CLI legs and the handler's own refusal |
| C8 | `history: true` + `recordRun: true` were accepted together, returning one shape and ignoring the other request | refused: they are different answers | handler preflight + curation/descriptor text state the refusal |
| H | Docs claimed “All five verifiers” (13 exist), “history never contains severity=unknown” (not enforced), an unqualified sealed-write claim (m13/m17 harnesses write unsealed), and milestone/process narrative | reference page rewritten to what the code does, including the token-matcher false-positive class measured on real C/Ruby corpora, the `unknown` grade for ungradeable resolved flows, and the type-vs-state distinction; §9 narrative removed from owned files | `docs/BB_SECURITY.md`; `m13/verify-security-docs`; m17's invariant now measures the truthful contract (state, not the type string) |
| T2 | Default live scan measured **5,515 / 5,546 ms p95** by the release battery, over the 5,000 ms T2 budget (the lane's earlier 945 ms figure came from an index state that no longer existed and did not cover the default shape on the reference index) | endpoint resolution matches the `brain_symbol` PRIMARY KEY and enforces project scope on the returned row instead of filtering `project_id` inside the indexed predicate | `audit/t2-default-budget.json` (before/after, both runtimes, planner plans), `runlogs2/t2-resolve-plan.log`, engine gate assertion + mutant `engine-resolve-project-filter` RED→GREEN; per-corpus counts identical (semantics unchanged) |
| G | Seven red verifiers: stale `tool-handlers.ts`/`tool-registry.ts` anchors, `docLines[2]` after the author header, Bun-only `import.meta.dir`, full-generator legs in a split tree, MCP child env not forwarded, a docs gate that validated its own not-yet-written record (`sec4`), a baseline auto-pass `h.nk(..., true)` in the precision gate | anchors read the per-tool modules and the live descriptor object; root derived from `fileURLToPath`; generator legs scoped `--only bb_security`; MCP child inherits `BB_DATA_DIR`; the docs gate validates sec1–sec3 and only *presence* of its own record; the precision auto-pass is a real predicate | `gates/EXITS.tsv` (below) |

Cross-scope causes that this lane reported and the Lead fixed in `93bb7f826`:
the per-open annotation-trigger churn in `schema-ddl.ts` (one of the C1 writers)
and the CLI door's unindexed-index creation. Both are verified behaviorally here
rather than assumed: the read-write-open control in `write-attribution.json` no
longer commits a write, and the CLI refuses an unindexed project.

## 2 · Gate table (this tree, `gates/EXITS.tsv`)

Every gate below was RED on the Phase A tree except the marked `was green`.
The suite is self-contained: a gate that needs an index falls back to
`validation/tools/bb_security/bbdata` when `BB_DATA_DIR` is unset (the Phase A
sweep was 13/13 red with `EROFS … mkdir $HOME/.bb`). Only the two m17 verifiers
still depend on the caller-supplied `BB_DATA_DIR`; they run with it in
`gates/run-all.sh`, and their compiled-door legs additionally need a current
`dist/` (integration builds it).

| Gate | Phase A | Phase B | Notes |
|---|---|---|---|
| `script/m13/verify-security-contract.ts` | 1 | **0** | one executable mode, planned modes honest, read-only opens asserted as source facts, page byte-fresh |
| `script/m13/verify-security-handler.ts` | 1 | **0** | adapter shape, history page cap, CAPPED on the live read, read-path byte-identity (findings **and** history), library-door refusal |
| `script/m13/verify-security-adversarial.ts` | 1 | **0** | SQLi/CMDi/XSS positives, clean negative, parameterized blind spot documented, mitigated boundary, CLI false-clean guard, MCP stdio door, sampled corpora |
| `script/m13/verify-security-docs.ts` | 1 | **0** | docs accuracy against the live descriptor, evidence validity, release-gate tamper proof |
| `script/m15/verify-security-regressions.ts` | 0 | **0** | kept green; comment contract cleaned, self-contained data dir |
| `script/m15/verify-security-precision.ts` | 0 | **0** | `h.nk(..., true)` auto-pass replaced by a real fixture predicate (the audit now scans it) |
| `script/m15/verify-security-deep.ts` | 1 | **0** | X6 reads the live registry descriptor + per-tool handler; no assembler text anchors |
| `script/verify-security.ts` | 0 | **0** | engine end-to-end (kept) |
| `script/m20/verify-security-flow-boundary.ts` | 0 | **0** | endpoint resolution outranks the mitigation flag (kept) |
| `script/m20/verify-security-adversarial.ts` | 0 | **0** | policy matrix, auto-pass audit over the in-scope suite, sealed evidence |
| `script/m20/verify-security-history.ts` | 0 | **0** | state-aware identity, evidence/confidence persisted, repeat-run parity, CLI parity over the **source** door |
| `script/m17/verify-sec-corpus.ts` | 1 | **0** | invariant corrected: observations (state) never persist; a resolved flow with ungradeable stored severity keeps the documented `unknown` grade |
| `script/m17/verify-sec-history.ts` | 1 | **0** | same correction through the shared history gate |

## 3 · Falsifiability: planted mutants (`audit/mutants.json`)

Each row plants one mutation in the code that owns the claim, runs the gate,
restores the file, verifies the restore by SHA-256, and runs the gate again.

| Mutant | Gate | RED | GREEN |
|---|---|---|---|
| `handler-read-not-readonly` | `m13/verify-security-contract` | 1 | 0 |
| `engine-read-not-readonly` | `m13/verify-security-contract` | 1 | 0 |
| `live-cap-note-dropped` | `m13/verify-security-handler` | 1 | 0 |
| `history-page-cap-removed` | `m13/verify-security-handler` | 1 | 0 |
| `library-door-creates-index` | `m13/verify-security-handler` | 1 | 0 |
| `history-fingerprint-drops-state` | `m20/verify-security-history` | 1 | 0 |
| `descriptor-advertises-planned-mode` | `m13/verify-security-contract` | 1 | 0 |
| `docs-description-drift` | `m13/verify-security-docs` | 1 | 0 |
| `engine-resolve-project-filter` | `script/verify-security.ts` | 1 | 0 |

9/9 RED→GREEN, 9/9 files restored to their original hash.

## 4 · Read path (`audit/readpath.json`, `audit/write-attribution.json`)

Post-fix, on an isolated fixture index and on the live 3.64 GB index, through the
real MCP stdio door:

| Observation | `brain.db` + `-wal` | `-shm` | Verdict |
|---|---|---|---|
| A findings read (MCP) | byte-identical | touched | no data write |
| A2 history read (MCP) | byte-identical | touched | no data write |
| B read-only control | byte-identical | touched | control |
| C T2 live index (MCP) | byte-identical | touched | no data write |
| E `recordRun` (MCP) | WAL grows | touched | **declared write** |

`-shm` is shared-memory bookkeeping; every connection open (read-only included)
may touch it. The SQLite header diff in `write-attribution.json` is the stronger
check: no `changeCounter` bump, no `schemaVersion` bump, no changed pages for
M/M2. The read-write-open control `W` no longer commits a write either, which is
the behavioural confirmation that the open-path writer the Lead fixed is gone;
the read-only open stays in the code as the guard for older indexes and for
databases other processes are writing.

## 5 · Latency (`LATENCY.json` from `audit/latency-A.json`)

Warm handler repeats and fresh-session MCP round trips; budgets are the
descriptor's declared T0/T1/T2 p95 budgets and the 30 s client timeout.

| Tier | in-process p50 / p95 | budget | MCP door p50 / p95 |
|---|---|---|---|
| T0 (5 files/13 symbols/0 flows) | 2 / 2 ms | 250 ms | 4,725 / 5,090 ms |
| T1 (100 files series, synthetic) | 26 / 56 ms | 1,000 ms | 5,999 / 6,062 ms |
| T2 (310,423 symbols, 820,040 relationships, 14,701 flow rows) | 508 / 562 ms | 5,000 ms | 2,730 / 2,770 ms |

The door numbers include source-process startup; Phase A measured the same door
at p95 14,948 / 9,383 / 27,759 ms. Both are inside the 30 s client timeout.

## 5b · T2 budget re-open (release battery) and its fix

The release battery measured the **default live scan** (`bb_security {}`, all
indexed flows) on the shared 3.6 GB reference index at **p50 5,515 / p95
5,546 ms**, over the 5,000 ms budget. This lane's earlier in-process T2 figure
(945 / 1,076 ms) was taken on an index state that no longer existed and did not
cover the default shape on the reference index — the battery, not the lane's own
table, was right.

**Root cause (query plan, not row count).** Endpoint resolution filtered
`project_id` inside the indexed predicate:
`WHERE s.project_id = ? AND s.id IN (...)`. On the reference index the planner
chooses `brain_symbol_type_cover_idx (project_id=?)` — a covering index over the
whole project — so every 500-id chunk scanned all 310,423 symbols. Measured on
the live index (`audit/t2-default-budget.json`, planner shape in
`runlogs2/t2-resolve-plan.log`):

| Shape | Plan | 200-id chunk (p50) |
|---|---|---|
| `WHERE s.project_id = ? AND s.id IN (...)` | `SEARCH s USING INDEX brain_symbol_type_cover_idx (project_id=?)` | **306 ms** |
| `WHERE s.id IN (...)` (primary key) | `SEARCH s USING sqlite_autoindex_brain_symbol_1 (id=?)` | **1.31 ms** |

A default scan needs 18 such chunks, which is the ~5.6 s the battery measured.

**Fix.** Resolution now matches the PRIMARY KEY and carries `project_id` as a
selected column, with project scope enforced on the returned row in JS — same
guard, 200× cheaper chunk. No budget was raised and no new cap was introduced:
the answer still declares the 500-result scan cap and the same `CAPPED` sentence
(`14,701 flows → 10,256 findings (9,756 beyond the cap)`).

**Semantics invariant.** The fix changes the plan, not the classification: all
five real corpora keep identical deduplicated/resolved/observation counts, and
the state census is unchanged (confirmed 5,362 / source_only 5,912 / unresolved
3,427; `runlogs2/t2-profile.log`).

**Re-measured with the release protocol** (in-process handler, project 1d3d57,
one warm-up + 3 measured runs, `BB_DATA_DIR=.bb-data`, `BB_NO_AUTO_REFRESH=1`,
`bb_security {}`):

| Measurement | p50 | p95 | Budget |
|---|---|---|---|
| Before (release battery) | 5,515 ms | 5,546 ms | 5,000 ms — OVER |
| After, release protocol (runs 560/501/648; harness-style drop-first 574/648) | 560 ms | 648 ms | PASS |
| After, 8 runs node v22.22.1 | 475 ms | 504 ms | PASS |
| After, 8 runs bun 1.3.14 / node 24 | 297 ms | 331 ms | PASS |

`brain.db` is byte-identical before/after each of those runs. The MCP door p95
fell from 5,630 to 2,770 ms as a side effect (the scan is no longer the floor).
The engine gate now asserts the keyed resolution shape and the mutant
`engine-resolve-project-filter` turns it RED; the read path stays byte-read-only
(`audit/readpath.json` A/A2/C unchanged, unindexed refusal unchanged).

## 6 · Real corpus (`REAL-CORPUS.json`, post-fix, real MCP stdio door)

| Corpus | Language | files | symbols | relationships | flow rows | dedup findings | resolved | observations | door |
|---|---|---|---|---|---|---|---|---|---|
| graphql-js | TypeScript | 375 | 8,057 | 42,667 | 435 | 434 | 144 | 290 | 4.4 s |
| rake (`lib`) | Ruby | 44 | 497 | 2,033 | 52 | 44 | 20 | 24 | 4.3 s |
| rebar3 | Erlang | 203 | 4,832 | 28,373 | 191 | 187 | 25 | 162 | 3.5 s |
| ansible | Python | 777 | 26,681 | 97,335 | 1,561 | 1,258 | 405 | 95 | 4.8 s |
| sqlite | C | 79 | 5,169 | 36,226 | 290 | 273 | 31 | 242 | 4.3 s |

Adversarial cases, all passing: clean code → zero findings **and** zero
observations; a parameterized SQL sink reported as a critical finding with the
documented limitation (the analyzer cannot tell it from a concatenated one — the
tool must not be the layer that hides it); a concatenated SQLi confirmed; a
partial flow with the mitigation flag stays an observation; an unindexed project
refused; a touched finding file marked `[stale]` with the manual repair footer.

## 7 · Open / cross-scope

- **The two m17 verifiers depend on `dist/`.** Their compiled-door legs report on
  the last build, so they are green only when the integration build is current;
  their content assertions were corrected in this phase and both are green with
  the build produced for this tree.
- **m48 corpus/param gates** (`script/m48/verify-c1-corpus.ts`,
  `script/m48/verify-p4-param-matrix.ts`) remain out of this lane's write scope;
  their coverage overlaps the real-corpus and adversarial evidence here.
- **`fromExisting`/`options` forwarding** was fixed inside the adapter; callers
  of `analyzeSecurityAcrossLanguages` are the handler and the shared history
  gate, both exercised here.
- No LSP twin exists for `bb_security` (charter table `—`), so there is no twin
  parity leg to run.

## 8 · Artifacts

`REPORT.json` (state + closed/open register + evidence index), `AUDIT-PHASE-A.md`,
this file, `REAL-CORPUS.json`, `LATENCY.json`, `gates/` (EXITS + every stdout),
`audit/` (mutants, readpath, write-attribution, latency samples, T2 default-scan
budget + planner evidence, Phase A probes), `runlogs2/` (T2 fix measurements and
the post-fix verification run),
`work/` (probe scripts), `README.md` (how to reproduce).
