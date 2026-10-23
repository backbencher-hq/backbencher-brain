#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SVELTE LANE — THE HEAD ARM. One command, one token, the Lead's order, four artifacts.
#
# WHAT IT DOES, IN THE ORDER THE LEAD SET (2026-10-23): the HEAD whole-population closure FIRST
# (both Lead instruments), then the extended provenance census, then the token is released.
#
# WHY EACH RUN IS SAFE TO PUBLISH: every one of them prints its own population rule; the census runs
# FIVE control arms before any corpus number and refuses a run whose production parse-failure rate
# exceeds 1 % (a bricked wasm parser would otherwise print a fraction as the population); the two
# Lead instruments are the same ones the coverage and completion gates read.
#
# THE BEAT IS A BYPRODUCT OF THE ARM'S OUTPUT. `arm-token.sh beat svelte` is called from the pipeline
# that reads each instrument's own stdout, so the token's age IS the arm's age and a stalled arm
# stops beating at the moment it stopped working — the fleet's rule, implemented here rather than in
# a second daemon.
#
# THE TOKEN IS TAKEN BY THE RUNNER, AND ITS REFUSAL IS RESPECTED: take refuses a lane that is not at
# the queue head, and refuses below a 1,200 MB memory floor. A refusal here means NOTHING RAN.
#
# USAGE
#   script/m14/svelte-head-arm.sh                 # the full arm (takes/releases the token)
#   script/m14/svelte-head-arm.sh --bounded-check # plumbing check: census on 60 files, NO token
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

TOKEN="script/m14/arm-token.sh"
LANE=svelte
OUTDIR="validation/m14/measurements"
STAMP="$(date +%Y%m%dT%H%M%S)"
export BB_CORPUS_ROOT="${BB_CORPUS_ROOT:-$ROOT/.corpus}"
MODE="${1:-arm}"

mkdir -p "$OUTDIR"

TOOK=0
cleanup() {
  if [ "$TOOK" = "1" ]; then
    "$TOKEN" release "$LANE" >/dev/null 2>&1 || true
    echo "== token released for $LANE =="
  fi
}
trap cleanup EXIT INT TERM

# run_with_beat NAME -- COMMAND...
# Each output line is printed and teed to the artifact; the token is beaten at most every 10 s and at
# every 50th line, so the beat follows the arm's OWN output growth (the fleet's rule).
run_with_beat() {
  local name="$1"
  shift
  local out="$OUTDIR/svelte-head-$name-$STAMP.txt"
  local last_beat lines=0 rc
  last_beat="$(date +%s)"
  echo "== $name =="
  echo "   artifact: $out"
  ( "$@" 2>&1 ) | while IFS= read -r line; do
    printf '%s\n' "$line"
    lines=$((lines + 1))
    local now
    now="$(date +%s)"
    if [ "$TOOK" = "1" ] && { [ $((now - last_beat)) -ge 10 ] || [ $((lines % 50)) -eq 0 ]; }; then
      "$TOKEN" beat "$LANE" >/dev/null 2>&1 || true
      last_beat="$now"
    fi
  done | tee "$out"
  rc=$?
  # A GATE'S VERDICT IS NOT AN INSTRUMENT FAILURE. incoming-gate.ts exits 1 when its CLAUSE-1 verdict
  # is FAIL — for a lane whose declaration is DERIVED from that FAIL (the ruby precedent), exit 1 IS
  # the measurement. So a stage may DECLARE the exits it accepts; a non-accepted exit stops the arm.
  # An accepted non-zero exit is still only publishable if the artifact proves the run COMPLETED:
  # the gate's own "instrument self-test: PASS" line is that proof.
  local allowed="${ALLOWED_RC:-0}"
  if ! printf ' %s ' "$allowed" | grep -qF " $rc "; then
    echo "!! $name EXITED $rc (allowed: $allowed) — stopping the arm; the artifact is retained but NOT publishable." >&2
    exit 4
  fi
  if [ "$rc" -ne 0 ]; then
    if ! grep -q "instrument self-test: PASS" "$out"; then
      echo "!! $name EXITED $rc with NO 'instrument self-test: PASS' in the artifact — the run did not" >&2
      echo "   complete (a crashed run also exits non-zero); the artifact is NOT publishable." >&2
      exit 4
    fi
    echo "   $name ok — exit $rc is the GATE'S VERDICT (recorded as an outcome), and the run's own self-test PASS is present"
  else
    echo "   $name ok"
  fi
}

