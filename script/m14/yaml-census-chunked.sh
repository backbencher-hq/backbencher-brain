#!/usr/bin/env bash
# script/m14/yaml-census-chunked.sh — THE YAML WHOLE-POPULATION CENSUS, IN DISJOINT CHUNKS,
# THROUGH THE SMALL ARM SLOT.
#
# WHY THE SMALL SLOT AND NOT THE HEAVY ARM.
#
# The small slot is a SEPARATE lock: it refuses a declared population above 2,000 files, and it
# refuses 0 (which means "the whole population" — a heavy arm in disguise). The yaml population is
# ~19,000 admitted files, so the whole population CANNOT be declared to it — but it CAN be WALKED
# in disjoint chunks of 2,000, each chunk taking the slot with its own declared population, and
# the chunks' tallies merged. The dart lane worked this out for itself, and the Lead's ruling is
# that the chunked walk is both the memory-safe path and the QUEUE-FAIR path.
#
# The second reason is the one that would have corrupted a measurement. A tree-sitter WASM
# module's MEMORY GROWS WITH EVERY PARSE and never shrinks: the dart lane measured that at roughly
# 7,600 parses the module runs out and every later `new Parser` ABORTS — and a single-process walk
# that LOOKS complete measures a fraction of the population while printing a whole-population
# header. One process per chunk cannot hit that wall, because the module is fresh in each one.
#
# THE CHUNKS ARE DISJOINT AND COMPLETE, and both facts are CHECKED rather than asserted: the
# admitted list is sorted once and chunk N takes `[N*K, (N+1)*K)`, the merge refuses chunks whose
# indices do not tile the population, and the merge refuses a chunk total that does not equal the
# admitted total.
#
# THE BEFORE/AFTER TOGGLE IS A FILE COPY, NOT A STASH: the stash stack holds ANOTHER LANE'S WIP,
# and the analyzer is THIS LANE's file, so a backup copy and `git checkout` are exact and touch
# nothing else.
#
# USAGE
#   bash script/m14/yaml-census-chunked.sh before   # the analyzer at git HEAD
#   bash script/m14/yaml-census-chunked.sh after    # the analyzer with the R3 work
set -uo pipefail
cd $HOME/mcp/backbencher-brain

MODE="${1:-after}"
LOG=".tmp-yaml/chunked-$MODE.log"
CHUNK_DIR="validation/m14/measurements/yaml-census-chunks-$MODE"
DISCOVER=".tmp-yaml/census-discovery-$MODE.json"
ANALYZER=src/ast/real-yaml-analyzer.ts
BACKUP=.tmp-yaml/real-yaml-analyzer.R3.ts
SIZE=2000
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
# A KILLED RUN MUST NOT LEAVE THE SMALL SLOT HELD: a holder that never beats is reclaimed by the
# TTL, and the fleet waits three minutes for a reclaim that is already certain. The trap releases
# the slot on ANY exit, including a cancellation.
trap 'bash script/m14/arm-token.sh release yaml >> "$LOG" 2>&1 || true' EXIT

mkdir -p "$CHUNK_DIR"

# ── THE ENUMERATION, to learn the chunk sizes BEFORE any slot is taken. The declaration the slot
# is given must be the chunk's ACTUAL population, and the slot checks it.
npx tsx script/m14/yaml-emission-census.ts --discover-only --out="$DISCOVER" >> "$LOG" 2>&1
TOTAL=$(python3 -c "import json,sys; print(json.load(open('$DISCOVER'))['population']['admittedTotal'])" 2>/dev/null || echo "")
if [ -z "$TOTAL" ] || [ "$TOTAL" -le 0 ] 2>/dev/null; then
  say "FATAL — the enumeration produced no admitted population; see $LOG"
  exit 4
fi
say "admitted $TOTAL files; chunk size $SIZE"

# ── THE BEFORE/AFTER TOGGLE, AS A COPY — THE WORKING TREE IS NEVER TOUCHED.
#
# The BEFORE run measures a COPY of the git-HEAD analyzer: `git show HEAD:<analyzer>` written to
# `script/m14/tmp/` with its one relative import (`./engine`) rewritten for its new home. Reverting
# the working tree instead would leave the lane's work MISSING from the repository for the length
# of the walk, and another agent committing in that window would commit the lane's work as gone.
HEAD_COPY="script/m14/tmp/yaml-head-analyzer.ts"
if [ "$MODE" = "before" ]; then
  mkdir -p script/m14/tmp
  git show HEAD:src/ast/real-yaml-analyzer.ts \
    | sed 's#from "\./engine"#from "../../../src/ast/engine"#' > "$HEAD_COPY"
  if ! grep -q 'from "../../../src/ast/engine"' "$HEAD_COPY"; then
    say "FATAL — the HEAD analyzer copy's import was not rewritten"; exit 6
  fi
  say "the BEFORE run measures a COPY of the git-HEAD analyzer ($HEAD_COPY); the working tree is untouched"
fi

idx=0
while [ $((idx * SIZE)) -lt "$TOTAL" ]; do
  n=$((TOTAL - idx * SIZE))
  [ "$n" -gt "$SIZE" ] && n=$SIZE
  # TAKE THE SMALL SLOT, DECLARING THIS CHUNK'S ACTUAL POPULATION.
  # THE SMALL SLOT IS TAKEN, OR WAITED FOR. A refusal is not a failure: the slot is a lock and its
  # holder is a lane that got there first. The wait is long, because the holder beats every 120s
  # and a chunk is a few minutes of work.
  GOT=0
  for w in $(seq 1 540); do
    if bash script/m14/arm-token.sh take-small yaml "$n" >> "$LOG" 2>&1; then GOT=1; break; fi
    sleep 20
  done
  if [ "$GOT" != "1" ]; then
    say "FATAL — the small slot was not obtained for chunk $idx after three hours"
    exit 5
  fi
  say "chunk $idx: $n files declared to the small slot"
  CHUNK_OUT="$CHUNK_DIR/chunk-$(printf '%02d' "$idx").json"
  if [ -f "$CHUNK_OUT" ]; then
    say "chunk $idx already walked ($CHUNK_OUT) — skipped"
    bash script/m14/arm-token.sh release yaml >> "$LOG" 2>&1
    idx=$((idx + 1))
    continue
  fi
  ANALYZER_ARG=""
  [ "$MODE" = "before" ] && ANALYZER_ARG="--analyzer=$HEAD_COPY"
  npx tsx script/m14/yaml-emission-census.ts --chunk-idx="$idx" --chunk-size="$SIZE" $ANALYZER_ARG \
    --out="$CHUNK_OUT" >> "$LOG" 2>&1
  say "chunk $idx done (exit $?)"
  bash script/m14/arm-token.sh release yaml >> "$LOG" 2>&1
  idx=$((idx + 1))
done

# THE WORKING TREE WAS NEVER TOUCHED, so there is nothing to restore — and the check that says so
# is the tree's own state, not a claim.
if ! git diff --quiet -- "$ANALYZER"; then
  say "the lane's analyzer work is still in the tree (the BEFORE run measured a COPY, as intended)"
else
  say "FATAL — the analyzer has no uncommitted work; the R3 edits are gone"; exit 7
fi

say "merging the chunks"
node script/m14/yaml-census-merge.ts --out=validation/m14/measurements/yaml-emission-census-$MODE.json \
  "$CHUNK_DIR"/chunk-*.json >> "$LOG" 2>&1
say "merge done (exit $?)"
say "ALL DONE"
exit 0
