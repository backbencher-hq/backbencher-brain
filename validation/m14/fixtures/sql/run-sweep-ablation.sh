#!/usr/bin/env bash
# Sweep-ablation over the whole corpus, in the census's 8 shards.
#
# Serial, not parallel: the box has 8 cores and ~4 GB free, and each shard holds every admitted
# file's edge SET in memory (1,962 files, 31,108 baseline edges) plus a second parse of each file
# through the patched prototype. Two concurrent shards is the documented ceiling; running all eight
# was tried and the machine began swapping, which would have made the wall-clock figure meaningless.
#
# Each shard re-runs the restore assertion on ITS OWN most-costly file, so the artifact's
# `prototypeRestored` is a list of 8 witnesses and the merge takes the one with the largest
# baseline-to-ablated gap as the population-wide witness.
set -u
M=validation/m14/fixtures/sql/measurements
S=validation/m14/fixtures/sql/sweep-ablation.mts
rm -f $M/pass10-sweep-ablation.shard*.json $M/pass10-sweep-ablation.shard*.log

for i in 0 1 2 3 4 5 6 7; do
  timeout 1800 npx tsx "$S" --shards 8 --shard "$i" --out "$M/pass10-sweep-ablation.shard$i.json" \
    > "$M/pass10-sweep-ablation.shard$i.log" 2>&1
  echo "shard$i exit=$? $(grep -h 'prototype restore assertion' "$M/pass10-sweep-ablation.shard$i.log" || echo 'NO RESTORE LINE')"
done
echo "=== ablation shards done ==="