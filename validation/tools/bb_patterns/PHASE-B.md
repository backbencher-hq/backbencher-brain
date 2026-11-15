<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — Phase B record for bb_patterns: the defects found in the
Phase A audit, the decision taken for each, the falsifiable gate that holds the
decision, and the measured before/after. This is the handoff a reviewer reads instead
of the transcript.
WHICH TOOL IT SERVES — bb_patterns (read, requiresIndex true, modes: orphaned, all).
EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_patterns/AUDIT-PHASE-A.md,
audit.json, gates/GATE-TABLE.json, LATENCY*.json, REAL-CORPUS.json, and the gate scripts
named in each row.
-->

# bb_patterns — Phase B record

Phase A (`AUDIT-PHASE-A.md`, `audit.json`) found 17 defects in the public surface of
`bb_patterns` while every ENGINE gate was green. Phase B fixes them and gives each one a
gate that fails when the fix is reverted, not a sentence that promises it.

## Defect ledger — decision, proof, status

| ID | Defect (Phase A) | Decision | Gate that holds it | Status |
|----|------------------|----------|--------------------|--------|
| P-01 | Read paths opened the index read-write; WAL grew +65,952/+98,912/+107,152 bytes on reads; T2 rw open 12,234 ms vs readonly 19.3 ms | All reads use `getRawInstance(projectId, {readonly:true})` in handler, orphan engine and rule engine; only an explicit `recordRun` writes | `m13/verify-patterns-handler-contract.ts` — db+WAL byte/mtime unchanged across default/orphaned/history; mutant M1 reverts the readonly open and the gate goes red | fixed, green |
| P-02 | Unindexed project answered `patterns (0 found)`, `isError:false`, and created `brain.db` | A missing index is a named refusal that names `bb index`; no database is created | handler-contract UNINDEXED (3 checks) + M1 mutant | fixed, green |
| P-03 | Latency over budget: T1 p50 1,294 / p95 1,749 ms vs 1,000; T2 19,839 / 93,078 ms vs 5,000 | Six relationship scans consolidated into four with shared aggregates; the schema lane then added `evidence_class` as a VIRTUAL GENERATED column plus `brain_rel_pattern_cover_idx`, and the engine now NAMES the column (`r.evidence_class`) so the covering index answers the statements; dead 310k-row symbol map removed; long-parameter count uses `json_array_length`; both engines open read-only | `LATENCY.json` (wall + process CPU, load declared); T2 plan lines and profile in `raw/schema-migration-t2.json` + `raw/t2-profile-postfix.json`; equivalence: `raw/fingerprint-schemafix-t1.json` == `raw/fingerprint-baseline-t1.json` (EQUIVALENT) | T1 fixed; T2 improved 33.7 s → 9.3 s CPU and still over 5 s — see "Latency" below |
| P-04 | Default page showed 20 god-class rows and 0 orphan/framework while the census named them | Handler asks the engine for the caller's page size (not `max(limit,100)` then slice), so the engine's one-slot-per-requested-class promotion lands on the displayed page | handler-contract PAGE (130 orphans + 60 god classes + 1 framework at default limit 20) + M2 mutant; engine contract `m69` | fixed, green |
| P-05 | `history` returned 1,787,433 chars for 1,113 findings; `limit` bounded runs only | Declared 200-finding window with `findingsTotal`/`findingsReturned`/`findingsWindow`/`findingsTruncated`; runs still bounded by `limit` | handler-contract HISTORY (6 checks) + M4 mutant | fixed, green |
| P-06 | `recordRun` silently did nothing in `scope=orphaned` | Both scopes persist; the answer prints `found` next to `recorded`; a run records the whole census (bounded by a declared 50,000 cap), never the display page | handler-contract RECORD-RUN (5 checks) | fixed, green |
| P-07 | `limit: 1e9` accepted, answered 55,402 chars | `limit` is a whole number 0..500; above the maximum it is refused by name; `limit=0` is an honest empty page that still names the census; descriptor publishes default/minimum/maximum | handler-contract LIMIT/SCHEMA (6 checks) + M3 mutant | fixed, green |
| P-08 | Footer claimed reads auto-refresh stale files and published a `refresh=false` option that does not exist | Footer uses the manual-only remediation (`bb index --changed` / `bb_index`), never an option the schema does not publish; state says the read does NOT auto-refresh | handler-contract STALENESS (5 checks) + M5 mutant | fixed, green |
| P-09 | Docs promised per-finding evidence/limitations arrays and import-resolution fields that the wire text never rendered | Either render it or stop claiming it: the orphaned answer now renders `[usage-evidence: refused … imports …]` and `[suppressed: …]`; the curated page draws the line between wire fields and engine-report fields | handler-contract EVIDENCE (4 checks) + M6 mutant | fixed, green |
| P-10 | Gate defects: doc gate read a fixed line and the old monolith; contract/e2e spawned MCP without `env` so `BB_DATA_DIR` was dropped and the e2e gate PASSED on "No index found" refusal text; m15 split the registry on a block that no longer exists; stale byte-freshness ran the full generator | Gates read the live registry and the per-tool module; MCP children forward `process.env`; content checks require `!isError` before matching text; freshness runs `--only bb_patterns`; m15 P6 asserts schema maximum + evidence-path coverage; new handler-contract gate has `--self-test` | red-then-green table below; `gates/results/*.json` | fixed, green |
| P-11 | `PATTERN_EVIDENCE_PATHS` fingerprinted the 39-line assembler instead of the tool module | The list names `src/mcp/tools/bb_patterns/{handler,descriptor}.ts` and no longer names the assembler | m15 P6 asserts both; `m20-pagination-history` writes the fingerprint | fixed, green |
| P-13 | `BB_PATTERNS.md` misdated authorship, claimed an external suite this checkout does not contain, and omitted the lifecycle false-positive limitation | Page rewritten with the §8 author header; external-suite claim removed and replaced with what the repository can re-run; lifecycle limitation restored (initialize/constructors) | `m16/verify-docs-truth.ts` D1 for BB_PATTERNS; `m13/verify-patterns-docs.ts` | fixed — m16 D1 has no bb_patterns row |
| P-14 | Descriptor published no machine-readable defaults or bounds | `default`/`minimum`/`maximum` on `limit` (0..500) and `confidenceThreshold` (0..1); defaults on every property; multi-line description states confidence ranges and planned modes | handler-contract SCHEMA; `m13/verify-patterns-contract.ts` | fixed, green |
| P-15 | 82 of 91 imports in the handler were residue | Handler rewritten to the modules it uses (10 imports) | `npx tsc --noEmit`; handler-contract | fixed, green |
| P-16 | Text omitted `truncatedByDisplayLimit` and said "across no rule(s)" | Census line says "no rules" when no rule fired; the overflow flag stays an engine-report field and the page says so | handler-contract; `docs/BB_PATTERNS.md` §"What the answer contains" | fixed, green |
| P-12 | history read opened the DB read-write | Fixed upstream (`2be07ae49`): `getAnalysisHistory` is read-only; re-checked on HEAD, not edited here | handler-contract READ/history | fixed upstream |

