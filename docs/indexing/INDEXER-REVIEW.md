# Indexer review — time, space, scope, and the surface a user sees

Scope: `bb index` end to end on this repository. Written 2026-10-09 against
`analyzers/ontology-laptop-b`. Every claim below is either (a) measured on this machine in
this session, (b) read from the named file:line, or (c) produced by a focused review pass and
**re-verified by reading the code myself** before being written down. Where a claim was NOT
verified, it says so.

Method: the four review passes (discovery/scope, worker pool, store/DB, derived phases) each
read the real code paths and cited `file:line`; two of them additionally *executed* the real
functions (the discovery reviewer imported the actual `discoverIndexableFiles` and ran it
against synthetic fixtures; the pool reviewer reproduced Node's IPC behaviour with real child
processes). I then re-read the load-bearing findings myself. Measurements come from the
project's own `brain_index_status.performance_stats`, `dbstat`, and the run logs committed in
`validation/m60/results/` and `.tmp-probe/logs/`.

---

## 1. The measured baseline

Same command (`bb index . --force --no-setup`), same machine, before and after the recent work:

| | files | index time | whole command | worker kills | errors |
|---|---|---|---|---|---|
| before | 11,045 | 9,069 s (151 min) | — | 99, in bursts of 7 | 231 + 118 timeouts |
| after | 5,086 | 443.3 s (7 m 7 s) | 911 s (15.1 min) | 0 | 0 |

Phases recorded by the run itself (`brain_index_status.performance_stats`, last run):

```
discoveryMs         620        parseMs          372,264   (6.2 min)
workerStartupMs     241        dbFlushMs        404,176   (6.7 min)  <-- now the largest
finalAccountingMs   490        postProcessingMs  67,417   (1.1 min)
                              totalWallMs      441,852   (7.4 min)
```

**The bottleneck moved from parsing to storing.** `dbFlush` now exceeds `parse`, and the two
overlap (their sum 776 s > wall 442 s). Store throughput implied: 687,099 symbol+relationship
rows written in 404 s ≈ **1,700 rows/s**. That is the number any further "blazing" claim has to
beat, and it is the reason §3 (space) and §6 (store path) matter more than parser work now.

---

## 2. Time complexity, phase by phase

| Phase | Cost model | Evidence |
|---|---|---|
| discovery/walk | O(F) stat + one `readdir` per directory; O(F²/B) for dispatch (see §5.13) | 620 ms for 5,086 files |
| parse (7 workers) | O(Σ parse cost per file); dominated by the largest files, not by F | 372 s |
| store (parent, synchronous) | O(S + R) rows, each with 18 index objects on `brain_relationship` (§3) | 404 s at ~1.7k rows/s |
| resolve | **linear plan**: three per-name aggregate temp tables + one indexed lookup per relationship. Fan-out 0.51 → 0.56 across 47→196 files (bound 1.5×) — but see §7.2: the reported "largest intermediate" excludes the plan's biggest table | 27,471 ms for 496,886 rels |
| enrich / gravity / taint / health | one pass each over stored relationships | 13,875 ms / ~0.5 s / 278 ms / 163 ms at 5,086 files |
| embeddings | O(embeddable symbols) network calls, background, capped | 24,502 queued vs a 25,000 cap; 2,283 stored; 7,014 still pending after a 300 s bounded wait |

**The gate's tiers do not cover production scale.** `script/perf/verify-scaling-linear.ts`
measures at 47/97/196 files and passes with 1.11× fan-out growth and 1.48× ms/rel growth
(bounds 1.5× / 2×). The production run resolves at **0.0553 ms/rel** — 2.6× the 0.0212 ms/rel
measured at 47 files, i.e. growth beyond what the 2× bound is tested over, across 108× the file
count. This is not proof of a superlinear algorithm (the per-rel cost also carries terms that
shrink relative to R), but it *is* a measurement the gate does not see, and a tier at ~1,000+
files belongs in it.

---

## 3. Space complexity

The database is **3,177.4 MB** for 5,086 files / 190,213 symbols / 496,886 relationships /
27,280 embeddings. `dbstat` attribution:

| Object | Bytes | Note |
|---|---|---|
| `brain_semantic_embedding` | **891.2 MB (28%)** | 27,280 rows = **34,254 B/row on disk** |
| `brain_relationship` + its **17** index objects | **1,077 MB** | table 328.5 MB, indexes **748.5 MiB** |
| `brain_symbol` + indexes | ~200 MB | `source_text` 23.9 MB over 36,946 rows (avg 132 B, cap 4,000) |
| free pages | **857.7 MB (27%)** | awaiting the next `--force` (VACUUM needs the write lock) |

**3.1 The vector is stored twice.** Every one of the 27,280 embedding rows has BOTH columns:

```
embedding_vector (text)  662.1 MB = 25,450 B/row      <- 2048 floats as JSON text
embedding_blob  (blob)   209.5 MB =  8,053 B/row      <- the same 2048 floats as float32
needed for float32 2048-d:                          8,192 B
rows with BOTH populated: 27,280 of 27,280
```

So ~662 MB of the database — 21% of the whole file — is a second copy of vectors that already
exist as blobs. `src/brain/database.ts` comments that the blob is written for every dense vector
"so fresh indexes never need this [backfill]", which makes the text column pure duplication on
the write path as well: it is serialised, stored, indexed and read by nothing that needs it.

