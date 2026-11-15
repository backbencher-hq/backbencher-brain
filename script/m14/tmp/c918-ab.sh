#!/usr/bin/env bash
# #918 analyzer-level A/B on all four c corpora. The analyzer file is swapped in
# and RESTORED in the same command regardless of outcome (trap), because a
# killed shell must never leave HEAD's analyzer in the tree.
set -u
cd /home/ishaq2321/mcp/backbencher-brain || exit 1
R=/home/ishaq2321/bb_tests/repositories
FIX=src/ast/real-c-analyzer.ts
KEEP=/tmp/c918-fix.ts
cp "$FIX" "$KEEP" || exit 1
restore() { cp "$KEEP" "$FIX"; echo "[restored] $(md5sum "$FIX" | cut -c1-8) vs saved $(md5sum "$KEEP" | cut -c1-8)"; }
trap restore EXIT INT TERM

run() { # <label> <repo> <limit>
  timeout 900 bun script/m14/tmp/c916-ab.ts "$2" "$3" "/tmp/c918-ab-$1.json" >/dev/null 2>&1
  echo "  $1: $(wc -c < "/tmp/c918-ab-$1.json") bytes"
}

echo "== POST (fix in tree) =="
run post-sqlite "$R/sqlite" 0
run post-jq "$R/jq" 0
run post-fmt "$R/fmt" 0
run post-nlohmann "$R/nlohmann-json" 0

echo "== PRE (HEAD analyzer) =="
git show HEAD:$FIX > "$FIX"
run pre-sqlite "$R/sqlite" 0
run pre-jq "$R/jq" 0
run pre-fmt "$R/fmt" 0
run pre-nlohmann "$R/nlohmann-json" 0
echo "== done =="
