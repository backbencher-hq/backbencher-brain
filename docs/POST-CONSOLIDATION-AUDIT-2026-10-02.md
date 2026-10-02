# Post-consolidation audit — what is actually red, and what is not ours

Written 2026-10-02, after the branch consolidation merged two independently
advanced lines into `main`. This records what is broken **and** whether the
consolidation caused it, because "CI is red" and "the merge broke it" are very
different problems with very different fixes.

## The short version

`main` is green where it can be: `npx tsc --noEmit` reports **zero** errors,
`npm run build` succeeds, `npm test` passes. Two CI checks fail and **neither
is caused by the merge** — both fail identically at `origin/main`'s pre-merge
tip (`3ae8355dd`), verified by running them in a worktree at that commit.

## CI failures, and their actual cause

| Check | Fails at `3ae8355dd` (pre-merge) | Fails on `main` (post-merge) | Same failure? |
|---|---|---|---|
| `verify` → M30.Q1 rate-limit resilience | yes, 3 FAILs | yes, same 3 FAILs | identical |
| `protected-paths` → P4 perl invariants | yes, 5 missing strings | yes, same 5 | identical |

**M30.Q1** fails on 429/5xx fallback to local word vectors
(`src/brain/semantic/engine.ts`). The consolidation did not touch that file.

**lane-protection P4** demands five strings in `script/m14/differential.ts` that
`validation/lane-protection/content-invariants.json` requires:
`derivePerlEdges`, `lang === "perl" ? ["contains"]`, `lang === "perl" ? ["calls"]`,
and two `PIN_BASELINE_FROM_SCOPE` forms. **None exists in either merge parent.**
The invariant file is byte-identical on both parents (`sha 11bfcc7aed21`), so
`origin/main` was already violating its own lane-protection contract before the
merge. This is a real defect in the perl lane's governance, not merge fallout.

Note this gate exists precisely to stop a merge from silently deleting a closed
milestone's artifacts — and it is correctly reporting that something deleted
perl's differential oracle. Worth finding out when and by what.

## The staleness that IS ours

Generated evidence was resolved during the merge by taking one side wholesale,
so it describes a tree that no longer exists. Measured, not assumed:

```
bun script/m12/verify-differential-freshness.ts
  FRESH 0 · STALE 43 · UNPINNED 5 · exit 1
```

Also red, all pre-existing or merge-adjacent:

| Gate | Result |
|---|---|
| `script/m29/verify-precision-ledger.ts` | FAIL — inputsHash drift (pre-existing, dated 09-29, **not** merge-caused) |
| `script/m49/verify-census-lineage.ts` | FAIL — 38/84 unanchored |
| `script/m49/verify-evidence-identity.ts` | FAIL — incl. `M14.0.F5.fsharp.json` never written |
| `script/m49/verify-evidence-lineage.ts` | FAIL — 95/5 |
| `script/m41/generate-site-truth.ts --check` | FAIL — DRIFT |

**The gate built to catch exactly this — artifact staleness after a merge — does
not run in CI.** `verify:fast` (CI's subset) contains zero staleness checks
against `validation/`; `ci.yml` deliberately keeps the full chain local. So the
merge-induced staleness is invisible to CI, while the two visible CI failures
are older problems.

Corpus-backed regeneration is currently **blocked**: `core.async` and `metabase`
are absent from `$HOME/fixtures/repositories`, and `clojure` is at the
wrong revision. Any Clojure F5/F7 corpus gate will fail on a truncated corpus
until they are restored per `validation/m14/corpus-pins.json`.

## Evidence stamps pointing at commits nothing keeps alive

165 distinct commit stamps are recorded across `validation/`. 143 are ancestors
of `main`. **19 were reachable from no ref at all** — one `git gc` from being
gone, which would leave artifacts citing commits that no longer exist.

They are now pinned as lightweight tags under `artifact-stamp/<sha12>`. Tags, not
branches: they add no branch noise, push by default, and read unambiguously as
"a stamp, not a branch to work from".

```
git for-each-ref refs/tags/artifact-stamp/
```

**Two stamps cannot be pinned** — the objects do not exist in this repository at
all, so no ref can be made to point at them:

- `14bc667923c4` — `validation/m31/wave2/results/G3.json`
- `1eafbdec535c` — `validation/m12/results/protobuf-corpus-errors.json`

Those two artifacts cite history this clone does not have. They are either from a
clone that was never pushed or were lost before this consolidation. Treat the
measurements in those two files as unverifiable.

## What is genuinely fixed

- `npx tsc --noEmit`: 21 → 0. Two were live runtime bugs (a bare `return` that
  exited `analyze()` with `undefined` in the zig lane; a `ReferenceError` on
  `${line}` in the Solidity lane's NatSpec diagnostics).
- `main` is protected: force-push and deletion disabled. The force-push is what
  excluded 232 commits from `main` in the first place.