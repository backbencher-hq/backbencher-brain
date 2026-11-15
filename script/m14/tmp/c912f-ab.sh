#!/usr/bin/env bash
# #912 A/B re-measurement against the FINAL analyzer bytes. The pre-fix side is
# HEAD's analyzer, swapped in and RESTORED in the same command regardless of
# outcome (trap), and the restore is md5-verified.
set -u
cd /home/ishaq2321/mcp/backbencher-brain || exit 1
R=/home/ishaq2321/bb_tests/repositories
FIX=src/ast/real-c-analyzer.ts
KEEP=/tmp/c912f-fix.ts
cp "$FIX" "$KEEP" || exit 1
FIXMD5=$(md5sum "$FIX" | cut -d' ' -f1)
restore() { cp "$KEEP" "$FIX"; echo "[restored] $(md5sum "$FIX" | cut -c1-8) == saved $(md5sum "$KEEP" | cut -c1-8)"; }
trap restore EXIT INT TERM

run() { # <phase> <corpus> <repo>
  timeout 900 bun script/m14/tmp/c916-ab.ts "$3" 0 "/tmp/c912f-$1-$2.json" 2>&1 | grep -v "^\[INFO\]"
}

echo "== POST (final worktree analyzer, md5 $(echo "$FIXMD5" | cut -c1-8)) =="
run post jq "$R/jq"
run post sqlite "$R/sqlite"

echo "== PRE (HEAD analyzer) =="
git show "HEAD:$FIX" > "$FIX"
echo "   swapped in: $(md5sum "$FIX" | cut -c1-8)"
run pre jq "$R/jq"
run pre sqlite "$R/sqlite"
echo "== done =="
