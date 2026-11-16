#!/usr/bin/env bash
# #920 A/B: the same fmt cpp probe with the PRE-FIX blanking. The engine file is
# restored in the same command regardless of outcome (trap) and md5-verified, so a
# kill can never leave HEAD's... (the fix) outside the tree.
set -u
cd <corpus-root>/mcp/backbencher-brain || exit 1
FIX=src/ast/engine.ts
KEEP=/tmp/c920-engine-fix.ts
cp "$FIX" "$KEEP" || exit 1
SAVED=$(md5sum "$KEEP" | cut -d' ' -f1)
restore() {
  cp "$KEEP" "$FIX"
  echo "[restored] $(md5sum "$FIX" | cut -c1-8) vs saved $(echo "$SAVED" | cut -c1-8)"
}
trap restore EXIT INT TERM

echo "== POST (fix in tree) =="
timeout 260 bun script/m14/differential.ts --repo fmt > /tmp/c920-fmt-post.log 2>&1
grep -E "^\[fmt\] (c|cpp):" /tmp/c920-fmt-post.log

echo "== PRE (old blanking swapped in) =="
python3 - "$FIX" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = 'const blankKeepingNewlines = (match: string): string => match.replace(/[^\\n]/g, " ")'
assert old in s, "helper not found"
s = s.replace(old, 'const blankKeepingNewlines = (match: string): string => " ".repeat(match.length)')
open(p, "w").write(s)
PY
echo "   swapped: $(md5sum "$FIX" | cut -c1-8)"
timeout 260 bun script/m14/differential.ts --repo fmt > /tmp/c920-fmt-pre.log 2>&1
grep -E "^\[fmt\] (c|cpp):" /tmp/c920-fmt-pre.log
echo "== done =="
