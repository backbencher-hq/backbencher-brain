#!/usr/bin/env bash
# #918 fixture pre/post: the fixture lane's evidence, measured through the same
# production entry the F3 lane uses. HEAD's analyzer is swapped in and RESTORED
# by trap regardless of outcome.
set -u
cd /home/ishaq2321/mcp/backbencher-brain || exit 1
FIX=src/ast/real-c-analyzer.ts
KEEP=/tmp/c918-fix.ts
cp "$FIX" "$KEEP" || exit 1
restore() { cp "$KEEP" "$FIX"; echo "[restored] $(md5sum "$FIX" | cut -c1-8) vs saved $(md5sum "$KEEP" | cut -c1-8)"; }
trap restore EXIT INT TERM

echo "=== POST (fix in tree) ==="
timeout 300 bun script/m14/tmp/c916-ab.ts "$PWD/validation/m14/fixtures/c" 0 /tmp/c918-fix-post.json 2>/dev/null

echo "=== PRE (HEAD analyzer) ==="
git show HEAD:$FIX > "$FIX"
timeout 300 bun script/m14/tmp/c916-ab.ts "$PWD/validation/m14/fixtures/c" 0 /tmp/c918-fix-pre.json 2>/dev/null
echo "=== done ==="
