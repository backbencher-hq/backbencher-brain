#!/usr/bin/env bash
# Warm latency sweep: one warm-up call + 5 timed calls per mode, in one process per mode.
# T0: test/fixtures/polyglot (tool-local bbdata)   T1: .perf-fixtures/bb-scale/n100 (tool-local bbdata)
# T2: this workspace's index (.bb-data, read-only tool, BB_NO_AUTO_REFRESH=1)
set -u
cd /home/ishaq2321/mcp/backbencher-brain
export BB_NO_AUTO_REFRESH=1
run() { # tier label args dir datadir
  local tier="$1" label="$2" args="$3" dir="$4" datadir="$5"
  local t0=$(date +%s%3N)
  local json
  json=$(BB_DATA_DIR="$datadir" BB_REPEAT=5 timeout 300 npx tsx validation/tools/bb_analyze/run-one.ts "$args" "$dir" 2>/dev/null)
  local code=$?
  local wall=$(( $(date +%s%3N) - t0 ))
  if [ -z "$json" ]; then json="{\"args\":$args,\"timedOut\":true}"; fi
  echo "$json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
d.update({'tier':'$tier','label':'$label','datadir':'$datadir','wallMs':$wall,'exit':$code})
print(json.dumps(d))
" >> validation/tools/bb_analyze/latency-raw.jsonl
  echo "done $tier $label exit=$code"
}
rm -f validation/tools/bb_analyze/latency-raw.jsonl
T0DIR="$PWD/test/fixtures/polyglot"; T1DIR="$PWD/.perf-fixtures/bb-scale/n100"; T2DIR="$PWD"
T0DATA="$PWD/validation/tools/bb_analyze/bbdata"; T1DATA="$PWD/validation/tools/bb_analyze/bbdata"; T2DATA="$PWD/.bb-data"
# T0
T0='{"mode":"callers","target":"applyDiscount"}'
for spec in \
  '{"mode":"callers","target":"applyDiscount"}|callers' \
  '{"mode":"callees","target":"applyDiscount"}|callees' \
  '{"mode":"trace","target":"applyDiscount"}|trace' \
  '{"mode":"dependencies"}|dependencies' \
  '{"mode":"stats"}|stats' \
  '{"mode":"complexity"}|complexity' \
  '{"mode":"impact","target":"applyDiscount"}|impact' \
  '{"mode":"test_mapping"}|test_mapping' \
  '{"mode":"test_gaps"}|test_gaps' \
  '{"mode":"test_impact","target":"applyDiscount"}|test_impact' \
  '{"mode":"test_quality"}|test_quality'; do
  run T0 "${spec##*|}" "${spec%|*}" "$T0DIR" "$T0DATA"
done
# T1
for spec in \
  '{"mode":"callers","target":"prepare"}|callers' \
  '{"mode":"callees","target":"prepare"}|callees' \
  '{"mode":"trace","target":"prepare"}|trace' \
  '{"mode":"dependencies"}|dependencies' \
  '{"mode":"stats"}|stats' \
  '{"mode":"complexity"}|complexity' \
  '{"mode":"impact","target":"prepare"}|impact' \
  '{"mode":"test_mapping"}|test_mapping' \
  '{"mode":"test_gaps"}|test_gaps' \
  '{"mode":"test_impact","target":"prepare"}|test_impact' \
  '{"mode":"test_quality"}|test_quality'; do
  run T1 "${spec##*|}" "${spec%|*}" "$T1DIR" "$T1DATA"
done
# T2
for spec in \
  '{"mode":"callers","target":"getProjectId"}|callers' \
  '{"mode":"callers","target":"makeProvenance"}|callers-hub' \
  '{"mode":"callees","target":"getProjectId"}|callees' \
  '{"mode":"trace","target":"getProjectId"}|trace' \
  '{"mode":"dependencies"}|dependencies' \
  '{"mode":"dependencies","limit":5}|dependencies-limit5' \
  '{"mode":"stats"}|stats' \
  '{"mode":"complexity"}|complexity' \
  '{"mode":"impact","target":"getProjectId"}|impact' \
  '{"mode":"test_mapping"}|test_mapping' \
  '{"mode":"test_gaps"}|test_gaps' \
  '{"mode":"test_impact","target":"getProjectId"}|test_impact' \
  '{"mode":"test_quality"}|test_quality'; do
  run T2 "${spec##*|}" "${spec%|*}" "$T2DIR" "$T2DATA"
done
echo ALL_DONE
