#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# erlang ARM RUNNER — the whole-population work in ONE token acquisition.
#
# WHAT IT RUNS, AND WHY THESE TWO IN ONE ACQUISITION:
#   1. THE CENSUS (`script/m14/erlang-extended-census.ts --cap=0`). Parse-only + analyzer,
#      one parse per file, tree.delete() in a finally, writing
#      validation/m14/measurements/erlang-extended-census.json: the three denominators, the
#      construct counters the four extended-type dispositions rest on (declared zeros + the
#      counted near misses), and the per-repository declared-name index the cause census reads.
#   2. THE ARBITER (`script/m14/incoming-gate.ts erlang erl,hrl 0 --dump`). One arm over the
#      WHOLE admitted population, writing TABLE 1 (the eleven-term closure) and the per-edge
#      DUMP rows. BB_DUMP_LIMIT is set high so the dump is not a prefix; the reader refuses a
#      truncated dump.
#   One acquisition for both, because a lane that takes the token twice spends the queue twice
#   and the two halves can be interleaved by another lane — at which point the two instruments
#   measured different machine states and neither is the other's control.
#
# THE BEAT, HONESTLY (fleet rule, the twelfth form): the beat is a byproduct of the work.
#   · the census beats from its own loop (`--beat-every=500`);
#   · the arbiter is Lead-owned and cannot be edited, so this runner keeps a watcher alive FOR
#     EXACTLY THE LIFETIME OF THE GATE PROCESS: it beats when the output files have GROWN since
#     the last check, and stops when the gate exits. It cannot outlive the arm.
#   · LIVENESS IS THE OUTPUT GROWING, NOT THE TOKEN'S BEAT. If the output has not grown 300 s
#     after the last change, the watcher says so LOUDLY (a dead arm with a live beat has happened
#     twice in this fleet); it does not silently wait on a beat.
#
# PREFLIGHT: refuses unless the token is held by erlang — a runner that starts a whole-population
# arm without the token is the exact defect the token exists to prevent.
#
# USAGE
#   bash script/m14/erlang-arm-run.sh                # census + arm, then release the token
#   bash script/m14/erlang-arm-run.sh --no-release   # keep the token for a second pass
#
# EXIT: 0 both instruments completed and the population closed · 2 preflight/environment ·
#       3 an instrument failed (partial output is NOT promoted) · 4 the population did not close.
# ─────────────────────────────────────────────────────────────────────────────
set -u
LANE=erlang
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO" || exit 2

RELEASE=1
[ "${1:-}" = "--no-release" ] && RELEASE=0

OUT_DIR="validation/m14/measurements"
mkdir -p "$OUT_DIR"
CENSUS_OUT="$OUT_DIR/erlang-extended-census.json"
CENSUS_LOG="$OUT_DIR/erlang-extended-census.stderr.log"
ARM_LOG="$OUT_DIR/erlang-gate-whole-2026-10-23.log"
ARM_ERR="$OUT_DIR/erlang-gate-whole-2026-10-23.stderr.log"

say() { printf '%s\n' "$*"; }

# ── preflight ───────────────────────────────────────────────────────────────
ARM_STATUS="$(bash script/m14/arm-token.sh status 2>&1 | head -1)"
case "$ARM_STATUS" in
  *"HELD by $LANE"*) say "preflight: token held by $LANE — $ARM_STATUS" ;;
  *)
    say "REFUSED — the arm token is not held by this lane."
    say "  status: $ARM_STATUS"
    say "  take it when the queue reaches erlang: bash script/m14/arm-token.sh take $LANE"
    exit 2
    ;;
esac
if [ ! -d "$REPO/.corpus" ]; then say "REFUSED — .corpus is absent; the population would be zero."; exit 2; fi
AVAIL_MB="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null)"
say "memory at start: MemAvailable ${AVAIL_MB:-?} MB"

# ── 1. THE CENSUS ───────────────────────────────────────────────────────────
say ""
say "=== 1/2 CENSUS — whole admitted population (construct counters + declared-name index) ==="
say "BB_CORPUS_ROOT=$REPO/.corpus bun script/m14/erlang-extended-census.ts --cap=0 --beat-every=500"
BB_CORPUS_ROOT="$REPO/.corpus" bun script/m14/erlang-extended-census.ts \
  --cap=0 --beat-every=500 --out "$CENSUS_OUT" 2> "$CENSUS_LOG" > /dev/null
CENSUS_RC=$?
tail -n 6 "$CENSUS_LOG" 2>/dev/null | sed 's/^/  /'
if [ "$CENSUS_RC" -ne 0 ] || [ ! -s "$CENSUS_OUT" ]; then
  say "CENSUS FAILED (exit $CENSUS_RC) — the population did not close on itself; the arm is NOT run and the token is released."
  [ "$RELEASE" = 1 ] && bash script/m14/arm-token.sh release "$LANE" >/dev/null 2>&1
  exit 3
