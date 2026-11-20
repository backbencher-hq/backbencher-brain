# FULL-SPECIMEN reindex proof — including receiver-type evidence and validated test_impact

(Run with commit `560301bb9`: bounded contains resolution + durable embedding outcome + Go receiver evidence +
validated test_impact.)

Specimen: `/home/ishaq2321/bettercap` (read-only; the harness indexes a copy). Code: this tree with the
bounded contains-target resolution, durable embedding-run outcome, and the C# guard. Harness:
`docs/bb-bettercap-fix/tools/final-bettercap-reindex.sh` (run with `node bin/bb`, local vectors only).

## Result — index completes (this failed with `SQLITE_FULL` before the fix)
- `index exit=0`; 1,972 of 1,973 files written (1 deliberate >5 MB size-tier skip, declared in health)
- **544 calls bound through a declared Go receiver type** (`bindingBasis=receiver-type`) — genuine
  project-receiver selector calls that were previously unresolved and therefore invisible to
  callers/impact/test evidence (sample: `f.sysCtlRead`, `f.enableParam`, `sess.Register`, `f.EnableForwarding`)
- **55,785 symbols, 111,786 relationships, 1,948 imports, 23,925 embeddings**; `derived: full`
- full run wall: 130.6 s; `last_embed_outcome` persisted: `{"queued":23951,"embedded":23951,"failed":0,"skipped":0,"dropped":0,"invalid":0}`
- harness assertions: **12 pass / 0 fail** (P0-2 no bound cross-language name-resolution rows and all
  candidates ≤0.5; P1-2 cross-file value reads 378, zero fabricated param rows, package-main calls on
  `main` 21/module 0; P1-1 same-module imports external 0, internal 327, dependencies(session)
  internal+dependents; cross-language read surface all candidates)
- read-time symptom script on the NEW index (index-time checks enabled): **38 pass / 0 fail / 2 deferred**
- health on the NEW index: files 1,972 / symbols 55,785 / relationships 111,786 / imports 1,948;
  freshness complete; `embeddings: … last run: 23951 embedded`; derived status names the deliberate
  1-file skip (`status=incomplete (recordedStatus=complete contradicts the counts)`), and
  `SKIPPED_FILES` explains why `force` will not fix it
- `bb_doc symbol Session` → single subject (copies 5, declaration-kind); `bb_search symbol Session` →
  `<projectId>:<path>` `fileId` + `absolutePath`; `test_quality session` aggregate 0.488095;
  `test_mapping session` on the fresh index: tested 18 / links 127 / **unvalidated 0** (the 137
  declared-unvalidated rows measured on the frozen pre-fix index are now resolved at index time by
  the package-scoped Go binding — the quality gate still declares the reason taxonomy when present)

## Why the old form failed
`CREATE TEMP TABLE _res_contains_targets AS … ROW_NUMBER() OVER (PARTITION BY r.id …)` over every
same-named symbol project-wide produced 20,991,769 candidate rows on this specimen (21,882 unresolved
`contains` rows × ~959 candidates) and the statement aborted the whole index with `SQLITE_FULL`.
The replacement keeps the identical winner ORDER BY but resolves per row through bound parameters in
one transaction (SQLite refuses correlated references to the UPDATE target inside a scalar subquery's
ORDER BY — the direct translation is why the first attempt failed), so no candidate cross-product is
ever materialized. Measured: 1,972-file index completes in the normal run time.

Evidence: `evidence/final/full-index/` (`reindex.log`, `harness.txt`, `read-checks.log`, `health.txt`,
`read-checks/`, `e2e/`, `crosslang-new-index.json`, `deps-new-index.json`, `m14-systems-gate.txt`).
