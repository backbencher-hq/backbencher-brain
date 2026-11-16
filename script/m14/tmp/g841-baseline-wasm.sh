#!/bin/bash
# Build a wasm from the GRAMMAR AT A GIVEN GIT REV, for A/B control comparison.
#   usage: g841-baseline-wasm.sh <git-rev> <out.wasm>
# Needed because the working-tree wasm is overwritten by each experiment, and a
# control that fails must be compared against the last verified revision before
# it can be called a regression.
set -u
BR=<corpus-root>/mcp/backbencher-brain
REV="$1"
OUT="$2"
V=/tmp/g841-baseline-build

rm -rf "$V"; mkdir -p "$V"
cd "$BR"
git show "$REV:grammars/tree-sitter-groovy/grammar.js" > "$V/grammar.js"
cp grammars/tree-sitter-groovy/package.json "$V/"
ln -sfn "$BR/grammars/tree-sitter-groovy/node_modules" "$V/node_modules"

cd "$V"
if ! tree-sitter generate > gen.txt 2>&1; then
  echo "GENERATE FAILED for $REV"
  grep -A8 "Unresolved conflict" gen.txt | head -10
  exit 1
fi
if ! tree-sitter build --wasm > build.txt 2>&1; then
  echo "BUILD FAILED for $REV"
  tail -5 build.txt
  exit 1
fi
cp "$V/tree-sitter-groovy.wasm" "$OUT"
echo "built $OUT from $REV  sha=$(sha256sum "$OUT" | cut -c1-12)"
