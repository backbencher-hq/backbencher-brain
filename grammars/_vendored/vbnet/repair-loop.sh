#!/usr/bin/env bash
# Grammar repair loop for tree-sitter-vbnet.
#   ./repair-loop.sh            rebuild wasm from grammars/tree-sitter-vbnet, run all cases
#   ./repair-loop.sh --parse    additionally dump the parse tree of each case
#   ./repair-loop.sh <case>     run one case (name or path)
set -uo pipefail

# paths resolved from this script's location, not hardcoded — see the header of
# grammar-gate.sh for why. `HERE` is grammars/_vendored/vbnet.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
[ -n "${BB_VB_BIN:-}" ] && export PATH="$BB_VB_BIN:$PATH"
export PATH="$ROOT/node_modules/.bin:$PATH"
GRAMMAR=$ROOT/grammars/tree-sitter-vbnet
REPRO=$HERE/repro-cases
TSX=$ROOT/node_modules/.bin/tsx
[ -d "$REPRO" ] || { echo "REPRO CASES MISSING: $REPRO"; exit 1; }

cd "$GRAMMAR" || exit 1
if [ "${1:-}" != "--no-build" ]; then
  echo "== generate =="
  # `tree-sitter build` compiles whatever is ALREADY in src/. If `generate`
  # fails, src/ still holds the PREVIOUS grammar and the build happily emits a
  # wasm of the old grammar -- the exact #841 defect ("the committed groovy wasm
  # was a build behind its own grammar"). So generate's exit code is checked,
  # and src/ is removed first so a stale parser.c can never be built.
  # PREFLIGHT, added 2026-10-01. The `rm -rf src` below is deliberate and must
  # stay: removing it reintroduces #841, where a generate that fails leaves the
  # PREVIOUS grammar in place and the build happily emits a wasm of the old
  # grammar. But it makes the tree-sitter CLI a HARD prerequisite, because once
  # src/ is gone a generate that cannot run is unrecoverable from in here.
  #
  # Not theoretical: running this gate on a machine without the CLI deleted the
  # vendored tree-sitter-vbnet/src/grammar.json and src/node-types.json — two
  # TRACKED pin files — and then failed with rc=127. The repository was restored
  # from git, and the ordering is fixed here so it cannot recur. The tool is
  # checked BEFORE the destructive step.
  if ! command -v tree-sitter >/dev/null 2>&1; then
    echo "PREFLIGHT FAILED: the tree-sitter CLI is not on PATH. Nothing modified."
    echo "  This script regenerates grammars/tree-sitter-vbnet/src, so it refuses to"
    echo "  start without the tool. Install it, or point BB_VB_BIN at its directory."
    exit 127
  fi
  rm -rf src
  GEN_LOG=$(tree-sitter generate 2>&1)
  GEN_RC=$?
  echo "$GEN_LOG" | head -40
  if [ $GEN_RC -ne 0 ] || [ ! -f src/parser.c ]; then
    echo "GENERATE FAILED (rc=$GEN_RC) — refusing to build a stale wasm"
    exit 1
  fi
  echo "generate ok: $(grep -o 'LANGUAGE_VERSION [0-9]*' src/parser.c | head -1)"
  echo "== build wasm =="
  BUILD_LOG=$(tree-sitter build --wasm --docker 2>&1)
  BUILD_RC=$?
  echo "$BUILD_LOG" | grep -iv "pulling\|waiting\|download\|verifying\|digest\|status:\|already exists\|unable to find image" | head -20
  if [ $BUILD_RC -ne 0 ]; then
    echo "BUILD FAILED (rc=$BUILD_RC)"; exit 1
  fi
  if [ ! -f tree-sitter-vbnet.wasm ]; then echo "BUILD FAILED: no wasm produced"; exit 1; fi
  cp -f tree-sitter-vbnet.wasm "$ROOT/wasm/tree-sitter-vbnet.wasm" && echo "wasm -> $ROOT/wasm/tree-sitter-vbnet.wasm"
fi

echo "== repro cases =="
cd "$REPRO" || exit 1
if [ -n "${1:-}" ] && [ "$1" != "--parse" ] && [ "$1" != "--no-build" ]; then
  FILES=$(ls "$REPRO"/*.vb | grep -i "$1")
  [ -z "$FILES" ] && { echo "no case matches '$1'"; exit 1; }
else
  FILES=$(ls "$REPRO"/*.vb)
fi
$TSX $ROOT/script/m14/tmp/grammar-cases.ts $FILES
