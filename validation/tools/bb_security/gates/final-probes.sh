#!/usr/bin/env bash
# Steps 3-6 of the Phase B evidence chain (the gate suite and planted mutants are
# recorded in runlogs/gates.log and runlogs/mutants.log).
set -u
cd "$(dirname "$0")/../../../.."
export BB_NO_AUTO_REFRESH=1
export BB_DATA_DIR="$PWD/validation/tools/bb_security/bbdata"
logs=validation/tools/bb_security/runlogs
mkdir -p "$logs"
echo "===== read-path probe"; npx tsx validation/tools/bb_security/work/probe-readpath.ts > "$logs/readpath.log" 2>&1; echo "readpath exit=$?"
echo "===== write attribution"; npx tsx validation/tools/bb_security/work/probe-write-attribution.ts > "$logs/write-attribution.log" 2>&1; echo "attribution exit=$?"
echo "===== latency"; npx tsx validation/tools/bb_security/work/probe-latency.ts > "$logs/latency.log" 2>&1; echo "latency exit=$?"
echo "===== real corpus"; npx tsx validation/tools/bb_security/work/probe-real-corpus.ts > "$logs/real-corpus.log" 2>&1; echo "real-corpus exit=$?"
echo "PROBES DONE"
