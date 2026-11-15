<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase A audit of bb_annotations: what the read side
actually does, measured through the real MCP stdio door and the real store, with
the exact command that produced every number.
WHO IT IS FOR — the campaign integration pass: defects, gate exit codes, latency
tiers, and the legs that are blocked rather than green.
EDIT TOGETHER WHEN THIS CHANGES — audit.json, raw/**, REAL-CORPUS.json,
LATENCY.json, gates/GATE-TABLE.json, and the tool's own files in
src/mcp/tools/bb_annotations/.
-->

# bb_annotations — Phase A audit

Tool: `bb_annotations` (read side of the annotation store). Commit audited: see
`audit.json.currentCommit` (the value is read from `git rev-parse HEAD` at build time).

State: **partial**. The audit is complete and reproducible; the tool is not verified.
Two defects are open and both are fixed in Phase B: **D2 (critical, read path writes)**
and **D1 (high, the `symbol` filter cannot find a qualified-name note)**.

Every claim below cites the file under `validation/tools/bb_annotations/` that holds
the measured record and the command that produced it. `audit.json` is the
machine-readable summary (schemaVersion/tool/status/commit/verifierCommand/
passed/failed/negativeCases/generatedAt/blockedLegs, per charter §5).

## 1 · Commands

All writes are confined to this lane's isolated `BB_DATA_DIR`; the shared
`.bb-data` and `~/.bb` stores are never opened. Every read sets
`BB_NO_AUTO_REFRESH=1`.

```
# fixture indexes (T0 polyglot, T1 n100, probe fixture) — isolated bbdata/
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/index-fixtures.mts
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/reset-probe.mts

# real MCP stdio door, 45 contract checks incl. 9 refusals
BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/mcp-door.mjs

# read-path immutability (I1 existing store, I2 never-indexed project, I3 legacy db)
BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/read-immutability.mjs

# store predicates: the read door vs the hover twin vs the handler's own comment
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/probe-store.mts

# cap/bound behaviour on 206 stored rows + EXPLAIN QUERY PLAN for each filter shape
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/audit-store-more.mts

# latency tiers (isolated indexes; T2 = read-only backup copy of the shared index)
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/latency.mts --tier T0
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/latency.mts --tier T1
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/latency.mts --tier T2

# real corpus: index (part 1) then write+read back through the door (part 2)
BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/real-corpus-index.mts
BB_NO_AUTO_REFRESH=1 node validation/tools/bb_annotations/work/real-corpus-door.mjs

# evidence aggregates
node validation/tools/bb_annotations/work/build-evidence.mjs
```

## 2 · Defects

| # | Severity | Defect | Proof |
|---|---|---|---|
| D1 | high | A note written under a symbol's **qualified name** is unreachable through the `symbol` filter in both directions (read `Widget.render` → 0 rows; read `render` → 0 rows), while the note is in the store and the hover twin returns it. Descriptor, curation and page claim the opposite. | `raw/door-annotations.json` R3/R4; `raw/probe-store.json` s2 (hover 1 row) vs s3 (door 0) vs s4 (intended set 1); `REAL-CORPUS.json` `R-symbol-qualified` returns the simple-name note only, the qualified-name row is visible only through `R-all` |
| D2 | critical | The read opens the store **read-write**. I2: a read on a never-indexed project **created** `projects/<pid>/brain.db` and answered `declaredAbsent`. I3: a read on a legacy store **recreated a dropped `brain_annotation` table** and changed the db hash. I1: a read removed the `-wal`/`-shm` files. | `raw/read-immutability.json` |
| D3 | high | First default call on the 3.6 GB reference index: **17,644.6 ms** (warm 2.8 ms) — the read-write open runs migrations/healers. Over the §6 5 s budget. | `raw/latency-T2.json` `absencePath.coldCallMs` |
| D4 | medium | The `path` property says a path read returns name-level notes too; the default excludes them and `includeNameLevel` says so. Two schema fields contradict each other; the page repeats both. | `raw/docs-claims.json` C6; `raw/door-annotations.json` R6 (4 rows) vs R7 (7 rows) |
| D5 | medium | Documented “Safety: Read-only. It does not modify source files, index data, or annotations.” is false. | `raw/docs-claims.json` C12 + `raw/read-immutability.json` |
| D6 | low | Charter §9 narration in the tool's own files: milestone ids (M28/M48/M55/M63), issue numbers, “the agent door”, “round-1 suite”, “the M28 workstream”. | `raw/section9-scan.txt` |
| D7 | low | At the cap the reason says “Raise limit (max 200)” — impossible when the limit is already 200. | `raw/audit-store-more.json` `capRead.truncationReason` |
| D8 | low | Curated performance claim describes only the symbol shape: path reads scan every annotation row of the project (no `symbol_path` index) and every shape sorts in a temp B-tree. | `raw/audit-store-more.json` `L2_queryPlans.plans` |
| D9 | low | `includeNameLevel` in the answer reports effective inclusion, not the accepted flag (symbol+path with `false` answers `true`). | `raw/door-annotations.json` R2 |
| D10 | low | Declared mode `annotate` names an action the schema does not expose (no `mode` option, no mode branch). | `raw/docs-claims.json` C10 |
| D11 | low | `limit` publishes no numeric bounds/default in the schema (prose only), unlike tools that carry `minimum`/`maximum`. | `raw/docs-claims.json` C8 |
| D12 | low | Generated Staleness section advises refreshing the index to fix this tool's output; annotations are stored rows and refresh does not change them (only name resolution). Generator is Lead-owned. | `raw/docs-claims.json` C17 |

## 3 · What is correct (measured)

- **Declared absence, all three shapes**: project-wide, symbol, path, symbol+path
  — each `isError:false`, `count:0`, `totalCountIfKnown:0`, `declaredAbsent:true`,
  case-specific `absenceNote` (`raw/door-annotations.json` A1–A5;
  `REAL-CORPUS.json` A-* rows before any write). An unindexed, unannotated name
  also declares absence (R18).
- **Truncation with a true total**: `limit 3` → count 3 / total 10 / `truncated:true`
  / reason names `limit 3` (R12); 206-row fixture: default → 50/206, cap → 200/206
  (`raw/audit-store-more.json`). `limit 0`, `201`, `-1`, `"5"`, `1.5` refused with a
  named rule (door X1–X5).
- **Path canonicalization**: `./src/alpha.ts` and the absolute path read the same
  rows as `src/alpha.ts` (R6/R8/R9 count 4 each, `path` echoed canonical) and the
  write door stores the canonical spelling (W9/W10). Same measured on all three
  real corpora (`R-path-dot-prefixed` → canonical `path`).
- **Filters**: name-level + file-scoped separation (R1/R2), multi-file name (R14),
  symbol+path narrowing (R10/R17), includeNameLevel broadening (R6→R7), refusal of
  unknown options with the accepted set named (X6), alias handling (A6/A7, X7).
- **Ordering**: `time_updated DESC, id` — newest-first across 10 writes (R11-order);
  the id tiebreak orders tied timestamps deterministically
  (`raw/probe-store.json` S5 `orderMatchesAscendingId:true`).

## 4 · Gate table (exit codes read from the runs)

See `gates/GATE-TABLE.json`; logs in `gates/logs/`; raw exit codes in
`gates/exit-codes.txt`.

| Gate | Exit | Note |
|---|---|---|
| m28-annotation-store | 0 | 50/50 checks, 7/7 mutants (VERIFIED) |
| m28-annotation-ui | 0 | 23/23, 6/6 mutants, 0 blocked legs (VERIFIED) |
| m28-mcp-tools | 0 | 26/26, 2/2 mutants |
| m28-mcp-surface | 0 | 13/13, 2/2 mutants |
| m28-union | 0 | 30/30, 6/6 mutants |
| verify-tool-docs --only bb_annotations | 0 | page matches descriptor+curation |
| m15-registry-handlers | 0 | behavioural registry/handler gate |
| verify-tool-registry | 0 | — |
| verify-public-surface | 0 | — |
| regex-policy | 0 | 14 allowlisted / 62 frozen / 0 new; no allowlist row names this tool |
| verify-tool-page-claims | 0 | 34 passed, 0 failed, 15 negatives |
| m48-p2-honesty | 0 | 21 passed, 0 failed, 7 negatives |
| m48-c2-edge-mutations | 0 | 73 passed, 0 failed, 3 negatives |
| m50-param-aliases | **1** | **RED outside this tool**: the one failure is `P4b (direction on bb_graph)`; every bb_annotations alias check passes |
| m48-d1-doc-truth | **1** | **RED on shared artifacts**: `docs/data/public-tools.json` + website generated data stale (Lead integration) |

## 5 · Latency (`LATENCY.json`)

Warm, one discarded call per subject, 5 measured runs, `BB_NO_AUTO_REFRESH=1`.
Population and db mtime are recorded per tier in `LATENCY.json`.

| Tier | Subject | Population | Cold first call | Default call p50 / p95 | Budget |
|---|---|---|---|---|---|
| T0 | test/fixtures/polyglot (isolated bbdata) | 5 files / 13 symbols | 10.1 ms | 2.563 / 2.722 ms | < 250 ms PASS |
| T1 | .perf-fixtures/bb-scale/n100 | 97 files / 3,512 symbols | 99.0 ms | 2.510 / 2.794 ms | < 1 s PASS |
| T2 | reference index copy (read-only backup) | 6,452 files / 310,423 symbols / 820,040 relationships | **17,644.6 ms** | 2.846 / 3.045 ms | < 5 s **FAIL on the cold call (D3)** |

Real corpus default-call latency through the door: graphql-js 25.8/27.7 ms,
rake 25.3/31.1 ms, rebar3 25.6/28.3 ms (p50/p95, includes MCP IPC).

The T2 copy was made with the SQLite backup API from a read-only source
connection (`raw/t2-copy.json`: equal=true, source db sha256 + mtime recorded).
The live shared store was never opened.

## 6 · Real corpus (`REAL-CORPUS.json`)

Indexed into an isolated `bbdata-real/` and exercised through the real MCP stdio
door (spawned `startMcpServer` child):

| Corpus | Files | Symbols | Subject | Absence before writes | Qualified-name read-back | Truncation |
|---|---|---|---|---|---|---|
| graphql-js | 564 | 13,620 | `utils.git` (TS function) | declared, all three shapes | **note missing (D1)** — simple-name note returned instead | limit 1 → 1/3 truncated |
| rake | 109 | 1,593 | `Rake::NameSpace` (Ruby class) | declared, all three shapes | **note missing (D1)** | limit 1 → 1/3 truncated |
| rebar3 | 303 | 7,012 | no distinct qualified name (declared not applicable) | declared, all three shapes | n/a — `secondNameFormRows=0` | limit 1 → 1/2 truncated |

## 7 · Twin readers (same table, different predicates)

`raw/twins-source.txt`, `raw/probe-store.json`.

| Surface | Predicate | Finds a qualified-name note? |
|---|---|---|
| `src/lsp/hover.ts:639` | `symbol_name = name OR symbol_name = qualified_name`, path-scoped | **yes** (measured 1 row) |
| `src/lsp/graph_request.ts:271` | same shape, root name + qualified name | yes (same predicate) |
| `src/intelligence/visualization/visualization-engine.ts:868` | `symbol_name IN (names)` | **no** (name only) |
| `bb_annotations` handler | `symbol_name IN (SELECT name …)` | **no** (D1) |

So the “reader and editor always agree” claim is false today: the hover finds a
note the tool misses, and the visualization badge misses what the hover finds.
The hover/graph/badge files are shared code; only the handler is this lane's.

## 8 · Regex and authorship

- Regex: no regex literal and no `RegExp` construction in
  `src/mcp/tools/bb_annotations/*` or the curation file; no allowlist row names
  the tool; `script/tools/verify-regex-policy.ts` exits 0 with 0 new uses.
- §9: process narration present in handler.ts (7 lines), descriptor.ts (1 line),
  curation (1 limitation string) — `raw/section9-scan.txt`; rewritten in Phase B.

## 9 · Blocked legs (declared, not green)

1. T2 against the **live** `.bb-data` store: blocked by D2 (a measurement must not
   open the shared store read-write). Measured on a read-only backup copy instead.
2. Compiled door (`node bin/bb mcp`): blocked by the stale `dist/` (rebuild is the
   Lead's integration step). All door measurements use the source entry through
   `tsx`, which the Lead's source-door ruling permits.
3. Qualified-name read-back on rebar3: not applicable — the Erlang indexer stores
   `qualified_name = name` for every symbol (measured 0 second-name-form rows).

## 10 · Files

`audit.json`, `LATENCY.json`, `REAL-CORPUS.json`, `gates/GATE-TABLE.json`,
`gates/exit-codes.txt`, `gates/logs/*.log`, `raw/*.json`, `raw/*.log`,
`raw/twins-source.txt`, `raw/section9-scan.txt`, and the reproducible scripts in
`work/` (index/reset, door, immutability, store predicates, cap/plans, latency,
real corpus, evidence build).

Fixture stores (`bbdata/`, `bbdata-real/`, `bbdata-immut-*/`, `t2-copy/`) are
per-lane working state and are not committed.
