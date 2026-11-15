#!/usr/bin/env bash
# T2 re-measure after the shared graph engine rewrite (post-collapse-identity).
# Warm: one warm-up + 5 timed calls per mode, one process per mode.
set -u
cd /home/ishaq2321/mcp/backbencher-brain
export BB_NO_AUTO_REFRESH=1 BB_DATA_DIR="$PWD/.bb-data"
out=validation/tools/bb_analyze/latency-raw-t2-rewrite.jsonl
: > "$out"
run() {
  local label="$1" args="$2"
  local t0=$(date +%s%3N)
  local json
  json=$(BB_REPEAT=5 timeout 420 npx tsx validation/tools/bb_analyze/run-one.ts "$args" "$PWD" 2>/dev/null)
  local code=$?
  local wall=$(( $(date +%s%3N) - t0 ))
  if [ -z "$json" ]; then json="{\"args\":$args,\"timedOut\":true}"; fi
  echo "$json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
d.update({'tier':'T2','label':'$label','datadir':'$PWD/.bb-data','wallMs':$wall,'exit':$code,'postGraphRewrite':True})
print(json.dumps(d))
" >> "$out"
  echo "done $label exit=$code wall=${wall}ms"
}
run callers            '{"mode":"callers","target":"getProjectId"}'
run callers-hub        '{"mode":"callers","target":"makeProvenance"}'
run callers-leaf       '{"mode":"callers","target":"toLowerCase"}'
run callees            '{"mode":"callees","target":"getProjectId"}'
run trace              '{"mode":"trace","target":"getProjectId"}'
run dependencies       '{"mode":"dependencies"}'
run dependencies-limit5 '{"mode":"dependencies","limit":5}'
run stats              '{"mode":"stats"}'
run complexity         '{"mode":"complexity"}'
run impact             '{"mode":"impact","target":"getProjectId"}'
run test_mapping       '{"mode":"test_mapping"}'
run test_gaps          '{"mode":"test_gaps"}'
run test_impact        '{"mode":"test_impact","target":"getProjectId"}'
run test_quality       '{"mode":"test_quality"}'
echo T2_REMEASURE_DONE
