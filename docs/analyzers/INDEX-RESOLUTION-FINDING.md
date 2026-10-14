# LIVE-INDEX RESOLUTION FINDING — the unattributed fleet-wide claim, tested

**Status: the claim's DEFECT is not reproducible on the current live index. No change to shared
resolution is justified by it.** Instrument:
`validation/m14/fixtures/index/live-index-resolution-probe.cjs`; raw output
`validation/m14/results/live-index-resolution-probe.txt`.

---

## What was claimed

Commit `9472d1861` (2026-10-09 20:06, "research(toml): the eager-resolve defect is fleet-wide — 882
mis-bindings, 32,359-edge fix, measured") added a section to `docs/analyzers/real-toml-analyzer.md`
but shipped **no instrument**. It asserts, from "this repository's own live index (190,213 symbols,
496,886 relationships)":

| claim | value |
|---|---|
| cross-file dotted edges | 1,543 |
| of those, ignored an **exact-name** symbol in their own file | **882** |
| a same-file-preference change WOULD REPOINT | **32,359** (json 31,785, typescript 105, toml 27, hcl 19, tsx 17, markdown 17) |
| hand-checked example | `validation/m14/issue-urls.json` target `M14.0.F1` → bound to `validation/m14/results/M14.0.F1.json` |

The commit's own author is unattributed: the `toml-lane` owner denies writing it and has no probe
path, and no artifact in the tree reproduces it. A 32,359-edge change to `parallel-indexer.ts` is
shared resolution that every lane's incoming measurements run through, so it needed verification
before anything acted on it.

## Where the index actually is — and the two traps on the way to it

Neither is a footnote; both cost a detour, and the first one is a general lesson.

1. **`node:sqlite` cannot open this file, and lies about why.** `DatabaseSync` returned
   `unable to open database file`, then (after a copy) `0 tables` — on a file whose first 16 bytes
   read `SQLite format 3`. The product uses **`better-sqlite3`**. An instrument that cannot open
   the artefact must not be reported as a finding about the artefact; the probe now uses the same
   driver as the product.
2. **SQLite needs a WRITABLE directory for its temp store.** Opening the live file read-only
   in place fails with `SQLITE_CANTOPEN` even though the header is fine, because the temp store
   cannot be created beside it. Copy the database into the workspace first, then query the copy.
3. **The schema is `brain_*`.** There is no `symbols` or `relationships` table. It is
   `brain_file(id, path)`, `brain_symbol(id, project_id, file_id, name, qualified_name, …)`,
   `brain_relationship(id, …, source_symbol_id, target_symbol_id, relationship_type, confidence,
   context, line_number, is_cross_file, …)`.

**The indexes on this machine** (70 of them; the two that matter):

| index | files | symbols | relationships |
|---|---|---|---|
| `$HOME/.bb/projects/1d3d57103be91b8f9716d70199fe28a3f39245d9/brain.db` — **the live index for this repo** | 5,398 | **199,289** | **512,652** |
| the workspace-local one the claim's test was first run against (`.bb-data/projects/1d3d…)` | 3,776 | 171,343 | 180,552 |

The claim's stated footing (190,213 / 496,886) matches neither exactly; both are close enough that
the claim plausibly read a slightly earlier state of one of them. That is why the verdict below is
about the **current** state rather than about whether the author could have seen those numbers.

## What the current live index says

```
index .tmp-index/live.db  (copy of the live index)
      5398 files, 199289 symbols, 512652 relationships
      claim says 190,213 symbols / 496,886 relationships

cross-file edges (by FILE_ID)                              1660
  ...the same, by the index's own flag                     1660
  claim says                                               1,543
      by type: contains:1660

cross-file edges ignoring a same-file EXACT-NAME symbol    0
  claim says                                               882
bound edges WITH a same-file exact-name candidate          204623
  already pointed there (nothing to repoint)               204623
  WOULD REPOINT = the difference                           0
  claim says                                               32,359 (json 31,785, typescript 105, ...)
edges targeting a symbol named M14.0.F1                    1
  contains   issue-urls -> M14.0.F1   SAME FILE: true
cross-file edges WITH a local exact-name candidate         0  (json null)
  claim's split                                            json 853, markdown 18, elixir 9, lua 4, css 4
```

