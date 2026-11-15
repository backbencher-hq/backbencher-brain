#!/usr/bin/env bash
# #920 deterministic A/B over fmt (the only one of the four pinned c/cpp corpora
# with a file carrying the shape). The engine is restored in the same command
# regardless of outcome (trap) and md5-verified.
set -u
cd /home/ishaq2321/mcp/backbencher-brain || exit 1
FIX=src/ast/engine.ts
KEEP=/tmp/c920-engine-fix.ts
cp "$FIX" "$KEEP" || exit 1
SAVED=$(md5sum "$KEEP" | cut -d' ' -f1)
restore() { cp "$KEEP" "$FIX"; echo "[restored] $(md5sum "$FIX" | cut -c1-8) vs saved $(echo "$SAVED" | cut -c1-8)"; }
trap restore EXIT INT TERM

R=/home/ishaq2321/bb_tests/repositories
echo "== POST (fix) =="
timeout 500 bun script/m14/tmp/c920-ab.ts "$R/fmt" /tmp/c920-fmt-post.json 2>&1 | grep -v "^\[INFO\]"

echo "== PRE (old blanking) =="
python3 - "$FIX" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = 'const blankKeepingNewlines = (match: string): string => match.replace(/[^\\n]/g, " ")'
assert old in s, "helper not found"
open(p, "w").write(s.replace(old, 'const blankKeepingNewlines = (match: string): string => " ".repeat(match.length)'))
PY
echo "   swapped: $(md5sum "$FIX" | cut -c1-8)"
timeout 500 bun script/m14/tmp/c920-ab.ts "$R/fmt" /tmp/c920-fmt-pre.json 2>&1 | grep -v "^\[INFO\]"
echo "== done =="
