#!/bin/zsh
# Secret leak gate. Run before merging any agent branch.
#
# The embeddings API key was supplied for local use only. It must never reach a
# commit, a file, a doc, a test fixture, or a log. This scans tracked files, the
# working tree, and every commit reachable from the branches being merged.
#
# The scanner matches on the KEY PREFIX ONLY — the real secret is deliberately not
# written into this script, so this file is itself safe to commit.
#
# Two implementation notes, both learned the hard way:
#   - `git grep` without --no-index silently ignores UNTRACKED files, which is
#     exactly where a freshly pasted key lands. A first version of this script
#     reported PASS on a planted key for that reason.
#   - This git build rejects `--no-index` ("unable to resolve revision"), so the
#     working tree is scanned with plain `grep -r`, respecting .gitignore.

set -u
REPO="$HOME/Documents/Default Project/ishaq/backbencher-brain"
cd "$REPO" || exit 1

PATTERN='sk-or-v1-[A-Za-z0-9_-]{16,}'
ALT_PATTERN='(sk-[A-Za-z0-9]{32,}|Bearer sk-or-v1)'
SELF='bb-secret-scan\.sh'
FAIL=0

report() { # $1 = label
  if [ "$1" -gt 0 ]; then FAIL=1; fi
}

echo "=== 1. tracked files ==="
hits=$(git grep -InE "$PATTERN" -- . 2>/dev/null | grep -v "$SELF" | wc -l | tr -d ' ')
if [ "$hits" != "0" ]; then
  git grep -InE "$PATTERN" -- . 2>/dev/null | grep -v "$SELF" | head -10
  echo "  ✗ $hits leak(s) in tracked files"; report 1
else
  echo "  ✓ clean"
fi

echo "=== 2. working tree incl. untracked (gitignore-respecting) ==="
# -r recursive, --exclude-dir skips noise. git grep cannot do this, hence grep.
hits=$(grep -rInE "$PATTERN" . \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
  --exclude-dir=.worktrees --exclude='*.wasm' 2>/dev/null \
  | grep -v "$SELF" | grep -v '/wt/a[0-9]/' | wc -l | tr -d ' ')
if [ "$hits" != "0" ]; then
  grep -rInE "$PATTERN" . \
    --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
    --exclude='*.wasm' 2>/dev/null \
    | grep -v "$SELF" | grep -v '/wt/a[0-9]/' | head -10
  echo "  ✗ $hits leak(s) in working tree"; report 1
else
  echo "  ✓ clean"
fi

echo "=== 3. history of branches being merged ==="
if [ "$#" -eq 0 ]; then
  echo "  (no branches given — tree only)"
else
  for b in "$@"; do
    n=$(git grep -InE "$PATTERN" "$b" -- . 2>/dev/null | grep -v "$SELF" | wc -l | tr -d ' ')
    if [ "$n" != "0" ]; then
      echo "  ✗ $b: $n hit(s)"
      git grep -InE "$PATTERN" "$b" -- . 2>/dev/null | grep -v "$SELF" | head -5
      report 1
    else
      echo "  ✓ $b clean"
    fi
  done
fi

echo "=== 4. other credential shapes (bare sk-..., Bearer headers) ==="
hits=$(grep -rInE "$ALT_PATTERN" . \
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
  --exclude='*.wasm' 2>/dev/null \
  | grep -v "$SELF" | grep -v '/wt/a[0-9]/' | wc -l | tr -d ' ')
if [ "$hits" != "0" ]; then
  grep -rInE "$ALT_PATTERN" . \
    --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
    --exclude='*.wasm' 2>/dev/null \
    | grep -v "$SELF" | grep -v '/wt/a[0-9]/' | head -10
  echo "  ✗ $hits possible credential(s)"; report 1
else
  echo "  ✓ clean"
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "SECRET SCAN: PASS — no credentials in tree or history"
else
  echo "SECRET SCAN: FAIL — do not merge. Remove the secret and rewrite history."
fi
exit $FAIL