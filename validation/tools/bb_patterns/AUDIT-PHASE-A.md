<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — Phase A audit of the bb_patterns public MCP tool: state, defect
register by severity, gate table (command → exit code), latency by tier, docs truth,
regex/process-attribution inventory, blocked legs, and the Phase B plan.
WHO IT IS FOR — the Lead reviewing and approving Phase B for this tool.
EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_patterns/audit.json (machine copy),
LATENCY.json, gates/GATE-TABLE.json, and the Phase B fixes it authorises.
-->

# bb_patterns — Phase A audit

- Repository: `/home/ishaq2321/mcp/backbencher-brain` (shared checkout, other lanes writing concurrently)
- Tool: `bb_patterns` (read; requiresIndex true; modes `orphaned`, `all`; planned `quality`, `architecture`)
- Engine: `src/intelligence/patterns/orphans.ts` (1,045 lines), `rules.ts` (280), `evidence.ts` (44); aggregator `PatternBrainTools.detectPatterns` in `src/ast/tools.ts` (not owned)
- Phase A start commit: `8c1cd5a81`; gate run commit: `6cecd6e`; report commit: `f1141f46`
- No `src/` or `docs/` change was made in Phase A. Evidence lives under `validation/tools/bb_patterns/`.
- Every claim below cites a file that a recorded command produced; raw logs are in `gates/logs/` and `raw/`.

## 1 · Verdict

Phase A is **complete**. The engine's semantic decisions are extensively and genuinely gated
(the evidence-quality gate, the confidence formulas, the census/page split, the rule budgets and
the requested-class promotion all have gates that pass and can go red — m64 P2 under node verifies
8/8 mutants caught, m65 P2 8/8). The tool surface has **5 high, 8 medium and 4 low defects**, all
observable. Four legs are blocked for reasons outside this task's scope (one upstream indexer
defect, two bun-incompatible selftests, the compiled-dist rebuild). Nothing reported below is a
style opinion; each row names the observation that produced it.

What is genuinely correct today (checked, not assumed):

- `scope` enum is refused for `quality`/`ALL`/garbage with a named error through the real MCP
  stdio door (`raw/mcp-door.json`).
- Unknown options, wrong types, negative/fractional `limit`, and `confidenceThreshold` outside
  0..1 are all refused with named, teaching errors at the MCP boundary (5 refusal cases captured).
- `confidenceThreshold` really does gate every class (framework included, at 0.6), and the orphan
  default is 0 for the evidence-derived scale — the 0.6-default whole-rule loss is fixed.
- Census vs page is honest: a 1,113-finding fixture prints `patterns (1113 found)` and
  `showing 20 — raise limit`; `limit=0` shows none while still naming the 1,113 census.
- `recordRun` in the default `all` scope persists the full census, and the answer says
  `(1113 found, 1113 recorded)`; the recorded run completes and history reads it back.
- The orphan engine's own tuning claims held on the audit fixtures (evidence arrays,
  suppression accounting, refused-evidence counters, import resolution; m13 orphans 22/22,
  m13 rules 29/29, m57 3/T3, m20 P1/P3, m64 P1, m65 P1, m69 P1 all exit 0).

## 2 · Defect register (severity · id · one line · evidence)

Full machine register with locations and fix plans: `audit.json` → `defects`.

### High

**P-01 · Every read path opens the index READ-WRITE and writes it.**
`handler.ts:71`, `orphans.ts:255`, `rules.ts:54` call `BrainDatabase.getRawInstance(projectId)`
with no readonly option. Measured (`raw/read-path-writes.json`): `scope=orphaned` created a
65,952-byte WAL, `scope=all` 98,912 bytes, `history` 107,152 bytes; the fixture db grew
643,072 → 704,512 bytes across the reads. On the T2 copy (`raw/t2-open-cost.json`) the default
read-write open took **12,234 ms** against **19.3 ms** for a byte-read-only open, moved the WAL
494,432 → 527,392 bytes, and reported `indexWriteFromReadWriteOpen: true`. This violates the
Lead ruling "read paths do not write the index" and is 12.2 s of the T2 latency defect.

