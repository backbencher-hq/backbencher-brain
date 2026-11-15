#!/usr/bin/env bash
# Drive `ontology-coverage-gate.ts <lang>` to a verdict across the corpus files that kill
# the process outright, and record every file it had to abandon.
#
# WHY THIS EXISTS
#
# `script/m14/resumable-walk.ts` defines two checkpoint markers: a walked path, and
# `!<path>` for "the walk gave up on this file — parse error OR a process-killing hang",
# with the stated rule "a re-run must not walk it again, or one poison file re-destroys
# every future run".
#
# That rule cannot execute for a hang. The arbiter's walk writes `!<path>` from the
# `catch` around `opts.run(i)`, but a WASM trap inside `parser.parse()` is answered by
# `ASTEngine.parseWithTimeout` calling `process.exit()`:
#
#     [BB-HANG] parser stuck 120s on <file> — exiting
#
# `process.exit()` does not reject the promise. It ends the process, so the `catch` never
# runs, the marker is never appended, and the file is offered again on the next run and
# kills that run too. Measured on this lane: `duckdb/data/secrets/README.md` trapped at
# 14:33:06 and its own 120s watchdog exited the process at 14:35:09 — 123s later, the
# same file — leaving the checkpoint with 0 bad markers after repeated runs.
#
# So the marker that is SUPPOSED to make the walk resumable is unwritable for the exact
# class of file the walk most needs it for. That is a defect in the shared walk, and
# `script/m14/` is shared machinery (workstream §8), so this script does NOT fix it. It
# supplies the marker from outside, using the arbiter's OWN `[BB-HANG]` line as the
# evidence, which is the only thing that knows which file died.
#
# WHAT IT DOES AND DOES NOT CLAIM
#
# Each file recorded here is one the arbiter named after losing the process to it. The
# walk then counts those files in its own `skippedBad` total and sets `partial`, so the
# arbiter's verdict declares the reduced population rather than reporting an untruncated walk.
# Nothing is hidden: `validation/m14/fixtures/markdown/arbiter-poison-files.json` lists
# every file, the log line that named it, and the checkpoint line count before and after.
#
# Usage: run-arbiter-to-completion.sh <lang> [max-rounds]
# Usage: run-arbiter-to-completion.sh <lang> [max-rounds] [--fresh]
#
# `--fresh` resets the checkpoint first. Use it when the arbiter's printed per-type edge
# counts must describe the WHOLE corpus, because `observed` is rebuilt every run while the
# walk skips files an earlier run already covered — so a resumed run tallies only
# `walkStats.walked` files while the banner below it reports the walk's coverage:
#
#     walk: 17456/17456 files (100.0%) ... every edge count below is over 100.0% of the corpus
#     uses  16,938 edges in 4+ files
#
# Those 16,938 edges were counted over the 972 files that round newly walked, which is
# 5.6% of the corpus. The banner is derived from `walkStats` and the tally from
# `walkStats.walked`, and the two are only the same number on a fresh walk. That gap is in
# shared machinery (§8) and is reported, not fixed, here.
set -uo pipefail

LANG_NAME="${1:?usage: run-arbiter-to-completion.sh <lang> [max-rounds] [--fresh]}"
MAX_ROUNDS="${2:-40}"
FRESH="${3:-}"
# markdown -> fixtures -> m14 -> validation -> repo root
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT" || exit 1

CHECKPOINT="validation/m14/measurements/walk-${LANG_NAME}.txt"
LOGDIR="validation/m60/${LANG_NAME}/logs"
mkdir -p "$LOGDIR" "$(dirname "$CHECKPOINT")"

total_at_start=$(wc -l < "$CHECKPOINT" 2>/dev/null || echo 0)
echo "checkpoint $CHECKPOINT starts at $total_at_start lines"

