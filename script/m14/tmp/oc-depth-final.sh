#!/usr/bin/env bash
# script/m14/tmp/oc-depth-final.sh — objc lane, full-extent draws at the CLOSING code.
# sdwebimage (104 .m files) and afnetworking (49 .m files) are the lane's two pinned
# corpora; both are small enough to be read WHOLE, so the depth claim is a full extent
# rather than a draw.
set -u
cd /home/ishaq2321/mcp/backbencher-brain
export BB_M14_WORK=/tmp/oc-depth-final-work
rm -rf "$BB_M14_WORK"

echo "=== sdwebimage full extent (104) ==="
bun script/m14/differential.ts --repo sdwebimage --sample 104 > /tmp/oc-final-sdwebimage.log 2>&1
echo "exit=$? log=/tmp/oc-final-sdwebimage.log"
grep -aE "\[sdwebimage\] objc: files=" /tmp/oc-final-sdwebimage.log

echo "=== afnetworking full extent (49) ==="
bun script/m14/differential.ts --repo afnetworking --sample 49 > /tmp/oc-final-afnetworking.log 2>&1
echo "exit=$? log=/tmp/oc-final-afnetworking.log"
grep -aE "\[afnetworking\] objc: files=" /tmp/oc-final-afnetworking.log

echo "=== done ==="