**P-02 · An unindexed project answers a clean zero (library/CLI door) and creates a database.**
`raw/unindexed-read.json`: against a directory the indexer never ran over, the source handler
returned `isError:false` — `patterns (0 found): none [scan: 0 finding(s) …]` — and created
`brain.db` (4,096 bytes). The MCP stdio door refuses the same project (`No index found … Run:
bb index`, isError true) because the server gate runs first; the CLI `cmdTool`
(`src/cli/index.ts:971`, not owned) and library callers have no gate. The engine's own comment
names this class: "A crash and a clean result are indistinguishable if the corpus is not asserted
real first."

**P-03 · Default latency exceeds budget on T1 and T2; a cold T2 scan is 133 s.**
`LATENCY.json`: T2 `default-all` p50 **19,839 ms** / p95 **93,078 ms** (budget 5,000 ms p95; one
93 s outlier under load, recorded not removed) and `scope=orphaned` p50 20,424 ms; T1 `default-all`
p50 **1,294 ms** / p95 1,749 ms (budget 1,000 ms); T0 passes comfortably (p50 69.6 ms / p95
112.8 ms). A cold engine pass on T2 measured `detectOrphans` **133,520 ms** and `detectIndexRules`
1,978 ms (`raw/t2-calls.jsonl`); the handler then took 26,430 ms warm-in-process on the same
population. Host load average 21–28 on 8 cores during the sweep (declared; p50 cited). 4× the
budget and within an outlier of the 30 s MCP client timeout.

**P-04 · The handler's displayed page violates the requested-class representation contract.**
`raw/behavior.json`: with 130 orphan candidates, 60 god classes and one framework row, the
documented default `{}` returned **20 god-class rows, zero orphan rows, zero framework rows**,
while its own census line printed `orphaned_function=855 orphaned_file=135 framework-detected=1`.
The engine's page at `maxResults=100` did contain 38 orphan rows and the framework row; the handler
asks the engine for `max(limit,100)` and slices the top `limit`, discarding the engine's one-slot
per-requested-class promotion. `limit:100` shows all three classes. `includeOrphaned` and
`includeFramework` default to true, so a default call can silently return none of them.

**P-05 · `history` returns an unbounded findings payload.**
`raw/history-payload.json`: after one recorded run over 1,113 findings,
`{history:true,limit:2}` returned **1,787,433 characters (1.79 MB)**. `limit` bounds runs only;
the shared history reader loads every finding row for the kind, and the answer is JSON with no
truncation declaration. At T2's census (13,237 findings/run) one run alone is ~21 MB.

### Medium

**P-06 · `recordRun` is silently ignored in `scope=orphaned`.** `{scope:"orphaned",recordRun:true}`
wrote no run (0→0), no error, no notice (`raw/behavior.json`); the descriptor documents the option
without a scope caveat.

**P-07 · `limit` has no upper bound and no declared maximum.** `limit: 1,000,000,000` passed the
boundary and returned all 1,113 rows / 55,402 characters on the fixture. The schema states no
maximum; the staleness resolver builds one SQL placeholder per page row, so a sufficiently large
limit fails with a SQLite variable error instead of a declared bound.

**P-08 · Staleness remediation text is false for this tool.** Live footer and generated page both
say "reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1
or **refresh=false**". The handler never calls `maybeAutoRefresh` and the schema has no `refresh`
option (the imports that would do it — `maybeAutoRefresh`, `autoRefreshLine`,
`FRESHNESS_REMEDIATION_MANUAL_ONLY` — are present and unused). The generator's default branch
(`script/verify-tool-docs.ts`, Lead-owned) emits it; the handler renders the same constant.

**P-09 · Docs/curation describe engine-report fields the wire never carries.** Curation line 41
claims "every finding … carries an evidence array … and a limitations array" and names
`summary.unverifiedUsageEdges` / `summary.importResolution`; the tool returns text only — no
per-finding evidence/limitations arrays and neither summary line is rendered.
What IS rendered: rule, location, confidence, `[stale]`, census/per-rule counts, suppression
counts (orphaned scope), provenance counts.

**P-10 · Per-tool gates have stale split assumptions, and one can pass on its own refusal text.**
- `script/m15/verify-patterns-deep.ts` exits 2: splits `src/mcp/tool-registry.ts` on
  `name: "bb_patterns"`, which the split registry no longer contains.
