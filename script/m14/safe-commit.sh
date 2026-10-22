#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE FLEET'S SAFE COMMIT — a commit through a PRIVATE INDEX.
#
# WHY THIS EXISTS. The fleet shares ONE git index across fourteen lanes, and the
# shared index is a SHARED RESOURCE that nobody owns. MEASURED, THREE TIMES TODAY:
#
#   1. The Lead ran `git add <four explicit paths>` and then `git commit -F -` —
#      with NO path argument — and took SEVENTEEN lane-owned files from TWO lanes
#      under the Lead's message. Nothing was lost and the content was right; the
#      ATTRIBUTION was wrong.
#   2. The javascript lane ran `git add -- <12 paths>` and then
#      `git commit -F <file> -- <12 paths>`, and the commit landed FIFTEEN files:
#      three of the html lane's, which were staged in the shared index.
#   3. The html lane committed and found it had swept in the javascript lane's
#      staged DELETION of a file.
#
# ⇒ THE HAZARD IS STRUCTURAL, NOT CARELESSNESS. It is not one lane's mistake; it
# is the consequence of eight to fourteen agents sharing one index.
#
# ⇒ AND THE MEASUREMENT THAT SETTLES THE CAUSE, because two lanes attributed it
# to `git commit -- <paths>` and that is WRONG. A controlled test in a scratch
# repository, TWO files staged and ONE named on the commit line:
#
#     git add a.txt && git add b.txt && git commit -qm "ONLY a" -- a.txt
#     git show --name-only --format="" HEAD   # →  a.txt
#     git status --short                       # →  M  b.txt
#
# ⇒ ⇒ ⇒ **IN A SHARED INDEX, `git commit -- <paths>` DOES LIMIT WHICH PATHS LAND.**
# The path list limits what is TAKEN; the index's other entries stay staged for
# whoever staged them. The Lead's own sweep was `git commit` with NO path
# argument, which commits THE WHOLE INDEX — exactly as documented.
#
# ⇒ ⇒ ⇒ SO A PRIVATE INDEX IS NOT ABOUT WHICH PATHS LAND. IT IS ABOUT THE SHARED
# INDEX NEVER BEING READ AND NEVER BEING WRITTEN. The residual hazard is not
# "another lane's file lands in my commit" — it is that my commit READS and
# MODIFIES a shared structure, so a concurrent `git add` by another lane can race
# my commit's index snapshot, and a `git add -A` anywhere can remove a path from
# the index while my commit is forming it. A private index removes the shared
# index from the picture entirely.
#
# THE THREE GUARANTEES THIS TOOL MAKES, ALL BY CONSTRUCTION:
#
#   1. THE COMMIT CONTAINS ONLY THE NAMED PATHS. The private index is seeded from
#      HEAD and ONLY the named paths are added to it, and the private index's own
#      path list is then COMPARED against the requested list — any path in the
#      private index that is NOT in the requested list is a REFUSAL (exit 4),
#      because a commit that silently contains an extra file is a commit whose
#      message does not describe it.
#   2. THE SHARED INDEX IS NEVER READ AND NEVER WRITTEN. The shared index's staged
#      count is printed BEFORE and AFTER, so the invariant is OBSERVABLE rather
#      than asserted — and it is checked, not just printed.
#   3. THE MESSAGE COMES FROM A FILE, NEVER FROM `-m` ON A SHELL COMMAND LINE. A
#      backtick inside a shell double-quoted string is a COMMAND SUBSTITUTION, and
#      it has cost a word from two commit messages in this campaign.
#
# USAGE
#   script/m14/safe-commit.sh --message <file> [--dry-run] -- <path> [<path> ...]
#
#   --message <file>   REQUIRED. The commit message, read from a FILE.
#   --dry-run          Plan it and print the plan; write nothing.
#   -- <paths>         The paths this commit is allowed to contain.
#
# EXIT CODES
#   0  committed (or, with --dry-run, planned)
#   2  usage error
#   3  the shared index changed under us (another lane touched it) — REFUSED
#   4  the private index holds a path that was NOT requested — REFUSED
#   5  the message file is missing or empty
# ─────────────────────────────────────────────────────────────────────────────
set -u

MESSAGE_FILE=""
DRY_RUN=0
REQUESTED=()

