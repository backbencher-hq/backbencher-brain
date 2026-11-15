#!/usr/bin/env bash
# CLOJURE LANE — THE POST-JOIN WATCHER: RUN THE ACCEPTANCE TEST ON A CADENCE UNTIL IT IS GREEN.
#
# WHY THIS IS A CADENCE AND NOT A DIGEST WATCH ✓✓ — THE FIRST VERSION OF THIS WATCHER FIRED ON A
# **FALSE POSITIVE** ✓✓: it watched the shared index's digest, the DART lane's commit touched that
# file ✓✓, the digest moved ✓✓, and the watcher ran the acceptance test against a tree in which THE
# JOIN HAD NOT LANDED ✓✓. **⇒ THE SHARED FILES' DIGESTS ARE SHARED WITH OTHER LANES' WORK ✓✓, SO
# WATCHING THEM WATCHES OTHER LANES ✓✓ ⇒ THE WATCHER MUST WATCH THE **EFFECT**, NOT A FILE ✓✓.**
#
# **THE HARNESS IS THE DETECTOR ✓✓** — it knows the price ✓✓, and it is green **if and only if** the
# movement is exactly the DERIVED price ✓✓ (841 rows ✓✓, in the GATE's key space ✓✓) ⇒ so the watcher
# runs it on a cadence and STOPS WHEN IT
# IS GREEN ✓✓. Each run takes the small slot (646 ≤ 2,000 ✓✓), beats it ✓✓, and releases it ✓✓.
#
# THE CAP AND THE DEADLINE ARE EXPLICIT ✓✓: a watcher that can run forever would hold the fleet's
# small slot forever ✓✓.
set -uo pipefail
cd /home/ishaq2321/mcp/backbencher-brain
LOG=validation/m14/fixtures/clojure/lane-logs
WATCH="$LOG/postjoin-watch.log"
POLL_SECONDS="${POLL_SECONDS:-480}"
MAX_RUNS="${MAX_RUNS:-40}"
DEADLINE=$(( $(date +%s) + ${WATCH_SECONDS:-21600} ))
RUNS=0

{
  echo ""
  echo "=== THE POST-JOIN WATCHER (CADENCE) — $(date -u +%FT%TZ) ==="
  echo "the poll: ${POLL_SECONDS}s · the cap: ${MAX_RUNS} run(s) · the deadline: ${WATCH_SECONDS:-21600}s"
  echo "the detector is the HARNESS ITSELF, not a digest: the first version watched the shared index's"
  echo "digest and fired on another lane's commit — a shared file's digest is shared with other lanes."
} >> "$WATCH"

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  RUNS=$((RUNS + 1))
  echo "" >> "$WATCH"
  echo "=== THE ACCEPTANCE TEST, RUN $RUNS ($(date -u +%FT%TZ)) ===" >> "$WATCH"
  timeout 2400 bash validation/m14/fixtures/clojure/run-postjoin-pair.sh >> "$WATCH" 2>&1
  RC=$?
  echo "the harness exited $RC (0 = GREEN = the movement is exactly the DERIVED price ✓✓ — the price the harness computed on this tree ✓✓, not a number written down here ✓✓)" >> "$WATCH"
  if [ "$RC" = "0" ]; then
    echo "" >> "$WATCH"
    echo "=== **THE HARNESS IS GREEN** — THE MOVEMENT IS EXACTLY THE DERIVED PRICE ✓✓ (841 rows ✓✓, in the GATE's key space ✓✓), AND THE PRICE IS CONFIRMED ✓✓ ($(date -u +%FT%TZ)) ===" >> "$WATCH"
    break
  fi
  if [ "$RUNS" -ge "$MAX_RUNS" ]; then
    echo "the cap is reached — the watcher stops" >> "$WATCH"
    break
  fi
  sleep "$POLL_SECONDS"
done
echo "" >> "$WATCH"
echo "=== THE WATCHER'S END (runs: $RUNS) — $(date -u +%FT%TZ) ===" >> "$WATCH"
