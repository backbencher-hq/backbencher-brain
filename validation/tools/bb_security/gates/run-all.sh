#!/usr/bin/env bash
# Runs every existing bb_security verifier from the working tree under bun.
# The gates are SELF-CONTAINED: they fall back to an isolated
# validation/tools/bb_security/bbdata data dir when BB_DATA_DIR is unset, so this
# runner deliberately does not export one (that is the self-containment check).
set -u
cd "$(dirname "$0")/../../../.."
export BB_NO_AUTO_REFRESH=1
export BB_DATA_DIR="$PWD/validation/tools/bb_security/bbdata"
out=validation/tools/bb_security/gates
: > "$out/EXITS.tsv"
gates=(
  script/m13/verify-security-contract.ts
  script/m13/verify-security-handler.ts
  script/m13/verify-security-adversarial.ts
  script/m13/verify-security-docs.ts
  script/m15/verify-security-regressions.ts
  script/m15/verify-security-precision.ts
  script/m15/verify-security-deep.ts
  script/verify-security.ts
  script/m20/verify-security-flow-boundary.ts
  script/m20/verify-security-adversarial.ts
  script/m20/verify-security-history.ts
  script/m17/verify-sec-corpus.ts
  script/m17/verify-sec-history.ts
)
for g in "${gates[@]}"; do
  name=$(echo "$g" | sed 's#/#_#g; s#\.ts$##')
  start=$(date +%s)
  timeout 1200 bun run "$g" > "$out/$name.out" 2>&1
  code=$?
  end=$(date +%s)
  printf '%s\t%s\t%ss\n' "$g" "$code" "$((end-start))" | tee -a "$out/EXITS.tsv"
done
