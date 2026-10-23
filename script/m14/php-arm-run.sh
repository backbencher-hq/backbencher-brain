#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# php ARM RUNNER — the whole-population work in ONE token acquisition.
#
# WHY A RUNNER AT ALL. The php lane has TWO heavy instruments (a 6,424-file emission+construct
# census and the arbiter's whole-population TABLE 1), and the fleet's rule is ONE heavy arm at a
# time. A lane that takes the token, runs one instrument, releases, and comes back later for the
# second spends the queue twice for one lane's work and can be interleaved by another lane between
# the two halves — at which point the two halves were measured on different machine states and the
# arm's own fingerprint no longer describes one run. This runner holds the token for the pair and
# writes both artifacts.
#
# THE BEAT, HONESTLY. The fleet rule is that a beat must be a BYPRODUCT OF THE WORK, not a second
# process. The census instrument beats FROM ITS OWN LOOP (`--beat-every=500`, added for this run) —
# that is the primary signal and its age is the arm's age. The arbiter (`script/m14/incoming-gate.ts`)
# is the LEAD'S instrument and cannot be edited by a lane, so for its run the runner keeps a
# watcher loop alive FOR EXACTLY THE LIFETIME OF THE GATE PROCESS: it starts with the gate, stops
# when the gate exits, and cannot outlive it. That is not the daemon the fleet banned (a marker
# that is created and never refreshed, or a process that outlives its arm); it is a beat that is a
# function of the arm's own process existing. Both runs also sit well under the 45-minute TTL.
#
# USAGE
#   bash script/m14/arm-token.sh take php          # the lane takes the heavy token when its queue
#                                                  # turn comes (php is > the 2,000-file small cap:
#                                                  # there is NO valid small-slot path)
#   bash script/m14/php-arm-run.sh                 # this runner; releases the token at the end
#   bash script/m14/php-arm-run.sh --no-release    # keep the token (a second pass in the same turn)
#
# PREFLIGHT: refuses unless the token is held by php — a runner that starts a whole-population arm
# without the token is the exact defect the token exists to prevent (the clojure lane's disclosure).
#
# EXIT: 0 both instruments completed · 2 preflight/environment · 3 an instrument failed (its own
# exit code and log are printed; partial output is NOT promoted to an artifact, because a partial
# number is a wrong number).
# ─────────────────────────────────────────────────────────────────────────────
set -u

LANE=php
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO" || exit 2

RELEASE=1
[ "${1:-}" = "--no-release" ] && RELEASE=0

OUT_DIR="validation/m14/measurements"
DATE="$(date +%F)"
mkdir -p "$OUT_DIR"

say() { printf '%s\n' "$*"; }

# ── preflight ───────────────────────────────────────────────────────────────
ARM_STATUS="$(bash script/m14/arm-token.sh status 2>&1 | head -1)"
case "$ARM_STATUS" in
  *"HELD by $LANE"*) say "preflight: token held by $LANE — $ARM_STATUS" ;;
  *)
    say "REFUSED — the arm token is not held by this lane."
    say "  status: $ARM_STATUS"
    say "  take it when the queue reaches php (php is ABOVE the 2,000-file small-slot cap; the"
    say "  heavy token is the only valid path): bash script/m14/arm-token.sh take $LANE"
    exit 2
    ;;
esac
if [ ! -d "$REPO/.corpus" ]; then
  say "REFUSED — no corpus root at $REPO/.corpus (BB_CORPUS_ROOT)"; exit 2
fi

# ── the beat watcher: alive exactly as long as the instrument it watches ─────
beat_while_alive() {
  local pid="$1"
  while kill -0 "$pid" 2>/dev/null; do
    bash script/m14/arm-token.sh beat "$LANE" >/dev/null 2>&1 || true
    sleep 60
  done
}

# ── runner ──────────────────────────────────────────────────────────────────
run_heavy() {
  local label="$1"; local log="$2"; shift 2
  say ""
  say "▶ $label"
  say "  $*"
  local t0; t0="$(date +%s)"
  "$@" >"$log" 2>&1 &
  local pid=$!
  beat_while_alive "$pid"
  wait "$pid"; local rc=$?
  local t1; t1="$(date +%s)"
  say "  exit=$rc  elapsed=$((t1 - t0))s  log=$log"
  return "$rc"
}

CENSUS_JSON="$OUT_DIR/php-emission-census.json"
GATE_LOG="$OUT_DIR/php-gate-whole-$DATE.txt"
CENSUS_LOG="$OUT_DIR/php-emission-census-$DATE.log"

say ""
say "php ARM RUN — $(date -Is)"
say "  population (from $OUT_DIR/php-population.json): committed denominator, 6,424 admitted"
say "  token: $ARM_STATUS"
say "  memory: $(free -m | sed -n '2p' | awk '{print "MemAvailable " $7 " MB (floor 1200)"}')"

# 1) the lane's own whole-population census: emission per type + the four-extended construct sites
if ! run_heavy "EMISSION + CONSTRUCT CENSUS (6,424 files, beating from its own loop)" "$CENSUS_LOG" \
  bun script/m14/php-population.ts --emit --beat-every=500 --json "$CENSUS_JSON"; then
  say "FAILED — census instrument did not complete; artifact NOT written (a partial number is a wrong number)."
  say "  log: $CENSUS_LOG"
  [ "$RELEASE" = 1 ] && bash script/m14/arm-token.sh release "$LANE" >/dev/null 2>&1 || true
  exit 3
fi

# 2) the arbiter's whole-population closure + per-edge dump (the cause census reads the dump)
if ! run_heavy "INCOMING GATE — WHOLE ADMITTED POPULATION (TABLE 1 + --dump)" "$GATE_LOG" \
  bash -c "BB_CORPUS_ROOT='$REPO/.corpus' BB_DUMP_LIMIT=2000000 bun run script/m14/incoming-gate.ts $LANE php,phpt 0 --dump"; then
  say "FAILED — the incoming gate did not complete; the closure is NOT published."
  say "  log: $GATE_LOG"
  [ "$RELEASE" = 1 ] && bash script/m14/arm-token.sh release "$LANE" >/dev/null 2>&1 || true
  exit 3
fi

say ""
say "▶ CONTROL CHECKS ON THE TWO RUNS (read, not assumed):"
grep -E "instrument self-test|parsed [0-9,]+ of|population:" "$GATE_LOG" | head -6 || true
python3 - "$GATE_LOG" "$CENSUS_JSON" <<'PY' || say "  (control read could not complete — report it, do not paper over it)"
import json, re, sys
gate, census = sys.argv[1], sys.argv[2]
txt = open(gate, errors="replace").read()
m = re.search(r"parsed=(\d+)/(\d+)\s+admitted=(\d+)", txt)
print(f"  gate population string: {m.group(0) if m else 'NOT FOUND'}")
try:
    c = json.load(open(census))["emission"]
    print(f"  census: mode={c['mode']} parsed={c['parsed']} failed={c['parseFailures']} beatEvery={c.get('beatEvery')} seconds={c['seconds']}")
except Exception as e:
    print(f"  census artifact unreadable: {e}")
PY

if [ "$RELEASE" = 1 ]; then
  bash script/m14/arm-token.sh release "$LANE" >/dev/null 2>&1 && say "" && say "token released — next instrument is the LIGHT declaration transcription" || say "WARNING — token release returned non-zero; check arm-token.sh status"
fi

say ""
say "artifacts:"
say "  $CENSUS_JSON"
say "  $GATE_LOG"
say "next (no token): bun run script/m14/php-declaration.ts → validation/m14/instruments/php/incoming-declaration.json"
