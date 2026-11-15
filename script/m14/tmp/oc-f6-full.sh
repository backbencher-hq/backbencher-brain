#!/usr/bin/env bash
# Runner: canonical F6 fixture-coverage at the objc closing code (writes M14.0.F6.json).
set -u
cd /home/ishaq2321/mcp/backbencher-brain
echo "=== start $(date -Is) ===" > /tmp/f6-full.log
bun run script/m14/verify-fixture-coverage.ts >> /tmp/f6-full.log 2>&1
echo "=== exit $? $(date -Is) ===" >> /tmp/f6-full.log
