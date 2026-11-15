#!/bin/bash
# Final gate battery for bb_visualize. Records command -> exit -> summary line.
cd "$(dirname "$0")/../../.." || exit 2
export BB_DATA_DIR=validation/tools/bb_visualize/bbdata
export BB_NO_AUTO_REFRESH=1
OUT=validation/tools/bb_visualize/logs/GATE_TABLE-final.txt
: > "$OUT"
record() { # label runtime command summaryPattern logFile
  local label=$1 runtime=$2 cmd=$3 pattern=$4 log=$5
  local start end code
  start=$(date +%s%3N)
  if [ "$runtime" = "bun" ]; then timeout 600 bun run "$cmd" > "$log" 2>&1; else timeout 600 npx tsx "$cmd" > "$log" 2>&1; fi
  code=$?
  end=$(date +%s%3N)
  local summary
  summary=$(grep -Eo "$pattern" "$log" | tail -1)
  printf '%s|%s|%s|exit=%s|%sms|%s\n' "$label" "$runtime" "$cmd" "$code" "$((end-start))" "$summary" >> "$OUT"
  echo "$label exit=$code $summary"
}
record "V1 contract" bun script/m13/verify-visualize-contract.ts 'V1: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v1.log
record "V2 fidelity" bun script/m13/verify-visualize-fidelity.ts 'V2: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v2.log
record "V3 e2e-corpus" bun script/m13/verify-visualize-e2e-corpus.ts 'V3: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v3.log
record "V4 docs" bun script/m13/verify-visualize-docs.ts 'V4: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v4.log
record "V5 options" bun script/m13/verify-visualize-options.ts 'V5: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v5.log
record "V6 target-literals" bun script/m13/verify-visualize-target-literals.ts 'V6: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v6.log
record "V7 views" bun script/m13/verify-visualize-views.ts 'V7: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v7.log
record "V8 owner-fold" bun script/m13/verify-visualize-owner-fold.ts 'V8: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v8.log
record "V9 honesty" bun script/m13/verify-visualize-honesty.ts 'V9: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v9.log
record "V10 browser" tsx script/m13/verify-visualize-browser.ts 'V10: [A-Z]+ \([0-9/]+ passed[^)]*\)' validation/tools/bb_visualize/logs/final-v10.log
record "m15 deep" bun script/m15/verify-visualize-migrate-deep.ts 'VISUALIZE/MIGRATE: [A-Z]+' validation/tools/bb_visualize/logs/final-m15.log
record "verify-visualize-migrate" bun script/verify-visualize-migrate.ts 'VISUALIZE/MIGRATE: [A-Z]+' validation/tools/bb_visualize/logs/final-migrate.log
record "m26 webview-core" bun script/m26/verify-webview-core.ts '[A-Z]+ \([0-9/]+ passed[^)]*\)|PASS|FAIL' validation/tools/bb_visualize/logs/final-m26-core.log
record "m26 graph-transport" bun script/m26/verify-graph-transport.ts '[A-Z]+ \(|PASS|FAIL' validation/tools/bb_visualize/logs/final-m26-transport.log
record "m26 graph-docs" bun script/m26/verify-graph-docs.ts '[A-Z]+ \(|PASS|FAIL' validation/tools/bb_visualize/logs/final-m26-docs.log
record "m26 hub-group-order" bun script/m26/verify-hub-group-order.ts '[A-Z]+ \(|PASS|FAIL' validation/tools/bb_visualize/logs/final-m26-order.log
record "regex policy" tsx script/tools/verify-regex-policy.ts 'REGEX POLICY: [A-Z]+[^\n]*' validation/tools/bb_visualize/logs/final-regex.log
# Docs page: verify only this tool's generated page (shared artifacts are regenerated centrally).
start=$(date +%s%3N)
timeout 300 npx tsx script/verify-tool-docs.ts --only bb_visualize > validation/tools/bb_visualize/logs/final-docs.log 2>&1
code=$?
end=$(date +%s%3N)
summary=$(grep -Eo 'TOOL DOCS: [A-Z]+[^\n]*' validation/tools/bb_visualize/logs/final-docs.log | tail -1)
printf 'tool docs bb_visualize|tsx|script/verify-tool-docs.ts --only bb_visualize|exit=%s|%sms|%s\n' "$code" "$((end-start))" "$summary" >> "$OUT"
echo "tool docs bb_visualize exit=$code $summary"

# Typecheck of the whole tree (the split modules included).
start=$(date +%s%3N)
timeout 600 npx tsc --noEmit > validation/tools/bb_visualize/logs/final-tsc.log 2>&1
code=$?
end=$(date +%s%3N)
printf 'tsc --noEmit|tsx|npx tsc --noEmit|exit=%s|%sms|%s\n' "$code" "$((end-start))" "$([ $code -eq 0 ] && echo clean || echo errors)" >> "$OUT"
echo "tsc exit=$code"

echo "DONE"
