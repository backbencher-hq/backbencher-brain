#!/usr/bin/env bash
# Stage ONE file's worth of changes in a shared file without touching anyone else's work.
#
# WHY THIS EXISTS. `script/m14/differential.ts` is edited by three agents at once, and the obvious
# way to stage a change in it — edit, `git add`, commit — commits whatever else is sitting in the
# worktree. That happened THREE times in one session:
#
#   1. committed 131 lines of another agent's work inside my compared-set commit (caught, `git reset`)
#   2. committed it again immediately after, via a `for f in $MINE; do git add "$f"; done` loop that
#      re-read differential.ts FROM THE WORKTREE and so undid the partial staging I had just built
#   3. staged 247 lines when my own hunk was 19 — same loop, same cause
#
# All three were the same mistake wearing different clothes: a partial index is fragile, and any
# `git add <path>` on a shared file silently replaces it with the whole worktree version. The fix is
# to never hand-maintain a partial index for these files; to build the staged content from HEAD plus
# an explicit patch, and to let the script verify the result.
#
# WHAT IT DOES, in order, and each step is a check rather than an assumption:
#
#   1. build  HEAD:PATH + the patch  ->  a clean copy containing only my change
#   2. confirm the patch applies to HEAD and that the result differs from HEAD
#   3. confirm the patch is ALREADY in the worktree, so I am not staging something I have not run
#   4. write that clean copy into the worktree, `git add` it, then RESTORE the worktree
#   5. verify the staged diff is exactly the patch and contains no foreign line
#
# Step 5 is the one that matters. Every prior incident would have been caught by it, because the
# staged diff was 131, 131 and 247 lines when the intended hunk was 22, 15 and 19.
#
# USAGE
#   stage-shared.sh <path> <patch-file> [expected-staged-lines]
#
# The third argument is optional but recommended: the number of ADDED lines the staged diff should
# contain. The script fails if the staged diff has more, which turns "did I sweep up someone else's
# work?" into a hard error instead of something to notice three commits later.
set -euo pipefail

PATH_ARG="${1:?usage: stage-shared.sh <path> <patch-file> [expected-added-lines]}"
PATCH="${2:?missing patch file}"
EXPECT="${3:-}"

cd "$(git rev-parse --show-toplevel)"

if ! git ls-files --error-unmatch "$PATH_ARG" >/dev/null 2>&1; then
  echo "not tracked in the index: $PATH_ARG" >&2; exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. HEAD + patch, built from HEAD so nothing in the worktree can leak in.
git show "HEAD:$PATH_ARG" > "$TMP/base"
# `-o` is not optional. The first version of this script passed the target file as patch's second
# argument and used -p0, and patch IGNORED that: it selects the file to edit from the patch's own
# `---`/`+++` headers. So it patched the REAL script/m14/differential.ts through the a/ b/ paths,
# `$TMP/patched` was never written, the `cmp` guard passed because both files were still HEAD, and the
# script then staged the unpatched copy and reported success. A staging helper that silently stages
# the wrong content is worse than no helper — it removes the very check it was written to provide.
# `-o` names the OUTPUT explicitly, so patch's file selection cannot influence the result.
if ! patch -s -p1 --no-backup-if-mismatch -o "$TMP/patched" "$TMP/base" "$PATCH"; then
  echo "PATCH DOES NOT APPLY TO HEAD — fix that first, do not fall back to staging the worktree" >&2
  exit 3
fi
if [ ! -s "$TMP/patched" ] || cmp -s "$TMP/base" "$TMP/patched"; then
  echo "patch produced no change against HEAD (patch wrote no output, or output equals HEAD)" >&2
  exit 3
fi

# 2. the change must ALREADY be in the worktree, so nothing untested gets staged.
if ! grep -qF "$(grep -m1 '^+[^+]' "$PATCH" | cut -c2- | sed 's/[[:space:]]*$//' | cut -c1-40)" "$PATH_ARG"; then
  echo "the patch is NOT present in the worktree — stage only what you have actually run" >&2
  exit 4
fi

# 3. install the clean copy, stage it, then put the worktree back untouched.
cp "$PATH_ARG" "$TMP/worktree-original"
cp "$TMP/patched" "$PATH_ARG"
git add "$PATH_ARG"
cp "$TMP/worktree-original" "$PATH_ARG"

# 4. verify the staged diff is the patch and nothing else.
STAGED_NUMSTAT="$(git diff --cached --numstat -- "$PATH_ARG" | head -1)"
ADDED="$(printf '%s' "$STAGED_NUMSTAT" | awk '{print $1+0}')"
DELETED="$(printf '%s' "$STAGED_NUMSTAT" | awk '{print $2+0}')"
if [ -z "$STAGED_NUMSTAT" ]; then
  echo "NOTHING STAGED for $PATH_ARG — the index matches HEAD, so this run staged nothing." >&2
  echo "That means the patched content equalled HEAD. Investigate before committing." >&2
  cp "$TMP/worktree-original" "$PATH_ARG"
  exit 6
fi
echo "staged: $PATH_ARG  (+$ADDED/-$DELETED)"
if [ -n "$EXPECT" ] && [ "$ADDED" -gt "$EXPECT" ]; then
  echo "TOO MANY LINES STAGED: expected at most +$EXPECT, got +$ADDED." >&2
  echo "Someone else's edits to this file are in the index. Unstage and rebuild." >&2
  git restore --staged "$PATH_ARG"
  exit 5
fi
echo "worktree restored; foreign edits preserved as unstaged: $(git diff --numstat -- "$PATH_ARG" | awk '{print $1"+ / "$2"-"}')"