- `script/m13/verify-patterns-docs.ts` fails 5/32: reads the description from doc line 3 (now the
  §8 header), reads the handler body from the 39-line assembler `tool-handlers.ts`, and runs the
  FULL generator for freshness (expected red mid-flight; `--only bb_patterns` exists).
- `script/m13/verify-patterns-contract.ts` (1 fail) and `verify-patterns-e2e-corpus.ts` (3 fails):
  MCP children spawned without `env`, so `BB_DATA_DIR` never reaches them and every MCP call reads
  "No index found". Three e2e checks **passed on that refusal text** ("output contains patterns"
  matches the temp path `bb-patterns-mcp-…`; "called function NOT flagged" passes because an
  error names no function) — a gate passing on its own refusal.
- `m13-patterns-docs` also flags the monolith import residue in `handler.ts` as "routes
  quality/architecture" (the strings appear in the import block).

**P-11 · Source-fingerprint evidence list is stale after the split.** `evidence.ts` lists
`src/mcp/tool-handlers.ts` (now a 39-line assembler) and omits
`src/mcp/tools/bb_patterns/{handler,descriptor}.ts`. `patternSourceFingerprint` cannot change when
the tool code changes and `patternRelevantWorkingTreeChanges` (which decides the m20 P2/P3
`verified` vs `known-gap` status) reports `[]` over a modified handler.

**P-12 · The history read creates analysis-history schema through a shared read-write open.**
`{history:true}` on a fresh data dir moved the WAL 107,152 bytes; `ensureHistorySchema` runs
CREATE TABLE on the read path inside `src/intelligence/analysis/run-history.ts:238` (not owned).

**P-13 · The curated guide is not owner-authored reference for this checkout.** No §8 header;
lines 8–16 claim the harness/raw outputs live in `bb_tests/bb_patterns/`, which does not exist in
this checkout (`~/bb_tests` has no `bb_patterns` directory), so every number in the page is
unreproducible here; line 258 documents `includeTests: true`, which bb_patterns does not accept;
line 231 is milestone narrative (`M57.T3`); line 252 is "the analyzer lane's work"; the
lifecycle-method limitation (`initialize`/constructors can look unreferenced) that m16 D1 requires
is absent — that is the red `m16 verify-docs-truth` leg this page owns. The page's
"Known pre-existing failure" for `m20/verify-patterns-orphan-semantics` was verified still true
(2 of 6 fail).

### Low

**P-14 · Descriptor has no machine-readable defaults or numeric bounds** (no `default`/`minimum`/
`maximum` on any property, though `types.ts` documents them for this purpose), and its description
says "ranked by evidence-derived confidence" while framework findings are a fixed 0.6.

**P-15 · Monolith import residue:** 82 of 91 named imports in `handler.ts` are unused; they pull
the graph/impact/edit/visualize/migration/documentation engines into the tool's import graph and
make the m13 docs routing check read the residue.

**P-16 · Text surface omits the engine's `truncatedByDisplayLimit` marker** (BB_PATTERNS documents
the flag as if a caller sees it) and prints "across no rule(s)" when every class is off.

**P-17 · Generated staleness sentence** is accurate about having no per-mode split but carries the
P-08 false remediation.

## 3 · Gate table

Environment: the sandbox HOME (`~/.bb`) is read-only, so every gate that indexes a tmpdir fixture
fails `EROFS` without a workspace data dir (`gates/logs/env-without-bb-data-dir.log`). The table
below is the second run with
`BB_DATA_DIR=…/validation/tools/bb_patterns/bbdata BB_NO_AUTO_REFRESH=1`; commands are exactly the
`verify:patterns` chain plus the shared legs that cover this tool. Run commit `6cecd6e`.

