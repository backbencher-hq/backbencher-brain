#!/usr/bin/env bash
# Run the SQL ontology census as N contiguous shards and merge them.
#
# WHY THIS EXISTS, in one line: engine.ts answers a 120s parser hang with process.exit(1), and the
# file that hangs MOVES between runs, so a single long walk is not a reproducible measurement.
#
# Each shard is its own process, so a fault costs one slice rather than the whole corpus, and each
# shard writes its rows incrementally so a shard that dies half-way leaves its finished rows behind.
# Shards are run SEQUENTIALLY here on purpose: running them in parallel would re-create the
# sustained-load condition the sharding exists to avoid.
#
# usage: run-sharded-census.sh <shard-count> <out-prefix> [exclude-suffix ...]
set -u
SHARDS="${1:?shard count}"
OUT="${2:?output prefix}"
shift 2
EX=()
for suf in "$@"; do EX+=(--exclude "$suf"); done

SCRIPT=validation/m14/fixtures/sql/ontology-census.mts
rm -f "$OUT".shard*.jsonl "$OUT".shard*.json "$OUT"

failed=()
for ((i=0; i<SHARDS; i++)); do
  echo "=== shard $i of $SHARDS ==="
  npx tsx "$SCRIPT" --shards "$SHARDS" --shard "$i" --out "$OUT" "${EX[@]}" 2>&1 \
    | grep -v "language parser loaded\|tree-sitter core\|BB-PARSE-ERR\|^\[ERROR\]\|^\[WARN\]" \
    | grep -E "admitted|parsed|degraded|symbols|per type|^-|^[a-z]+ +[0-9]" | head -20
  rc=${PIPESTATUS[0]}
  # A shard that died leaves no report; its rows may still be on disk, so the merge still sees them.
  if [ ! -f "$OUT.shard$i.json" ]; then
    failed+=("$i")
    echo "shard $i produced no report (exit $rc)"
  fi
done

echo "=== merging ==="
npx tsx "$SCRIPT" --merge "$OUT".shard*.jsonl --out "$OUT" 2>&1 \
  | grep -v "language parser loaded\|tree-sitter core" | head -45

if [ ${#failed[@]} -gt 0 ]; then
  echo "INCOMPLETE: shards without a report: ${failed[*]}"
  exit 3
fi
echo "all $SHARDS shards reported"