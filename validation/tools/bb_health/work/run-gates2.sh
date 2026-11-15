#!/usr/bin/env bash
# Phase B red-then-green run: every bb_health gate, isolated data dir, canonical
# evidence snapshotted and restored, fresh H-evidence kept under
# validation/tools/bb_health/evidence/m13 for the docs gate.
set -u
REPO="/home/ishaq2321/mcp/backbencher-brain"
OUT="$REPO/validation/tools/bb_health/gates"
LOGS="$OUT/logs-phaseB"; SNAP="$OUT/evidence-snapshot2"; EMIT="$OUT/emitted2"
DATA="$REPO/validation/tools/bb_health/bbdata"
EVID="$REPO/validation/tools/bb_health/evidence/m13"
mkdir -p "$LOGS" "$EMIT" "$EVID" "$SNAP"
for m in m13 m15 m40 m51 m64; do mkdir -p "$SNAP/$m" "$EMIT/$m"; done
cp -p "$REPO"/validation/m13/results/h*.json "$SNAP/m13/" 2>/dev/null
cp -p "$REPO"/validation/m15/results/h*.json "$SNAP/m15/" 2>/dev/null
cp -p "$REPO"/validation/m40/results/A6*.json "$SNAP/m40/" 2>/dev/null
cp -p "$REPO"/validation/m51/results/A2*.json "$SNAP/m51/" 2>/dev/null
cp -p "$REPO"/validation/m64/results/*.json "$SNAP/m64/" 2>/dev/null
export BB_DATA_DIR="$DATA"
export BB_NO_AUTO_REFRESH=1
export BB_M40_READ_ONLY=1
cd "$REPO" || exit 1
: > "$LOGS/gates.tsv"
run() {
  local name="$1"; shift
  local log="$LOGS/$name.log"
  local start=$(date +%s%N)
  timeout 900 "$@" > "$log" 2>&1
  local code=$?
  local ms=$(( ($(date +%s%N) - start) / 1000000 ))
  local tail1
  tail1=$(grep -E "VERIFIED|KNOWN-GAP|PASS|FAILURES|FAIL:|FATAL|A2:|A6 health" "$log" | tail -2 | tr '\n' ' ')
  printf '%s\t%s\t%s\t%s\n' "$name" "$code" "$ms" "$tail1" | tee -a "$LOGS/gates.tsv"
  return 0
}
run verify-health npx tsx script/verify-health.ts
run m13-mutability npx tsx script/m13/verify-health-mutability.ts
cp -p "$REPO"/validation/m13/results/h1.json "$EVID/" 2>/dev/null
run m13-verbose npx tsx script/m13/verify-health-verbose.ts
cp -p "$REPO"/validation/m13/results/h2.json "$EVID/" 2>/dev/null
run m13-integrity npx tsx script/m13/verify-health-integrity.ts
cp -p "$REPO"/validation/m13/results/h3.json "$EVID/" 2>/dev/null
run m13-refresh npx tsx script/m13/verify-health-refresh.ts
cp -p "$REPO"/validation/m13/results/h4.json "$EVID/" 2>/dev/null
run m13-e2e npx tsx script/m13/verify-health-e2e-corpus.ts
cp -p "$REPO"/validation/m13/results/h5.json "$EVID/" 2>/dev/null
run m13-docs bun run script/m13/verify-health-docs.ts
run m15-deep npx tsx script/m15/verify-health-deep.ts
run m40-a6 npx tsx script/m40/verify-a6-health-refresh.ts
run m51-a2 npx tsx script/m51/verify-a2-health-split.ts
run m64-sample-coverage npx tsx script/m64/verify-sample-coverage.ts
run m64-refresh-integrity npx tsx script/m64/verify-refresh-integrity.ts
run m64-coverage-partial npx tsx script/m64/verify-coverage-and-partial.ts
run m64-freshness-reasons npx tsx script/m64/verify-freshness-reasons.ts
run m64-actionability npx tsx script/m64/verify-actionability.ts
run m64-unindexed npx tsx script/m64/verify-unindexed.ts
run m64-paths npx tsx script/m64/verify-paths.ts
run m64-embed-scan npx tsx script/m64/verify-embed-scan.ts
run m64-wire bun run script/m64/verify-wire.ts
run m64-health-deep npx tsx script/m64/verify-health-deep.ts
run m64-evidence npx tsx script/m64/verify-evidence.ts
# restore canonical evidence; keep any file the gates created new
for m in m13 m15 m40 m51 m64; do
  d="$REPO/validation/$m/results"; [ -d "$d" ] || continue
  for f in "$d"/*.json; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    if [ -e "$SNAP/$m/$b" ]; then cp -p "$SNAP/$m/$b" "$f"; else mv "$f" "$EMIT/$m/$b"; fi
  done
done
echo "PHASE B GATE RUN COMPLETE"
