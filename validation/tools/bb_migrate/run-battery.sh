#!/usr/bin/env bash
# The campaign gate battery for bb_migrate. Every row is a command whose exit code is
# read and recorded; no gate is reported green from memory.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
LOG="validation/tools/bb_migrate/logs"
export BB_DATA_DIR="$ROOT/validation/tools/bb_migrate/bbdata"
export BB_NO_AUTO_REFRESH=1
mkdir -p "$LOG"
rows=()
run() {
  local id="$1" command="$2"
  local out="$LOG/battery-${id}.log"
  eval "$command" > "$out" 2>&1
  local code=$?
  local summary
  summary=$(grep -E "VERIFIED|KNOWN-GAP|PASS|FAIL|BLOCKED|error TS" "$out" | tail -1 | cut -c1-160)
  rows+=("$(node -e 'console.log(JSON.stringify({id:process.argv[1],command:process.argv[2],exitCode:Number(process.argv[3]),summary:process.argv[4]}))' "$id" "$command" "$code" "$summary")")
  echo "$id exit=$code  $summary"
}
run m13-accuracy   "npx tsx script/m13/verify-migrate-accuracy.ts"
run m13-docs       "bun run script/m13/verify-migrate-docs.ts"
run m13-e2e        "bun run script/m13/verify-migrate-e2e-corpus.ts"
run m20-order      "bun run script/m20/verify-migration-order.ts"
run m20-methodology "bun run script/m20/verify-migration-methodology.ts"
run m20-mappings   "bun run script/m20/verify-migration-mappings.ts"
run m20-dictionary "bun run script/m20/verify-migration-dictionary.ts"
run m35-s3         "bun run script/m35/verify-s3-graph-migrate.ts"
run m48-c2         "bun run script/m48/verify-c2-edge-mutations.ts"
run m48-p4         "bun run script/m48/verify-p4-param-matrix.ts"
run m65-latency    "bun run script/m65/verify-migrate-latency.ts"
run m65-selectors  "bun run script/m65/verify-migrate-selectors.ts"
run m15-deep       "bun run script/m15/verify-visualize-migrate-deep.ts"
run visualize-migrate "bun run script/verify-visualize-migrate.ts"
run docs-only      "npx tsx script/verify-tool-docs.ts --only bb_migrate"
run regex-policy   "npx tsx script/tools/verify-regex-policy.ts"
run typecheck      "npx tsc --noEmit"
run m31-mode-corpus "bun run script/m31/tool-mode-corpus.ts --check"
printf '%s\n' "${rows[@]}" > "$LOG/.battery-rows.jsonl"
node -e '
const fs = require("fs")
const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
const out = { schemaVersion: 1, tool: "bb_migrate", generatedAt: new Date().toISOString(), currentCommit: require("child_process").execSync("git rev-parse HEAD", { cwd: process.cwd(), encoding: "utf8" }).trim(), rows, passed: rows.filter((row) => row.exitCode === 0).length, failed: rows.filter((row) => row.exitCode !== 0).length }
fs.writeFileSync("validation/tools/bb_migrate/BATTERY.json", JSON.stringify(out, null, 1))
console.log(`battery: ${out.passed} pass / ${out.failed} fail of ${rows.length}`)
' "$LOG/.battery-rows.jsonl"
