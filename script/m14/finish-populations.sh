#!/bin/bash
# finish-populations.sh — RUN OUTSIDE THE HARNESS, IN A PLAIN TERMINAL ON THE LAPTOP.
#
#   bash script/m14/finish-populations.sh > finish.log 2>&1 &
#
# WHY THIS SCRIPT EXISTS, AND WHY THE LEAD IS NOT RUNNING IT FROM THE CHAT: the harness kills
# every command after ~10 minutes and the Lead spent 15 hours re-learning that while polling
# dead processes (fleet form 17: A HUNG PROCESS IS NOT A WORK IN PROGRESS — and neither is a
# DEAD ONE THAT READS AS ALIVE THROUGH THE WRONG PID). A plain terminal on the laptop has no
# such limit, and the slice work needs no intelligence — only sequence. THE SCRIPT IS THE
# WHOLE JOB: run every missing slice, then merge, then run the two gates, then report.
#
# WHAT A SLICE IS: the measurement tool reads a language's files; a slice reads 1,000 of them
# so each run fits a window. Each slice writes its own artifact, and merge-arm-slices.ts glues
# them into the whole-population number — REFUSING to write if any slice is missing, so this
# script cannot produce a partial answer that looks like a complete one.
#
# WHAT IT RUNS: json [0, 14115) — 14 slices, ~3 min each ≈ 45 min of machine time.
#               cpp  [6750, 23237) — 17 slices, ~5 min each ≈ 85 min of machine time.
#       TOTAL ≈ 2 hours 15 minutes of unattended running, ZERO chat turns, ZERO polling.
#
# AFTER IT FINISHES: paste `tail -40 finish.log` back to the Lead. The merge lines and the
# gate lines are all the Lead needs to certify json and cpp DONE.

cd "$(dirname "$0")/../.." || exit 1
export BB_CORPUS_ROOT="$PWD/.corpus"
mkdir -p .tmp-json/slices .tmp-cpp/slices

run_slice () {
  # run_slice <lane-key> <offset> <width> <dir> <count-arg>
  local KEY=$1 OFF=$2 W=$3 DIR=$4 CNT=$5
  local F="$DIR/chunk-$OFF.txt"
  if [ -s "$F" ] && grep -q "THIS RUN IS A CHUNK" "$F" 2>/dev/null; then
    echo "SKIP  [$KEY $OFF, $((OFF+W))) — already complete"
    return 0
  fi
  echo "RUN   [$KEY $OFF, $((OFF+W))) starting $(date +%H:%M:%S)"
  BB_DUMP_LIMIT=4000000 bun run script/m14/incoming-gate.ts "$KEY" "$CNT" --offset="$OFF" > "$F" 2>&1
  local RC=$?
  local OK
  OK=$(grep -c "THIS RUN IS A CHUNK" "$F" 2>/dev/null || echo 0)
  echo "DONE  [$KEY $OFF, $((OFF+W))) rc=$RC chunk=$OK size=$(stat -c%s "$F" 2>/dev/null || echo 0) $(date +%H:%M:%S)"
  # A failed slice is RETRIED ONCE at half width — the measured cliff between 2,000 and 500.
  if [ "$OK" = "0" ] && [ "$W" -gt 250 ]; then
    local H=$((W / 2))
    echo "RETRY [$KEY $OFF, $((OFF+H))) at width $H (the first slice failed; half the width fits a worse window)"
    run_slice "$KEY" "$OFF" "$H" "$DIR" "$H"
    run_slice "$KEY" "$((OFF+H))" "$H" "$DIR" "$H"
  fi
}

echo "===================== JSON POPULATION ====================="
for OFF in 0 1000 2000 3000 4000 5000 6000 7000 8000 9000 10000 11000 12000 13000; do
  run_slice json "$OFF" 1000 .tmp-json/slices 1000
done
run_slice json 14000 115 .tmp-json/slices 115

echo "===================== JSON MERGE ====================="
bun script/m14/merge-arm-slices.ts --dir .tmp-json/slices --population 14115 \
  --write validation/m14/results/json-whole-population-closure.json 2>&1 | tail -8

echo "===================== CPP POPULATION ====================="
for OFF in 6750 7750 8750 9750 10750 11750 12750 13750 14750 15750 16750 17750 18750 19750 20750 21750 22750; do
  run_slice cpp "$OFF" 1000 .tmp-cpp/slices 1000
done
# NOTE: the loop's last slice [22750, 23750) is CLAMPED BY THE GATE to [22750, 23237) —
# a chunk header prints its own true bounds, so the merge reads the real 487-file slice. No tail call needed.

echo "===================== CPP MERGE ====================="
bun script/m14/merge-arm-slices.ts --dir .tmp-cpp/slices --population 23237 \
  --write validation/m14/results/cpp-whole-population-closure.json 2>&1 | tail -8

echo "===================== GATES ====================="
bun script/m14/coverage-block-gate.ts --json 2>/dev/null | grep -E '"lane": ?"(json|cpp)"' || true
echo "----"
bun script/m14/completion-gate.ts 2>&1 | sed -n '1,40p'
echo "===================== FINISHED $(date) ====================="