**3.2 Indexes cost more than the data they index.** `brain_relationship` carries **17** B-tree
objects (16 named indexes + the PK autoindex) for 496,886 rows: **748.5 MiB of indexes over a
328 MiB table (2.3×)**. The five largest alone (`autoindex_brain_relationship_1` 93.9,
`brain_rel_proj_type_target_idx` 81.0, `brain_rel_proj_target_idx` 77.5,
`brain_rel_proj_source_idx` 74.8, `brain_rel_target_type_idx` 58.0 MB) exceed the table. Every
insert maintains all 17 — this is the mechanical reason `dbFlushMs` is now the largest phase.
**Only three of the 17 are read during the load** (PK autoindex for dedup, `brain_rel_source_idx`,
`brain_rel_target_idx`), so **549 MiB of index is deferrable** to the end of a run; for
`brain_symbol`, 10 of 12 are deferrable (127 MB). The constraint is that deferral must be
implemented *inside* the run: `ensureHealthIndexes` recreates 8 core indexes on **every open** of
an existing database (`schema-ddl.ts:714-731` via `database.ts:85`) and `ensureQueryShapeIndexes`
recreates the gravity index (`:604-613`).

**3.3 Parent memory scales with the whole run, not the pool.** The parent retains every file's
full result — including per-symbol snippet text — in `results` for the entire run
(`parallel-indexer.ts:1490`, pushed on every outcome, cleared only after the pool resolves at
`:5844`; `symbols` carry snippets of up to 10,000 chars, `pool-worker.ts:1047`). Measured by the
pool reviewer with real child processes: while the parent was blocked in a synchronous store, a
child's RSS climbed 75 → 120 → 215 → 306 MB sending 300 × 1 MB messages, and the parent then
allocated 399 MB receiving them. There is no IPC high-water mark in either direction
(`safeSend` discards `process.send`'s boolean, `pool-worker.ts:94-103`). For a 1M-symbol project
this is the failure mode that ends the run, and it is a *space* bound driven by total symbols.

---

## 4. Discovery and scope — what is indexed versus what exists

Measured against `git ls-files` (12,699 tracked) and the real index (5,086 files):

| tree | tracked | indexed | coverage |
|---|---|---|---|
| `src` | 209 | 205 | **98.1%** |
| `script` | 4,297 | 3,906 | 90.9% |
| `docs` | 291 | 288 | 99.0% |
| `test` | 42 | 42 | 100% |
| `website` | 124 | 92 | 74.2% |
| `ide` | 36 | 32 | 88.9% |
| `validation` | 6,580 | 214 | 3.3% (`.bbignore`, deliberate) |
| `grammars` | 286 | 0 | 0% (`.bbignore`, deliberate) |
| `worktree-snapshots` | 286 | 0 | 0% (`.bbignore`, deliberate) |
| `.tmp-probe` | 144 | 0 | 0% (`.bbignore`, deliberate) |

Findings, all read from the code (the discovery pass additionally executed the real walk):

1. **CRITICAL — directory-name skips beat every ignore file and cannot be re-included.**
   `shouldSkip("/" + relativePath)` runs at `parallel-indexer.ts:1033`, *before*
   `localIg.ignores(...)` at `:1035`, and `shouldSkip` is a bare
   `skipPatterns.some(p => p.test(path))` (`:636-638`) with no negation. The patterns include
   whole segment names: `env` (`:270`), `bin` (`:298`), `out` (`:274`), `deps` (`:293`),
   `gen`/`generated` (`:312-313`), `platforms` (`:307`), `build` (`:273`), `target` (`:275`),
   `perf` (`:337`). Verified by running the real walk: `src/env/config.ts`,
   `src/bin/tool.ts`, `src/out/box.tsx`, `src/gen/api.ts` are all absent — and no `.bbignore`
   line can bring them back. Rust `src/bin/*.rs`, `packages/ui/src/out/Box.tsx` and
   `src/deps/container.ts` are permanently invisible.
2. **HIGH — `.mts` and `.cts` are never indexed.** `EXTENSION_LANGUAGE`
   (`language-detection.ts:20-103`) maps `ts, tsx, js, cjs, mjs, jsx` and has no `mts`/`cts`
   (verified myself). **490 tracked files** in this repository are `.mts`, including much of the
   gate suite (`script/m14/clean-*.mts`, `script/m12/xml-*.mts`). Same gate also drops `.hh`,
   `.tpp`, `.ipp`, `.inl`, `.inc`, `.csproj`, `.fsproj`, `.xaml`, `.plist`, `.wsdl`, `.pom`,
   `.conf`, `.ini`, `.cfg`, and hand-written `.d.ts` (`:320`) — the last of which *routes* but is
   then skipped. `ParallelIndexerConfig.extensions` (`:145-251`) is dead code: nothing reads it,
   and it disagrees with the map that actually admits files.
3. **HIGH — the 1–5 MB tier reads only the first 256 KB, silently.** `pool-worker.ts:920-935`
   allocates `min(size, 256 KB)`, hashes the *truncated* text, and returns
   `extractFallback(...)`. The "Using structural extraction for large file" message goes to
   `function log(..._args: unknown[]) {}` (`pool-worker.ts:36`) — **a no-op logger** (verified).
   Worse, the read-side freshness check hashes the whole file (`freshness.ts:17,323`), so any
   metadata change makes such a file report permanently `hash-differs` with a reindex
   remediation that cannot clear it.
4. **HIGH — symlinks are never followed.** `isSymbolicLink` appears zero times in `src`; the walk
   only consults `isDirectory()`/`isFile()` (`:1006`, `:1038-1040`). Verified: a symlinked file
   and a symlinked directory are both absent (and a cyclic link cannot hang — it is never
   entered).
5. **HIGH — nested ignore files are flattened, so anchored patterns are inert.** Child
   `.gitignore`/`.bbignore` files are added into one root `ignore()` instance (`:976-997`) but
   tested with root-relative paths (`:1035`). Verified: `sub/.gitignore` containing `/build2/`
   and `/anchored.ts` left both files indexed.
6. **HIGH — submodules and worktrees are indexed as first-party.** The nested-repo check tests
   `e.isDirectory() && e.name === ".git"` (`:972-974`); a submodule or worktree writes `.git` as
   a FILE, so the subtree is walked (verified) and its symbols enter the graph.
7. **HIGH — a file that grows past 5 MB keeps its old rows and is reported "unchanged".**
   `foundFiles.add()` (`:918`) happens before the >5 MB return (`:921-925`), and stale cleanup
   only removes paths absent from `foundFiles` (`:1088-1089`); `skippedFiles++` is then reported
   as `unchanged` (`:5719`; CLI prints it at `cli/index.ts:416`).
8. **HIGH — no stable ordering, and it reaches a page.** Nothing sorts the walk (`readdir` →
   `await stat` → push, `:944-955`), and `symbol-search.ts:323,327` applies `LIMIT` with **no
   ORDER BY**, so which rows survive a candidate cap is insertion order. Symbol IDs are
   content-addressed, so stored rows are reproducible; the *page* is not.
9. **HIGH — the in-process (no-fork) mode silently truncates.** `FULL_AST_CUTOFF = 13000`,
   `MAX_FILES_IN_PROCESS = 14000` (`:1169-1174`): files past 14,000 are never parsed, files past
   13,000 are regex-extracted, and the summary's arithmetic cannot account for them
   (`:5324`, residual at `:5720`); the CLI never prints `byLanguage` or fallback counts.
10. **HIGH — no duplicate-content detection.** Identity is the path
    (`INSERT OR REPLACE INTO brain_file` keyed on `projectId:relativePath`, `:2752-2757`); the
    hash column is a *non-unique* index (`brain.sql.ts:29,48,52`) and `fileHash` is never used to
    dedupe. A copied or vendored file is stored twice — duplicate symbols, duplicate embeddings,
    and `bb_edit`'s "symbol is ambiguous" path becomes reachable.
11. **HIGH — read-time exclusions hide files the index deliberately kept.** `NOISE_DIR_SEGMENTS`
    (`analysis-exclusions.ts:7-21`) hides `fixtures`, `vendor`, `snapshots`, `baselines`,
    `generated`, `gen` from every read surface while the walk indexes them. The reviewer
    demonstrated it live in this repo: `bb_search mode=file` returns
    `script/fixtures/contract-fixture.ts` as indexed and fresh, while a symbol search for its
    export `createContractFixture` answers "no results … scan was cut short (noise-filter)" —
    despite three tracked scripts importing it.
12. **MEDIUM — data formats are admitted by name, bounded only by size.** json/yaml/toml/xml/
    svg/md/sql/graphql all route; lock files are named one by one (`:322-325`) so `Cargo.lock`
    and `Gemfile.lock` are excluded by accident while `poetry.lock`/`Pipfile` are indexed as
    TOML. Measured in this repo before the `.bbignore` work: json was 78.8% of all symbols.
13. **MEDIUM — three more walks with divergent skip lists.** `fingerprint.ts:79-80` uses the union
    of `skipPatterns` + `cliSkipPatterns` (which uniquely has `snapshot.json$`), so
    `computeCheckoutFingerprint` can never equal `computeDbFingerprint` for a tree containing
    such a file — "moved project" adoption never fires. `collectDirChanges` (`:6858`) has a third
    list, `DIR_WALK_SKIP_DIRS` (`:6853`), which includes `vendor` that discovery deliberately does
    *not* skip.
14. **MEDIUM — `bb_index mode=dir` deletes what its own walk does not see.** In
    `collectDirChanges`, the >5 MB skip (`:6881`) precedes `seen.add` (`:6882`), and every stored
    path under the prefix not in `seen` becomes `{type:"deleted"}` (`:6891`) → purged
    (`:6965-6980`). Editing any file in a tree containing `vendor/` therefore silently deletes
    that vendor code's symbols and reports a normal-looking `deleted: N`.
15. **MEDIUM — explicit-file indexing bypasses ignore files.** `:5304-5305` filters only
    `shouldSkipCli` + `hasValidExtension`; `:6993-6994` only `hasValidExtension` + `shouldSkip`.
    A gitignored file added by path enters the index and is purged again by the next full run.
16. **MEDIUM — stored text is capped twice, silently**: 10,000-char snippets
    (`pool-worker.ts:1047`) and `source_text` at 4,000 chars / 200 lines (`:733-751`, applied
    `:3698`). Content search cannot find a term that appears late in a large symbol.
17. **MEDIUM — no binary-content detection.** Any name-routed file is parsed; the only content
    probe is the 256-byte shebang check for extensionless files (`:692-710`). A misnamed binary
    becomes a symbol-less `brain_file` row counted as `symbolLoss`.
18. **LOW — name rules catch hand-written files**: `.*-min\.` and `.*\.min\.` (`:315-316`) exclude
    `admin-min.ts`; `.*\.map$` (`:319`) excludes any `foo.map`; depth > 50 returns silently
    (`:967`); `localIg.ignores` is written twice (`:1035-1036`) and `/obj/` twice
    (`:1022-1023`); the inline compiled-mode list (`:1013-1028`) is redundant with
    `skipPatterns` + `rootIg` and is inert at root level.

---

## 5. The worker pool

Architecture: the parent forks workers; workers parse and `process.send` results; **the parent is
the only process that touches SQLite**, synchronously. Verified findings:

1. **HIGH — no `error` listener on pool workers, so a send to a dying worker can kill the parent.**
   The only `.on("error")` in 7,083 lines is on the fork *probe's* throwaway worker (`:5486`) —
   verified myself. `child.send()` to a closed channel emits an unhandled `'error'`
   asynchronously, so the `try/catch` at `:2034-2064` does not catch it. The reviewer reproduced
   both orderings on Node v22.22.1 with real children: after the `exit` event, send returns false
   *and* the process exits 1 with `ERR_IPC_CHANNEL_CLOSED`; in the pool's actual ordering — the
   parent blocked 400 ms across the child's death, with `exitCode===null, killed===false,
   connected===true` (exactly the state the guard reads as alive) — send returns **true** and the
   write fails with EPIPE, exiting 7. This is the same failure class the comment at `:1579-1606`
   claims to have fixed. One line fixes it: `worker.on("error", …)` at fork time.
2. **HIGH — a worker that dies before `ready` bypasses the restart cap and forks forever.**
   The `exit` handler calls `clearStartupTimer(worker)` first (`:1881-1883`), so the startup
   watchdog can never fire for a fast death; `startupFailures` is incremented only at `:1739`,
   `:1754`, `:1775`, `:1934` — never on `exit` (verified). With `MAX_STARTUP_FAILURES` never
   reached, the replacement branch (`:1899-1916`) loops fork → die → fork with nothing parsed and
   nothing reported. The *silent*-worker variant is capped; that is the only case the existing
   fixture covers.
3. **MEDIUM — no IPC flow control; the parent retains the whole run in memory** (see §3.3).
4. **MEDIUM — an engine-failure worker is pooled twice.** `pool-worker.ts:1528-1530` sends
   `engine_fail` and then `:1545-1554` sends `ready` unconditionally; the parent pushes on both
   (`:1812-1830`) and dispatch shifts from `idleWorkers` without a membership check (`:2003-2015`),
   so one process can run two batches — halving effective parallelism on exactly the regex-fallback
   path, against unchanged 45 s budgets.
5. **MEDIUM — the startup watchdog has no stall deferral.** `decideWatchdog` is applied only to
   per-file timeouts (`:1619-1638`); the startup timer kills on wall clock with the sole test
   `workers.has(worker)` (`:1769-1777`), so a parent block longer than the startup timeout can
   SIGKILL a worker that already sent `ready`, and each such kill advances `startupFailures`
   toward failing the remaining queue outright.
6. **MEDIUM — `processed` counts attempts, not files.** Ten `processed++` sites (verified: `:1187`,
   `:1232`, `:1655`, `:1669`, `:1684`, `:1696`, `:1730`, `:1856`, `:1862`, …), including timeout,
   poison-drop and retry paths; the percentage is `processedFiles/totalFiles*98`
   (`:5536`) with no clamp, and `filesPerSecond` uses the same counter (`:5855`). A run with
   retries can therefore report >100%.
7. **LOW — a `file_done` for an already-killed batch is still accepted** (`:1838-1857` never
   consults `pendingBatches`, unlike `file_start` `:1832` and `batch_done` `:1865`), so a file can
   be parsed and stored twice after a timeout kill. No data loss (`INSERT OR REPLACE`); CPU and
   counters suffer.
8. **LOW/MEDIUM — a dispatch into a dead-but-unreaped worker is dropped by the kernel**, and the
   ensuing timeout blames `batch.files[0]` as a poison pill (`:1678-1704`). The end-of-run DB pass
   usually rescues it (`:5740-5748`) — but that pass is skipped on a cancelled run (`:5737-5740`).
   *Positive:* no reachable path leaves a file with zero result entries, and the batch retry loops
   are bounded (`MAX_FILE_RETRIES = 3`, `:1557-1558`, checked on every requeue).
9. **MEDIUM — `new Promise(async (resolve) => …)` has no catch** (`:1489`): a synchronous throw
   from `fork()` (EMFILE/ENOMEM) leaves the pool promise pending forever, with no diagnostic and
   live children holding IPC handles.
10. **LOW — pool size ignores cgroup/affinity limits.** `Math.max(2, Math.min(cpus().length - 1, 12))`
    (`:125`) gives **2 workers on a 1-core machine** (`min(0,12)=0` → `max(2,0)`), and a 2-CPU
    container on a 64-core host reports 63 → caps at 12. `os.availableParallelism()` is
    affinity-aware; `cpus()` is not. There is no CLI or env override for concurrency.
11. **LOW — an empty file list still forks a worker** (`:1387` `|| 1`, then `:2068-2070`), costing
    one Node/tsx boot (0.55–3.4 s) on a no-op run.
12. **LOW — a >5 MB file is recorded as `success: true` with zero symbols** and an empty-string
    hash (`pool-worker.ts:897-916`); it is only revisited if mtime/size change.
13. **INFORMATIONAL — dispatch is O(F²/B) worst case**: `fileQueue.splice(0, batchSize)` copies the
    remaining tail per dispatch (`:2015`), and retries `unshift` (`:1674`, `:1701`, `:2058`).
    Irrelevant below ~100k files; the dominant term is memory (§3.3).
14. **NO DEFECT — dispatch is work-conserving.** Every event that can idle a worker calls
    `scheduleNext()` synchronously, and there is deliberately no timer-based dispatch
    (`:1911-1913`) because a blocked loop would never fire it.

---

## 6. The store path and the database

`storeResults` (`parallel-indexer.ts:2727`) prepares **13 statements once per call** and executes
one `.run()` per row — no multi-row `VALUES` anywhere, though better-sqlite3 allows 32,766
variables. One transaction per call (`:3003`, invoked `:4326`, default `BEGIN DEFERRED`; the first
statement per file is a DELETE, so the write lock is taken at the top). Per file, in order: six
DELETEs (`:3059-3066`) → `insertFile` (`:3163`) → the symbol loop (`:3654`) → the relationship
loop (`:3984`/`:4281`).

**6.1 Batch sizes have drifted apart.** `workerBatchSize` is 10 files per IPC batch (`:136`); the
pool's DB flush threshold is **hardcoded 20** (`:1850`); `FLUSH_CHUNK_FILES` is 20 (`:1453`);
and `dbBatchSize: 100` (`:139`), documented as the bulk-insert bound, **never binds in the
worker-pool path** because `storeResults` receives at most 20 files per call. So the pool commits
more often, and writes more WAL frames, than the configuration implies.

**6.2 A SELECT is executed PER RELATIONSHIP, and it sorts every candidate.** Call site
`:4119-4122`; statements `resolveTargetStmt` (`:2856-2862`) and `resolveContainsTargetStmt`
(`:2971-2977`), both shaped:

```sql
SELECT s.id, s.file_id, f.language FROM brain_symbol s
LEFT JOIN brain_file f ON f.id = s.file_id
WHERE s.project_id = ? AND s.name = ?
ORDER BY COALESCE(s.is_declaration,0) ASC, (s.file_id = ?) DESC, (f.language = ?) DESC, s.id
LIMIT 1
```

`EXPLAIN QUERY PLAN` on the real index reports `SEARCH s USING INDEX
brain_sym_proj_name_type_idx` … **`USE TEMP B-TREE FOR ORDER BY`** — every edge materialises and
sorts *all* same-named candidates. Measured per query: **0.146 ms at 0 candidates → 0.229 at 5 →
0.663 at 55 → 6.506 at 553 → 11.538 at 2,010 → 21.342 ms at 3,159**. Distribution across the
496,886 edges (proxy: `target_external`): **26,838 edges see ≥1,000 candidates**, 67,814 see
100–999, 115,083 see 10–99, 162,440 see 1–9, 124,711 see none. The same information is already in
memory (`nameToSymbol`, `:3246`, `:3367-3391`).

**Honest bound on this finding.** The additive estimate from those buckets (~14.7 min) *exceeds*
the measured 404 s store phase, so the `target_external` proxy over-counts (about 20% of targets
are qualified, and the leaf differs). The 404 s is the real ceiling for the sum of this SELECT,
17-way index maintenance and the per-file DELETEs; the split among them is **not measured** and
would need instrumentation.

**6.3 Failure semantics are the dangerous part.**

1. **CRITICAL — a full disk is invisible.** There is no `SQLITE_FULL`/`ENOSPC` path anywhere in
   `src/`. A failing commit is caught, rolled back and **skipped** (`:4330-4343`); the run reaches
   its status write and summary, whose counts are re-read from the database
   (`:5847-5849`; `cli/index.ts:299-302`). The user sees `✓ indexed N files…` with N silently
   smaller.
2. **HIGH — a broken index can be persisted as `complete`.** `status = errorFiles > 0 ? "partial"
   : "complete"` (`:5906`), but `errorFiles` only counts *parse* outcomes (`:5694`, `:5812`); a
   store rollback is written to stderr and nothing else (`:4335`, `:1971-1976`).
3. The end-of-run checkpoint fires **before** the embedding drain finishes (`cli/index.ts:303-307`
   vs the drain awaited at `:317-333`), so "the writes have stopped here" is false and the WAL
   regrows after the `index space:` line.
4. The force-wipe is **not transactional**: nine autocommit DELETEs with `foreign_keys = OFF`
   (`:6168-6194`). A crash mid-wipe leaves a partially wiped index that nothing marks suspect.
5. Corruption surfaces as one opaque driver line (`db.node.ts:22-23` → `cli/index.ts:1288-1292`),
   and additive migrations are blanket `catch {}` (`schema-ddl.ts:569-576, 615-622, …`), so a
   corrupt database can be silently left un-migrated.

**6.4 Pragmas are minimal and the temp store is on disk.** Only `journal_mode=WAL`,
`busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys` are set (`db.node.ts:29-35`).
`cache_size`, `mmap_size`, `temp_store` and `journal_size_limit` are never set, so the driver's
compiled defaults apply: **16 MB page cache, mmap off, `TEMP_STORE=1` (file-backed), 4 MB
auto-checkpoint**. For a 3.3 GB database whose store path forces a temp sort per edge, that is the
un-tuned part of the load — and it is why the `USE TEMP B-TREE` in 6.2 lands on disk.

**6.5 Concurrency and locking are mostly right, with one hole.** A second indexer is refused
immediately by an `O_EXCL` lockfile naming the holder (`index-lock.ts:96-122`, taken before the
`--force` wipe at `cli/index.ts:154-166`). The in-place wipe is verified to keep a live MCP
server's cached handle valid — and VACUUM is verified to work while another process holds the
database open (it needs the *write* lock, not exclusivity). The hole: **the MCP's own writers hold
no index lock** — the background embedding drainer (`:2496-2690`) and annotations — so they contend
only through `busy_timeout=5000`, and a lost embedding chunk is counted `failed` and downgraded to
tf-idf (`:2648-2656`).

**6.6 Reclamation only happens on the CLI path, and only sometimes.** `reclaimSpace` is referenced
at `cli/index.ts:189` (after a `--force` wipe) and `:308` (end of run) and **nowhere else** — the
MCP `bb_index` path never checkpoints. An ordinary run passes `vacuum: false`, and the wipe path
only vacuums when rows were deleted from a file ≥256 MiB, so **858 MiB (27%) of this index is
never returned by a normal run**.

---

## 7. Derived phases, and where the candidate cost actually went

The bulk plan really is the linear one, and it is measured. `stats = { plan: "linear", … }`
(`:4939`); the plan builds `_i13_src` (`:4827`), `_i13_tier` (`:4854`), `_i13_best_file` (`:4865`),
`_i13_best_lang` (`:4877`), `_i13_best_any` (`:4888`), `_i13_pick` (`:4910`) and applies with one
`UPDATE … FROM` (`:4945-4951`). `ROW_NUMBER`/"window" survives only in probes. Measured on the real
index (496,886 relationships, 190,213 symbols): `_i13_src` 1,600 ms · `_i13_tier` 155 ·
`_i13_best_file` 304 · `_i13_best_lang` 381 · `_i13_best_any` 173 · `_i13_pick` 2,033 ·
**apply 33,433 ms**. The apply dominates because it rewrites rows in a table carrying 17 indexes.
What makes the shape safe is the unique index on `_i13_src(rel_id)` (`:4852`) — without it the plan
degenerates to a scan per relationship (measured 15.6 s vs 0.060 s).

**7.1 The candidate cost did not disappear — it moved into the store.** `resolveTargetStmt` and
`resolveContainsTargetStmt` (`:2856-2862`, `:2971-2977`) run **once per relationship at insert
time** (`:4119-4122`), and that call site is **not** inside the `if (!options.skipResolution)`
block (which spans `:4368-4555`). Verified: the pool path stores every batch with
`skipResolution: true` (`:1465`) and still pays the per-edge SELECT for all 496,886 edges. So the
complexity is O(R × C log C), and it lands in `dbFlushMs` (404 s of the 442 s run), not in
`postProcessingMs`. Measured C on the live index: **average 3.66, max 3,159; 237 names have ≥100
candidates and 14 have ≥1,000**. This is the single largest algorithmic term in the indexer today,
and it is exactly the term the linear plan was written to remove from the other pass.

**7.2 The gate cannot see the plan's biggest intermediate.** The reported value is
`MAX(c)` over `_i13_tier`, `_i13_best_file`, `_i13_best_lang`, `_i13_best_any` and `_i13_pick`
(`:4930-4938`) — it **excludes `_i13_src`**, which is R rows (496,886 here against a reported
246,909). The comment above it says "the largest intermediate it materialised, counted from the
tables it built", and `verify-scaling-linear.ts` divides this number by R to compute the clock-free
fan-out check. A table of R rows is dropped from a metric whose purpose is to bound the largest
intermediate, so the gate's headline number under-states it by roughly 2× on this corpus.

**7.3 Resolution is 6–8 passes over R, not one.** Between them: the unresolved `COUNT`
(`:4602-4604`), two strategy `UPDATE`s (`:4641`, `:4655`), the dotted-target update (`:4443`), the
import resolver (`:4690`), `_i13_src` (`:4827`), `_i13_pick` (`:4910`), the `is_cross_file` recompute
(`:4956-4966`) and cross-language normalisation with two correlated `EXISTS` per resolved row
(`:4979-5006`, measured 11.1–13.7 s for 496,886 rows).

**7.4 The other derived phases are sound.** Enrichment is O(R) keyset pages with one PK update per
row (`brain-relationship-enrichment.ts:180-728`); gravity is O(S log R) with two indexed probes per
symbol plus five whole-table updates (`:43-117`, measured 3.4–4.1 s for 190k symbols); health is
four aggregates (`project-health.ts:48-169`); taint is one CTE plus per-flow updates. **No derived
phase is O(R×N).** Two blemishes: taint's `LIMIT 10000` (`:5071`) truncates without a truncation
flag, and the function swallows query errors and returns 0 (`:5147-5150`), so a failed taint pass is
recorded as an "ok" phase outcome.

**7.5 The plan's largest intermediate is on disk.** No `PRAGMA temp_store` is ever set
(§6.4), so `_i13_src` — R rows — is a **file-backed** temp table, and the per-edge `ORDER BY` in
§7.1 sorts through disk-backed temp storage too. On a 3.3 GB database with a 16 MB page cache, that
is the un-tuned part of every sort in this review.

**7.6 ANALYZE runs once, late, and stale stats are never repaired.** `ANALYZE` runs at the end of
`runPostProcessing` (`:6472-6480`) — not in the bounded incremental pass (`:6666-6842`), not when
the run is cancelled (`:5916-5917`), and not with `--skip-post-processing`. `ensurePlannerStats`
(`schema-ddl.ts:753-764`) only fires when `sqlite_stat1` is **absent**, on the pre-existing-DB
branch, so present-but-stale statistics are never refreshed on the read path and nothing reports
that a project maintained by `--changed`/`--resume`/`bb_edit` is planning on statistics that
describe an older database. The three documented blowups from missing stats (`_i13_src` 260×,
taint 600×, graph owner-cascade 200–400×) are data-skew dependent; the reviewer reproduced the plan
changes, not the blowups.

**7.7 `--skip-post-processing` can report a healthy index that never had a derived pass.** The run
persists `status: "complete"` (`:5900-5910`, `:6045-6056`) although nothing derived ran, and
`bb_health`'s "Index Completeness" check reads exactly that row (`brain-index-health.ts:287-360`) —
so a deferred index can read HEALTHY. The CLI's own "consistency" line counts only rows with no
external identity on either end (`:5194-5214`); the **34,646 rows on this repo that carry
`target_external` and a NULL target** are not counted, so it can print "every internal relationship
is attached to a symbol" over tens of thousands of unattached internal edges. The `--post` help
lists five phases; the code records eight (`:6353-6480`).

**7.8 Embeddings: capped by product design, invisible until the summary.** The queue cap is 25,000
(`BB_EMBEDDING_QUEUE_LIMIT`, `:2110`) and a single batch over `BB_EMBEDDING_BATCH_LIMIT` (50,000) is
dropped whole (`:2453-2457`). Overflow drops are logged at **debug** level only (`:2462`) and
surface solely in the end-of-run line "N dropped (queue cap)". The drainer is serial, chunked at 100
vectors, one transaction per chunk, with a tf-idf fallback for the rest (`:2662-2704`); it never
blocks the index but keeps the process alive (measured ~10 min of silent tail, now announced and
bounded). Two models in one index is **by design** (`:2143-2147`); search filters by the *query's*
model (`semantic-search.ts:191`) and falls back to keyword search with reason
`no-matching-model-embeddings`, so the other model's vectors are invisible rather than merged. The
summary warns about it (`cli/index.ts:368-380`).

---

## 8. Progress, ETA, and the messages a user reads

All from `src/cli/index-progress.ts` (313 lines) plus the indexer's own framing line.

1. **The ETA is a cumulative average and ignores everything after parsing.**
   `estimateRemainingMs` (`:116-124`) is `(elapsed / processedFiles) × remaining`, with a single
   guard `elapsed < 1000 ms`. Consequences measured in this session's own logs: the ETA slid
   33m → 25m → 19m → **8m** → 25m → 14m → 20m as the file mix changed, and at `100%` it prints
   `eta=0s` while the derived phases and the embedding tail still lie ahead — in the measured
   run, files finished at 5 m 33 s and the command ended at 15.1 min, i.e. the ETA called it
   done two-thirds of the way early. It also inherits the attempt-vs-file counter (§5.6), so a
   run with retries can show >100%. A windowed rate and a phase-aware remainder (parse vs
   derived vs embedding queue) would both be honest; today's number is not.
2. **The size bands exist and are sensible — except at the small end.**
   `expectationFor` (`:100-105`): 0 → "nothing to index — the index is already up to date",
   <150 → "this is a small project — a few minutes at most", <4,000 → "this will take a few
   minutes", ≥4,000 → "large project — this takes a while. Grab a coffee; bb keeps working in the
   background". Measured verbatim on a 7-file project: *"Indexing 7 files — this is a small
   project — a few minutes at most"* (it finished in ~2 s). The module docstring promises a
   "a moment" band that does not exist in the code.
3. **Encouragement fires at thresholds that are absurd on small projects**, and one branch is
   dead. `encouragementFor` (`:52-64`) announces "a quarter of the way in" at ≥25% — measured at
   **1 of 7 files**. Its last two lines (`if (isBigProject && pct < 10) return null` / `return
   null`) are equivalent, so the branch the comment describes is unreachable.
4. **The non-TTY milestone rate limit is dead code.** `renderNonTtyLine` (`:270-296`) computes
   `dueByTime` from `nonTtyIntervalMs` but then returns whenever `bucket === lastNonTtyBucket`,
   so wall-clock alone can never emit a line — the documented "AND by wall-clock, so neither a
   very long run nor a stalled run floods the log" is not what the code does. This is also why a
   250-second parent stall produced *no* output at all in the logs (§2 of the perf work).
5. **"Longer than we expect" fires on healthy runs.** `finish()` (`:298-313`) prints "That took
   … — longer than we expect. If it felt like it hung, that is worth reporting" at ≥5 min
   regardless of project size. Measured on the *healthy* 5,086-file run: "That took 7m 7s —
   longer than we expect." The threshold should scale with the discovered file count (or the
   wording should be neutral), otherwise the product tells users something is wrong precisely
   when it is not.
6. **What is good and should be kept**: the "nothing to index — already up to date (N unchanged,
   0 skipped, 0.2s)" path with its per-bucket breakdown; the `[index] <pct>% … elapsed=… eta=…`
   non-TTY line shape; the one-line-per-5% behaviour; the fixed-width TTY bar; the honest
   "Indexing N files — …" framing emitted once; and the summary's explicit
   `0 newly parsed | 7 unchanged | 0 errors | 0 timeouts` accounting.

---

## 9. The flag surface

`bb index --help` exposes eight options: `--force`, `--no-setup`, `--skip-post-processing`,
`--post`, `--file <path>`, `--changed`, `--resume`, `--import <db>` (`cli/index.ts:4-11`).

1. **`--exclude` does not exist, though the indexer documents it.** `parallel-indexer.ts:1073`
   reads *"Load CLI --exclude patterns (comma-separated globs)"* and `excludePatterns` is
   threaded through — but no CLI option sets it, so `.bbignore` is the only user-facing exclusion
   mechanism (and per §4.1 it cannot undo a directory-name skip).
2. **Concurrency is not overridable.** `ParallelIndexerConfig.concurrency` (`:125`) has no env or
   CLI knob, so a user cannot cap workers on a loaded machine, ask for deterministic
   single-worker runs, or raise it on a big host past the hard 12 cap.
3. **`--force` keeps the file** (documented at `cli/index.ts:167-170`, deliberately, so a live MCP
   server's handle stays valid). Space is reclaimed instead by the wipe-path checkpoint + VACUUM
   (`src/ast/index-space.ts`), which now decides on rows deleted rather than on `freelist_count`.
4. **No `--json` / `--quiet`**: the index command speaks human text only, so scripting it means
   parsing prose. (`bb show`/`bb stats` cover some of this outside the index path.)
5. The remaining flags match their documented behaviour, including `--resume` reading the live
   checkpoint and `--changed` costing seconds on an unchanged tree (verified: 0.2 s, "nothing to
   index").

---

## 10. What I would fix, ranked

**Correctness first — small diffs, large consequences:**

1. `worker.on("error", …)` on pool workers: one line, prevents a whole-run death (§5.1).
2. Count a pre-`ready` exit toward `startupFailures`: prevents an infinite fork loop (§5.2).
3. **A failed store batch must fail the run.** Today a full disk rolls back batch after batch,
   skips them, and still prints `✓ indexed N files…` (§6.3.1). Count the skips, persist
   `partial`/`failed`, exit non-zero.
4. A rolled-back batch must not persist `status: "complete"` (§6.3.2) — `errorFiles` only counts
   parse outcomes today.
5. **Resolve targets from memory instead of one sorted SELECT per edge.** `O(R × C log C)` sits on
   the critical path in `dbFlushMs` (§7.1): the data is already in `nameToSymbol`, and the
   `_i13_best_*` aggregates exist for exactly this ranking. This is the biggest algorithmic win
   available, and it is the term the linear plan was written to remove from the other pass.
6. `largestIntermediate` must include `_i13_src` (§7.2): the gate's clock-free check divides a
   number that omits a table of R rows by R.
7. Stop storing every vector twice — drop the JSON column's write, or the column (§3.1): ~660 MB
   and a large share of embedding write time.
8. `shouldSkip` needs negation, and `bin`/`env`/`out`/`gen`/`deps` must leave the *segment* list
   (§4.1): four real source trees in this repository are invisible today and unfixable by any
   ignore file.
9. Add `.mts`/`.cts` to the language map and delete the dead `extensions` list (§4.2): 490 tracked
   files in this repo.
10. `--skip-post-processing` must not persist `complete`, and the "consistency" line must count the
    edges that carry an external identity but no target — 34,646 of them here (§7.7).
11. Taint must surface its 10,000-row truncation and must not swallow a query failure as an "ok"
    phase outcome (§7.4).

**Then the honest surface:**

12. Phase-aware ETA: parse remainder + derived phases + the embedding queue, a windowed rate, and
    "…" until there is signal (§8.1).
13. Message bands: a "seconds/a moment" band below ~50 files, and a "longer than we expect"
    threshold that scales with the discovered file count (§8.2, §8.5).
14. Delete the dead branches in `encouragementFor` and `renderNonTtyLine`, or make them do what
    their comments claim (§8.3, §8.4).

**Then space and throughput:**

15. Defer the 14 relationship indexes (549 MiB) and 10 symbol indexes (127 MB) during a full load
    and build them once at the end, inside the run (§3.2, §6.2) — less write amplification per
    insert, which is what `dbFlushMs` is made of.
16. Tune the bulk load: `temp_store = MEMORY` (the biggest intermediate and every per-edge sort are
    file-backed today), a real page cache, and `journal_size_limit` (§6.4, §7.5).
17. Bound parent memory and add an IPC high-water mark (§3.3); the in-process fallback retains every
    file result for the whole run, and `fileRelCounters` is never cleared (§7 memory).
18. Add a ≥1,000-file tier to `verify-scaling-linear.ts` and fix the intermediate accounting (§2,
    §7.2) so the gate sees production scale.
19. Reclaim on ordinary runs, not only after `--force`, and move the end-of-run checkpoint after
    the embedding drain (§6.6, §6.3.3) — 858 MiB (27%) of this index is currently never returned.

**Worth deciding deliberately (policy, not bugs):** whether `.d.ts`, fixtures and data formats stay
indexed; whether read-time exclusions and index-time discovery share one list (§4.11-4.12);
duplicate-content detection (§4.10); reporting the in-process 13k/14k clamp (§4.9); and refreshing
stale planner stats on incremental runs (§7.6).

---

## 11. Not covered by this review

- **Not measured:** the split of the 404 s store phase between the per-edge SELECT, 17-way index
  maintenance and the per-file DELETEs. Two reviewers bounded it (their additive estimate exceeds
  the phase, so the proxy over-counts), but no run isolated the terms — that needs instrumentation,
  which is a write.
- **Not observed in production:** §5.1's EPIPE ordering and §5.2's crash-before-`ready` loop. Both
  are demonstrated at the Node/code level with real child processes, not caught in a run.
- **Not measured:** parent peak RSS per 1,000 retained symbols (the mechanism is certain from the
  code; the constant is not), and the same for the in-process fallback's retained results.
- **Not reproduced:** the documented no-stats blowups (260× / 600× / 200–400×). The reviewer
  reproduced the plan *changes* on a schema-identical A/B, not the blowups, whose preconditions are
  data-skew dependent.
- **Not exercised:** the embedding drainer and semantic search on a genuinely mixed-model index
  (read from code plus in-repo measurements); Bun's bundled SQLite (only the Node better-sqlite3
  3.49.2 path was probed, so `TEMP_STORE` may differ there).
- **Out of scope:** LSP/MCP read paths beyond what the discovery pass touched, every language
  analyzer's own parse cost, and why 124,711 edges (25.1%) resolve to no symbol at all — that is
  analyzer work, not indexer work.

## Verification status of this document

| Section | How it was established |
|---|---|
| §1, §2, §3 | Measured on this machine: `brain_index_status.performance_stats`, `dbstat`, `PRAGMA`/`compile_options`, and the committed run logs |
| §4 | A review pass that **executed the real `discoverIndexableFiles`** against synthetic fixtures, plus my own audit of the index against `git ls-files`; I re-read the CRITICAL finding, the no-op logger and the 256 KB truncation myself |
| §5 | A review pass that reproduced the IPC orderings with real child processes; I re-verified both HIGH findings in the source (the only `error` listener is the fork probe's; `clearStartupTimer` is first in the exit handler) |
| §6 | A review pass that ran `EXPLAIN QUERY PLAN` and per-candidate timings on a schema-identical copy and `dbstat`-measured the real index; I re-read its two headline claims (the per-edge SELECT inside the store loop; `largestIntermediate` excluding `_i13_src`) |
| §7 | A review pass with real-database counts/distributions and synthetic timings; I re-read the `largestIntermediate` exclusion and the unguarded per-edge resolve |
| §8, §9 | Read and measured by me, including verbatim CLI runs on 7-file, 205-file and 5,086-file projects |
| §3.1, §6.4, §7.8 | Cross-checked against the reviewers' independent `dbstat`/`PRAGMA` measurements, which agreed byte-for-byte apart from one corrected object count |