Read against the claim, item by item:

- **882 mis-bindings → 0.** No cross-file edge in the live index points outside its file while an
  exact-name symbol exists inside it. The counterfactual set is empty, so the same-file-preference
  change has nothing to move on this index. The claim's own hand-checked example no longer holds
  either: `issue-urls -> M14.0.F1` is now bound **inside its own file**.
- **32,359 repoints → 0**, and the parts add up exactly: 204,623 bound edges have a same-file
  exact-name candidate and **all 204,623 already point at it**. The claim's denominator (102,393)
  and its "already pointed there" (70,034) do not reconcile with this index at all — they sum to
  172,427, not to 32,359 + 70,034.
- **1,543 cross-file dotted edges → 1,660**, and every one of them is `contains`. The claim's
  language split (json 853, markdown 18, …) has no counterpart here: the json-heavy cross-file
  population it describes does not exist in this index.

## And the same claim DOES reproduce on the other index — which is the real lesson

Run against the workspace-local index (`.bb-data/projects/1d3d…`), the mechanical prediction
reproduces, including the hand-checked example:

```
cross-file edges (by FILE_ID)                              53394
cross-file edges ignoring a same-file EXACT-NAME symbol    13652
bound edges WITH a same-file exact-name candidate          101840
  already pointed there (nothing to repoint)               88188
  WOULD REPOINT = the difference                           13652
edges targeting a symbol named M14.0.F1                    1
  contains   issue-urls -> M14.0.F1   SAME FILE: false
cross-file edges WITH a local exact-name candidate         13652  (json 13320)
```

So the mechanism is real and the probe is sound — it finds the defect where the defect exists. What
this exposes is **which artefact the claim was reading**: a mixed workspace database, not the live
index. Two consequences worth carrying forward:

1. **`.bb-data` is not the repository's index.** It contains scratch projects from other work
   (`php-owner-res-*`, `php-store-census-*`, `store-resolution-*`), so a query over it is a query
   over a union of unrelated corpora. Cross-file resolution across unrelated projects is not a
   defect; it is what a union of projects looks like. **A fleet-wide claim about THIS repository
   must be run against the live index path.**
2. **The claim's numbers are not a scaled copy of the measured ones.** 882 against a measured
   13,652, and 32,359 against 13,652 — the digits do not correspond to the same quantity on the
   same artefact, so the claim is not simply "the same measurement at a different revision".

## Verdict

**No change to `src/ast/parallel-indexer.ts` or `src/ast/pool-worker.ts` is justified by
`9472d1861`.** On the current live index the defect it describes is absent: 0 of 1,660 cross-file
edges ignore a same-file exact-name symbol, and 0 bound edges would repoint.

The section it added to `docs/analyzers/real-toml-analyzer.md` is left in place but must be read as
**unreproduced**: its numbers describe a different artefact from the one it names. Anything built on
it — including the "1,267 applicable toml sites waiting on the refusal half" — inherits that.

**A second, narrow finding stands on its own** and is not affected by any of the above: the *toml
workspace-inheritance* question is real, was measured by `toml-lane` as **1,269 sites in 138
documents** (`TOML-G1`), and is recorded as an OPEN item rather than as a ruling. That item needs no
fleet-wide justification — it is a statement about toml sites in this corpus.

## How to re-run

```bash
cp $HOME/.bb/projects/1d3d57103be91b8f9716d70199fe28a3f39245d9/brain.db .tmp-index/live.db
node validation/m14/fixtures/index/live-index-resolution-probe.cjs .tmp-index/live.db --index
```

`--index` builds four covering indexes **on the copy** (the product's own index carries none, which
takes a 500k-row correlated `EXISTS` from seconds to minutes). Never point `--index` at the live
file; the probe opens read-only unless asked to index.
