# Branch unification, 2026-10-14 — how two `main`s were reconciled

## What happened

`origin/main` was **force-pushed** on 2026-10-13 14:26 after this laptop had
pushed at 04:06. The local tracking ref recorded it plainly:

```
2230e4309 refs/remotes/origin/main@{0}: fetch origin: forced-update
60da94020 refs/remotes/origin/main@{1}: update by push      <- my push
```

So `main` had **two lineages with no common history since 2026-08-13**, and
neither contained the other:

| ref | commit | commits since fork | date |
|---|---|---|---|
| this laptop's `main` | `60da94020` | 6,897 | 2026-10-13 04:06 |
| `origin/main` | `2230e4309` | 14,677 | 2026-10-13 14:26 |
| fork point | `ef12f02ca9` | — | 2026-08-13 03:13 |

`2230e4309` is itself a merge whose message reads *"main becomes a PARENT, so
its 6,954 commits are in this history and nothing is discarded."* That claim
was true of the `main` the other laptop could see. It did not account for the
6,897 commits that had been pushed afterwards and then overwritten.

**6,897 commits existed on exactly one laptop.** Before anything else they were
made durable off-laptop, on a **new branch** (no force, nothing overwritten):

```
git push origin HEAD:refs/heads/rescue/local-main-60da94020   # exit 0
git ls-remote origin refs/heads/rescue/local-main-60da94020   # 60da94020...
git ls-remote origin refs/heads/main                          # 2230e4309... (unmoved)
git tag safety/local-60da94020-20261014-2022 HEAD
```

## How the merge was resolved, and why

`git merge-tree --write-tree HEAD origin/main` (a dry run that never touches the
worktree) reported **685 conflicted files**: 644 `add/add` and 41 content
conflicts. Nothing was identical, so there was no free lunch to collect.

Both sides were then measured before any resolution was chosen, because
"take theirs" and "take ours" are only safe when you know what the other side
already contains. Measured, not assumed:

| probe | result |
|---|---|
| `script/m62` gate inventory | mine 32, theirs 32 |
| `script/m61` gate inventory | mine 35, theirs 35 |
| `script/` files present only in my tree | **0** |
| `src/brain/brain-relationship-enrichment.ts` `ENRICHMENT_OWNED_KEYS` | present in theirs |
| `src/ast/pool-worker.ts` `safeSend` | present in theirs |
| `script/m24/verify-closure.ts` byte-identical guard | present in theirs |
| `script/m62/verify-check-arg-order.ts` | present in theirs |
| `script/m62/verify-handwritten-type-copies.ts` `typeof import` anchoring | present in theirs |
| `script/m62/verify-duplicate-cores.ts` direction report | present in theirs |
| `script/m26/graph-core.ts` `exact-exempt-kind` | **ABSENT from theirs** |

The two fleets converged. With **zero** `script/` files exclusive to my tree and
identical gate inventories, `origin/main`'s version is the newer evolution of
nearly every conflicted file, and it is the version that already contains the
work. So all 685 conflicts were resolved to `origin/main`'s side.

### What "resolved to theirs" does and does not mean

It does **not** delete anything. The merge commit keeps **both** parents, so
every line of both lineages stays reachable:

```
git show rescue/local-main-60da94020:<path>    # my side, still there
git show 2230e43091b:<path>                    # their side, still there
```

That is why no rebase, no amend and no force-push were used, and why the push
that follows is an ordinary fast-forward: `origin/main` becomes an **ancestor**
of the new tip, so the other laptop's next `git fetch` sees no forced update and
cannot lose anything again.

### The one thing that was NOT in theirs, and was re-landed

`script/m26/graph-core.ts` announced an **exact hit** as a substitution. The
engine's union includes `exact-exempt-kind`, which is an exact hit, and the
renderer reached its "this is only a substitute" branch for it. Fixed in
`527f9bba5` after being found by anchoring rather than by inspection. Absent from
`origin/main`, so it was re-landed on top of the merge as its own commit.

## Post-merge verification (the numbers, and what they mean)

Merge-resolution code in this repo has previously shipped with unbalanced braces,
because a regex matching `evidence: {` also matched runtime object literals.
So the tree was measured before the merge was committed, and the measurement is
an A/B against `origin/main`'s own tree in a clean worktree:

| check | merged tree | `origin/main` tree (baseline) | verdict |
|---|---|---|---|
| `tsc` parse-level errors (`TS1xxx`) | 6 | 21 | merge added **0** new |
| `tsc` total errors (`script/`) | 661 | 720 | −59 |
| `tsc` files with errors | 203 | 208 | −5 |
| `tsc` errors (`src/`, `tsconfig.json`) | 0 | — | clean |
| conflict markers anywhere | 0 | — | clean |
| conflicted files resolved | 685 / 685 | — | 0 unmerged entries remain |

The 6 surviving parse-level errors are **pre-existing in `origin/main`**
(`TS1117` duplicate keys in `m25/run-vscode-e2e.mts`, `m28/verify-governance.ts`,
`m29/verify-analyzer-relevance.ts`, `m61/verify-sealing.ts`; `TS1064` in
`m30/verify-setup.ts`; `TS1533` in `m60/lua-conformance-probe.ts`). They are
recorded here rather than silently fixed, because fixing them is a separate
change that needs its own gate, not something to smuggle into a merge.

A naive brace-balance scan reports ~600 files "unbalanced". All of them are
generated tree-sitter grammars and regex/regex-heavy probes that the scanner
mis-parses; **none was a conflicted file**, and `tsc` parses every file in the
tree. The scan is not evidence of damage and is not cited as such.