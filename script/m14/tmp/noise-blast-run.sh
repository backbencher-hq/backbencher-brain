#!/usr/bin/env bash
# Runner: blast-radius scan for the pool-worker leaf fix (objc lane, M60).
set -u
cd <corpus-root>/mcp/backbencher-brain
BB_FILTER_LOG=/tmp/noise-blast.log
echo "=== start $(date -Is) ===" > "$BB_FILTER_LOG"
bun script/m14/tmp/noise-filter-blast.ts <corpus-root>/bb_tests/repositories 60 >> "$BB_FILTER_LOG" 2>&1
echo "=== exit $? $(date -Is) ===" >> "$BB_FILTER_LOG"
