#!/usr/bin/env bash
# Green then mutant runs for the repaired bb_index gates. Red is proven by the
# mutant invocation exiting non-zero with its forced-failure check named.
set -u
cd "$(dirname "$0")/../../../.."
export BB_DATA_DIR="$PWD/validation/tools/bb_index/bbdata"
AUD="validation/tools/bb_index/audit/gates"
run() { # name env-assignment... command...
  local name="$1"; shift
  local log="$AUD/$name.log"
  timeout 700 env "$@" > "$log" 2>&1
  local rc=$?
  echo "GATE $name exit=$rc"
  grep -E "passed,|FAIL:|MUTATION" "$log" | tail -4
}

run m40-a1-green        BB_M40_READ_ONLY=1 bun run script/m40/verify-a1-post-entry.ts
run m40-a1-mutant-path  BB_M40_MUTATE_A1_POST_PATH_UNGUARDED=1 bun run script/m40/verify-a1-post-entry.ts
run m43-p1-green        BB_M43_READ_ONLY=1 bun run script/m43/verify-p1-index-lock.ts
run m43-p1-mutant-lock  BB_M43_MUTATE_P1_HANDLER_ALLOW=1 bun run script/m43/verify-p1-index-lock.ts
run m40-a9-green        BB_M40_READ_ONLY=1 bun run script/m40/verify-a9-purge.ts
echo "GREEN+MUTANT RUNS DONE"
