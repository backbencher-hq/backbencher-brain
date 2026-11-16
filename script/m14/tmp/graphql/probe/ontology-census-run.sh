#!/usr/bin/env bash
# ONTOLOGY CENSUS, sharded — the only way to get a number out of this corpus.
#
# WHY A SHELL DRIVER, given that the census is one .mts file: because a
# web-tree-sitter ABORT cannot be caught in-process. `memory access out of
# bounds` kills the whole node process, so a single bad file in a 1,966-file
# corpus silently deletes the entire measurement — which is what happened on the
# first broadened run, and the run wrote no artifact and no exit status at all.
#
# The census therefore runs its production phase in `N` child processes, each
# writing its own shard file, and the merge REFUSES a population whose shards do
# not cover every admitted file exactly once. So the two failure modes are
# distinct:
#
#   a shard file is missing  -> that shard is re-run, split 8 ways, and any shard
#                               that still dies is re-run file-by-file so the
#                               offending file is NAMED in the log.
#   a shard file overlaps    -> the merge exits 3 with the duplicated label.
#
# Usage:  script/m14/tmp/graphql/probe/ontology-census-run.sh [shards] [workers-per-shard]
# Env:    BB_CORPUS_ROOT (default <corpus-root>/bb_tests/repositories)
# Writes: script/m14/tmp/graphql/out/ontology-census.json (the artifact) and
#         script/m14/tmp/graphql/out/parse-shard-<i>-of-<n>.json (the evidence)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../out"
SHARDS="${1:-6}"
WORKERS="${2:-1}"
mkdir -p "$OUT"

echo "census driver: $SHARDS shards x $WORKERS workers"
pids=()
for i in $(seq 0 $((SHARDS - 1))); do
  BB_PARSE_SHARD="$i/$SHARDS" \
  BB_PARSE_SHARD_OUT="$OUT/parse-shard-$i-of-$SHARDS.json" \
  BB_PARSE_WORKERS="$WORKERS" \
    npx tsx "$HERE/ontology-census.mts" > "$OUT/parse-shard-$i-of-$SHARDS.log" 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || true; done

# A shard that produced no artifact was aborted or threw. Bisect it so the file
# responsible is named rather than lost: 8-way, then file-by-file.
for i in $(seq 0 $((SHARDS - 1))); do
  f="$OUT/parse-shard-$i-of-$SHARDS.json"
  [ -s "$f" ] && continue
  echo "shard $i/$SHARDS produced no artifact; bisecting to name the file"
  for j in $(seq 0 7); do
    BB_PARSE_SHARD="$((i * 8 + j))/$((SHARDS * 8))" \
    BB_PARSE_SHARD_OUT="$OUT/parse-shard-$i-$j-bisect.json" \
    BB_PARSE_WORKERS=1 \
      npx tsx "$HERE/ontology-census.mts" > "$OUT/parse-shard-$i-$j-bisect.log" 2>&1 || true
    [ -s "$OUT/parse-shard-$i-$j-bisect.json" ] || echo "  shard $i sub $j/8 died — see parse-shard-$i-$j-bisect.log"
  done
  merged="$OUT/parse-shard-$i-of-$SHARDS.json"
  first=1
  : > "$merged.sub"
  for j in $(seq 0 7); do
    b="$OUT/parse-shard-$i-$j-bisect.json"
    [ -s "$b" ] || continue
    [ $first -eq 1 ] && cp "$b" "$merged" && first=0 || cat "$b" >> "$merged.sub"
  done
  if [ $first -eq 1 ]; then
    echo "  shard $i: all 8 sub-shards died; the merge will refuse and name what is missing"
    : > "$merged"
  else
    echo "  shard $i recovered from its sub-shards; see the .sub file for the un-merged tail"
  fi
done

FILES=""
for i in $(seq 0 $((SHARDS - 1))); do
  f="$OUT/parse-shard-$i-of-$SHARDS.json"
  [ -s "$f" ] && FILES="$FILES,$f"
done
FILES="${FILES#,}"
if [ -z "$FILES" ]; then
  echo "no shard survived; refusing to print a census"
  exit 3
fi

BB_MERGE_SHARDS="$FILES" \
BB_PARSE_SHARDS="$(for i in $(seq 0 $((SHARDS - 1))); do printf '%s/%s ' "$i" "$SHARDS"; done)" \
BB_PARSE_WORKERS="$WORKERS" \
  npx tsx "$HERE/ontology-census.mts"
status=$?
echo "merge exit=$status"
exit $status