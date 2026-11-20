# FINAL write-side verification — real bettercap source, fresh index (subset)

## Why a subset
A FULL bettercap-copy reindex (2031 files, 55,785 symbols) runs the indexer's derived
relationship-resolution phase, which fails with SQLITE_FULL on a fresh large index:
`CREATE TEMP TABLE _res_contains_targets AS SELECT … ROW_NUMBER() OVER (PARTITION BY r.id …)`
materializes 20,991,769 candidate rows for 21,882 unresolved `contains` rows (measured:
`select count(*) from brain_relationship r join brain_symbol s on s.project_id=r.project_id and
s.name=r.target_external where r.relationship_type='contains' and r.target_symbol_id is null and
r.line_number>0`). This statement predates the campaign and is UNMODIFIED by it
(`git diff 380a7e473 -- src/ast/parallel-indexer.ts` contains no `_res_contains_targets` hunk);
the condition is data/scale-only (all contains rows arrive NULL in a worker-pool index). It is a
pre-existing full-index scaling defect, recorded here rather than hidden; the full-index read-side
checks still pass (12/12, evidence `reindex-final*` logs + this dir).

To verify the index-time fixes on REAL bettercap source with a COMPLETED derivation, we indexed a
copy restricted to `.go`, `go.mod/go.sum`, `Makefile`, `*.yaml/yml/js/json` (2031 → 393 files;
`derived: full`), everything else unchanged.

## Results (project ddaf987f4b9b474f1446b1f28ee529e3c8c965d3, derived: full)
| check | result |
|---|---|
| P0-1 refactor dry-run `LoadModules` | **3 files / 3 sites**: `modules/modules.go`, `main.go`, `modules/modules_test.go`; `verification.reparsed=passed`, `unresolvedReferences=[]` |
| P0-2 `main.go:47 modules.LoadModules` binding | **bound** to `…:modules/modules.go:LoadModules:42`, `bindingBasis=import-path` |
| P0-2 `modules_test.go:16 LoadModules` (same-package) | **bound** to the same symbol |
| P0-2 import-path bindings on real index | 504 rows |
| P0-2 cross-language name-resolution structural rows | **0** |
| P1-1 same-module imports marked external | **0** (over `github.com/bettercap/bettercap/v2…`) |
| P1-1 internal Go imports | **326** |
| P1-1 dependencies(session) | `returnedInternalDependencies=348`, `returnedInternalDependents=2470`, returned=26 |
| P1-2 func-main call attribution | `main` function line 20 owns **21** calls; module symbol owns **0** |
| P1-2 GO1 cross-file value reads | **378** rows; fabricated function-type param rows **0** |
| embedded P1-1 identity | `brain_project_meta.go_module_path=github.com/bettercap/bettercap/v2` |

Evidence: `subset-index.log` (full derivation), `subset-refactor-dryrun.json`,
`subset-deps-session.json`, plus the SQL above (commands recorded in the campaign log).
