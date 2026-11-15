#!/usr/bin/env bash
# The final Phase B evidence chain, in order:
#   1. the full security gate suite (13 verifiers)
#   2. planted-mutant red→green proof
#   3. read-path immutability probes (findings + history + unindexed doors)
#   4. write-path attribution (which open commits what)
#   5. latency T0/T1/T2
#   6. REAL-CORPUS post-fix through the real MCP stdio door
set -u
cd "$(dirname "$0")/../../../.."
export BB_NO_AUTO_REFRESH=1
export BB_DATA_DIR="$PWD/validation/tools/bb_security/bbdata"
logs=validation/tools/bb_security/runlogs
mkdir -p "$logs"
npx_tsx() { npx tsx "$@"; }

echo "===== 1/6 gate suite"; ./validation/tools/bb_security/gates/run-all.sh > "$logs/gates.log" 2>&1; echo "gates exit=$?"
echo "===== 2/6 planted mutants"; npx_tsx validation/tools/bb_security/work/probe-mutants.ts > "$logs/mutants.log" 2>&1; echo "mutants exit=$?"
echo "===== 3/6 read-path probe"; npx_tsx validation/tools/bb_security/work/probe-readpath.ts > "$logs/readpath.log" 2>&1; echo "readpath exit=$?"
echo "===== 4/6 write attribution"; npx_tsx validation/tools/bb_security/work/probe-write-attribution.ts > "$logs/write-attribution.log" 2>&1; echo "attribution exit=$?"
echo "===== 5/6 latency"; npx_tsx validation/tools/bb_security/work/probe-latency.ts > "$logs/latency.log" 2>&1; echo "latency exit=$?"
echo "===== 6/6 real corpus"; npx_tsx validation/tools/bb_security/work/probe-real-corpus.ts > "$logs/real-corpus.log" 2>&1; echo "real-corpus exit=$?"
echo "CHAIN DONE"