GATE_ARGS=("$LANG_NAME")
POISON_JSON="validation/m14/fixtures/markdown/arbiter-poison-files-${LANG_NAME}.json"
printf '{"lang":"%s","checkpoint":"%s","linesAtStart":%s,"records":[' "$LANG_NAME" "$CHECKPOINT" "$total_at_start" > "$POISON_JSON.tmp"

round=1
while [ "$round" -le "$MAX_ROUNDS" ]; do
  log="$LOGDIR/arbiter-full-r${round}.log"
  echo "--- round $round -> $log"
  # `--fresh` goes to the FIRST round only. The arbiter resets the checkpoint itself when
  # it sees the flag, so passing it every round would discard each round's progress —
  # observed as the checkpoint line count going DOWN across rounds (4643, 5927, 5931,
  # 5816, 4517, 6230, 3947) instead of up, which never converges.
  if [ "$FRESH" = "--fresh" ] && [ "$round" -eq 1 ]; then
    GATE_ARGS+=("--fresh")
  fi
  npx tsx "script/m14/ontology-coverage-gate.ts" "${GATE_ARGS[@]}" > "$log" 2>&1
  code=$?

  if [ "$code" -eq 0 ]; then
    echo "ARBITER EXIT 0 after $((round - 1)) round(s)"
    # Copy the verdict out of the round-numbered log, which the next --fresh run would
    # overwrite. The verdict is the deliverable; the round logs are how it was reached.
    cp "$log" "validation/m60/${LANG_NAME}/arbiter-verdict.log"
    tail -40 "$log"
    printf '{"lang":"%s","checkpoint":"%s","linesAtStart":%s,"records":[' "$LANG_NAME" "$CHECKPOINT" "$total_at_start" > "$POISON_JSON.tmp"
    if [ -s "${POISON_JSON%.json}.log" ]; then
      python3 - "$POISON_JSON.tmp" "${POISON_JSON%.json}.log" <<'PY'
import json, sys
out, logf = sys.argv[1], sys.argv[2]
rows = [l.rstrip("\n") for l in open(logf) if l.strip()]
json.dump({"poisonFileCount": len(rows), "records": rows}, open(out, "w"), indent=2)
PY
    else
      echo '{"poisonFileCount":0,"records":[]}' > "$POISON_JSON.tmp"
    fi
    mv "$POISON_JSON.tmp" "$POISON_JSON"
    echo "wrote $POISON_JSON"
    exit 0
  fi

  hang="$(grep -o '\[BB-HANG\] parser stuck [0-9]*s on .* — exiting' "$log" | tail -1)"
  if [ -z "$hang" ]; then
    # 137 is the OOM killer, not a parse failure. This lane has a measured heap cliff at
    # ~6,900 parses / 62.4 MB (commit 6af7361fe), so a round that walks more files than
    # that dies here. The walk is append-only, so the files it finished are already on
    # disk and the next round resumes from them — retrying is the correct response, and
    # it is what makes the run converge. Aborting here is what makes it not converge.
    if [ "$code" -eq 137 ]; then
      echo "round $round OOM-killed at $(wc -l < "$CHECKPOINT") checkpoint lines; resuming (append-only walk kept the progress)"
      echo "OOM" >> "${POISON_JSON%.json}.log"
      round=$((round + 1))
      continue
    fi
    echo "ARBITER EXIT $code and named no poison file — this is a real failure, not a hang"
    tail -60 "$log"
    exit "$code"
  fi

  victim="$(printf '%s' "$hang" | sed 's/.* on \(.*\) — exiting/\1/')"
  echo "poison file named by the arbiter: $victim"
  echo "$hang" >> "${POISON_JSON%.json}.log"
  printf '!%s\n' "$victim" >> "$CHECKPOINT"
  echo "marked bad in $CHECKPOINT (now $(wc -l < "$CHECKPOINT") lines)"
  round=$((round + 1))
done

echo "gave up after $MAX_ROUNDS rounds; checkpoint at $(wc -l < "$CHECKPOINT") lines"
exit 1