| Gate | Command | Exit | Note |
|---|---|---|---|
| canonical engine | `bun run script/verify-patterns.ts` | 0 | 16/16 fixture checks |
| m13 orphans | `bun run script/m13/verify-patterns-orphans.ts` | 0 | 22/22, 5 negatives |
| m13 rules | `bun run script/m13/verify-patterns-rules.ts` | 0 | 29/29, 4 negatives |
| m13 contract | `bun run script/m13/verify-patterns-contract.ts` | **1** | P-10 MCP env |
| m13 docs | `bun run script/m13/verify-patterns-docs.ts` | **1** | P-10 split/header/generator |
| m13 e2e+corpus | `bun run script/m13/verify-patterns-e2e-corpus.ts` | **1** | P-10 MCP env + passes-on-refusal; all corpus legs passed (Go, Haskell, Ruby, TS corpora present at `~/bb_tests/repositories`) |
| m15 deep | `bun run script/m15/verify-patterns-deep.ts` | **2** | P-10 registry split (FATAL) |
| m20 parameter scan | `bun run script/m20/verify-patterns-parameter-scan.ts` | 0 | P1 PASS |
| m20 orphan semantics | `bun run script/m20/verify-patterns-orphan-semantics.ts` | **1** | blocked: upstream indexer (2/6) |
| m20 pagination/history | `bun run script/m20/verify-patterns-pagination-history.ts` | 0 | P3 PASS |
| m57 scope=all | `bun run script/m57/verify-t3-scope-all.ts` | 0 | K1–K6 PASS |
| m64 evidence gate | `bun run script/m64/verify-patterns-evidence-gate.ts` | 0 | 45/45 |
| m64 selftest | `bun run script/m64/verify-gate-selftest.ts` | **1** | blocked: bun-incompatible spawn; **node → PASS 8/8** |
| m65 rules budget/gates | `bun run script/m65/verify-rules-budget-and-gates.ts` | 0 | R1–R10 PASS |
| m65 selftest | `bun run script/m65/verify-rules-gate-selftest.ts` | **1** | blocked: same spawn defect |
| m69 page classes | `bun run script/m69/verify-patterns-page-class-representation.ts` | 0 | engine contract PASS (handler page violates it — P-04) |
| m16 docs truth | `bun run script/m16/verify-docs-truth.ts` | **1** | D1 BB_PATTERNS (mine, P-13); D1 BB_ASK ×2, D2 BB_EDIT, D3 BB_ASK are other lanes' |
| m15 registry/handlers | `bun run script/m15/verify-registry-handlers.ts` | 0 | 23/23 |

10/18 exit 0; 4 reds are my gate defects to fix in Phase B (m13 contract/docs/e2e, m15 deep);
2 reds are blocked outside scope (m20 P2 indexer, m64/m65 selftests under bun); m16 has 1 row mine
(fix with P-13) and 4 rows other lanes'. Full logs with sha256: `gates/GATE-TABLE.json`.

## 4 · Latency

Protocol: own `BB_DATA_DIR` per tier under `validation/tools/bb_patterns/bbdata/` (gitignored),
`BB_NO_AUTO_REFRESH=1`, one excluded warmup then five measured calls of `{}` (default all) and
`{scope:"orphaned"}`; source door `createToolHandlers().bb_patterns`; p50/p95 over five.
Exact commands/env/runs: `LATENCY.json`.

| Tier | Population (files/symbols/relationships) | default-all p50 / p95 | orphaned p50 / p95 | Budget | Verdict |
|---|---|---|---|---|---|
| T0 `test/fixtures/polyglot` | 5 / 13 / 26 | 69.6 ms / 112.8 ms | 23.4 ms / 49.7 ms | 250 ms | pass |
| T1 `.perf-fixtures/bb-scale/n100` | 97 / 3,512 / 17,068 | **1,293.7 / 1,748.9 ms** | 778.3 / 864.7 ms | 1,000 ms | **fail** |
| T2 reference index (backup copy) | 6,452 / 310,423 / 820,040 | **19,839 / 93,078 ms** | 20,424 / 21,771 ms | 5,000 ms | **fail** |

T2 index identity: source db 3,639,963,648 bytes, mtime `2026-11-01T22:37:46.803Z`, project
`1d3d57103be91b8f9716d70199fe28a3f39245d9`; backup taken through a byte-read-only source handle
(`raw/t2-backup.json`), source db/wal unchanged by the backup. The live `.bb-data` was not read by
the tool because the current read path writes it (P-01); live re-measurement is a Phase B item.

T2 open cost (`raw/t2-open-cost.json`): read-only open 19.3 ms vs read-write open **12,234 ms**.
T2 engine decomposition (`raw/t2-calls.jsonl`): cold `detectOrphans` 133,520 ms /
`detectIndexRules` 1,978 ms; warm handler default-all 26,430 ms, orphaned 18,107 ms. Load average
21–28 on 8 cores during the sweep; p50 cited and the 93 s outlier kept in the record.

## 5 · Option/mode matrix (observed, not read)

