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
# COMMIT SAFELY, WHICH IS WHERE THE FOURTH INCIDENT HAPPENED.
#
# This script guards the INDEX. It did not guard the COMMIT, and `git commit` then swept in a peer's
# staged file alongside my hunk. Resetting and unstaging that file BY NAME was not enough either —
# a second peer file went in the next attempt — because a denylist of the files I happened to notice
# is not an allowlist of the files I meant. So the commit path is explicit here: an ALLOWLIST is
# taken as arguments, everything else is unstaged, and the staged set is asserted to equal it before
# the commit is even offered.
#
#   stage-shared.sh --commit <msg-file> <path>...
#
# ALWAYS pass every path you intend to commit, even the ones you believe are already correct. An
# omitted path is unstaged, which is the safe direction; a swept-in path is the unsafe one, and there
# is no version of this that fails safe if you forget.
#
# USAGE
#   stage-shared.sh <path> <patch-file> [expected-staged-lines]
#   stage-shared.sh --commit <msg-file> <path>...
#
# The third argument to the first form is optional but recommended: the number of ADDED lines the
# staged diff should contain. The script fails if the staged diff has more, which turns "did I sweep
# up someone else's work?" into a hard error instead of something to notice three commits later.
set -euo pipefail

# ---- commit-tree: exact blobs, no shared index, no worktree -----------------------------------
# The only form that cannot sweep in a peer's work, because it reads and writes NO index at all and
# never takes content from the working tree. It commits a named blob to a named path, seeded from
# HEAD in a scratch GIT_INDEX_FILE. Use it when the change is not in the worktree verbatim -- a
# rebuilt-from-HEAD edit, or a file a peer is actively editing.
#
#   stage-shared.sh --commit-tree <msg-file> <blob-file>=<path> [<blob-file>=<path> ...]
if [ "${1:-}" = "--commit-tree" ]; then
  MSG="${2:?--commit-tree needs a message file}"
  shift 2
  [ "$#" -ge 1 ] || { echo "--commit-tree needs at least one blob=path pair" >&2; exit 2; }
  ISOLATED="$(mktemp)"; rm -f "$ISOLATED"
  export GIT_INDEX_FILE="$ISOLATED"
  git read-tree HEAD
  for pair in "$@"; do
    B="${pair%%=*}"; T="${pair#*=}"
    [ -f "$B" ] || { echo "no such blob file: $B" >&2; unset GIT_INDEX_FILE; exit 2; }
    git ls-files --error-unmatch "$T" >/dev/null 2>&1 || { echo "not tracked: $T" >&2; unset GIT_INDEX_FILE; exit 2; }
    BLOB="$(git hash-object -w "$B")"
    MODE="$(git ls-tree HEAD "$T" | awk '{print $1}')"
    git update-index --cacheinfo "$MODE,$BLOB,$T"
  done
  echo "exact blobs staged (worktree and shared index untouched):"
  git diff --cached --numstat | sed 's/^/    /'
  git commit -q -F "$MSG"
  unset GIT_INDEX_FILE; rm -f "$ISOLATED"
  echo "committed: $(git show --stat --format='%h %s' -1 | head -1)"
  exit 0
fi


# ---- commit form: allowlist, then assert, then commit -----------------------------------------
if [ "${1:-}" = "--commit" ]; then
  MSG="${2:?--commit needs a message file}"
  shift 2
  [ "$#" -ge 1 ] || { echo "--commit needs at least one path (an empty allowlist commits everything)" >&2; exit 2; }
  for p in "$@"; do git restore --staged "$p" 2>/dev/null || true; done
  STAGED="$(git diff --cached --name-only | sort)"
  WANT="$(printf '%s\n' "$@" | sort)"
  if [ "$STAGED" != "$WANT" ]; then
    echo "STAGED SET != ALLOWLIST — refusing to commit." >&2
    echo "  staged:"; printf '    %s\n' $STAGED >&2
    echo "  wanted:"; printf '    %s\n' $WANT >&2
    echo "  a peer's file is in the index. It was left staged, not discarded." >&2
    exit 7
  fi
  echo "allowlist verified, staged set matches exactly:"
  printf '    %s\n' $STAGED
  git commit -q -F "$MSG"
  echo "committed: $(git show --stat --format='%h %s' -1 | head -1)"
  exit 0
fi

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