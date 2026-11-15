#!/bin/zsh
# bb_tests/bb_patterns/harness/env.sh — the ONE way to get a working bb runtime on this box.
#
# MEASURED RUNTIME MATRIX (why this file exists at all):
#
#   runtime              node:sqlite   better-sqlite3 (the engine's Node driver)
#   node v22.14.0        SIGKILL      OK
#   node v22.20.0        SIGKILL      OK
#   node v24.21.0        OK           ABI mismatch (prebuilt is NODE_MODULE_VERSION 127)
#
# `node:sqlite` on Node 22 does not merely warn as experimental — opening ANY
# database, even `new DatabaseSync(":memory:")`, terminates the process with
# SIGKILL (exit 137) and no output. So a corpus harness that reaches for
# node:sqlite dies silently. better-sqlite3 is what src/brain/database.ts
# actually resolves under Node (`#db` -> better-sqlite3), so this harness uses
# the same driver as the engine: a measurement and the thing it measures then
# share one SQL implementation.
#
# usage:  source bb_tests/bb_patterns/harness/env.sh
#         cd /Users/sano/Documents/Default\ Project/ishaq/backbencher-brain
#         ./node_modules/.bin/tsx ../bb_tests/bb_patterns/probes/....ts

export BBNODE="$HOME/.local/bbnode/bin/node"
export PATH="$HOME/.local/bbnode/bin:$PATH"
export BB_DATA_DIR="${BB_DATA_DIR:-/Users/sano/Documents/Default Project/ishaq/bb_tests/bb_patterns/_data}"
# A build of the repo is required by verifiers that exec bin/bb; keep it
# separate from the engine-only ones so a stale dist can never silently
# stand in for current source.
export BB_REPO="/Users/sano/Documents/Default Project/ishaq/backbencher-brain"
