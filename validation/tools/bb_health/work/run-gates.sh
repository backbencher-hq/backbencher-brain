#!/usr/bin/env bash
# Phase A: run every bb_health gate from the working tree, isolated BB_DATA_DIR,
# capture logs + exit codes, and keep committed validation evidence untouched
# (snapshot -> run -> restore; emission kept under gates/emitted/).
set -u
REPO="/home/ishaq2321/mcp/backbencher-brain"
OUT="$REPO/validation/tools/bb_health/gates"
LOGS="$OUT/logs"
SNAP="$OUT/evidence-snapshot"
EMITTED="$OUT/emitted"
DATA="$REPO/validation/tools/bb_health/bbdata"
mkdir -p "$LOGS" "$EMITTED"
export BB_DATA_DIR="$DATA"
export BB_NO_AUTO_REFRESH=1
export BB_M40_READ_ONLY=1
cd "$REPO" || exit 1

GATES=(
  "script/verify-health.ts"
  "script/m13/verify-health-mutability.ts"
  "script/m13/verify-health-verbose.ts"
  "script/m13/verify-health-integrity.ts"
  "script/m13/verify-health-refresh.ts"
  "script/m13/verify-health-e2e-corpus.ts"
  "script/m13/verify-health-docs.ts"
  "script/m15/verify-health-deep.ts"
  "script/m40/verify-a6-health-refresh.ts"
  "script/m51/verify-a2-health-split.ts"
  "script/m64/verify-sample-coverage.ts"
  "script/m64/verify-refresh-integrity.ts"
  "script/m64/verify-coverage-and-partial.ts"
  "script/m64/verify-freshness-reasons.ts"
  "script/m64/verify-actionability.ts"
  "script/m64/verify-unindexed.ts"
  "script/m64/verify-paths.ts"
  "script/m64/verify-embed-scan.ts"
  "script/m64/verify-wire.ts"
  "script/m64/verify-health-deep.ts"
  "script/m64/verify-evidence.ts"
)

: > "$LOGS/gates.tsv"
for gate in "${GATES[@]}"; do
  name=$(echo "$gate" | sed 's#/#__#g')
  log="$LOGS/${name}.log"
  start=$(date +%s%N)
  timeout 900 node --import tsx "$gate" > "$log" 2>&1
  code=$?
  end=$(date +%s%N)
  ms=$(( (end - start) / 1000000 ))
  printf '%s\t%s\t%s\n' "$gate" "$code" "$ms" >> "$LOGS/gates.tsv"
  echo "[$code ${ms}ms] $gate"
done

# ── keep emitted evidence in our tree; restore the committed snapshots ──────
for m in m13 m15 m40 m51 m64; do
  srcdir="$REPO/validation/$m/results"
  [ -d "$srcdir" ] || continue
  mkdir -p "$EMITTED/$m"
  # move files that did not exist before the run
  for f in "$srcdir"/*.json; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    if [ ! -e "$SNAP/$m/$base" ]; then
      mv "$f" "$EMITTED/$m/$base"
    fi
  done
  # restore modified files from the snapshot
  if [ -d "$SNAP/$m" ]; then
    for f in "$SNAP/$m"/*.json; do
      [ -e "$f" ] || continue
      base=$(basename "$f")
      cp -p "$f" "$srcdir/$base"
    done
  fi
done

echo "GATE RUN COMPLETE"
