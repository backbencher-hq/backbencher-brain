#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# script/m14/java-arm.sh — THE JAVA LANE'S WHOLE-POPULATION ARM, with the fleet's
# liveness contract built in.
#
# WHY THIS EXISTS. The java lane's completion evidence is ONE whole-population,
# INDEXED run:
#
#   BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=3000000 \
#     bun run script/m14/incoming-gate.ts java java 0 --index --dump
#
# and it is a ~10–15 minute process. THE FLEET HAS LOST THIS SHAPE OF RUN MANY
# TIMES, each loss teaching one rule this script encodes:
#
#   1. ONE HEAVY ARM AT A TIME. The token is taken before anything is measured and
#      released on EVERY exit path (trap), so a failed arm cannot leave the fleet
#      behind a stale lock.
#   2. THE BEAT IS A BYPRODUCT OF THE WORK. `arm-token.sh beat java` is called from
#      INSIDE this loop, so the token's age IS the arm's age. No daemon, no second
#      process whose disagreement has to be resolved by reading `ps`.
#   3. THE LIVENESS TEST IS THE OUTPUT, NOT THE BEAT. A heartbeat proves the
#      heartbeat; the arm is alive when `.tmp-java/arm-current.txt` GROWS. A file
#      that has not grown for 300 s is declared DEAD whatever the beat says — and
#      killed, because a stalled arm holds the token.
#   4. BEFORE TAKING THE TOKEN, LOOK FOR A SURVIVOR. A surviving `incoming-gate`
#      for java is a SECOND heavy arm; the preflight refuses rather than stacking.
#   5. NO OFFSET SLICES FOR THIS LANE. `--index` sets `index.complete =
#      (maxFiles <= 0)` in `script/m14/incoming-gate.ts`, so an `--offset` slice is
#      a DEGRADED arm measured on an INCOMPLETE project index. A closure summed
#      from slices would not be this lane's population. If the window kills the
#      arm, the window is the limit and it is reported as the limit — a degraded
#      slice is never substituted for it.
#
# USAGE
#   bash script/m14/java-arm.sh                 # take the token (must be java's place), run, release
#   bash script/m14/java-arm.sh --no-take       # measure only if java already holds the token
#   bash script/m14/java-arm.sh --status        # print token/queue state and exit
#
# OUTPUT
#   .tmp-java/arm-current.txt      the report + the per-edge DUMP (one TSV line per
#                                  non-resolved edge; BB_DUMP_LIMIT=3000000 so the
#                                  bound cannot truncate a whole-population dump)
#   .tmp-java/arm-current.err      stderr
#   .tmp-java/arm-current.rc       the gate's own exit code
#   .tmp-java/arm-current.log      this runner's beat/liveness log
#
# NEXT STEP AFTER A GREEN ARM (the runner prints this too):
#   bun run script/m14/java-dump-classify.ts .tmp-java/arm-current.txt
#
# EXIT: the gate's own exit code; 7 when the liveness check killed a stalled arm;
#       5 when the preflight found a survivor; 0 for --status.
# ─────────────────────────────────────────────────────────────────────────────
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LANE="java"
OUT_DIR="$ROOT/.tmp-java"
OUT="$OUT_DIR/arm-current.txt"
ERR="$OUT_DIR/arm-current.err"
RC_FILE="$OUT_DIR/arm-current.rc"
LOG="$OUT_DIR/arm-current.log"
GATE="$ROOT/script/m14/incoming-gate.ts"
TOKEN="$ROOT/script/m14/arm-token.sh"
CORPUS="${BB_CORPUS_ROOT:-$ROOT/.corpus}"
STALL_LIMIT=300 # seconds without output growth before the arm is declared dead
BEAT_EVERY=20

mkdir -p "$OUT_DIR"

status() {
  bash "$TOKEN" 2>&1 | head -12
  exit 0
}

if [ "${1:-}" = "--status" ]; then status; fi

NO_TAKE=0
if [ "${1:-}" = "--no-take" ]; then NO_TAKE=1; fi

