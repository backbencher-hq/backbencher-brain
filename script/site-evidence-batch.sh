#!/usr/bin/env bash
# The website evidence batch: every site gate at ONE HEAD, then the ledger sync
# and the governance/closure gates for M41 and M56.
#
# Run from anywhere; it cd's to the repo root. Stop if any step fails — a batch
# is only meaningful when the whole matrix is green at one commit. Do NOT commit
# other lanes' working-tree files: the batch commits only validation/m41/results
# and validation/m56/results.
#
# Why this order: closure (X1) requires governance (G1) to pass, G1 requires the
# ledger to match the artifacts, and the ledger is synced from the artifacts the
# verifiers just wrote. The final re-sync + G1 pass records the closure evidence.
set -euo pipefail
cd "$(dirname "$0")/.."
HEAD="$(git rev-parse --short HEAD)"
echo "== website evidence batch at $HEAD"

echo "== 1/6 atlas digest gate"
npx tsx script/atlas/verify-atlas.ts

echo "== 2/6 M41 website verifiers"
npx tsx script/m41/verify-truth-pipeline.ts
npx tsx script/m41/verify-site-truth.ts
npx tsx script/m41/verify-site-truth.ts --label T3
npx tsx script/m41/verify-seo.ts
npx tsx script/m41/verify-design.ts

echo "== 3/6 M56 website verifiers"
npx tsx script/m56/verify-tools-truth.ts
npx tsx script/m56/verify-editors-page.ts
npx tsx script/m56/verify-languages-surface.ts
npx tsx script/m56/verify-docs-completeness.ts
npx tsx script/m56/verify-design.ts
npx tsx script/m56/verify-support-page.ts
npx tsx script/m56/verify-ia.ts

echo "== 4/6 ledger sync (withdraw citations this history cannot resolve)"
npx tsx script/m41/sync-ledger.ts --drop-unreachable-citations
npx tsx script/m41/sync-ledger.ts --milestone m56 --drop-unreachable-citations

echo "== 5/6 governance, then sync again so closure reads verified siblings"
npx tsx script/m41/verify-governance.ts
npx tsx script/m56/verify-governance.ts
npx tsx script/m41/sync-ledger.ts
npx tsx script/m41/sync-ledger.ts --milestone m56

echo "== 6/6 closure (X1), re-sync, re-run governance at the same HEAD"
npx tsx script/m41/verify-closure.ts
npx tsx script/m56/verify-closure.ts
npx tsx script/m41/sync-ledger.ts
npx tsx script/m41/sync-ledger.ts --milestone m56
npx tsx script/m41/verify-governance.ts
npx tsx script/m56/verify-governance.ts

echo
echo "== BATCH GREEN at $HEAD"
echo "   commit ONLY the evidence:"
echo "   git add validation/m41/results validation/m56/results"
echo "   git commit -m 'Website: evidence batch at <HEAD>'"
echo "   then STOP re-running gates: a later single verifier moves its artifact"
echo "   past the ledger and G1 correctly goes red again (not a batch any more)."
