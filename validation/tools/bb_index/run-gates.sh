#!/usr/bin/env bash
# Phase-A gate battery for bb_index. Every gate runs from the working tree with an
# ISOLATED BB_DATA_DIR (validation/tools/bb_index/bbdata) and a per-gate log.
# The shared .bb-data index is never named here.
set -u
cd "$(dirname "$0")/../../.." || exit 1
OUT="validation/tools/bb_index/audit/gates"
mkdir -p "$OUT"
export BB_DATA_DIR="$PWD/validation/tools/bb_index/bbdata"
export BB_NO_AUTO_REFRESH=1
RESULTS="$OUT/results.tsv"
touch "$RESULTS"

run() {
  local name="$1"; shift
  local log="$OUT/$name.log"
  local start end rc
  if grep -qP "^$name\t0\t" "$RESULTS" 2>/dev/null; then echo "GATE $name already green"; return 0; fi
  start=$(date +%s)
  timeout 900 "$@" > "$log" 2>&1
  rc=$?
  end=$(date +%s)
  printf '%s\t%s\t%s\n' "$name" "$rc" "$((end - start))" >> "$RESULTS"
  echo "GATE $name exit=$rc secs=$((end - start))"
}

run verify-index          npx tsx script/verify-index.ts
run m40-a1-post-entry     bun run script/m40/verify-a1-post-entry.ts
run m40-a2-bounded-post   bun run script/m40/verify-a2-bounded-post.ts
run m40-a3-write-parity   bun run script/m40/verify-a3-write-parity.ts
run m40-a5-flag-semantics bun run script/m40/verify-a5-flag-semantics.ts
run m40-a6-health-refresh bun run script/m40/verify-a6-health-refresh.ts
run m40-a9-purge          bun run script/m40/verify-a9-purge.ts
run m43-p1-index-lock     bun run script/m43/verify-p1-index-lock.ts
run m43-a1-mcp-auto-refresh bun run script/m43/verify-a1-mcp-auto-refresh.ts
run m43-a2-cli-auto-refresh bun run script/m43/verify-a2-cli-auto-refresh.ts
run m43-a3-flag-semantics bun run script/m43/verify-a3-flag-semantics.ts
run m43-a4-corpus         bun run script/m43/verify-a4-corpus.ts
run m28-index-portability npx tsx script/m28/verify-index-portability.ts
run m22-e1-mcp            bun run script/m22/verify-e1-mcp.ts
run m22-d3-single-file    bun run script/m22/verify-d3-single-file.ts
run m22-c2-help           bun run script/m22/verify-c2-help.ts
run m64-paths             npx tsx script/m64/verify-paths.ts
run m64-unindexed         npx tsx script/m64/verify-unindexed.ts
run m64-refresh-integrity npx tsx script/m64/verify-refresh-integrity.ts
echo "GATE BATTERY DONE"