`raw/behavior.json` — 33 calls. Highlights:

- `{}` → all scope, 20 rows, `isError:false`; `confidenceThreshold` default 0 (confirmed by the
  fixture's full census at 0 and 195 at 0.6 / 195 at 0.7 for orphans).
- `includeOrphaned:false` → 63 findings (god 60, long-params 1, complexity 1, framework 1);
  `includeAntiPatterns:false` → 1,051 (orphans + framework); all three off → `patterns (0 found)`.
- Negative/fractional limit refused by name; `limit:0` accepted and shows no rows while naming
  the census; `limit:1e9` accepted and returns the whole census as text (P-07).
- Invalid scope/types/unknown option/threshold range refused by name (5 captured).
- `recordRun` in `all` persists full census (1113 found = 1113 recorded, run completed);
  in `orphaned` silently does nothing (P-06).
- `{history:true}` returns `{runs, findings, summary}`; 1.79 MB after one recorded run (P-05).
- The default page shows only god-class rows despite the census naming orphans and framework
  (P-04), and the staleness footer promises auto-refresh (P-08).

Real MCP stdio door (`raw/mcp-door.json`): source server (`work/node-server-entry.ts` →
`src/mcp/server.ts`) over `StdioClientTransport`, child env carrying `BB_DATA_DIR`:
success `scope=orphaned` (isError false, `orphaned code (…)`, provenance present), success default
`{}`, and refusals for `scope=quality`, unknown option `foo`, `confidenceThreshold:2`, and a
missing index (`No index found … Run: bb index`, isError true). No stdout pollution (empty server
stderr; the JSON-RPC handshake completed).

Compiled door note: `dist/` was rebuilt by another writer at 18:29 during this audit; compiled-door
evidence is time-dependent and belongs to the Lead's integration rebuild. The CLI door was probed
separately and is where P-02 was found (library/CLI path answers a clean zero and creates a db).

## 6 · Docs truth

Checked: `docs/tools/bb_patterns.md` (generated), `docs/BB_PATTERNS.md` (hand), curation,
descriptor, `docs/data/public-tools.json` entry.

True and verified: modes/plannedModes; defaults (`scope all, limit 20, include* true,
confidenceThreshold 0, history/recordRun false`); scope enum; the four documented error classes
(all observed); the `confidenceThreshold` scale claims (orphans 0.30–0.70, framework fixed 0.6,
anti-patterns 0.6–0.9); census-vs-page naming; recordRun full-census claim in `all` scope.

False or unsupported (fix in Phase B): P-08 remediation, P-09 evidence/summary fields as wire
output, P-13 external corpus path, `includeTests` as a tool option, milestone/lane narrative and
missing §8 header, missing lifecycle-method limitation (m16 D1). The page's verification list
names gates that all exist and run; the gate check counts it quotes (22, 29) match the run.

## 7 · Regex and §9 inventory

**Regex: 0 uses in the owned tool sources.** Scanned `handler.ts`, `descriptor.ts`, `orphans.ts`,
`rules.ts`, `evidence.ts`, curation; `validation/tools/regex-baseline.json` has no row under
`src/intelligence/patterns/`; `npx tsx script/tools/verify-regex-policy.ts` → **PASS** (87 uses
repo-wide, 0 new, 2 allowlisted). `orphans.ts:190` states the design: "No regex".

**Process attribution: 19 banned hits across 6 files** (full line list in `audit.json`):

| File | Lines | Class |
|---|---|---|
| `handler.ts` | 38,39,40,43,44,61,68,127 | milestone IDs, issue numbers, "the agent door" |
| `orphans.ts` | 16,252,292,293 | process date (EXTENDED 2026-10-18), "shipped" as history |
| `rules.ts` | 2,79,113,186 | milestone IDs, "shipped" |
| `curation/bb_patterns.ts` | 39 | process history ("once took … now take") |
| `docs/BB_PATTERNS.md` | 231,252 | milestone ID, "the analyzer lane's work" |
| `docs/tools/bb_patterns.md` | 102 | "shipped" via curation |

Phase B keeps every measured fact (rewritten as plain facts: what the engine does and what it was
measured at) and deletes the process narration; technical `owner_symbol_id` meanings stay.

## 8 · Blocked legs

1. **m20 orphan-semantics (2/6)** — upstream indexer: one call is resolved to BOTH same-named
   declarations, so the ambiguity guard cannot fire (`shared findings=0`), and the fixture's
   dynamic `registry[name]` access produces no relationship row at all in this indexer version, so
   the "no fabricated static target" precondition is absent. Fails identically on the unmodified
   engine; documented as a known pre-existing failure in the guide. Not fixable inside
   `src/intelligence/patterns/`. Request: indexer-owner fix or an engine-level invariant gate.
2. **m64/m65 selftests under bun** — both spawn `process.execPath` with the node-only
   `--import tsx`; under the canonical `bun run` the baseline is red before any mutation, while
   under node m64 PASSes 8/8 with every mutation caught. Scripts are not in this write scope.
3. **Compiled CLI/MCP transport** — `dist/` rebuilt mid-audit by another writer; owned by the
   Lead's integration rebuild. Source door verified end-to-end.
4. **T2 on live `.bb-data`** — blocked by P-01 (would write the shared index). Measured on a
   byte-identical backup copy; Phase B re-measures live with `dbUnchanged:true` after the fix.

## 9 · Phase B plan (for approval)

Ordered, each step falsifiable:

1. **Read-only opens** (P-01/P-02/P-12 handler side): `handler.ts` staleness handle, `orphans.ts`,
   `rules.ts` open `{readonly:true}`; unindexed projects now throw the loud named error and the
   handler returns it as `isError` text. Re-measure T2 live and prove `dbUnchanged:true`; prove
   unindexed refusal through handler + MCP door. Red proof: a mutant reverting one handle to the
   rw open turns the new read-write gate red.
2. **Page contract** (P-04): pass the caller's `limit` to the engine (or re-apply one-slot
   promotion on the handler slice); gate case with >100 orphans + framework asserting each
   requested class at `limit:20`. Red on the current code.
