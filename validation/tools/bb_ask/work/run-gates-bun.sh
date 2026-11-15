#!/usr/bin/env bash
# Faithful `npm run verify` gate invocation for bb_ask: bun run, no BB_DATA_DIR
# override (the MCP child in these gates does not forward env), BB_NO_AUTO_REFRESH=1.
set -u
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="$ROOT/validation/tools/bb_ask/work/baseline-bun"
mkdir -p "$OUT"
export BB_NO_AUTO_REFRESH=1
export BB_DATA_DIR="$ROOT/validation/tools/bb_ask/bbdata-bun"
GATES=(
  script/m13/verify-ask-contract.ts
  script/m13/verify-ask-provenance.ts
  script/m13/verify-ask-adversarial.ts
  script/m13/verify-ask-integration.ts
  script/m13/verify-ask-docs.ts
  script/verify-semantic.ts
  script/m13/verify-ask-e2e-corpus.ts
  script/m16/verify-ask-stats.ts
  script/m15/verify-ask-deep.ts
)
SUMMARY="$OUT/exit-codes.tsv"
: > "$SUMMARY"
for g in "${GATES[@]}"; do
  name="$(basename "$g" .ts)"
  log="$OUT/$name.log"
  start=$(date +%s)
  timeout 1800 bun run "$g" > "$log" 2>&1
  code=$?
  end=$(date +%s)
  printf '%s\t%s\t%s\n' "$g" "$code" "$((end-start))s" >> "$SUMMARY"
  echo "DONE $g exit=$code $((end-start))s" >&2
done
echo "ALL DONE" >&2
cat "$SUMMARY"
