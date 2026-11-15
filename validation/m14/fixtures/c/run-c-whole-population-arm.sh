#!/usr/bin/env bash
# run-c-whole-population-arm — THE c LANE's WHOLE-POPULATION ARM, RUN UNDER THE FLEET's ARM TOKEN.
#
# Author: Muhammad Ishaq Khan. What it is: the c lane's arm runner. It takes the arm token (never
# steals it), writes the INSTRUMENT DIGESTS header so the figure is tied to the tree it was read at,
# runs the gate over the lane's OWN extension map (`c,h` — the map at incoming-gate.ts:286), beats
# the token every two minutes, and releases the token on the way out.
#
# A HANG IS A RESULT AND IT MUST NAME A FILE: the gate's progress line names the file it is parsing,
# so the log's LAST progress line names the repo and the file the arm died on. The runner records
# that line into the summary so the hang is actionable rather than merely noted.
#
# Usage: bash validation/m14/fixtures/c/run-c-whole-population-arm.sh <outdir>
set -u
cd "$(dirname "$0")/../../../.." || exit 2
OUTDIR="${1:-validation/m14/fixtures/c/measurements}"
mkdir -p "$OUTDIR"
LOG="$OUTDIR/c-arm-whole-population.log"
BODY="$LOG.body.txt"
SUM="$OUTDIR/c-arm-whole-population.summary.txt"

# THE TOKEN: take it, do not steal it. `take` refuses any lane not at the head of the queue.
if ! bash script/m14/arm-token.sh take c; then
  echo "ARM TOKEN NOT TAKEN — the queue is the order" >&2
  exit 3
fi
cleanup() {
  bash script/m14/arm-token.sh release c >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

# THE INSTRUMENT DIGESTS — the figure is tied to the tree it was read at.
{
  echo "INSTRUMENT DIGESTS — THIS ARM RAN ON EXACTLY THESE"
  echo "  arbiter  sha256(incoming-rule.ts + incoming-gate.ts) = $(cat script/m14/incoming-rule.ts script/m14/incoming-gate.ts | sha256sum | cut -d' ' -f1)"
  echo "  analyzer sha256(src/ast/real-c-analyzer.ts)           = $(sha256sum src/ast/real-c-analyzer.ts | cut -d' ' -f1)"
  echo "  corpus root = $PWD/.corpus"
  echo ""
} > "$LOG"

# BEAT every two minutes; the token's TTL is 45 min.
( while true; do sleep 120; bash script/m14/arm-token.sh beat c >/dev/null 2>&1 || true; done ) &
BEAT_PID=$!

# THE ARM: the gate at MODULE LEVEL cannot be imported ⇒ it is run AS A PROCESS ✓✓. The third
# positional argument is the FILE LIMIT (0 = every file) ✓✓.
BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/incoming-gate.ts c c,h 0 > "$BODY" 2>&1
RC=$?
kill "$BEAT_PID" 2>/dev/null
wait "$BEAT_PID" 2>/dev/null

# THE HANG'S LAST NAMED FILE: the gate's progress line names the file it is parsing ✓✓.
LAST_PROGRESS="$(grep -oE "[0-9]+/[0-9]+ parsed \([0-9]+ failed, [0-9]+ degraded\)[^$]*" "$BODY" | tail -1)"
{
  echo "exit code: $RC"
  echo "log: $LOG"
  echo "body: $BODY"
  echo "last progress line (the file the arm was parsing): ${LAST_PROGRESS:-<none — the arm produced no progress line>}"
  echo "bytes: log $(wc -c < "$LOG") · body $(wc -c < "$BODY")"
} > "$SUM"
cat "$LOG" "$BODY" > "$LOG.combined" 2>/dev/null
mv "$LOG.combined" "$LOG"
exit $RC
