<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the bb_index lane's audit and repair record: contract truth, the defect register with before/after evidence, the gate table (with the mutant that makes each repaired gate red), latency, blocked legs, and the files changed.
WHO IT IS FOR — the repository owner and the release integrator checking that this tool's green evidence is falsifiable.
EDIT TOGETHER WHEN THIS CHANGES — the bb_index handler/descriptor/curation, src/ast/parallel-indexer.ts (dir-change detection, reindexFilesParallel), src/ast/index-lock.ts, src/ast/index-space.ts, docs/indexing/**, and the gates named in the table.
-->

# `bb_index` — audit and repair

State: **PHASE B COMPLETE on the isolated fixtures and the real corpus door.** Every claim below
carries the command that produced it and the file that holds its output. The shared `.bb-data` and
`~/.bb` indexes were never indexed, wiped or written by this lane; every write ran against
`BB_DATA_DIR=validation/tools/bb_index/bbdata` (or `.../realcorpus/bbdata`).

## 1 · Defect register (all reproduced before the fix)

| id | severity | defect | evidence (before) | fix | evidence (after) |
|---|---|---|---|---|---|
| D1 | HIGH | `mode=file` re-parsed an UNCHANGED file: second call answered `indexed: 1` in 11.8 s, so the documented `no-op` could never occur. Root cause: `reindexFilesParallel` passes `skipDiscovery:true` + the named list, which bypasses `indexParallel`'s mtime+size check | `audit/door-t0.json` (case "repeat unchanged file": indexed 1, 11,441 ms) | partition named files before delegating: mtime+size fast path, confirmed by the stored sha256; skipped files counted as `unchanged`, declined extensions as `declined` | `audit/door-unchanged.json` (5/5 `indexed:0`, `unchanged:1`, `outcome:"no-op"`, 16–119 ms) |
| D2 | HIGH (release blocker) | `mode=dir` deleted index rows for files that EXIST on disk: the walk skipped `vendor/` while discovery indexes it, and walk absence was treated as deletion. Editing one file returned `deleted: 2`, purged `src/vendor/format.ts` + `vendor/lib/helper.ts`, files 3→1, symbols 3→1 | `audit/door-vendor.json` + `audit/vendor-state-before-dir.json`/`vendor-state-after-dir.json` (initial run) | a row is deleted only when the file is provably absent (`stat` ENOENT); `vendor` removed from the walk's skip set; dir candidates are filtered by the indexer's own eligibility gates | `audit/door-vendor-after-fix.json` + `audit/vendor-state-*-dir.json`: `deleted: 0`, files 3→3, both vendor symbols still present (`work/vendor-guard-check.sh`) |
| D3 | HIGH | `mode=post` ignored the documented inside-project path policy: `{path:"/etc"}` and `{path:"README.md"}` both re-derived the phases and reported success; the documented example `{"path":"post"}` failed with "no such path" | `audit/door-t0.json` (PROBE rows) | post path must exist, resolve inside the project after realpath, and be a directory (project root or subdirectory); example/descriptor fixed; m40 A1 gate updated to a valid project path | `audit/door-t0-postfix.json`: outside and file paths refused with named errors; `{path:".",mode:"post"}` answers in 115 ms |
| D4 | HIGH (gate) | m40 A1 crashed (`JSON.parse` of a refusal) because it called the handler with the stale `path:"post"` sentinel | `audit/gates/m40-a1-post-entry.log` pre-repair run | gate uses the project path, creates its `empty2` fixture, asserts the post containment refusals, and carries a mutant that makes it red | A1 green 28/0/3; mutant `BB_M40_MUTATE_A1_POST_PATH_UNGUARDED=1` red 24/2/1 (`audit/gates/m40-a1-*.log`) |
| D5 | MEDIUM | no-op `reason` was false in both directions: an unsupported extension answered "nothing changed: content already matches"; the unchanged-file branch was unreachable | `audit/door-t0.json` (assets/data.bin row) | `reason` now distinguishes "already match the index (mtime, size and sha256 agree)" from "holds nothing the indexer extracts", and each count is reported | `audit/door-t0-postfix.json`: `.bin` → `declined:1` + unsupported-type reason; unchanged → sha256 reason |
| D6 | LOW | a future-schema lock refusal printed the "records no start time" remedy instead of naming the newer writer | `audit/lock-matrix.log` step G | `IndexLockHeldError` names "written by a newer bb (lock schema vN)" and the 24 h age-out | `audit/lock-matrix.log` step G (message now correct) |
| D7 | LOW | handler carried ~34 unused imports from the monolith split; descriptor said `outcome` is "indexed, partial, no-op or indexed"; example broken by D3 | static scan `audit/static-scan.json` | handler imports only what it uses; descriptor/curation reworded with the real vocabulary and the accepted post form | `validation/tools/regex-*` clean; descriptor/curation diff |
| D8 | MEDIUM | the MCP reindex path never reclaimed the WAL, and `index-space.ts` issued its PRAGMAs through a `pragma()` method the `CoreDatabase` wrapper does not have, so every checkpoint silently returned false | `docs/indexing/INDEXER-REVIEW.md` §6.6; `walCheckpointed:false` on the first post-fix probe | PRAGMAs go through the driver's own method or a prepared statement; a write run checkpoints the WAL and reports `walCheckpointed` | `audit/door-t0-postfix.json`: `walCheckpointed: true` on the changed-file call |
| D9 | MEDIUM | `mode=dir` reported candidates the indexer would decline (80 on the real 564-file corpus: `candidates:80, processed:0` on a settled tree) | `audit/door-realcorpus.json` (dir row) | the dir walk applies the indexer's eligibility gates (`hasValidExtension` + `shouldSkip`) before calling a path a candidate | `audit/door-realcorpus-dir.json`: settled corpus → `candidates:0, unchanged:true`, 367 ms |

## 2 · What each mode does, as measured through the real MCP stdio door

Door: `npx tsx src/mcp/server.ts --dir <fixture>` over JSON-RPC `tools/call` (no in-process shortcuts).
Commands and raw answers: `audit/door-t0.json`, `audit/door-t0-postfix.json`, `audit/door-vendor.json`,
`audit/door-vendor-after-fix.json`, `audit/door-unchanged.json`, `audit/lock-matrix.log`,
`audit/door-realcorpus.json`, `audit/door-realcorpus-dir.json`.

- **auto** resolves by path kind and reports the resolved mode (`file`/`dir`); **file** answers
  `indexed/partial/no-op` with `unchanged`, `declined`, `skipped`, `errorDetail`, `walCheckpointed`
  and the bounded-derived block; **dir** reports `candidates` beside `processed/deleted/errors`, and
  `unchanged:true` for a settled tree; **post** returns every derived phase with timing + outcome,
  `totalMs`, and `integrityHealth`.
- **Path policy** (all modes): blank/missing path, unknown mode/option, nonexistent path, `../`
  traversal, absolute path outside the project, symlink inside the project pointing outside, file
  passed to `dir`, directory passed to `file`, file or outside path passed to `post` — every one is a
  named refusal with `isError:true`. An in-project root path (`.`) is accepted by `post`.
- **Index lock** through the same door (`work/lock-matrix.sh`, one process namespace so the holder's
  pid is real): a LIVE holder → file mode refused in 29 ms and dir-with-candidate refused in 108 ms,
  both naming pid/host/start time and the remedy; SIGKILLed holder → reclaimed and the call succeeds;
  malformed payload fresh (grace raised) → refused with the "names no process" remedy, unchanged
  lockfile; malformed payload aged 20 s → reclaimed; foreign-host lock fresh → refused with the 24 h
  TTL remedy; foreign-host lock aged 25 h → reclaimed; future-schema lock fresh → refused.
  A holder started from a DIFFERENT tool-call namespace is invisible to the lock's `/proc` probe and
  is therefore correctly judged dead — a namespace boundary, recorded rather than counted as a defect.
- **Staleness repair vs full reindex:** the tool has no full-rebuild mode (by design — that is the CLI's
  `bb index --force`); `file`/`dir` are the bounded stale-file repair and `post` re-derives the heavy
  phases without re-parsing. A settled tree now answers `unchanged:true`/`no-op` instead of re-parsing.

## 3 · Gate table (from the working tree; commands in `work/`)

| gate | green | mutant run (must go red) |
|---|---|---|
| `script/verify-index.ts` | **ALL PASS** — `audit/gates/verify-index.log` | not applicable (regression fixture gate) |
| `script/m40/verify-a1-post-entry.ts` | **28 passed, 0 failed, 3 negatives** | `BB_M40_MUTATE_A1_POST_PATH_UNGUARDED=1` → **24/2/1 (RED)** — mode=post containment |
| `script/m40/verify-a3-write-parity.ts` | **30 passed, 0 failed, 5 negatives** (new legs: unchanged no-op; vendor survives dir reindex) | `BB_M40_MUTATE_A3_NO_SKIP=1` → **RED** ("unchanged file still re-parses — indexed=1"); `BB_M40_MUTATE_A3_WALK_DELETE=1` → **RED** ("walk absence purges a file that exists on disk — deleted=1 vendorRows=0") |
| `script/m43/verify-p1-index-lock.ts` | **22 passed, 0 failed, 2 negatives** (new leg: the TOOL door refuses while another process holds the lock) | `BB_M43_MUTATE_P1_HANDLER_ALLOW=1` → **RED** (3b: refusal missing, `isError=undefined`) |
| `script/m40/verify-a9-purge.ts` | see §4 — **72/2/4 RED, declared**: two checks (env-doc coverage in `docs/m40/PLAN.md`, and an unmarkable diagnostic export) are outside this lane; the split-stale reads were repaired here | — |
| `script/m22/verify-e1-mcp.ts` (agent-fresh) | **VERIFIED 8/8, 1 negative** — `audit/gates/m22-e1-mcp.log` | — |
| `script/m22/verify-d3-single-file.ts` | **VERIFIED 9/9, 2 negatives** — `audit/gates/m22-d3-single-file.log` | — |
| `script/m43/verify-a1-mcp-auto-refresh.ts` / `a2-cli-auto-refresh.ts` | **25/0/4** and **18/0/5** — `audit/gates/m43-a1-*.log`, `m43-a2-*.log` | — |
| `script/m28/verify-index-portability.ts` | **PASS** (writer 3.49.2, independent reader 3.45.1) — `audit/gates/m28-index-portability.log` | — |

Indexer-lifecycle gates not in this checkpoint (m40 A2/A5/A6, m43 A3/A4) were launched via `work/run-final-sweep.sh` and did not finish under the shared-machine load; recorded as a blocked leg in `GATES.json` rather than claimed green.

`tsc --noEmit` (src) exit 0 after every edit set; `tsc --noEmit -p tsconfig.scripts.json` reports 6
pre-existing errors, none in a file this lane touched.

## 4 · A9 purge gate — repaired parts and the two remaining reds

Repaired: the gate read `tool-handlers.ts`/`tool-registry.ts` as one monolith, so the enum and the
mode-branch checks asserted over files that no longer hold the code; it now reads the bb_index
descriptor and handler modules through `script/lib/tool-sources.ts`, and the two mutation seams are
quarantine-checked like the existing one.

Remaining red (declared, not hidden — both outside this lane's write scope):
1. "Every env var documented in the purge report": `docs/m40/PLAN.md` (Lead-owned) does not list the
   36 env vars the gate enumerates, most of them pre-existing. This lane's new knobs are documented in
   `docs/indexing/environment-variables.md`; the gate checks only the m40 plan.
2. "export `describePoolWorkerUnavailable` used or marked internal": the export has no in-tree caller
   and A9's internal-mark convention only recognises three hard-coded names, so a new diagnostic
   export cannot be marked. Gate defect to repair at integration together with item 1.

## 5 · Latency (real MCP door, isolated data dirs)

Full numbers and environment in `LATENCY.json`. Headline, post-fix:

| tier | subject | measurement |
|---|---|---|
| T0 (5 files) | changed-file reindex (cold process) | 5,218 ms (worker-pool start dominates one file's parse) |
| T0 | unchanged file (agent-fresh repeat) | p50 **23 ms**, p95 119 ms — no parse |
| T0 | settled dir / post | 25 ms / 115 ms |
| T1 (100 files) | unchanged file, warm | p50 **16 ms**, p95 19 ms |
| T1 | settled dir | 210 ms |
| T1 | post (full derived re-run) | 3,923 / 9,743 ms (two runs) |
| T2 (reference index) | **blocked** | write tool vs charter §6 read-only T2 rule and the no-touch rule for the shared index; reference population recorded byte-read-only in `LATENCY.json` |

The before/after that matters for an agent: a repeat `bb_index` on an unchanged file went from
**11,800 ms** (always re-parse) to **16–23 ms** (declared no-op).

## 6 · Docs, regex, authorship

- `docs/tools/bb_index.md` regenerated with `npx tsx script/verify-tool-docs.ts --only bb_index --write`;
  descriptor + curation updated to the measured vocabulary (outcome/reason/unchanged/declined/
  walCheckpointed, post path rule, example `{"path":".","mode":"post"}`).
- `docs/indexing/environment-variables.md` gained the index-lock, status-fsync and auto-refresh knobs
  and an author header; `docs/indexing/INDEXER-REVIEW.md` findings 14 (deletion) and 6.6 (reclamation)
  are rewritten as FIXED with their gate/evidence; the stale `index-lock.ts:105-115` citation in
  `troubleshooting.md` now names the class instead of a moved line range.
- Regex: no regex was added to any tool file. `handler.ts`, `descriptor.ts` and the curation file
  contain zero regex literals; the new code uses string comparisons only (`static-scan.json`).
- Authorship: new/changed files carry the §8 header; new comments describe the defect class, not a
  process. Residual milestone narrative inside the 9k-line shared `parallel-indexer.ts` is recorded as
  campaign-wide debt, not silently rewritten.

## 7 · Files changed

`src/mcp/tools/bb_index/handler.ts`, `src/mcp/tools/bb_index/descriptor.ts`,
`script/tool-docs/curation/bb_index.ts`, `docs/tools/bb_index.md`, `docs/indexing/environment-variables.md`,
`docs/indexing/INDEXER-REVIEW.md`, `docs/indexing/troubleshooting.md`, `src/ast/parallel-indexer.ts`
(dir-change existence guard + eligibility + named-file skip partition + WAL checkpoint call),
`src/ast/index-space.ts` (driver-agnostic PRAGMA), `src/ast/index-lock.ts` (future-schema remedy),
`script/m40/verify-a1-post-entry.ts`, `script/m40/verify-a3-write-parity.ts`,
`script/m40/verify-a9-purge.ts`, `script/m43/verify-p1-index-lock.ts`,
`validation/tools/bb_index/**` (evidence, probe harness, AUDIT.md, LATENCY.json, REAL-CORPUS.json).
