#!/usr/bin/env bash
# THE TAIL OF THE ARM, BISECTED. The [7900, 102) range hangs the fleet's own gate at 2,000-, 500-,
# 100- and 50-file granularity, so it is re-cut at 10 files per slice with a hard per-slice timeout.
# The tiling rule is unchanged: the slices must abut, start at 0, and reach the gate's own admitted
# total (8,102). A slice that TIMES OUT is recorded as a hang with its own offset, never silently.
set -u
cd /home/ishaq2321/mcp/backbencher-brain
OUT=validation/m14/measurements/groovy-arm
LOG=script/m14/tmp/groovy-arm-run.log
for OFF in $(seq 7900 10 8100); do
  echo "  b10 --offset=$OFF start $(date -Iseconds)" >> "$LOG"
  timeout 45 bun script/m14/incoming-gate.ts groovy groovy,gvy,gradle 10 --index --offset=$OFF \
    > "$OUT/chunk-$OFF.txt" 2>&1
  RC=$?
  echo "  b10 --offset=$OFF rc=$RC $(date -Iseconds)" >> "$LOG"
  if [ "$RC" = "124" ]; then rm -f "$OUT/chunk-$OFF.txt"; fi
done
echo "  b10 done $(date -Iseconds)" >> "$LOG"
