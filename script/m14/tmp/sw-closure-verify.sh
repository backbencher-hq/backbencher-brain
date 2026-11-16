#!/usr/bin/env bash
# script/m14/tmp/sw-closure-verify.sh — swift lane closure re-derivation.
# Quick probes first, the slow FULL-EXTENT draws last, each step timeout-guarded so
# one wedged child cannot hide the readings that already exist.
set -u
cd <corpus-root>/mcp/backbencher-brain
export BB_M14_WORK=/tmp/sw-closure-work
rm -rf "$BB_M14_WORK"

step() { echo; echo "=== $* ==="; }

step "1 fixtures (F3)"
timeout 900 bun script/m14/run-fixtures.ts --lang swift > /tmp/sw-clo-fixtures.log 2>&1
echo "exit=$?"; tail -6 /tmp/sw-clo-fixtures.log

step "2 fixture coverage (F6)"
timeout 900 bun run script/m14/verify-fixture-coverage.ts --lang swift > /tmp/sw-clo-f6.log 2>&1
echo "exit=$?"; tail -12 /tmp/sw-clo-f6.log

step "3 M12 swift truth"
timeout 900 bun script/m12/verify-analyzer.ts swift > /tmp/sw-clo-m12.log 2>&1
echo "exit=$?"; tail -22 /tmp/sw-clo-m12.log

step "4 name census (full extent)"
timeout 1800 bun script/m14/tmp/sw-name-census.ts > /tmp/sw-clo-census.log 2>&1
echo "exit=$?"; tail -16 /tmp/sw-clo-census.log

step "5 line coverage (full extent)"
timeout 1800 bun script/m14/tmp/sw-line-coverage.ts > /tmp/sw-clo-lines.log 2>&1
echo "exit=$?"; tail -18 /tmp/sw-clo-lines.log

step "6 line equivalence"
timeout 1800 bun script/m14/tmp/sw-line-equivalence.ts > /tmp/sw-clo-lines-eq.log 2>&1
echo "exit=$?"; tail -14 /tmp/sw-clo-lines-eq.log

step "7 typecheck"
timeout 900 bun run typecheck > /tmp/sw-clo-tsc.log 2>&1
echo "exit=$?"; grep -c "error TS" /tmp/sw-clo-tsc.log

step "8 mutants"
timeout 2400 BB_MUTANT_ONLY="swift/" bun script/m14/mutate-analyzer.ts > /tmp/sw-clo-mutants.log 2>&1
echo "exit=$?"; tail -10 /tmp/sw-clo-mutants.log

step "9 swift-nio FULL EXTENT 554 (samples)"
timeout 2400 bash -c 'BB_F5_SHOW_SAMPLES=1 bun script/m14/differential.ts --repo swift-nio --sample 554' > /tmp/sw-clo-nio.log 2>&1
echo "exit=$?"; grep -E "\[swift-nio\] swift:" /tmp/sw-clo-nio.log

step "10 alamofire FULL EXTENT 400 (samples)"
timeout 2400 bash -c 'BB_F5_SHOW_SAMPLES=1 bun script/m14/differential.ts --repo alamofire --sample 400' > /tmp/sw-clo-alamofire.log 2>&1
echo "exit=$?"; grep -E "\[alamofire\] swift:" /tmp/sw-clo-alamofire.log

echo
echo "=== DONE ==="
