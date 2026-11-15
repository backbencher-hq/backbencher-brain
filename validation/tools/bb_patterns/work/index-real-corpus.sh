#!/usr/bin/env bash
# Release-grade corpus indexing for bb_patterns: index a real repository per
# ecosystem into an isolated BB_DATA_DIR under the lane's evidence tree. The
# shared workspace index is never used. Runs sequentially; each repo records its
# index facts so REAL-CORPUS.json can cite population and timing.
set -u
cd /home/ishaq2321/mcp/backbencher-brain || exit 1
OUT=validation/tools/bb_patterns/corpus
RAW=validation/tools/bb_patterns/raw
mkdir -p "$OUT" "$RAW"
REPOS=("$HOME/bb_tests/repositories/graphql-js" "$HOME/bb_tests/repositories/rake" "$HOME/bb_tests/repositories/rebar3" "$HOME/bb_tests/repositories/go-tools" "$HOME/bb_tests/repositories/zig")
LOGS=$OUT/logs
mkdir -p "$LOGS"
for repo in "${REPOS[@]}"; do
  name=$(basename "$repo")
  data=$OUT/$name
  mkdir -p "$data"
  echo "=== indexing $name ==="
  BB_DATA_DIR="$PWD/$data" BB_NO_AUTO_REFRESH=1 timeout 1800 npx tsx validation/tools/bb_patterns/work/index-fixture.mts "$repo" "$RAW/corpus-$name-index.json" > "$LOGS/$name-index.log" 2>&1
  code=$?
  echo "$name index exit=$code"
  BB_DATA_DIR="$PWD/$data" npx tsx validation/tools/bb_patterns/work/index-facts.mts "CORPUS-$name" "$repo" "$RAW/corpus-$name-facts.json" >> "$LOGS/$name-index.log" 2>&1
  echo "$name facts exit=$?"
done
echo "CORPUS INDEX DONE"
