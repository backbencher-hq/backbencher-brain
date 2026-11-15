#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# take-and-run-c-arms.sh — WAIT for the arm token, take it, run the c lane's arms, release it.
#
# The fleet runs eight lanes at once and the token is the fleet's ONE heavy arm. This script
# waits for it (bounded), takes it atomically (mkdir), runs the c lane's three arms with a
# heartbeat between them, and releases it in a trap — so a crash cannot leave the fleet's arm
# resource locked.
#
#   ARM A-BEFORE : the HEAD analyzer (git show HEAD:… — a READ), on the RECORDED population (`.c`)
#   ARM A-AFTER  : the lane's analyzer, on the SAME population and the SAME root
#   ARM B-AFTER  : the gate's OWN map (`c,h`) — 20,824 files on the farm, against A's 5,022
#
# NOTHING DESTRUCTIVE: the analyzer file is swapped with `cp` and always restored by the trap.
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/../../../../.." || exit 2
ROOT="$(pwd)"
TOKEN="script/m14/arm-token.sh"
LOGDIR="validation/m14/fixtures/c/measurements"
DEADLINE=$(( $(date +%s) + 21600 ))
RESTORE="$(mktemp)"

echo "[$(date +%H:%M:%S)] waiting for the arm token — c is QUEUED, and the token script refuses an out-of-order take, so this only succeeds when c reaches the head…"
while :; do
  if bash "$TOKEN" take c >/dev/null 2>&1; then
    echo "[$(date +%H:%M:%S)] TOKEN TAKEN by c"
    break
  fi
  now=$(date +%s)
  if [ "$now" -ge "$DEADLINE" ]; then
    echo "[$(date +%H:%M:%S)] TIMED OUT waiting for the token — the arms were NOT run."
    exit 3
  fi
  sleep 30
done

release() {
  # RESTORE THE ANALYZER THAT WAS IN THE TREE WHEN THE ARM STARTED — not a snapshot. The lane may
  # have changed the analyzer after this script was written, and a restore that overwrites the
  # working tree with an OLDER version of the lane's own file would silently undo work.
  if [ -f "$RESTORE" ]; then cp "$RESTORE" src/ast/real-c-analyzer.ts; rm -f "$RESTORE"; fi
  bash "$TOKEN" release c >/dev/null 2>&1 || true
  echo "[$(date +%H:%M:%S)] TOKEN RELEASED"
}
trap release EXIT INT TERM

# THE INSTRUMENT DIGEST — a reader must be able to tell WHICH INSTRUMENT produced a number, and a
# COMMIT IS NOT ENOUGH: the arbiter's source can change without its commit changing (uncommitted
# work), and the own-file tie-break (2026-10-20 21:14) and the externalTarget/externalVia key-space
# change are exactly the kind of change that moves a column. So each arm's log carries the digest of
# the arbiter AND of the analyzer as they stood WHEN THAT ARM RAN.
instrument_digests() {
  local arb analyzer
  arb=$(cat script/m14/incoming-rule.ts script/m14/incoming-gate.ts | sha256sum | cut -d" " -f1)
  analyzer=$(sha256sum src/ast/real-c-analyzer.ts | cut -d" " -f1)
  echo "INSTRUMENT DIGESTS — THIS ARM RAN ON EXACTLY THESE"
  echo "  arbiter  sha256(incoming-rule.ts + incoming-gate.ts) = $arb"
  echo "  analyzer sha256(src/ast/real-c-analyzer.ts)           = $analyzer"
  echo "  corpus root = $ROOT/.corpus"
}

run_arm() { # $1 = label, $2 = ext-list
  local label="$1" exts="$2"
  local log="$LOGDIR/c-arm-${label}.txt"
  echo "[$(date +%H:%M:%S)] ARM ${label}: incoming-gate c ${exts} 0   (root: $ROOT/.corpus)"
  # THE DIGEST HEADER, written INTO the arm's own log, so the log is self-describing. The gate's
  # output goes to a body file and the two are concatenated AFTER it, because the redirection would
  # otherwise truncate the header away.
  instrument_digests > "$log.digests.txt"
  ( cd "$ROOT" && BB_CORPUS_ROOT="$ROOT/.corpus" timeout 3600 bun run script/m14/incoming-gate.ts c "$exts" 0 ) > "$log.body.txt" 2>&1
  local arm_exit=$?
  cat "$log.digests.txt" "$log.body.txt" > "$log"
  rm -f "$log.body.txt" "$log.digests.txt"
  echo "[$(date +%H:%M:%S)] ARM ${label} exit $arm_exit  → $log"
  bash "$TOKEN" beat c >/dev/null 2>&1 || true
}

# ── ARM A-BEFORE: the HEAD analyzer on the recorded population ─────────────────────────────
cp src/ast/real-c-analyzer.ts "$RESTORE"   # the LIVE file, to be put back when the arm ends
cp validation/m14/fixtures/c/tmp/real-c-analyzer.HEAD.ts src/ast/real-c-analyzer.ts
echo "[$(date +%H:%M:%S)] swapped in the HEAD analyzer"
run_arm "A-BEFORE" "c"

# ── ARM A-AFTER: the lane's analyzer, same command, same population ─────────────────────────
cp validation/m14/fixtures/c/tmp/real-c-analyzer.AFTER.ts src/ast/real-c-analyzer.ts
echo "[$(date +%H:%M:%S)] swapped in the lane's analyzer"
run_arm "A-AFTER" "c"

# ── ARM B-AFTER: the gate's OWN map (`.h` admitted) — the population re-arm + Ruling 1 ──────
run_arm "B-AFTER" "c,h"

echo "[$(date +%H:%M:%S)] all three arms done"
