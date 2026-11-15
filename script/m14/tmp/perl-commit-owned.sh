#!/usr/bin/env bash
# Commit ONLY the paths you name, on top of the current HEAD, without ever
# touching the repository's real index (a co-agent shares it).
#
# WHY THIS EXISTS
# ---------------
# I destroyed the worktree once with this exact shape:
#
#     # call 1
#     export GIT_INDEX_FILE=/tmp/idx-$$ ; git read-tree HEAD ; git add a b c
#     # call 2  <-- a DIFFERENT shell, so a DIFFERENT $$
#     export GIT_INDEX_FILE=/tmp/idx-$$ ; git commit
#
# `$$` is the shell's PID. Separate bash invocations are separate processes, so
# call 2 pointed at an index file that did not exist. `git commit` read it as
# empty and wrote an EMPTY TREE: 6,069 files and 1,309,541 lines gone in one
# commit. It was recovered by the next commit, but that was luck, not design.
#
# So: one process, a fixed index path, and a hard assertion that the staged set
# is EXACTLY the paths you asked for. If the index is not what you think it is,
# this refuses instead of committing an empty tree.
#
# usage:  bb-commit-owned.sh <message-file> <path> [path...]
set -euo pipefail

# --patch mode: stage a pre-built unified diff instead of whole worktree paths.
# Needed for SHARED files (script/m14/differential.ts, mutate-analyzer.ts,
# run-fixtures.ts) that carry a co-agent's uncommitted work alongside mine, where
# `git add <path>` would sweep both. The patch is built from HEAD plus only my
# hunks, so the staged delta is mine by construction and GUARD 1 below still
# proves it.
PATCHFILE=""
if [ "${1:-}" = "--patch" ]; then PATCHFILE="$2"; shift 2; fi

MSG_FILE="${1:-}"
[ -n "$MSG_FILE" ] || { echo "usage: bb-commit-owned.sh [--patch <file>] <message-file> <path>..." >&2; exit 2; }
shift
[ -f "$MSG_FILE" ] || { echo "no such message file: $MSG_FILE" >&2; exit 2; }
[ "$#" -ge 1 ] || [ -n "$PATCHFILE" ] || { echo "usage: bb-commit-owned.sh [--patch <file>] <message-file> <path>..." >&2; exit 2; }

IDX="${BB_OWNED_INDEX:-/tmp/bb-owned-index}"
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"

BASE_TREE_FILE_COUNT="$(git ls-tree -r --name-only HEAD | wc -l | tr -d ' ')"

# NOTE: no `$$` anywhere. The path is fixed, and the whole stage+verify+commit
# happens in THIS process, so a stale index from another shell is impossible:
# we delete it and rebuild from HEAD on every call.
rm -f "$IDX"
export GIT_INDEX_FILE="$IDX"
git read-tree HEAD

if [ -n "$PATCHFILE" ]; then
  [ -f "$PATCHFILE" ] || { echo "no such patch: $PATCHFILE" >&2; exit 2; }
  # --check first: a patch that does not apply cleanly must abort, not half-apply.
  git apply --cached --check "$PATCHFILE" || { echo "patch does not apply; aborting" >&2; exit 5; }
  git apply --cached "$PATCHFILE"
else
  for p in "$@"; do
    [ -e "$p" ] || { echo "refusing: path does not exist: $p" >&2; exit 2; }
  done
  git add -- "$@"
fi

# GUARD 1: the staged set must be EXACTLY the requested paths. This is the check
# that would have caught the empty-index commit: the index was empty, so the
# staged set was 0 paths, not the 11 that were requested.
mapfile -t STAGED < <(git diff --cached --name-only HEAD | sort)
if [ -n "$PATCHFILE" ]; then
  mapfile -t WANTED < <(grep -E "^\+\+\+ b/" "$PATCHFILE" | sed 's|^+++ b/||' | sort -u)
  # A patch names its own paths, so anything else passed on the command line
  # would be SILENTLY IGNORED. It bit twice in one session: a commit that carried
  # a 4-file payload committed 1 file and reported success. Refuse instead.
  if [ "$#" -gt 0 ]; then
    echo "REFUSING TO COMMIT — --patch stages only what the patch names, and you" >&2
    echo "  also passed $# path(s) that would be dropped: $*" >&2
    echo "  Make two commits, or fold those paths into the patch." >&2
    rm -f "$IDX"; unset GIT_INDEX_FILE
    exit 6
  fi
else
  mapfile -t WANTED < <(printf '%s\n' "$@" | sort)
fi
if [ "${#STAGED[@]}" -ne "${#WANTED[@]}" ] || [ "$(printf '%s\n' "${STAGED[@]}")" != "$(printf '%s\n' "${WANTED[@]}")" ]; then
  echo "REFUSING TO COMMIT — staged set is not what you asked for." >&2
  echo "  requested ${#WANTED[@]}: $(printf '%s ' "${WANTED[@]}")" >&2
  echo "  staged    ${#STAGED[@]}: $(printf '%s ' "${STAGED[@]:-<none>}")" >&2
  echo "  (an empty staged set means the index is not the one you think)" >&2
  rm -f "$IDX"; unset GIT_INDEX_FILE
  exit 3
fi

# GUARD 2: the tree that is about to be written must not lose files. A commit
# that removes thousands of paths is a mistake, not a refactor.
STAGED_TREE_FILE_COUNT="$(git write-tree | { read t; git ls-tree -r --name-only "$t" | wc -l | tr -d ' '; })"
REMOVED=$(( BASE_TREE_FILE_COUNT - STAGED_TREE_FILE_COUNT ))
if [ "$REMOVED" -gt 0 ]; then
  echo "REFUSING TO COMMIT — the staged tree drops $REMOVED file(s) (HEAD has $BASE_TREE_FILE_COUNT)." >&2
  echo "  removals: $(git diff --cached --diff-filter=D --name-only HEAD | tr '\n' ' ')" >&2
  rm -f "$IDX"; unset GIT_INDEX_FILE
  exit 4
fi

echo "staged ${#STAGED[@]} path(s); tree file count $STAGED_TREE_FILE_COUNT (HEAD $BASE_TREE_FILE_COUNT, removals $REMOVED)"
git diff --cached --stat HEAD | tail -20
git commit -q -F "$MSG_FILE"
NEW=$(git rev-parse --short HEAD)
rm -f "$IDX"; unset GIT_INDEX_FILE
echo "committed $NEW"
git show --stat --format="%h %s" -1 HEAD | tail -20
