#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../../../.."
export BB_DATA_DIR="$PWD/validation/tools/bb_index/bbdata"
AUD="validation/tools/bb_index/audit/gates"
run() { local name="$1"; shift; timeout 800 env "$@" > "$AUD/$name.log" 2>&1; echo "GATE $name exit=$?"; }
run m40-a2-bounded-post BB_M40_READ_ONLY=1 bun run script/m40/verify-a2-bounded-post.ts
run m40-a5-flag-semantics BB_M40_READ_ONLY=1 bun run script/m40/verify-a5-flag-semantics.ts
run m40-a6-health-refresh BB_M40_READ_ONLY=1 bun run script/m40/verify-a6-health-refresh.ts
run m43-a3-flag-semantics BB_M43_READ_ONLY=1 bun run script/m43/verify-a3-flag-semantics.ts
run m43-a4-corpus BB_M43_READ_ONLY=1 bun run script/m43/verify-a4-corpus.ts
echo FINAL_SWEEP_DONE
