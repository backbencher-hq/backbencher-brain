#!/usr/bin/env bash
# wait-and-run-c-whole-population-v2 — THE SAME PIPELINE, WITH A HEARTBEAT ON STDOUT.
#
# Author: Muhammad Ishaq Khan. What it is: v1 of this waiter was reaped while it was IDLE (it wrote
# only to a file), so v2 ECHOES every poll — a job that keeps producing output is a job that stays
# alive, and a heartbeat on stdout is also the record of how long the lane waited ✓✓.
#
# The pipeline is unchanged and is the whole remaining deliverable in one place ✓✓:
#   take the token (ATOMIC ✓✓ — the queue is the order ✓✓) · the arm with the digest header and the
#   beats · the reader, which PRINTS ITS OWN CLOSURE and ASSERTS it · the cell → c-arm-current.json ✓✓
set -u
cd "$(dirname "$0")/../../../.." || exit 2
LOG=validation/m14/fixtures/c/measurements/c-arm-whole-population-wait.log
say() { echo "$(date -Is) $*"; echo "$(date -Is) $*" >> "$LOG"; }

say "WAITING FOR THE ARM TOKEN (the c lane's queue position is the order)"
WAITED=0
while true; do
  if bash script/m14/arm-token.sh take c >/dev/null 2>&1; then
    say "TOKEN TAKEN after ${WAITED}s"
    break
  fi
  ST="$(bash script/m14/arm-token.sh status 2>/dev/null | head -2 | tr '\n' ' ')"
  say "waiting ${WAITED}s — $ST"
  sleep 45
  WAITED=$((WAITED + 45))
done

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
say "ARM STARTED — the gate over the lane's OWN map 'c,h', file limit 0 (every file)"
( while true; do sleep 120; bash script/m14/arm-token.sh beat c >/dev/null 2>&1 || true; echo "$(date -Is) beat" >> "$LOGF"; done ) &
BEAT_PID=$!
DUMPF="$OUTDIR/c-arm-whole-population.dump.txt"
BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/incoming-gate.ts c c,h 0 --dump > "$BODY" 2>&1
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
say "ARM DONE rc=$RC"
bun run validation/m14/fixtures/c/reader-c-cell.ts --log="$LOGF" --dump="$DUMPF" --out=validation/m14/measurements/c-arm-current.json
say "CELL WRITTEN rc=$? → validation/m14/measurements/c-arm-current.json"
