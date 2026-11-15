#!/usr/bin/env bash
# Full-corpus erlang dual lens, in chunks, restartable.
#
# WHY CHUNKS. Three separate WASM failures forced this, all of them in
# `script/m14/tmp/erlang-census.ts` and all of them found by running it:
#
#   1. one reused parser returned no tree for 422 of 4,326 files;
#   2. `parser.delete()` on an instance an aborted parse had already torn down
#      raised "Out of bounds memory access" from inside web-tree-sitter and killed a
#      70-minute run with no report written;
#   3. after enough of those, `new Parser()` ITSELF began failing with
#      "call_indirect to a signature that does not match" — the module's function
#      table is corrupted once parsers have been deleted.
#
# So the parser is never deleted inside a process, and the corpus is split into
# chunks that each get a fresh process with a fresh WASM module. The chunks TILE
# the file list exactly — no stride, so nothing is skipped and nothing is counted
# twice — and a chunk that dies costs one chunk, not the run.
#
# RESTARTABLE. A chunk whose JSON already exists is skipped, so re-running after an
# interruption continues rather than restarting. That matters on a shared box where
# a run can be preempted at any moment.
#
# Usage:  bash script/m14/tmp/erlang-census-all.sh [chunkCount]
#         OUT_DIR defaults to /home/sano/ishaq/bb_tests/erl-evidence/census
set -u
CHUNKS="${1:-24}"
OUT_DIR="${OUT_DIR:-/home/sano/ishaq/bb_tests/erl-evidence/census}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
mkdir -p "$OUT_DIR"

echo "corpus dual lens: $CHUNKS chunks -> $OUT_DIR"
for i in $(seq 0 $((CHUNKS - 1))); do
  n=$((i + 1))
  out="$OUT_DIR/chunk-$(printf '%03d' "$n").json"
  if [ -s "$out" ]; then
    echo "  chunk $n/$CHUNKS — already done, skipping"
    continue
  fi
  # A chunk that dies writes a .err and is retried on the next invocation rather
  # than silently counted as clean.
  rm -f "$out.err"
  bun run "$ROOT/script/m14/tmp/erlang-census.ts" \
    --chunks "$CHUNKS" --offset "$i" --out "$out" \
    > "$OUT_DIR/chunk-$(printf '%03d' "$n").log" 2>&1
  if [ -s "$out" ]; then
    echo "  chunk $n/$CHUNKS — ok ($(bun -e 'const d = await Bun.file(process.argv[1]).json(); console.log(`${d.filesRead} files, ${d.relationships} rels, unexplained=${d.unexplained}, missing=${d.missing}`)' "$out" 2>/dev/null))"
  else
    echo "  chunk $n/$CHUNKS — FAILED (see $OUT_DIR/chunk-$(printf '%03d' "$n").log); re-run to retry"
    cp "$OUT_DIR/chunk-$(printf '%03d' "$n").log" "$out.err" 2>/dev/null || true
  fi
done

bun run "$ROOT/script/m14/tmp/erlang-census-aggregate.ts" "$OUT_DIR"