#!/bin/bash
# NIM WHOLE-POPULATION ARM — the census and the arm under ONE heavy-token acquisition.
#
# THE PAIRING IS THE LEAD'S (2026-10-23): "both parse the same 6,063 files and only one of them
# needs a second process start". So this driver takes the fleet's heavy token ONCE, runs
#   1. script/m14/nim-extended-census.ts  (the four extended-type counts, with the leak guard)
#   2. script/m14/incoming-gate.ts nim nim,nims,nimble 0 --dump  (the whole-population closure)
# and releases the token at the end.
#
# THE BEAT IS A BYPRODUCT OF THE WORK, NOT A SECOND PROCESS (the scala lane's rule): the token is
# beaten whenever the RUN'S OWN OUTPUT GROWS, so the token's age IS the arm's age and a stalled arm
# stops beating at exactly the moment it stopped working.
#
# THE POPULATION IS THE GIT-TRACKED SET under the 1 MiB cap, measured by
# script/m14/nim-population.ts into validation/m14/measurements/nim-population.json (6,063 admitted
# over 8 repositories on 2026-10-23). The census READS that artifact; the arm re-derives the same
# population through incoming-gate.ts's own rule.
#
# RUN: bash script/m14/nim-whole-population-arm.sh     (in a PERSISTENT terminal session)
# EXIT: 0 = both ran and the census's guards held; 3 = token wait exceeded; 4 = census failed;
#       5 = arm failed; 6 = the arm parsed fewer files than the population holds.
set -u
cd "$(dirname "$0")/../.." || exit 2
ROOT=$PWD
LANE=nim
DATE=$(date +%F)
CENSUS_LOG="$ROOT/validation/m14/measurements/nim/nim-extended-census.txt"
CENSUS_JSON="$ROOT/validation/m14/measurements/nim-extended-census.json"
ARM_LOG="$ROOT/validation/m14/measurements/nim/nim-gate-whole-${DATE}.txt"
WAIT_MAX=${BB_NIM_WAIT_MAX:-21600}   # 6 hours; per the Lead 2026-10-23, an expiring cap is RE-ARMED, never read as a refusal
TOKEN=script/m14/arm-token.sh

beat() { bash "$TOKEN" beat "$LANE" >/dev/null 2>&1 || true; }
release() { bash "$TOKEN" release "$LANE" >/dev/null 2>&1 || true; }
# ★ ONLY RELEASE A TOKEN WE ACTUALLY TOOK. A `release` when this lane is NOT the holder exits 4
#   without moving the queue — but a trap that fires on an unrelated exit must not call into the
#   shared lock at all unless the lock is ours. MEASURED 2026-10-23: this driver's first run was
#   reaped by its job wrapper seconds after launch, its trap ran `release nim`, and the lane's
#   queue place was found GONE afterwards with no audit line naming the remover. So the guard is
#   the flag, and the queue place is re-added by this script's caller when it is not the head.
TOOK=0
trap '[ "$TOOK" = 1 ] && release; true' EXIT

echo "== NIM WHOLE-POPULATION ARM — $(date -Is) =="
echo "   population: the GIT-TRACKED set under .corpus, {nim,nims,nimble}, 1 MiB cap"
echo "   census log:  $CENSUS_LOG"
echo "   arm log:     $ARM_LOG"

# ── 1. THE TOKEN: wait for svelte (or whoever holds it) to release; nim is the queue head ──────
t0=$(date +%s)
while true; do
  if out=$(bash "$TOKEN" take "$LANE" 2>&1); then
    TOOK=1
    echo "   TOKEN TAKEN after $(( $(date +%s) - t0 ))s: $(echo "$out" | head -1)"
    break
  fi
  now=$(date +%s)
  if [ $(( now - t0 )) -ge "$WAIT_MAX" ]; then
    echo "   TOKEN WAIT EXCEEDED ${WAIT_MAX}s — last refusal: $out" >&2
    exit 3
  fi
  # Keep the queue honest and do not spin: 15 s.
  sleep 15
done

# ── the growth-beat watcher: beat only when the run's own output grows ─────────────────────────
# Args: <log> <pid>. Kills itself when the pid is gone.
beat_on_growth() {
  local log=$1 pid=$2 last=-1
  while kill -0 "$pid" 2>/dev/null; do
    local sz=0
    [ -e "$log" ] && sz=$(stat -c %s "$log" 2>/dev/null || echo 0)
    if [ "$sz" != "$last" ]; then beat; last=$sz; fi
    sleep 5
  done
}

# ── 2. THE CENSUS (the four extended-type counts; own population guard) ───────────────────────
echo "== CENSUS START $(date -Is) =="
NIM_CENSUS_BEAT=1 bun run script/m14/nim-extended-census.ts --json "$CENSUS_JSON" > "$CENSUS_LOG" 2>&1 &
CPID=$!
beat_on_growth "$CENSUS_LOG" "$CPID" &
WATCH=$!
wait "$CPID"; CEXIT=$?
kill "$WATCH" >/dev/null 2>&1 || true
beat
echo "== CENSUS EXIT $CEXIT $(date -Is) =="
if [ "$CEXIT" -ne 0 ]; then
  echo "CENSUS FAILED — see $CENSUS_LOG (exit $CEXIT)" >&2
  tail -20 "$CENSUS_LOG" >&2
  exit 4
fi
tail -6 "$CENSUS_LOG"

# ── 3. THE ARM: the whole-population closure, one run (the 2026-10-14 precedent proves feasible) ─
echo "== ARM START $(date -Is) =="
BB_CORPUS_ROOT="$ROOT/.corpus" BB_DUMP_LIMIT=2000000 \
  bun run script/m14/incoming-gate.ts "$LANE" nim,nims,nimble 0 --dump > "$ARM_LOG" 2>&1 &
APID=$!
beat_on_growth "$ARM_LOG" "$APID" &
WATCH=$!
wait "$APID"; AEXIT=$?
kill "$WATCH" >/dev/null 2>&1 || true
beat
echo "== ARM EXIT $AEXIT $(date -Is) =="
if [ "$AEXIT" -ne 0 ]; then
  echo "ARM FAILED — see $ARM_LOG (exit $AEXIT)" >&2
  tail -20 "$ARM_LOG" >&2
  exit 5
fi

# ── 4. THE POPULATION GUARD: the arm's own header must say it parsed the population ───────────
ADMITTED=$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("validation/m14/measurements/nim-population.json","utf8")).admitted)')
PARSED=$(grep -oE "population: [0-9]+ parsed of [0-9]+" "$ARM_LOG" | head -1 | grep -oE "^population: [0-9]+" | grep -oE "[0-9]+")
echo "   population guard: arm parsed ${PARSED:-?} of admitted ${ADMITTED}"
if [ "${PARSED:-0}" != "$ADMITTED" ]; then
  echo "ARM POPULATION MISMATCH — parsed ${PARSED:-?} vs admitted $ADMITTED; THIS ARM IS NOT THE POPULATION" >&2
  exit 6
fi

release
TOOK=0
trap - EXIT
echo "== DONE — token released $(date -Is) =="
grep -E "^TOTAL|^type " "$ARM_LOG" | head -15
