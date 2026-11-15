#!/usr/bin/env bash
# #743 grammar-wave A/B at the ANALYZER level: swap in the candidate grammar wasm,
# dump the production analyzer's own output for each corpus, then restore the pinned
# wasm in the SAME command regardless of outcome (trap) — a killed shell must never
# leave a candidate grammar in the tree.
#
#   bash script/m14/tmp/c743-ab.sh <c|cpp> [repo ...]
set -u
cd /home/ishaq2321/mcp/backbencher-brain || exit 1
LANG_KIND="${1:-cpp}"; shift || true
R=/home/ishaq2321/bb_tests/repositories
case "$LANG_KIND" in
  cpp) WASM=wasm/tree-sitter-cpp.wasm; CAND=/tmp/fam-cpp.wasm; DEFAULT="fmt nlohmann-json";;
  c)   WASM=wasm/tree-sitter-c.wasm;   CAND=/tmp/fam-c.wasm;    DEFAULT="sqlite jq";;
  *)   echo "usage: c743-ab.sh <c|cpp> [repo ...]"; exit 2;;
esac
REPOS="${*:-$DEFAULT}"
KEEP="/tmp/c743-pinned-$LANG_KIND.wasm"
cp "$WASM" "$KEEP" || exit 1
cp "$CAND" "$WASM" || exit 1
restore() {
  cp "$KEEP" "$WASM"
  echo "[restored $WASM] now $(md5sum "$WASM" | cut -c1-8) vs pinned $(md5sum "$KEEP" | cut -c1-8)"
}
trap restore EXIT INT TERM

echo "== CANDIDATE grammar ($CAND) in tree =="
for repo in $REPOS; do
  timeout 900 bun script/m14/tmp/c916-ab.ts "$R/$repo" 0 "/tmp/c743ab-$LANG_KIND-post-$repo.json" >/dev/null 2>&1
  echo "  post-$repo: $([ -f /tmp/c743ab-$LANG_KIND-post-$repo.json ] && wc -c < /tmp/c743ab-$LANG_KIND-post-$repo.json || echo MISSING) bytes"
done

cp "$KEEP" "$WASM"
echo "== PINNED grammar in tree =="
for repo in $REPOS; do
  timeout 900 bun script/m14/tmp/c916-ab.ts "$R/$repo" 0 "/tmp/c743ab-$LANG_KIND-pre-$repo.json" >/dev/null 2>&1
  echo "  pre-$repo: $([ -f /tmp/c743ab-$LANG_KIND-pre-$repo.json ] && wc -c < /tmp/c743ab-$LANG_KIND-pre-$repo.json || echo MISSING) bytes"
done
echo "== done =="
