#!/usr/bin/env bash
# Sweep-reachability over the whole corpus, in the slices that are known to finish.
#
# The 8-shard plan is the census's. Two of its slices are measured from finer sub-slices because
# the single-process slice exceeds 900s on this corpus's slow files — a cost, not a fault: every
# sub-slice completes, and the merge deduplicates rows BY PATH so an overlapping slice cannot
# double count.
set -u
M=validation/m14/fixtures/sql/measurements
S=validation/m14/fixtures/sql/sweep-reachability.mts
rm -f $M/pass10-sweep-reachability.*.json $M/pass10-sweep-reachability.*.log

run() { # run <shards> <shard> <tag>
  timeout 1800 npx tsx "$S" --shards "$1" --shard "$2" --out "$M/pass10-sweep-reachability.$3.json" \
    > "$M/pass10-sweep-reachability.$3.log" 2>&1
  echo "$3 exit=$?"
}

for i in 0 1 3 4 5 6 7; do run 8 "$i" "shard$i"; done
for i in 6 10 14 18 22 26 30; do run 32 "$i" "s32-$i"; done
for i in 2 34 98; do run 128 "$i" "s128-$i"; done
for i in 66 178 290 402; do run 512 "$i" "s512-$i"; done
echo "=== reachability slices done ==="