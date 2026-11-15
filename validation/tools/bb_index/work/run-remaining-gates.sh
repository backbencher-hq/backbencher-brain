#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../../../.."
export BB_DATA_DIR="$PWD/validation/tools/bb_index/bbdata"
AUD="validation/tools/bb_index/audit/gates"
run() { local name="$1"; shift; timeout 700 env "$@" > "$AUD/$name.log" 2>&1; echo "GATE $name exit=$?"; tail -3 "$AUD/$name.log" | grep -vE "^\s*$" | head -3; }
run verify-index           BB_NO_AUTO_REFRESH=1 npx tsx script/verify-index.ts
run m43-a1-mcp-autorefresh BB_NO_AUTO_REFRESH=1 bun run script/m43/verify-a1-mcp-auto-refresh.ts
run m43-a2-cli-autorefresh BB_NO_AUTO_REFRESH=1 bun run script/m43/verify-a2-cli-auto-refresh.ts
run m22-e1-mcp             bun run script/m22/verify-e1-mcp.ts
run m22-d3-single-file     bun run script/m22/verify-d3-single-file.ts
run m28-index-portability  npx tsx script/m28/verify-index-portability.ts
echo REMAINING_GATES_DONE
