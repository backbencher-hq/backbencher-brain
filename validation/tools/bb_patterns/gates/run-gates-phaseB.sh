#!/usr/bin/env bash
# Phase B gate battery for bb_patterns. Resumable: each gate's exit code and log are
# written as soon as it finishes, and a completed gate is skipped on a re-run, so a
# session restart never loses the table.
set -u
cd /home/ishaq2321/mcp/backbencher-brain || exit 1
export BB_DATA_DIR=/home/ishaq2321/mcp/backbencher-brain/validation/tools/bb_patterns/bbdata/phaseb
export BB_NO_AUTO_REFRESH=1
export BB_EMBEDDING_DISABLED=1
OUT=validation/tools/bb_patterns/gates
mkdir -p "$OUT/logs" "$OUT/results"
run() {
  local name="$1"; shift
  if [ -f "$OUT/results/$name.json" ]; then echo "skip $name (already recorded)"; return; fi
  local start end code
  start=$(date +%s%3N)
  "$@" > "$OUT/logs/$name.log" 2>&1
  code=$?
  end=$(date +%s%3N)
  local sha
  sha=$(sha256sum "$OUT/logs/$name.log" | cut -d' ' -f1)
  printf '{"gate":"%s","command":"%s","exitCode":%s,"durationMs":%s,"logSha256":"%s","log":"%s","recordedAt":"%s"}\n' \
    "$name" "$*" "$code" "$((end - start))" "$sha" "$OUT/logs/$name.log" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/results/$name.json"
  echo "-> $name exit=$code dur=$((end - start))ms"
}
run verify-patterns bun run script/verify-patterns.ts
run m13-patterns-orphans bun run script/m13/verify-patterns-orphans.ts
run m13-patterns-rules bun run script/m13/verify-patterns-rules.ts
run m13-patterns-contract bun run script/m13/verify-patterns-contract.ts
run m13-patterns-docs bun run script/m13/verify-patterns-docs.ts
run m13-handler-contract bun run script/m13/verify-patterns-handler-contract.ts
run m20-parameter-scan bun run script/m20/verify-patterns-parameter-scan.ts
run m20-orphan-semantics bun run script/m20/verify-patterns-orphan-semantics.ts
run m20-pagination-history bun run script/m20/verify-patterns-pagination-history.ts
run m57-t3-scope-all bun run script/m57/verify-t3-scope-all.ts
run m64-patterns-evidence-gate bun run script/m64/verify-patterns-evidence-gate.ts
run m65-rules-budget-and-gates bun run script/m65/verify-rules-budget-and-gates.ts
run m69-page-classes bun run script/m69/verify-patterns-page-class-representation.ts
run m16-docs-truth bun run script/m16/verify-docs-truth.ts
run m15-registry-handlers bun run script/m15/verify-registry-handlers.ts
run m13-patterns-e2e-corpus bun run script/m13/verify-patterns-e2e-corpus.ts
run m15-patterns-deep bun run script/m15/verify-patterns-deep.ts
run m13-handler-contract-selftest bun run script/m13/verify-patterns-handler-contract.ts --self-test
echo "GATE BATTERY DONE"
