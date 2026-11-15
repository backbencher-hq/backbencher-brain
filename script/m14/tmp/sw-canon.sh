#!/usr/bin/env bash
# script/m14/tmp/sw-canon.sh — swift lane, CANONICAL 60-file draws re-derived at the
# closing code (the M14.0.F5 artifact is a family-level snapshot a scoped run may not
# write; the lane's own canonical rows are re-measured here, dart's convention).
set -u
cd /home/ishaq2321/mcp/backbencher-brain
export BB_M14_WORK=/tmp/sw-canon-work
rm -rf "$BB_M14_WORK"

echo "=== swift-nio canonical 60 ==="
bun script/m14/differential.ts --repo swift-nio --sample 60 > /tmp/sw-canon-nio.log 2>&1
echo "exit=$? log=/tmp/sw-canon-nio.log"
grep -aE "\[swift-nio\] swift: files=" /tmp/sw-canon-nio.log

echo "=== alamofire canonical 60 ==="
bun script/m14/differential.ts --repo alamofire --sample 60 > /tmp/sw-canon-alamofire.log 2>&1
echo "exit=$? log=/tmp/sw-canon-alamofire.log"
grep -aE "\[alamofire\] swift: files=" /tmp/sw-canon-alamofire.log

echo "=== done ==="
