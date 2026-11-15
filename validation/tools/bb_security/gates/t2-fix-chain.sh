#!/usr/bin/env bash
# The T2 default-scan fix evidence chain, in order.
set -u
cd "$(dirname "$0")/../../../.."
export BB_NO_AUTO_REFRESH=1
export BB_DATA_DIR="$PWD/validation/tools/bb_security/bbdata"
logs=validation/tools/bb_security/runlogs2
mkdir -p "$logs"
echo "===== mutants (9)"; npx tsx validation/tools/bb_security/work/probe-mutants.ts > "$logs/mutants.log" 2>&1; echo "mutants exit=$?"
echo "===== gate suite"; ./validation/tools/bb_security/gates/run-all.sh > "$logs/gates.log" 2>&1; echo "gates exit=$?"
echo "===== real corpus"; npx tsx validation/tools/bb_security/work/probe-real-corpus.ts > "$logs/real-corpus.log" 2>&1; echo "corpus exit=$?"
echo "===== latency"; npx tsx validation/tools/bb_security/work/probe-latency.ts > "$logs/latency.log" 2>&1; echo "latency exit=$?"
echo "===== t2 default budget (node)"; npx tsx validation/tools/bb_security/work/probe-t2-budget.ts > "$logs/t2-budget-node.log" 2>&1; echo "t2-node exit=$?"
echo "===== t2 default budget (bun)"; bun run validation/tools/bb_security/work/probe-t2-budget.ts > "$logs/t2-budget-bun.log" 2>&1; echo "t2-bun exit=$?"
echo "T2-FIX CHAIN DONE"
