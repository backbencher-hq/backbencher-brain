#!/usr/bin/env bash
# Post-fix verification: the three m13 gates, the planted-mutant battery, and the
# read-path probes, all against the shared reference index state.
set -u
cd "$(dirname "$0")/../../../.."
export BB_NO_AUTO_REFRESH=1
export BB_DATA_DIR="$PWD/validation/tools/bb_security/bbdata"
logs=validation/tools/bb_security/runlogs2
mkdir -p "$logs"
for gate in script/m13/verify-security-contract.ts script/m13/verify-security-handler.ts script/m13/verify-security-adversarial.ts; do
  name=$(echo "$gate" | sed 's#/#_#g; s#\.ts$##')
  bun run "$gate" > "$logs/$name.out" 2>&1; echo "$gate exit=$?"
done
echo "===== mutants (9)"; npx tsx validation/tools/bb_security/work/probe-mutants.ts > "$logs/mutants.log" 2>&1; echo "mutants exit=$?"
echo "===== read path"; npx tsx validation/tools/bb_security/work/probe-readpath.ts > "$logs/readpath.log" 2>&1; echo "readpath exit=$?"
echo "===== write attribution"; npx tsx validation/tools/bb_security/work/probe-write-attribution.ts > "$logs/write-attribution.log" 2>&1; echo "attribution exit=$?"
echo "POSTFIX VERIFY DONE"
