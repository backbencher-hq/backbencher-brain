#!/usr/bin/env bash
# Runner: the full fixture sweep at the objc closing code (M60 objc lane).
set -u
cd <corpus-root>/mcp/backbencher-brain
echo "=== start $(date -Is) ===" > /tmp/fixtures-head.log
bun script/m14/run-fixtures.ts >> /tmp/fixtures-head.log 2>&1
echo "=== exit $? $(date -Is) ===" >> /tmp/fixtures-head.log
