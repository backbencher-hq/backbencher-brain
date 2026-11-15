#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../../../.."
export BB_DATA_DIR="$PWD/validation/tools/bb_index/bbdata"
export BB_M40_READ_ONLY=1
AUD="validation/tools/bb_index/audit/gates"
for m in WALK_DELETE NO_SKIP; do
  out="$AUD/m40-a3-mutant-$m.log"
  env "BB_M40_MUTATE_A3_$m=1" timeout 700 bun run script/m40/verify-a3-write-parity.ts > "$out" 2>&1
  echo "$m exit=$? tail:"; grep -E "A3 write|MUTATION|FAIL" "$out" | tail -4
done