3. **Bounds** (P-05/P-07): declare `limit` maximum (proposal 500) in schema+handler with a named
   refusal and `totalCountIfKnown`-style census line; bound `history` findings window with a
   declared total; gate for both, red on current code.
4. **recordRun scope honesty** (P-06): record in both scopes *or* refuse `orphaned`+`recordRun` by
   name; document; gate.
5. **Staleness truth** (P-08): handler renders manual-only remediation from the summary; request
   the Lead's `bb_patterns` branch in `script/verify-tool-docs.ts` (stating no auto-refresh, no
   refresh option). Regenerate only `docs/tools/bb_patterns.md`.
6. **Evidence/§9/docs** (P-09/P-13/P-14/P-15/P-16): trim handler imports; render refused-evidence
   and import-resolution aggregate lines in `scope=orphaned`; rewrite curated guide with §8 header
   and honest engine-vs-answer split; restore the lifecycle-method limitation; add descriptor
   defaults/bounds; fix zero-case wording.
7. **Gate repairs** (P-10/P-11): m15-deep source resolution via `script/lib/tool-sources.ts`;
   m13-docs header-aware description, split handler path, `--only bb_patterns` freshness; forward
   `env` in both MCP transports and assert `isError:false` before reading text; point
   `PATTERN_EVIDENCE_PATHS` at the split files and add an assertion that the list covers the
   handler/descriptor. Every repaired gate shown red on a planted mutant then green.
8. **Evidence + commit**: `validation/tools/bb_patterns/gates-redgreen/`, updated `LATENCY.json`
   (live T2), `audit.json` → Phase B section; commits in this lane's scope only, plain messages,
   no trailers; `git diff --cached --name-only` checked before each commit.

## 10 · Files written in Phase A

`validation/tools/bb_patterns/AUDIT-PHASE-A.md`, `audit.json`, `LATENCY.json`,
`gates/GATE-TABLE.json`, `gates/exit-codes.txt`, `gates/run-gates.sh`, `gates/logs/*.log` (18 gate
logs + environment log), `raw/*.json` / `raw/*.jsonl` (behavior, read-path writes, T2 open cost,
unindexed read, MCP door, history payload, index facts, backup, latency per tier, T2 calls),
`work/*.mts` probes + Node server entry. Indexes and the 3.4 GB T2 backup live under
`validation/tools/bb_patterns/bbdata/` (gitignored, never committed). Nothing under `src/`, `docs/`
or `script/` was modified in Phase A.
