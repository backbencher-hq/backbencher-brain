#!/usr/bin/env bash
# script/m14/tmp/sw-depth-final.sh — swift lane, post-fix full-extent depth runs.
# Canonical lane = swift-nio (554 files, the corpus the six findings were
# measured on); second corpus = alamofire (where #942 was measured).
set -u
cd <corpus-root>/mcp/backbencher-brain
export BB_M14_WORK=/tmp/sw-depth-final-work
rm -rf "$BB_M14_WORK"

echo "=== swift-nio full extent (554) ==="
bun script/m14/differential.ts --repo swift-nio --sample 554 > /tmp/sw-final-nio.log 2>&1
echo "exit=$? log=/tmp/sw-final-nio.log"
tail -40 /tmp/sw-final-nio.log

echo "=== alamofire full extent ==="
bun script/m14/differential.ts --repo alamofire --sample 400 > /tmp/sw-final-alamofire.log 2>&1
echo "exit=$? log=/tmp/sw-final-alamofire.log"
tail -40 /tmp/sw-final-alamofire.log

echo "=== done ==="
