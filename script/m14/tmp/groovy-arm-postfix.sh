#!/usr/bin/env bash
# THE POST-FIX ARM. One coherent measurement of the WHOLE admitted population, after the visit-fix
# that removed the 2^depth walk: five disjoint 2,000-file gate slices (offsets 0..8000, the last one
# reaching the gate's own admitted total), the matching five census slices, then both merges.
# Every earlier chunk/census file is removed first so the closure is ONE run, not a splice of runs
# taken before and after the fix.
set -u
cd /home/ishaq2321/mcp/backbencher-brain
OUT=validation/m14/measurements/groovy-arm
LOG=script/m14/tmp/groovy-arm-run.log
: > "$LOG"
rm -f "$OUT"/chunk-*.txt "$OUT"/census-*.json
mkdir -p "$OUT"
for OFF in 0 2000 4000 6000 8000; do
  echo "  gate --offset=$OFF start $(date -Iseconds)" >> "$LOG"
  timeout 1800 bun script/m14/incoming-gate.ts groovy groovy,gvy,gradle 2000 --index --offset=$OFF \
    > "$OUT/chunk-$OFF.txt" 2>&1
  echo "  gate --offset=$OFF rc=$? $(date -Iseconds)" >> "$LOG"
  timeout 1800 bun script/m14/groovy-population-census.ts --offset=$OFF --limit=2000 --json \
    > "$OUT/census-$OFF.json" 2>&1
  echo "  census --offset=$OFF rc=$? $(date -Iseconds)" >> "$LOG"
done
timeout 900 bun script/m14/groovy-arm-merge.ts 2>&1 | head -30 >> "$LOG"
echo "  arm-merge rc=$? $(date -Iseconds)" >> "$LOG"
timeout 900 bun script/m14/groovy-census-merge.ts 2>&1 | tail -8 >> "$LOG"
echo "  census-merge rc=$? $(date -Iseconds)" >> "$LOG"
echo "  ARM DONE $(date -Iseconds)" >> "$LOG"