fi
say "census artifact: $CENSUS_OUT"

# ── 2. THE ARBITER, with a liveness watcher that cannot outlive it ──────────
say ""
say "=== 2/2 ARBITER — one arm over the whole population, dump high enough to be complete ==="
say "BB_CORPUS_ROOT=$REPO/.corpus BB_DUMP_LIMIT=2000000 npx tsx script/m14/incoming-gate.ts $LANE erl,hrl 0 --dump"
: > "$ARM_LOG"
: > "$ARM_ERR"
(
  BB_CORPUS_ROOT="$REPO/.corpus" BB_DUMP_LIMIT=2000000 \
    npx tsx script/m14/incoming-gate.ts "$LANE" erl,hrl 0 --dump \
    > "$ARM_LOG" 2> "$ARM_ERR"
) &
GATE_PID=$!
say "gate pid $GATE_PID — watching output growth (the liveness test is the OUTPUT, not the beat)"

last_size=-1
last_change=$(date +%s)
last_beat=0
while kill -0 "$GATE_PID" 2>/dev/null; do
  sleep 10
  s1=$(stat -c%s "$ARM_LOG" 2>/dev/null || echo 0)
  s2=$(stat -c%s "$ARM_ERR" 2>/dev/null || echo 0)
  size=$((s1 + s2))
  now=$(date +%s)
  if [ "$size" -ne "$last_size" ]; then
    last_size=$size
    last_change=$now
    if [ $((now - last_beat)) -ge 60 ]; then
      bash script/m14/arm-token.sh beat "$LANE" >/dev/null 2>&1 && last_beat=$now
    fi
    say "  [$(date +%H:%M:%S)] output ${size} bytes (stdout ${s1}) · rss $(awk '/VmRSS/ {print int($2/1024)" MB"}' /proc/$GATE_PID/status 2>/dev/null || echo '?')"
  else
    # KEEPALIVE: a runner whose terminal goes quiet is treated as idle by the harness, and the
    # fleet's rule is that the OUTPUT is the liveness signal. One line per check, cheap and honest.
    say "  [$(date +%H:%M:%S)] waiting · output ${size} bytes · unchanged for $((now - last_change))s"
  fi
  if [ $((now - last_change)) -ge 300 ]; then
    say "  *** THE OUTPUT HAS NOT GROWN FOR $((now - last_change)) s — BY THE FLEET'S OWN LIVENESS TEST THIS ARM IS DEAD, WHATEVER THE TOKEN'S BEAT SAYS. ***"
    say "  *** stdout ${s1} bytes · stderr ${s2} bytes · the last 5 stderr lines: ***"
    tail -n 5 "$ARM_ERR" 2>/dev/null | sed 's/^/      /'
    last_change=$now
  fi
done
wait "$GATE_PID"
GATE_RC=$?
say "gate exited $GATE_RC"
tail -n 3 "$ARM_ERR" 2>/dev/null | sed 's/^/  stderr: /'

# ── THE POPULATION MUST CLOSE, AND SO MUST THE DUMP ─────────────────────────
POP_LINE="$(grep -m1 '^population: ' "$ARM_LOG" 2>/dev/null || true)"
say "arm population line: ${POP_LINE:-MISSING}"
if [ -z "$POP_LINE" ]; then
  say "REFUSED — the arm printed no population line; no artifact is promoted."
  [ "$RELEASE" = 1 ] && bash script/m14/arm-token.sh release "$LANE" >/dev/null 2>&1
  exit 4
fi
if ! grep -q '^TABLE 1 —' "$ARM_LOG"; then
  say "REFUSED — the arm printed no TABLE 1."
  [ "$RELEASE" = 1 ] && bash script/m14/arm-token.sh release "$LANE" >/dev/null 2>&1
  exit 4
fi
if grep -q 'DUMP	BOUND' "$ARM_LOG" || grep -q 'DUMP TRUNCATED' "$ARM_LOG"; then
  say "REFUSED — THE DUMP IS TRUNCATED (the bound marker is in the log). The cause partition would be over a prefix."
  [ "$RELEASE" = 1 ] && bash script/m14/arm-token.sh release "$LANE" >/dev/null 2>&1
  exit 4
fi
say "dump rows: $(grep -c '^DUMP	' "$ARM_LOG" 2>/dev/null || echo 0) (unresolved: $(grep -c '^DUMP	[^	]*	unresolved	' "$ARM_LOG" 2>/dev/null || echo 0))"

if [ "$RELEASE" = 1 ]; then
  bash script/m14/arm-token.sh release "$LANE" >/dev/null 2>&1 && say "ARM TOKEN RELEASED by $LANE"
else
  say "token NOT released (--no-release)"
fi
say ""
say "DONE — artifacts:"
say "  $CENSUS_OUT"
say "  $ARM_LOG"
say "  $ARM_ERR"
exit 0
