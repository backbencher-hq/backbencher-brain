#!/usr/bin/env bash
# ── THE YAML WHOLE-POPULATION CENSUS, UNDER THE HEAVY ARM TOKEN ────────────────────────────────
#
# TWO PASSES, ONE ARM SESSION, IN THIS ORDER:
#
#   1. PARSE-ONLY. The four extended types' DECISIVE COUNTERS read the TREE (a tag's suffix, a
#      merge key's value shape, an include-family tag's POSITION, a template interpolation inside a
#      scalar). The analyzer is not needed for any of them, and MEASURED COST says so: 300 files
#      cost 3,039 ms of parse — 10 ms per file, so the 18,997-file population is about three
#      minutes of parsing. This pass is what a lane short of the arm can afford, and it is the
#      pass a RULING needs.
#
#   2. FULL. The same walk plus the analyzer, for the per-TYPE emission counts the spec's
#      `_implemented_measured` rows carry. Same tree, same `add()` calls — the analyzer is the only
#      difference, so a construct count from pass 1 and a construct count from pass 2 are the SAME
#      measurement and agree by construction.
#
# WHY CHUNKS AND NOT ONE PROCESS. A tree-sitter WASM module's memory grows with every parse and
# never shrinks: the dart lane measured that at roughly 7,600 parses the module runs out and every
# later `new Parser` ABORTS — and a single-process walk that LOOKS complete then measures a
# fraction of the population while printing a whole-population header. One process per 2,000-file
# chunk cannot hit that wall.
#
# WHY THE CHUNKS MERGE. They are DISJOINT by construction (`--chunk-idx` slices the SORTED admitted
# list after the stride), so edges and file counts are exact SUMS and repository counts are the size
# of the UNION — a repository spans chunks, and a sum would overcount it. The merge REFUSES a chunk
# set whose indices do not tile the population or whose total does not equal the admitted total.
#
# THE TOKEN. `arm-token.sh take yaml` refuses unless the lane is at the QUEUE HEAD, so this script
# WAITS for its turn rather than jumping it. The release is on EXIT, so a cancelled run cannot leave
# a lock nobody can open.
set -u
cd "$(dirname "$0")/../.." || exit 1

SIZE="${CHUNK_SIZE:-2000}"
LOG=".tmp-yaml/parse-census.log"
mkdir -p .tmp-yaml validation/m14/measurements
: > "$LOG"

say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

trap 'bash script/m14/arm-token.sh release yaml >> "$LOG" 2>&1 || true' EXIT

# ── THE POPULATION, LEARNED FROM THE INSTRUMENT ITSELF (never assumed) ───────────────────────────
DISCOVER=".tmp-yaml/parse-discover.json"
npx tsx script/m14/yaml-emission-census.ts --parse-only --discover-only --out="$DISCOVER" >> "$LOG" 2>&1
TOTAL="$(python3 -c "import json;d=json.load(open('$DISCOVER'));print(d['population']['admittedTotal'])" 2>/dev/null)"
if [ -z "$TOTAL" ] || [ "$TOTAL" -le 0 ]; then
  say "FATAL — the admitted total could not be read from $DISCOVER"
  exit 4
fi
NCHUNKS=$(( (TOTAL + SIZE - 1) / SIZE ))
say "admitted $TOTAL files; chunk size $SIZE; $NCHUNKS chunks"

# ── TAKE THE HEAVY TOKEN, OR WAIT FOR THE LANE'S TURN ───────────────────────────────────────────
say "waiting for the heavy token (the lane's queue turn)..."
GOT=0
for _ in $(seq 1 540); do
  if bash script/m14/arm-token.sh take yaml >> "$LOG" 2>&1; then GOT=1; break; fi
  sleep 20
done
if [ "$GOT" != "1" ]; then
  say "FATAL — the heavy token was not obtained in three hours"
  exit 5
fi
say "HEAVY TOKEN TAKEN by yaml"
# ── THE PULSE IS A BYPRODUCT OF THE WORK (the scala lane's design, and the Lead's ruling) ────────
# NO DAEMON. The beat is written when a CHUNK COMPLETES — so the token's age IS the arm's age: one
# liveness signal instead of two that can disagree, and a stalled arm stops beating at exactly the
# moment it stopped working. A stale beat then cannot mean "the holder is gone" AND "the holder's
# heart stopped while its work continued" at the same time, which is the ambiguity the daemon
# created. A chunk of 2,000 files is ~13 s of parse, so the gap between beats is the work's own
# gap by construction.

run_pass() {
  MODE="$1"          # parse-only | full
  DIR="validation/m14/measurements/yaml-census-chunks-$MODE"
  OUT="validation/m14/measurements/yaml-emission-census-$MODE.json"
  rm -rf "$DIR"; mkdir -p "$DIR"
  EXTRA=""
  [ "$MODE" = "parse-only" ] && EXTRA="--parse-only"
  local i
  for i in $(seq 0 $((NCHUNKS - 1))); do
    local CHUNK_OUT="$DIR/chunk-$(printf '%02d' "$i").json"
    say "pass=$MODE chunk $i/$((NCHUNKS - 1))"
    npx tsx script/m14/yaml-emission-census.ts $EXTRA --chunk-idx="$i" --chunk-size="$SIZE" \
      --out="$CHUNK_OUT" >> "$LOG" 2>&1
    if [ ! -f "$CHUNK_OUT" ]; then say "FATAL — chunk $i produced no artifact"; return 6; fi
    # THE BEAT IS THE WORK'S OWN PULSE: a completed chunk is the arm saying it is alive.
    bash script/m14/arm-token.sh beat yaml >> "$LOG" 2>&1 || true
  done
  node script/m14/yaml-census-merge.ts --out="$OUT" "$DIR"/chunk-*.json >> "$LOG" 2>&1 || return 7
  say "pass=$MODE merged -> $OUT"
  return 0
}

# ── ONE PASS PER TURN BY DEFAULT, AND THE REASON IS THE MACHINE ─────────────────────────────────
# The Lead's reading, and it is right: the parse-only pass is what the four rulings need and it is
# ~3 minutes of work, while the full pass runs the analyzer over the same 18,997 files on a machine
# whose load is 16-19 on 8 CPUs. Holding the heavy slot for both would make a lane that needs one
# measurement block every lane behind it for two. THE PARSE-ONLY PASS GOES FIRST AND THE FULL PASS
# IS A SECOND TURN (`--full`), so the slot is held for the work that DECIDES something.
if [ "${1:-}" = "--full" ]; then
  run_pass full || exit $?
  say "FULL PASS DONE — validation/m14/measurements/yaml-emission-census-full.json"
else
  run_pass parse-only || exit $?
  say "PARSE-ONLY PASS DONE — validation/m14/measurements/yaml-emission-census-parse-only.json"
  say "(the full pass is a second turn: bash script/m14/yaml-census-heavy.sh --full)"
fi
