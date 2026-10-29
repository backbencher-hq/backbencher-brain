# PROPOSAL (clean) — the import file claim's third candidate spelling: a project-wide search

**From:** clean lane owner · **date:** 2026-10-29 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `src/ast/real-clean-analyzer.ts` (this lane's own file) — one candidate list in the PASS 3
claim pass. Nothing shared, nothing Lead-owned.
**Status:** MEASURED, PRICED, **NOT TAKEN**. The lane's per-file contract and the F perf budget are the
two reasons, and both are stated below rather than implied.

## 0 · WHY THIS EXISTS

Clean finds a module's file on a **search path**, not at the project root. The analyzer's import file
claim (`importProjectFile`) can only spell two candidate sets without a project file list:

| spelling | description | verified on the 312-file population |
| --- | --- | --- |
| A | `Module/Sub.{icl,dcl}` at the project root | **438** — every hit a file that DECLARES the module |
| B | + the importing file's **own directory** | **136** — every hit declares the module |
| C | + **anywhere** in the project (leaf `Sub.{icl,dcl}`) | **243** — every hit declares the module |
| — | no candidate | 1,115 |

A and B are implemented (2026-10-29); the arm's `imports` row reads 891 verified claims (574
`importProjectFile` + 317 `moduleNamespace`), extFAIL 0. The 222 edges in the ruling
`import-module-file-on-a-search-path` are what C would answer.

Instrument: `validation/m14/fixtures/clean/import-claim-pricing.mts`
(`--json validation/m14/measurements/clean/import-claim-pricing-2026-10-29.json`).

## 1 · THE LEAF-AMBIGUITY QUESTION IS SETTLED, AND IT IS NOT 243

The pricing instrument's own counter (`of C, basename NOT unique in project`) reads **243**, and it is
**wrong as a wrong-file measure**: a module's `.icl` + `.dcl` pair is TWO files with one basename, so
every C hit with both halves scored as "not unique". Re-measured properly (distinct DIRECTORIES holding
`<leaf>.icl`, a one-off probe over the same admitted list):

```
A 438 · B 136 · C-unique-leaf 239 · C-ambiguous-leaf 4 · none 1115 · total 1932
```

The four ambiguous edges are all eastwood's `Linter`, which exists at **both** `src/linter/Linter.icl`
and `test/suite-default/Linter.icl`. So a search that DECLINES a leaf found in more than one directory
would claim **239 edges and 0 wrong files**, not 243.

## 2 · WHAT IT WOULD COST

- **A recursive walk per project root**, cached for the process (the arm: 5 walks, one per repository;
  production: one per project per pool worker). Clean's repos are small (74–109 files); a large project
  is the open question, and this lane has **no F baseline row** for `Clyde:clean` yet
  (`CLEAN-STATE.md` §5 — the row is the Lead's central sweep), so the cost cannot be measured against
  the budget it would be charged to.
- **The claim's evidence basis.** The guard confirms a candidate with `statSync` (disk), while the
  gate's `ProjectFacts.files` is the git-tracked admitted list. The two agree on this corpus — measured
  per repository: clean-stdlib 74/74, Prelude 42/42, Clyde 109/109, eastwood 73/73, cloogle.org 14/14 —
  so a C claim could not refute here. It could elsewhere, and `extFAIL` is the column that would pay.
  **Re-measured 2026-10-29 for UNTRACKED source:** `git ls-files --others --exclude-standard --
  '*.icl' '*.dcl'` is **0 in all five repositories**, so on this corpus a walk and the admitted list
  agree exactly. The limit is production-shaped (Clean's `_build` output is untracked by default), and
  it is why the honest form of this proposal needs the driver to PASS the admitted list rather than a
  walk to guess it.
- **A new filesystem capability in a per-file analyzer.** The file's contract is pure tree-sitter
  extraction plus the shared guard's `statSync`; a directory walk is a new class of work for it, and the
  lane would have to state it in the analyzer's doctrine rather than let it appear as one more
  `extraCandidates` entry.

## 3 · WHAT IT WOULD BUY

`imports` unresolved 1,041 → **802** (`-239`), `import_module_file_on_a_search_path` retired to 0, and
the three import classes reduced to 59 module-in-another-project + 760 module-declared-nowhere (both of
which are TRUE and not claimable). The lane's verdict stays FAIL — clause 1 needs the whole 3,871-row
wall — so this is **headroom, not closure**.

## 4 · THE ALTERNATIVE TAKEN NOW

None. The 222 rows are counted and ruled, with a falsifier that would retire the ruling if a bucket
assignment is wrong. A lane that published the claim WITHOUT the confirmed candidate would be back to
2026-10-28's 1,177 refutations, which is the defect this round removed.

## 5 · IF THE OWNER WANTS IT

1. Build `Map<root, Map<leafBase, string[]>>` lazily (one walk per root, `readdirSync` with
   `withFileTypes`, admitted extensions only, the 1 MB cap applied).
2. Pass the unique-directory hits as `extraCandidates` after A and B; **decline when the leaf resolves in
   more than one directory** (the 4 `Linter` edges stay unclaimed).
3. Re-run the arm and require: `imports` extFAIL **0**, unresolved **802**, `extOK 1,130`; then re-run
   `residual-cause-census.mts` and retire the ruling with its new count.
4. Record the walk in the analyzer's header doctrine and in `docs/analyzers/real-clean-analyzer.md`, and
   price it against `Clyde:clean` once the F row exists.
