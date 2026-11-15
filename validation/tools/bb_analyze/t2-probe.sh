#!/usr/bin/env bash
# T2 (reference large index) single-call probes. Read-only; BB_NO_AUTO_REFRESH=1.
set -u
cd /home/ishaq2321/mcp/backbencher-brain
export BB_DATA_DIR="$PWD/.bb-data"
export BB_NO_AUTO_REFRESH=1
out=validation/tools/bb_analyze/t2-probes.jsonl
: > "$out"
probes=(
 '{"mode":"stats"}'
 '{"mode":"complexity"}'
 '{"mode":"callers","target":"getProjectId"}'
 '{"mode":"callees","target":"getProjectId"}'
 '{"mode":"trace","target":"getProjectId"}'
 '{"mode":"impact","target":"getProjectId"}'
 '{"mode":"dependencies","limit":5}'
 '{"mode":"test_mapping"}'
 '{"mode":"test_gaps"}'
 '{"mode":"test_quality"}'
 '{"mode":"test_impact","target":"getProjectId"}'
)
for p in "${probes[@]}"; do
  start=$(date +%s%3N)
  json=$(timeout 240 npx tsx validation/tools/bb_analyze/run-one.ts "$p" 2>/dev/null)
  code=$?
  end=$(date +%s%3N)
  wall=$((end-start))
  if [ -z "$json" ]; then json="{\"probe\":$(printf '%s' "$p" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),\"timedOut\":$([ $code -eq 124 ] && echo true || echo false),\"exit\":$code}"; fi
  echo "$json" | python3 -c "import json,sys; d=json.load(sys.stdin); d['wallMs']=$wall; d['exit']=$code; print(json.dumps(d))" >> "$out"
  echo "done: $p exit=$code wall=${wall}ms"
done
