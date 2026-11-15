#!/usr/bin/env bash
# script/m14/tmp/sw-artifacts.sh — re-emit the M60/M14 artifacts at the swift lane's
# final bytes. The tracker snapshot, the LCM and G1 come AFTER the issues are closed.
set -u
cd /home/ishaq2321/mcp/backbencher-brain

step() { echo; echo "=== $* ==="; }

step "F3 canonical fixtures run"
timeout 1800 bun script/m14/run-fixtures.ts > /tmp/fixtures.log 2>&1
echo "exit=$?"; tail -3 /tmp/fixtures.log

step "fixtures-at-head"
timeout 600 npx tsx script/m60/emit-fixtures-at-head.ts --log /tmp/fixtures.log
echo "exit=$?"

step "F6 canonical fixture coverage"
timeout 1800 bun run script/m14/verify-fixture-coverage.ts > /tmp/sw-clo-f6-full.log 2>&1
echo "exit=$?"; tail -8 /tmp/sw-clo-f6-full.log

step "P1 payload matrix"
timeout 1800 npx tsx script/m60/payload-matrix.ts > /tmp/sw-clo-p1.log 2>&1
echo "exit=$?"; tail -8 /tmp/sw-clo-p1.log

step "R10 target-spelling census (all lanes, canonical draws)"
timeout 3600 bun script/m60/target-spelling-census.ts > /tmp/sw-clo-r10.log 2>&1
echo "exit=$?"; tail -20 /tmp/sw-clo-r10.log

step "R7 sentinel census"
timeout 3600 bun script/m60/sentinel-census.ts --emit > /tmp/sw-clo-r7.log 2>&1
echo "exit=$?"; tail -14 /tmp/sw-clo-r7.log

step "R8 framework-surface census"
timeout 3600 bun script/m60/framework-surface-census.ts --emit > /tmp/sw-clo-r8.log 2>&1
echo "exit=$?"; tail -14 /tmp/sw-clo-r8.log

step "declared-type-refs census"
timeout 3600 bun script/m60/declared-type-refs-census.ts > /tmp/sw-clo-dtr.log 2>&1
echo "exit=$?"; tail -10 /tmp/sw-clo-dtr.log

echo; echo "=== DONE ==="