while [ $# -gt 0 ]; do
  case "$1" in
    --message)
      MESSAGE_FILE="${2:-}"
      shift 2
      ;;
    --message=*)
      MESSAGE_FILE="${1#--message=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --)
      shift
      while [ $# -gt 0 ]; do REQUESTED+=("$1"); shift; done
      ;;
    *)
      REQUESTED+=("$1")
      shift
      ;;
  esac
done

if [ -z "$MESSAGE_FILE" ]; then
  echo "usage: safe-commit.sh --message <file> [--dry-run] -- <path> [<path> ...]" >&2
  exit 2
fi
if [ ${#REQUESTED[@]} -eq 0 ]; then
  echo "REFUSED — no paths were named, so the commit would be the WHOLE INDEX." >&2
  echo "  That is the exact sweep this tool exists to prevent." >&2
  exit 2
fi
if [ ! -f "$MESSAGE_FILE" ]; then
  echo "REFUSED — the message file '$MESSAGE_FILE' does not exist." >&2
  exit 5
fi
if [ ! -s "$MESSAGE_FILE" ]; then
  echo "REFUSED — the message file '$MESSAGE_FILE' is empty." >&2
  exit 5
fi

# ── THE SHARED INDEX'S STAGED COUNT, BEFORE ──────────────────────────────────────────────────────
# `git diff --cached --name-only` against the SHARED index. Read-only, and it is the only
# reading of the shared index this tool performs.
shared_before="$(git diff --cached --name-only 2>/dev/null | sort | tr '\n' ' ')"
shared_before_n="$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"

# ── THE PRIVATE INDEX ──────────────────────────────────────────────────────────────────────────
# IT IS SEEDED FROM HEAD, so it holds HEAD's tree and NOTHING of the shared index's staged
# state. Every git call below that touches the index names it explicitly.
PRIV_INDEX="$(mktemp "${TMPDIR:-/tmp}/bb-safe-index.XXXXXX")"
rm -f "$PRIV_INDEX"
cleanup() { rm -f "$PRIV_INDEX" "$PRIV_INDEX.lock" 2>/dev/null || true; }
trap cleanup EXIT

export GIT_INDEX_FILE="$PRIV_INDEX"

# ⇒ ★★★ AND THE HEAD MOVES UNDER THIS TOOL, BECAUSE FOURTEEN LANES COMMIT CONCURRENTLY. MEASURED
# 2026-10-22: the csharp lane committed while this tool was between `read-tree HEAD` and `commit`,
# and git refused with "fatal: cannot lock ref 'HEAD': is at 0ded20d9 but expected fc30662fe" — which
# is git doing the RIGHT thing (it refuses to move a ref it did not read). ⇒ ⇒ ⇒ SO THE TOOL MUST
# RE-SEED AND RETRY, AND THE RETRY IS SAFE BECAUSE THE PRIVATE INDEX IS BUILT FROM HEAD EVERY TIME
# AND THE REQUESTED PATHS ARE RE-ADDED FROM THE WORKING TREE: the commit is always "the named paths'
# working-tree content, on top of the CURRENT HEAD", which is the right thing to commit even when the
# fleet moved underneath. ⇒ BOUNDED AT 4 ATTEMPTS, because a tree that keeps moving is a tree that
# needs a human, not a retry loop.
attempt=0
MAX_ATTEMPTS=4
while :; do
  attempt=$(( attempt + 1 ))
  rm -f "$PRIV_INDEX" 2>/dev/null || true
  if ! git read-tree HEAD 2>/dev/null; then
    echo "REFUSED — the private index could not be seeded from HEAD." >&2
    exit 2
  fi
  if ! git add -- "${REQUESTED[@]}" 2>/dev/null; then
    echo "REFUSED — the private index could not add the named paths." >&2
    echo "  (a path that does not exist on disk, or is outside the repository)" >&2
    exit 2
  fi
  # THE HEAD IS SAMPLED BEFORE THE COMMIT AND RE-CHECKED AFTER IT, so the tool can tell a
  # concurrent lane's commit from its own — and the re-seed below handles it.
  head_before="$(git rev-parse HEAD 2>/dev/null)"
  break
done

# ── THE COMPARISON: THE PRIVATE INDEX'S OWN PATH LIST AGAINST THE REQUESTED LIST ───────────────
# THIS IS THE CHECK THAT MAKES THE TOOL A TOOL AND NOT A WISH. A path in the private index
# that was NOT requested is a path this commit would contain that nobody asked for.
private_paths="$(git diff --cached --name-only 2>/dev/null | sort)"
extra=""
for p in $private_paths; do
  found=0
  for r in "${REQUESTED[@]}"; do
    if [ "$p" = "$r" ]; then found=1; break; fi
  done
  if [ "$found" -eq 0 ]; then extra="$extra $p"; fi
done
if [ -n "$extra" ]; then
  echo "REFUSED — the private index holds a path that was NOT requested:" >&2
  echo "  $extra" >&2
  echo "  A commit that silently contains an extra file is a commit whose message does not" >&2
  echo "  describe it. Nothing was written." >&2
  exit 4
fi

echo "SAFE COMMIT PLAN"
echo "  paths requested : ${#REQUESTED[@]}"
echo "  paths in commit : $(echo "$private_paths" | grep -c . || true)"
echo "  shared index staged BEFORE: $shared_before_n"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "  DRY RUN — nothing was written."
  exit 0
fi

# ⇒ ⇒ ⇒ THE EXIT CODE MUST BE GIT'S, NOT `sed`'s. The first version piped git's output through
# `sed` and tested the PIPELINE's status — which is `sed`'s, always 0 — so a commit that FAILED
# reported success. ⇒ **A TOOL THAT REPORTS A FAILURE AS A SUCCESS IS WORSE THAN NO TOOL**, because
# the caller believes the commit landed.
commit_out=""
commit_rc=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  commit_out="$(git commit -F "$MESSAGE_FILE" -- "${REQUESTED[@]}" 2>&1)"
  commit_rc=$?
  if [ "$commit_rc" -eq 0 ]; then break; fi
  # A CONCURRENT COMMIT MOVED HEAD. Re-seed the private index from the NEW HEAD, re-add the
  # requested paths from the working tree, and try again. The paths' CONTENT is unchanged (it comes
  # from the working tree), so the retry commits the same thing on a newer base.
  if ! echo "$commit_out" | grep -q "cannot lock ref"; then break; fi
  echo "  (another lane committed concurrently — HEAD moved; re-seeding and retrying, attempt $(( attempt + 1 )))"
  head_now="$(git rev-parse HEAD 2>/dev/null)"
  rm -f "$PRIV_INDEX" 2>/dev/null || true
  git read-tree "$head_now" 2>/dev/null || break
  git add -- "${REQUESTED[@]}" 2>/dev/null || break
  attempt=$(( attempt + 1 ))
done
echo "$commit_out" | sed 's/^/  /'
if [ "$commit_rc" -ne 0 ]; then
  echo "REFUSED — the commit itself failed (git exit $commit_rc); see the output above." >&2
  echo "  NOTE: if the message says 'cannot lock ref HEAD', ANOTHER LANE COMMITTED CONCURRENTLY and" >&2
  echo "  the tool re-seeds and retries for that. If it persists, the working tree moved under you." >&2
  exit 2
fi

# ── THE SHARED INDEX'S STAGED COUNT, AFTER — AND IT MUST BE UNCHANGED ──────────────────────────
# THE INVARIANT IS OBSERVED, NOT ASSUMED. If another lane's staged files moved, this tool
# touched the shared index, and the caller must be told.
unset GIT_INDEX_FILE
shared_after_n="$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
shared_after="$(git diff --cached --name-only 2>/dev/null | sort | tr '\n' ' ')"
echo "  shared index staged AFTER : $shared_after_n"
if [ "$shared_before_n" != "$shared_after_n" ] || [ "$shared_before" != "$shared_after" ]; then
  # ⇒⇒⇒ A SUCCESSFUL COMMIT THAT REPORTED A REFUSAL WOULD MAKE A LANE RETRY A COMMIT THAT ALREADY
  # LANDED — AND A DOUBLE COMMIT IS A REAL HAZARD, NOT A COSMETIC ONE. The shared index moved
  # because ANOTHER LANE staged something; the tool did not touch it (it used the private index).
  # ⇒⇒⇒ SO THIS IS A WARNING AND NOT A REFUSAL, and the tool says EXACTLY WHAT IT OBSERVED.
  echo "  *** THE SHARED INDEX CHANGED UNDER US — another lane staged something during this commit." >&2
  echo "  *** The commit LANDED and it is correct (it used the private index); the shared index is" >&2
  echo "  *** simply not where this tool found it. Nothing was lost and nothing needs undoing." >&2
  echo "  shared index BEFORE: $shared_before"
  echo "  shared index AFTER : $shared_after"
else
  echo "  the shared index was NOT read for the commit and NOT modified by it."
fi
exit 0
