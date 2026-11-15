#!/usr/bin/env bash
# Phase-A measurement battery for bb_ask: re-runs every tier probe against the consolidated
# (gitignored) bbdata/<tier> data dirs so each evidence JSON names a path that exists.
set -u
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
D="$ROOT/validation/tools/bb_ask"
export BB_NO_AUTO_REFRESH=1
run() { echo "== $*" >&2; "$@" >/dev/null 2>&1 || echo "FAILED: $*" >&2; }

# T0 — local word vectors
run env BB_DATA_DIR="$D/bbdata/t0" BB_EMBEDDING_DISABLED=1 npx tsx validation/tools/bb_ask/work/index-fixture.mts "$ROOT/test/fixtures/polyglot" "$D/t0-index.json"
run env BB_DATA_DIR="$D/bbdata/t0" BB_EMBEDDING_DISABLED=1 npx tsx validation/tools/bb_ask/work/latency.mts T0 "$ROOT/test/fixtures/polyglot" "$D/t0-latency-local.json"
run env BB_DATA_DIR="$D/bbdata/t0" npx tsx validation/tools/bb_ask/work/latency.mts T0-remote-query "$ROOT/test/fixtures/polyglot" "$D/t0-latency-remote-query.json"
run env BB_DATA_DIR="$D/bbdata/t0" npx tsx validation/tools/bb_ask/work/index-facts.mts "$ROOT/test/fixtures/polyglot" "$D/t0-index-facts.json"

# T0 — API embeddings configured (true remote vector path)
run env BB_DATA_DIR="$D/bbdata/t0api" npx tsx validation/tools/bb_ask/work/index-fixture.mts "$ROOT/test/fixtures/polyglot" "$D/t0-index-api.json"
run env BB_DATA_DIR="$D/bbdata/t0api" npx tsx validation/tools/bb_ask/work/latency.mts T0-api-vector "$ROOT/test/fixtures/polyglot" "$D/t0-latency-api.json"

# T1 — synthetic n100, local word vectors
run env BB_DATA_DIR="$D/bbdata/t1" BB_EMBEDDING_DISABLED=1 npx tsx validation/tools/bb_ask/work/index-fixture.mts "$ROOT/.perf-fixtures/bb-scale/n100" "$D/t1-index.json"
run env BB_DATA_DIR="$D/bbdata/t1" BB_EMBEDDING_DISABLED=1 npx tsx validation/tools/bb_ask/work/latency.mts T1 "$ROOT/.perf-fixtures/bb-scale/n100" "$D/t1-latency-local.json"
run env BB_DATA_DIR="$D/bbdata/t1" npx tsx validation/tools/bb_ask/work/latency.mts T1-remote-query "$ROOT/.perf-fixtures/bb-scale/n100" "$D/t1-latency-remote-query.json"
run env BB_DATA_DIR="$D/bbdata/t1" BB_EMBEDDING_DISABLED=1 npx tsx validation/tools/bb_ask/work/limits.mts "$ROOT/.perf-fixtures/bb-scale/n100" "$D/limits.json"
run env BB_DATA_DIR="$D/bbdata/t1" BB_EMBEDDING_DISABLED=1 npx tsx validation/tools/bb_ask/work/mcp-door.mts "$ROOT/.perf-fixtures/bb-scale/n100" "$D/mcp-door.json"

# T2 — the shared reference index, facts only, through a byte-read-only handle
run env BB_DATA_DIR="$ROOT/.bb-data" npx tsx validation/tools/bb_ask/work/index-facts.mts "$ROOT" "$D/t2-index-facts.json"
# T2 — the read-only backup copy (gitignored), facts + component decomposition
run env BB_DATA_DIR="$D/t2-copy" npx tsx validation/tools/bb_ask/work/index-facts.mts "$ROOT" "$D/t2-copy-index-facts.json"
run env BB_DATA_DIR="$D/t2-copy" npx tsx validation/tools/bb_ask/work/t2-components.mts "$ROOT" "$D/t2-components-remote.json"
run env BB_DATA_DIR="$D/t2-copy" BB_EMBEDDING_DISABLED=1 npx tsx validation/tools/bb_ask/work/t2-components.mts "$ROOT" "$D/t2-components-local.json"
echo "ALL DONE" >&2