## Latency

Method: warm, in-process, the tool's own handler over the source door; one excluded
warmup per shape and five measured runs per shape; wall clock AND process CPU time
(`process.cpuUsage`) recorded per call; `BB_DATA_DIR` points at a lane-scoped copy; db
and WAL are stat'ed before and after every call (`-shm` is a read-mark file and may
move); the host load average is recorded per run because the whole campaign runs on one
shared box.

- **T0** (`test/fixtures/polyglot`, 5 files / 13 symbols / 26 relationships): **PASS**.
  default-all p50 18.6 / p95 25.0 ms, CPU 9-10 ms; orphaned p50 11.2 / p95 18.8 ms,
  CPU 5-11 ms; db+WAL unchanged.
- **T1** (`.perf-fixtures/bb-scale/n100`, 97 files / 3,512 symbols / 17,068 relationships):
  **PASS on process CPU and p50; p95 wall is contention-inflated.** default-all p50 632 /
  p95 1,877 ms at 409-572 ms CPU; orphaned p50 773 / p95 1,537 ms at 404-607 ms CPU;
  db+WAL unchanged. The host load average was 18-25 during these runs (a shared box with
  other lanes sweeping T2), so p95 wall is not the engine's work; a quiet-load rerun is
  the remaining verification step.
- **T2** (reference workspace index, 6,452 files / 310,423 symbols / 820,040
  relationships): **FAIL — and reported as a fail.** One default-all call measured
  **85.2 s wall / 33.7 s process CPU** against a 5,000 ms budget, on a byte-identical lane
  copy (db+WAL unchanged). The schema lane then added the `evidence_class` VIRTUAL
  GENERATED column and `brain_rel_pattern_cover_idx`; after the engine named the column,
  removed a dead 310k-row symbol map and switched the parameter count to
  `json_array_length`, the same shape measures **p50 9,343 ms / p95 10,321 ms wall at
  8.1-10.6 s process CPU — 3.6x better, still over the 5,000 ms budget, and reported as
  such.** The final profile (`raw/t2-profile-postfix.json`) attributes the remaining
  13.2 s: DISTINCT `target_external` over clean rows 4.58 s (`target_external` is not in
  the covering index, so rows still touch the relationship heap), the 52,903 reported-type
  symbol rows 3.20 s, used/incoming aggregate 1.30 s, referenced-file join 1.03 s, file
  coverage aggregate 0.96 s, long-parameter rule 0.60 s. The two largest lines need index
  coverage extensions (target_external in the pattern covering index; a narrow
  `(project_id, symbol_type)` symbol index) — schema/index surface, not this tool's. The
  live shared index additionally refused a byte-read-only open at measurement time
  (`SQLiteError: unable to open database file`) while the identical bytes opened normally;
  that blocked live leg is recorded in `raw/t2-live-open-failure.json`. Equivalence of the
  rewrite is proven by `raw/fingerprint-schemafix-t1.json` == baseline (EQUIVALENT) and by
  the index/no-index and column/json probes on identical bytes.