# ── PREFLIGHT 1: the corpus. An arm over an empty corpus measures nothing. ─────
if [ ! -d "$CORPUS" ]; then
  echo "java-arm: NO CORPUS at $CORPUS — set BB_CORPUS_ROOT" >&2
  exit 2
fi

# ── PREFLIGHT 2: a survivor is a second heavy arm, not a warm-up. ──────────────
SURVIVOR="$(pgrep -af "incoming-gate.ts java java" | grep -v "java-arm.sh" || true)"
if [ -n "$SURVIVOR" ]; then
  echo "java-arm: A SURVIVING JAVA GATE IS RUNNING — kill it before taking the token (a second heavy arm is not a measurement):" >&2
  echo "$SURVIVOR" >&2
  exit 5
fi

# ── THE TOKEN. Only the queue HEAD may take the ordinary token; the arm-token
#    verb refuses anything else, so this script does not invent a queue rule. ──
if [ "$NO_TAKE" -eq 0 ]; then
  echo "java-arm: taking the ordinary token for $LANE"
  if ! bash "$TOKEN" take "$LANE"; then
    echo "java-arm: TOKEN NOT TAKEN — java is not the queue head (or the machine is under the memory floor); see the token output above." >&2
    exit 3
  fi
else
  echo "java-arm: --no-take — assuming $LANE already holds the token"
fi

release() {
  bash "$TOKEN" release "$LANE" >/dev/null 2>&1 || true
  echo "java-arm: token released"
}
trap release EXIT INT TERM

# ── THE ARM. Output redirects are line-buffered by the gate's own flush points;
#    if the file does not grow for STALL_LIMIT the arm is dead whatever the beat says.
: > "$OUT"
: > "$ERR"
: > "$LOG"
echo "java-arm: START $(date -Is) — whole population, --index --dump, corpus $CORPUS" | tee -a "$LOG"
BB_CORPUS_ROOT="$CORPUS" BB_DUMP_LIMIT=3000000 \
  bun run "$GATE" "$LANE" "$LANE" 0 --index --dump > "$OUT" 2> "$ERR" &
PID=$!
echo "java-arm: gate pid $PID" | tee -a "$LOG"

LAST=0
STALL=0
while kill -0 "$PID" 2>/dev/null; do
  bash "$TOKEN" beat "$LANE" >/dev/null 2>&1 || true
  CUR="$(stat -c%s "$OUT" 2>/dev/null || echo 0)"
  if [ "$CUR" -le "$LAST" ]; then STALL=$((STALL + BEAT_EVERY)); else STALL=0; fi
  printf '%s bytes=%s stall=%ss pid=%s\n' "$(date -Is)" "$CUR" "$STALL" "$PID" | tee -a "$LOG"
  if [ "$STALL" -ge "$STALL_LIMIT" ]; then
    echo "java-arm: ARM DEAD — output has not grown for ${STALL}s; killing pid $PID (the window is the limit, not the population)" | tee -a "$LOG" >&2
    kill "$PID" 2>/dev/null || true
    sleep 2
    kill -9 "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null
    echo 7 > "$RC_FILE"
    echo "java-arm: STALLED — report the window as the limit; do NOT substitute an offset slice (--index slices are a degraded arm)." >&2
    exit 7
  fi
  LAST="$CUR"
  sleep "$BEAT_EVERY"
done
wait "$PID"
GATE_RC=$?
echo "$GATE_RC" > "$RC_FILE"
echo "java-arm: END $(date -Is) — gate exit $GATE_RC, output $(stat -c%s "$OUT" 2>/dev/null || echo 0) bytes" | tee -a "$LOG"

if [ "$GATE_RC" -ne 0 ]; then
  echo "java-arm: GATE EXITED $GATE_RC — read $ERR and the report's own verdict lines; an exit 1 is the gate's FAIL verdict (a measurement), exit 2/3 are refusals." >&2
  tail -5 "$ERR" >&2 || true
  exit "$GATE_RC"
fi

echo "java-arm: next — bun run script/m14/java-dump-classify.ts $OUT"
exit 0