if [ "$MODE" = "--bounded-check" ]; then
  echo "== BOUNDED CHECK (no token, declared validation only) =="
  "$TOKEN" status 2>/dev/null || true
  run_with_beat "census-bounded-check" \
    bun run script/m14/svelte-extended-census.ts --sample=60
  echo "== BOUNDED CHECK COMPLETE — this is NOT a measurement and wrote no population claim =="
  exit 0
fi

# ── `--census-only`: take the arm, run ONLY the extended census, release. For the census re-run after
#    a census-instrument repair, when the two Lead closure instruments are already measured at this
#    HEAD (their artifacts exist and are stamped). It is still a whole-population arm: one heavy run.
if [ "$MODE" = "--census-only" ]; then
  echo "== CENSUS-ONLY ARM (one heavy run; the closure instruments are already measured) =="
  if ! "$TOKEN" take "$LANE"; then
    echo "REFUSED — this lane's turn has not arrived (or the memory floor refused). NOTHING WAS RUN." >&2
    exit 3
  fi
  TOOK=1
  echo "== $LANE holds the arm =="
  run_with_beat "extended-census" \
    bun run script/m14/svelte-extended-census.ts \
      --progress "validation/m14/measurements/svelte-census-progress-$STAMP.txt" \
      --out "validation/m14/measurements/svelte-extended-census-$STAMP.json"
  echo
  echo "== CENSUS-ONLY ARM COMPLETE =="
  ls -la "$OUTDIR"/svelte-head-extended-census-"$STAMP".txt "$OUTDIR"/svelte-extended-census-"$STAMP".json "$OUTDIR"/svelte-census-progress-"$STAMP".txt 2>/dev/null || true
  grep -hE "^files measured|^BUILD PRECONDITIONS|REACHABLE|unreachable|part_of CAN|^elapsed" "$OUTDIR"/svelte-head-extended-census-"$STAMP".txt 2>/dev/null | head -14 || true
  exit 0
fi

echo "== TAKE THE ARM (refuses unless $LANE is queue head and >=1,200 MB is available) =="
if ! "$TOKEN" take "$LANE"; then
  echo "REFUSED — this lane's turn has not arrived (or the memory floor refused). NOTHING WAS RUN." >&2
  exit 3
fi
TOOK=1
echo "== $LANE holds the arm =="

# 1 · THE HEAD WHOLE-POPULATION CLOSURE — the residual gate (buckets + per-type CLOSURE lines).
run_with_beat "residual-gate" \
  npx tsx script/m14/residual-gate.ts --lane "$LANE"

# 2 · THE HEAD ELEVEN-TERM CLOSURE — the incoming gate over the WHOLE admitted set.
# THE CANONICAL WHOLE-POPULATION FORM IS `<lang> 0`, NOT `<lang> <lang> 0` (Lead, MEASURED 2026-10-23):
# the gate reads the lane's spellings from the ONE router table only when the extension argument is
# OMITTED, and a NUMERIC second argument is the file count. Passing a spelling gives an explicit set
# the gate honours deliberately — cpp did that and measured 15% of its own population. `0` here means
# NO CAP. The artifact prints which source the extension came from, so a wrong invocation is visible.
# Exit 1 is ACCEPTED on purpose: the gate exits 1 on a CLAUSE-1 verdict FAIL, and this lane's
# declaration IS derived from that FAIL (the same form the ruby declaration uses). The runner still
# requires the artifact to carry the gate's own "instrument self-test: PASS".
ALLOWED_RC="0 1"
run_with_beat "incoming-table1" \
  npx tsx script/m14/incoming-gate.ts "$LANE" 0
ALLOWED_RC="0"

# 3 · THE EXTENDED PROVENANCE CENSUS — emission leg (with sfcDelegated provenance) + AST construct leg.
# `--progress` names the last file in the artifact AND on stdout (so the beat follows real growth and a
# hang names its file instead of looking like a slow population — the fleet's rule).
run_with_beat "extended-census" \
  bun run script/m14/svelte-extended-census.ts \
    --progress "validation/m14/measurements/svelte-census-progress-$STAMP.txt" \
    --out "validation/m14/measurements/svelte-extended-census-$STAMP.json"

echo
echo "== ARM COMPLETE — artifacts =="
ls -la "$OUTDIR"/svelte-head-*-"$STAMP".txt "$OUTDIR"/svelte-extended-census-"$STAMP".json 2>/dev/null || true
echo
echo "== population / closure headlines =="
grep -hE "^population|^files measured|^  TOTAL|CLOSURE|edges [0-9]" "$OUTDIR"/svelte-head-*-"$STAMP".txt 2>/dev/null | head -20 || true
