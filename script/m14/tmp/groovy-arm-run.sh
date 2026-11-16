#!/usr/bin/env bash
# THE ARM, IN FIVE DISJOINT SLICES OF THE GATE'S OWN SORTED ADMITTED LIST.
# The small slot is ALREADY HELD by groovy (taken by the lane), and the durable beat runs as a
# separate background job (`arm-token.sh loop groovy`) — a detached daemon launched from inside a
# bash call is REAPED with that call, MEASURED by the fleet three times.
# The release runs EVEN IF A SLICE FAILS.
set -u
cd <corpus-root>/mcp/backbencher-brain
OUT=validation/m14/measurements/groovy-arm
mkdir -p "$OUT"
LOG=script/m14/tmp/groovy-arm-run.log

echo "groovy arm runner started $(date -Iseconds)" >> "$LOG"
for OFF in 0 2000 4000 6000 8000; do
  echo "  slice --offset=$OFF start $(date -Iseconds)" >> "$LOG"
  timeout 3600 bun script/m14/incoming-gate.ts groovy groovy,gvy,gradle 2000 --index --offset=$OFF \
    > "$OUT/chunk-$OFF.txt" 2>&1
  RC=$?
  echo "  slice --offset=$OFF rc=$RC $(date -Iseconds)" >> "$LOG"
  # THE CENSUS SLICE, SAME OFFSET — the lane's own census over the same admitted slice.
  timeout 3600 bun script/m14/groovy-population-census.ts --offset=$OFF --limit=2000 --json \
    > "$OUT/census-$OFF.json" 2>&1
  echo "  census --offset=$OFF rc=$? $(date -Iseconds)" >> "$LOG"
done

echo "  merging $(date -Iseconds)" >> "$LOG"
timeout 600 bun script/m14/groovy-arm-merge.ts >> "$LOG" 2>&1
echo "  merge rc=$?" >> "$LOG"
timeout 600 bun script/m14/groovy-census-merge.ts >> "$LOG" 2>&1
echo "  census merge rc=$?" >> "$LOG"

bash script/m14/arm-token.sh release groovy >> "$LOG" 2>&1
echo "  released $(date -Iseconds)" >> "$LOG"
