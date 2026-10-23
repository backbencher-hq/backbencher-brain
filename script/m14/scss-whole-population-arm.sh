#!/bin/bash
# SCSS WHOLE-POPULATION ARM — the census and the arm under ONE heavy-token acquisition.
#
# THE PAIRING IS THE NIM DRIVER'S (2026-10-23): both parse the same 4,433 admitted files and only
# one of them needs the fleet's heavy token, so the token is taken ONCE, the extended-type census
# runs first (it shapes the declaration's walls), then `incoming-gate.ts` runs the whole-population
# closure. The token is released at the end, on every path.
#
# THE BEAT IS A BYPRODUCT OF THE WORK, NOT A SECOND PROCESS (the scala lane's rule, and this
# environment has killed five runners that trusted a daemon): the token is beaten whenever the
# RUN'S OWN OUTPUT GROWS, so the token's age IS the arm's age. The liveness test for a human is
# that the OUTPUT FILE GROWS, not that the token looks live.
#
# THE POPULATION IS THE GIT-TRACKED SET under the 1 MiB cap, measured by
# `script/m14/scss-population.ts` into `validation/m14/measurements/scss-population.json`
# (4,433 admitted over 25 repositories, 2 over-cap paths carried BY NAME). The census READS that
# artifact's rule and re-derives the same tracked set; the arm re-derives it through
# incoming-gate.ts's own walk. Both are checked against the artifact's admitted count.
#
# `--index` IS DELIBERATE AND PART OF THE PUBLICATION: `.scss` is in
# `src/ast/parallel-indexer.ts` PROJECT_INDEX_EXTENSIONS and `incoming-gate.ts` carries an
# SCSS_DECLARATION_SPEC, so production builds a project index for this language. The declaration's
# population string says `index=yes`; an index-less arm would be a DIFFERENT population.
#
# RUN:  bash script/m14/scss-whole-population-arm.sh      (in a PERSISTENT terminal session)
# EXIT: 0 both ran and the guards held · 3 token wait exceeded · 4 census failed · 5 arm failed to
#       measure (an instrument failure: exit 2/3/5; 0/1 are the gate's VERDICT codes) · 6 the arm
#       parsed fewer files than the population holds · 7 a survivor scss arm was already running.
set -u
cd "$(dirname "$0")/../.." || exit 2
ROOT=$PWD
LANE=scss
DATE=$(date +%F)
OUTDIR="$ROOT/validation/m14/measurements/scss"
CENSUS_LOG="$OUTDIR/scss-extended-census-${DATE}.txt"
CENSUS_JSON="$ROOT/validation/m14/measurements/scss-extended-census.json"
ARM_LOG="$OUTDIR/scss-gate-whole-${DATE}.txt"
POP_JSON="$ROOT/validation/m14/measurements/scss-population.json"
mkdir -p "$OUTDIR"
WAIT_MAX=${BB_SCSS_WAIT_MAX:-21600} # 6 hours; an expiring cap is RE-ARMED, never read as a refusal
TOKEN=script/m14/arm-token.sh

beat() { bash "$TOKEN" beat "$LANE" >/dev/null 2>&1 || true; }
release() { bash "$TOKEN" release "$LANE" >/dev/null 2>&1 || true; }
# ONLY RELEASE A TOKEN WE ACTUALLY TOOK. A trap firing on an unrelated exit must not touch the
# shared lock unless it is ours (the nim driver's measured lesson: a reaped wrapper's trap ran a
# bare `release`, and the lane's queue place was gone with no audit line naming the remover).
TOOK=0
trap '[ "$TOOK" = 1 ] && release; true' EXIT

echo "== SCSS WHOLE-POPULATION ARM — $(date -Is) =="
echo "   population: the GIT-TRACKED set under .corpus, {scss}, 1 MiB cap, dedup realpath"
echo "   arm:        incoming-gate.ts scss scss 0 --dump --index  (INDEX-ASSISTED population)"
echo "   census log: $CENSUS_LOG"
echo "   arm log:    $ARM_LOG"

# ── 0. PREFLIGHT: a survivor arm is a SECOND HEAVY ARM ──────────────────────────────────────────
if pgrep -af "incoming-gate.ts scss scss 0" >/dev/null 2>&1; then
  echo "SURVIVOR scss ARM ALREADY RUNNING — kill it before taking anything:" >&2
  pgrep -af "incoming-gate.ts scss scss 0" >&2
  exit 7
fi
if [ ! -s "$POP_JSON" ]; then
  echo "NO POPULATION ARTIFACT at $POP_JSON — run: bun script/m14/scss-population.ts" >&2
  exit 4
fi

# ── 1. THE TOKEN ────────────────────────────────────────────────────────────────────────────────
if [ "${BB_SCSS_TOKEN_ALREADY_HELD:-0}" = "1" ]; then
  TOOK=1
  echo "   TOKEN ALREADY HELD (granted turn) — $(bash "$TOKEN" status 2>&1 | head -1)"
