# Final review — one branch, no tags, no stash, nothing lost

**2026-11-01.** Every claim below was measured in this session after the cleanup, on `main`.

## 1. The odd refs you saw ("no tail and no head")

They were **broken worktrees**, and they are gone. After the branch deletion, 24 worktrees under
`$HOME/mcp/bb-lanes/` still pointed at branches that no longer existed, so `git worktree list`
printed them as **`000000000 [analyzer/CLEAN]`** — a HEAD with no commit, i.e. no tail and no head. Their
administrative entries were removed and `git worktree prune` run:

```
worktrees now: 1   ($HOME/mcp/backbencher-brain [main])
```

Their directories under `$HOME/mcp/bb-lanes/` are outside this session's writable workspace, so
`rm -rf $HOME/mcp/bb-lanes` still needs doing from a shell that can write there; git no longer
tracks them either way. **Also present and NOT branches:** 19 `refs/agents/<uuid>/checkpoints/turn/N` refs
— the agent runtime's own session checkpoints, harmless, left alone.

## 2. Ref state, after

| namespace | before this review | after |
|---|---|---|
| local branches (`refs/heads/`) | 1 (`main`) | **1 (`main`)** |
| remote branches | 1 (`main`) | **1 (`main`)** |
| tags | **123** | **0** |
| stash | **1** (HTML fixture WIP) | **0** — patch exported to `.git/stash-0-html-fixture-2026-11-01.patch` (29,182 lines) before dropping |
| worktrees | 25 (24 broken) | **1** |
| agent checkpoint refs | 19 | 19 (runtime state, not branches) |

Remote tags: 127 deleted (`git push origin --delete`), `git ls-remote --tags origin` now prints nothing.

## 3. Nothing was lost — and the audit found real work that WAS at risk

Deleting 123 tags made **105 tag tips unreachable from `main`**. Two safeguards were put in place
*before* the tags went:

1. **A complete-history bundle** — `.git/archive-pre-tag-delete-2026-11-01.bundle` (359 MB,
   `git bundle verify` → *"The bundle records a complete history"*), containing every ref that existed at
   cleanup. It is local-only (inside `.git/`, not pushed, not a ref).
2. **A recovered-code archive committed to `main`** — `archive/unmerged-pre-merge-2026-11-01/`.
   Every deleted tip was scanned for files `main` lacks (`git diff --diff-filter=A main <tip> -- src
   script`): **164 code files** qualified and were reproduced byte-for-byte under their original paths,
   with `MANIFEST.json` recording the source tip SHA for each. `README.md` groups them: the LSP hover
   layout cache (`src/lsp/hover_cache.ts` + 3 verifiers), the evidence-batch/pinned-truth harness
   (`script/lib/*`), visualization renderers, graph `id-compaction`, the matlab/vba lane instruments, and
   m31/m44/m61/m62 wave scripts. **This directory is not compiled and not imported** — it is a durable
   record for a decision (adopt some / adopt all / discard), not a build input.

The earlier local-only audit (2,019 commits reachable only from five local refs) is covered by both: their
tips were tagged before cleanup and are inside the bundle.

## 4. The 50 analyzers are 100% — measured after every step of the cleanup

| check | command | result |
|---|---|---|
| all/all coverage | `bun script/m14/coverage-block-gate.ts` | **50/50 lanes declared, 0 blocks with problems, 0 uncited silence** |
| DONE conditions | `bun script/m14/completion-gate.ts` | **50 lanes · 50 at n/n · 50 DONE**, self-test 3/3 |
| incoming/outgoing at construct level | `bun script/m14/run-fixtures.ts` | **all fixtures pass** (no baseline regressions) |
| no-regex (DONE condition 6) | `bash script/m14/no-regex-gate.sh` | **PASS — 0 regex literals, by AST census** |
| typecheck | `npx tsc --noEmit` | **0 errors** (main config), 0 (scripts config) |

And the artifacts are all present, one per lane: **50 analyzers, 50 declarations, 50 specs**, 53 fixture
directories.

## 5. What a future session should do with this page

- `git fsck` / git's 2-week prune grace and the 359 MB bundle are the recovery path for any deleted tip;
  `git bundle list-heads .git/archive-pre-tag-delete-2026-11-01.bundle` names every one.
- The recovered archive needs an owner decision; nothing else in the repository depends on it.
- `rm -rf $HOME/mcp/bb-lanes` remains the one manual step (outside this session's sandbox).
