#!/usr/bin/env bash
# ⇒⇒⇒ THE ARM WITH THE PULSE INSIDE IT ✓✓ — the fleet's structural fix, as a wrapper ✓✓.
#
# ⇒⇒⇒ WHY A WRAPPER AND NOT A DAEMON ✓✓: a beat daemon and an arm are two processes and they can
# disagree — the daemon keeps a dead token warm, or the arm runs and the daemon dies so the token
# reads STALE mid-flight ✓✓. Both happened on this box today, three holders in a row, and the fleet
# spent four hours in a 20-GB swap for it ✓✓.
#
# ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ HERE THE BEAT IS EMITTED ONLY WHEN THE GATE'S OWN OUTPUT GREW ✓✓.** The log's SIZE is
# the arm's progress, so the token's age is the arm's age, a stalled arm stops beating exactly when it
# stopped working, and there is one liveness signal that cannot disagree with itself ✓✓.
#
# Usage: bash script/m14/javascript-arm-beating.sh <log-path> [extra gate args...]
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="${1:?usage: javascript-arm-beating.sh <log-path> [gate args]}"
shift
cd "$ROOT"

EXT="js,mjs,cjs,jsx"
: > "$LOG"

BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/incoming-gate.ts javascript "$EXT" 0 "$@" >> "$LOG" 2>&1 &
GATE_PID=$!

LAST_SIZE=-1
BEATS=0
while kill -0 "$GATE_PID" 2>/dev/null; do
  sleep 60
  kill -0 "$GATE_PID" 2>/dev/null || break
  SIZE=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt "$LAST_SIZE" ]; then
    LAST_SIZE="$SIZE"
    BEATS=$((BEATS + 1))
    bash script/m14/arm-token.sh beat javascript > /dev/null 2>&1 \
      && echo "[beat $BEATS] gate log ${SIZE} bytes — growing, so the arm is alive" >> "$LOG"
  else
    echo "[NO BEAT] gate log still ${SIZE} bytes after 60s — the arm is NOT growing, and a stalled arm is not a live arm" >> "$LOG"
  fi
done

wait "$GATE_PID"
RC=$?
echo "[gate exit $RC] after ${BEATS} live beat(s)" >> "$LOG"
exit "$RC"