else
  # TAKE A QUEUE PLACE FIRST. `take` refuses a lane that is not at the HEAD, so a lane that only
  # polls can be overtaken; the queue is the order and the place is taken ONCE here.
  bash "$TOKEN" queue "$LANE" 2>&1 | head -2 || true
  t0=$(date +%s)
  while true; do
    if out=$(bash "$TOKEN" take "$LANE" 2>&1); then
      TOOK=1
      echo "   TOKEN TAKEN after $(( $(date +%s) - t0 ))s: $(echo "$out" | head -1)"
      break
    fi
    if [ $(( $(date +%s) - t0 )) -ge "$WAIT_MAX" ]; then
      echo "   TOKEN WAIT EXCEEDED ${WAIT_MAX}s — last refusal: $out" >&2
      exit 3
    fi
    sleep 15
  done
fi

# ── the growth-beat watcher: beat ONLY when the run's own output grows ─────────────────────────
beat_on_growth() {
  local log=$1 pid=$2 last=-1
  while kill -0 "$pid" 2>/dev/null; do
    local sz=0
    [ -e "$log" ] && sz=$(stat -c %s "$log" 2>/dev/null || echo 0)
    if [ "$sz" != "$last" ]; then beat; last=$sz; fi
    sleep 5
  done
}

# ── 2. THE EXTENDED-TYPE CENSUS (whole population; its own leak guard) ────────────────────────
echo "== CENSUS START $(date -Is) =="
bun run script/m14/scss-extended-census.ts > "$CENSUS_LOG" 2>&1 &
CPID=$!
beat_on_growth "$CENSUS_LOG" "$CPID" &
WATCH=$!
wait "$CPID"; CEXIT=$?
kill "$WATCH" >/dev/null 2>&1 || true
beat
echo "== CENSUS EXIT $CEXIT $(date -Is) =="
if [ "$CEXIT" -ne 0 ]; then
  echo "CENSUS FAILED — see $CENSUS_LOG (exit $CEXIT; 5 = the leak/coverage guard tripped)" >&2
  tail -20 "$CENSUS_LOG" >&2
  exit 4
fi
[ -s "$CENSUS_JSON" ] || { echo "CENSUS WROTE NO ARTIFACT at $CENSUS_JSON" >&2; exit 4; }
tail -8 "$CENSUS_LOG"

# ── 3. THE ARM: the whole-population closure, one run ─────────────────────────────────────────
echo "== ARM START $(date -Is) =="
BB_CORPUS_ROOT="$ROOT/.corpus" BB_DUMP_LIMIT=2000000 \
  bun run script/m14/incoming-gate.ts "$LANE" scss 0 --dump --index > "$ARM_LOG" 2>&1 &
APID=$!
beat_on_growth "$ARM_LOG" "$APID" &
WATCH=$!
wait "$APID"; AEXIT=$?
kill "$WATCH" >/dev/null 2>&1 || true
beat
echo "== ARM EXIT $AEXIT $(date -Is) =="
# THE GATE'S EXIT CODE IS ITS VERDICT, NOT ITS MEASUREMENT: 1 means the verdict failed, which every
# DONE lane has (a residual wall is dispositioned, not eliminated). 2/3/5 mean the instrument could
# not run at all.
if [ "$AEXIT" -ne 0 ] && [ "$AEXIT" -ne 1 ]; then
  echo "ARM FAILED TO MEASURE — exit $AEXIT is an instrument failure (0/1 are verdict codes); see $ARM_LOG" >&2
  tail -20 "$ARM_LOG" >&2
  exit 5
fi

# ── 4. THE POPULATION GUARD: the arm's own header must say it parsed the population ────────────
ADMITTED=$(bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).admitted)' "$POP_JSON")
PARSED=$(grep -oE "population: [0-9]+ parsed of [0-9]+" "$ARM_LOG" | head -1 | grep -oE "^population: [0-9]+" | grep -oE "[0-9]+")
echo "   population guard: arm parsed ${PARSED:-?} of admitted ${ADMITTED}"
if [ "${PARSED:-0}" != "$ADMITTED" ]; then
  echo "ARM POPULATION MISMATCH — parsed ${PARSED:-?} vs admitted $ADMITTED; THIS ARM IS NOT THE POPULATION" >&2
  exit 6
fi
if ! grep -q "project index: USED" "$ARM_LOG"; then
  echo "ARM DID NOT USE THE PROJECT INDEX — the declaration publishes index=yes; this arm is a DIFFERENT population" >&2
  exit 6
fi

release
TOOK=0
trap - EXIT
echo "== DONE — token released $(date -Is) =="
grep -E "^TOTAL|^type " "$ARM_LOG" | head -18