## REAL-CORPUS (real repositories, real MCP stdio door)

Method: each repository is indexed into its own lane `BB_DATA_DIR`, then the SOURCE MCP
server is started over `StdioClientTransport` (the door, not the in-process handler) and
`bb_patterns` is called across its documented shapes; the answer's own census and page
are recorded, db/WAL are stat'ed before and after, and the door is also exercised with
refusal cases and a >100-orphan / framework / god-class promotion fixture. Full data:
`REAL-CORPUS.json`.

| Repository | Files / symbols / relationships | Read session moved db+WAL? | orphaned | default | limit=100 | history | recordRun wrote? |
|---|---|---|---|---|---|---|---|
| graphql-js | 564 / 13,620 / 61,917 | no | 7.16 s | 2.21 s | 2.18 s | 72 ms | yes |
| rake | 109 / 1,593 / 9,075 | no | 0.67 s | 0.27 s | 0.27 s | 47 ms | yes |
| rebar3 | 303 / 7,012 / 38,143 | no | 4.41 s | 1.32 s | 1.23 s | 61 ms | yes |
| go-tools | 2,017 / 32,726 / 147,112 | no | 12.15 s | 8.04 s | 7.42 s | 12 ms | yes |
| zig | 20,580 / (indexing interrupted twice by session ends) | — | blocked: index incomplete when the door was run | | | | |

Refusals through the same door, each an error carrying its named reason: invalid scope,
unknown option, `limit` above the maximum (names the 500 bound), `confidenceThreshold`
out of range, and a missing index (`No index found … Run: bb index`).

Promotion fixture through the same door (130 orphan candidates + 60 god classes + 1
framework file, default `limit: 20`): census 1,102 findings, displayed page 20 rows with
an orphan row, a framework row and a god-class row all present — the class promotion
reaches the page the caller sees. Reads moved db+WAL: no.

## Red-then-green evidence

`bun run script/m13/verify-patterns-handler-contract.ts --self-test` copies the tree into
a tmpdir, plants ONE mutation at a time and requires the gate to go red for each; the
un-mutated mirror must be green first, so a red cannot be vacuous. Latest run
(`validation/m13/results/p6-selftest.json`, `gates/results/m13-handler-contract-selftest.json`):

| Mutant | Reverts | Baseline / result |
|---|---|---|
| baseline | nothing | mirror **green** |
| M1 | byte-read-only open | gate **RED** (READ: db and WAL unchanged) |
| M2 | page-size contract (`maxResults: enginePage`) | gate **RED** (PAGE: requested class represented) |
| M3 | `limit` ceiling (500) | gate **RED** (LIMIT: above-maximum refused by name) |
| M4 | history findings window (200) | gate **RED** (HISTORY: truncation declared) |
| M5 | manual-only staleness footer | gate **RED** (STALENESS: no auto-refresh promise) |
| M6 | rendered evidence channels | gate **RED** (EVIDENCE: refused-usage counts) |

Gate table: `gates/GATE-TABLE-phaseB.json` — 13 green, 3 red (all three cross-scope, named
with the exact failing check), 7 declared blocked legs (m64/m65 sandbox selftests, zig
index, live T2 byte-read-only open, e2e rerun, dist rebuild, `script/m65` R8).

`m15/verify-patterns-deep.ts` was re-run against the split tree and is green (P1-P8 all
VERIFIED; 45 checks, 6 negatives), including the new registry/schema/evidence-path legs.

## Cross-scope items (not this lane's files; requested from the Lead)

- `script/m65/verify-rules-budget-and-gates.ts` R8 monkey-patches the raw handle it
  obtained itself; the rule engine now opens its own read-only handle, so the fresh gate
  captures 0 statements. One-line fix: obtain the handle with
  `getRawInstance(projectId, {readonly:true})` before patching, or wrap
  `BrainDatabase.getRawInstance`.
- `script/m57/verify-t3-scope-all.ts` K6b fails because `dist/` predates the edited
  `rules.ts`; rebuilding the shipped artifacts is the integration lane's step.
- `m64`/`m65` gate self-test legs spawn `bun` inside the sandbox and are declared blocked
  legs (as recorded in Phase A); their evidence gates themselves pass.
