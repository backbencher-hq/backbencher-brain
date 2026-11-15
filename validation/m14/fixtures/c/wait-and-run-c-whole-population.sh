#!/usr/bin/env bash
# wait-and-run-c-whole-population — WAIT FOR THE ARM TOKEN, THEN RUN THE WHOLE-POPULATION c ARM,
# READ THE CELL, AND PUBLISH IT. The c lane is position 8 in the queue, so the arm waits its turn.
#
# Author: Muhammad Ishaq Khan. What it is: the lane's own arm pipeline. It polls the arm token and
# fires the runner the moment `take c` succeeds — the runner's take is ATOMIC, so the lane never
# steals the token from a live holder, and the queue is the order.
#
# The whole pipeline runs in one place so that the cell is published with the arm that produced it:
#   1. take the token (atomically) · 2. the arm with the digest header and the beats
#   3. the reader, which PRINTS ITS OWN CLOSURE and ASSERTS it
#   4. the cell → validation/m14/measurements/c-arm-current.json
set -u
cd "$(dirname "$0")/../../../.." || exit 2
LOG=validation/m14/fixtures/c/measurements/c-arm-whole-population-wait.log
echo "WAITING FOR THE ARM TOKEN (the c lane's queue position is the order) — $(date -Is)" > "$LOG"

WAITED=0
while true; do
  if bash script/m14/arm-token.sh take c >/dev/null 2>&1; then
    echo "TOKEN TAKEN after ${WAITED}s — $(date -Is)" >> "$LOG"
    break
  fi
  sleep 60
  WAITED=$((WAITED + 60))
  echo "still waiting: ${WAITED}s — $(bash script/m14/arm-token.sh status 2>/dev/null | head -2 | tr '\n' ' ')" >> "$LOG"
done

# THE ARM (the runner takes the token itself; it is already ours now, and `take` is idempotent for
# the holder) — hmm: the runner's own `take` would be a second take ✗. So the arm is run HERE, with
# the same beats and the same digest header, and the runner stays the single-place version for a
# lane that holds the token already.
OUTDIR=validation/m14/fixtures/c/measurements
mkdir -p "$OUTDIR"
LOGF="$OUTDIR/c-arm-whole-population.log"
BODY="$OUTDIR/c-arm-whole-population.log.body.txt"
{
  echo "INSTRUMENT DIGESTS — THIS ARM RAN ON EXACTLY THESE"
  echo "  arbiter  sha256(incoming-rule.ts + incoming-gate.ts) = $(cat script/m14/incoming-rule.ts script/m14/incoming-gate.ts | sha256sum | cut -d' ' -f1)"
  echo "  analyzer sha256(src/ast/real-c-analyzer.ts)           = $(sha256sum src/ast/real-c-analyzer.ts | cut -d' ' -f1)"
  echo "  corpus root = $PWD/.corpus"
  echo ""
} > "$LOGF"
( while true; do sleep 120; bash script/m14/arm-token.sh beat c >/dev/null 2>&1 || true; done ) &
BEAT_PID=$!
BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/incoming-gate.ts c c,h 0 > "$BODY" 2>&1
RC=$?
kill "$BEAT_PID" 2>/dev/null; wait "$BEAT_PID" 2>/dev/null
LAST_PROGRESS="$(grep -oE "[0-9]+/[0-9]+ parsed \([0-9]+ failed, [0-9]+ degraded\)[^$]*" "$BODY" | tail -1)"
{
  echo "arm exit code: $RC"
  echo "last progress line (the file the arm was parsing): ${LAST_PROGRESS:-<none — the arm produced no progress line>}"
  echo "bytes: header $(wc -c < "$LOGF") · body $(wc -c < "$BODY")"
} >> "$LOGF"
cat "$BODY" >> "$LOGF"
bash script/m14/arm-token.sh release c >/dev/null 2>&1
echo "ARM DONE rc=$RC — $(date -Is)" >> "$LOG"

# THE CELL — the reader PRINTS ITS OWN CLOSURE and ASSERTS it; a cell that cannot close is not a cell.
bun run validation/m14/fixtures/c/reader-c-cell.ts --log="$LOGF" --out=validation/m14/measurements/c-arm-current.json >> "$LOG" 2>&1
echo "CELL WRITTEN rc=$? — $(date -Is)" >> "$LOG"
