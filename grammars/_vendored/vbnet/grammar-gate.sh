#!/usr/bin/env bash
# THE VB GRAMMAR GATE — the thing a repair must pass, in one command.
#
#   ./grammar-gate.sh              build, then run cases + corpus, and FAIL if
#                                  the corpus aggregate clean% drops
#   ./grammar-gate.sh --no-build   skip generate/build (use the wired wasm)
#   ./grammar-gate.sh --accept      record the current corpus reading as the
#                                  floor (an explicit act, never automatic)
#
# WHY THE CORPUS HALF EXISTS, and it is not belt-and-braces. During this lane a
# change that made `_name_reference` accept `generic_name` -- so that
# `Implements IComparable(Of C)` would parse -- kept ALL 26 repro cases green
# and took the corpus from 89.79 % clean to 32.49 %. Every bad file carried
# exactly ONE error node, the signature of a grammar that has stopped parsing
# rather than of a missing production. A fixture suite cannot see that: the
# fixtures cover the shapes the lane knows about, and the regression was in the
# interaction of a name rule with `qualified_name`'s qualifier. So the gate is
# the DIFFERENTIAL, and the cases are the fast inner loop.
#
# The floor is a measured reading, not a number someone typed: `--accept` writes
# whatever the corpus says right now, and after that any drop is a failure.
set -uo pipefail

# ── paths, resolved from THIS FILE rather than hardcoded ────────────────────
# The original hardcoded $HOME/…, which made the gate unrunnable on
# any other machine and on any clone. Everything below is derived from the
# script's own location, so a clone is self-contained. Overridable for a
# toolchain that lives elsewhere:
#
#   BB_VB_BIN      extra PATH entry for the `tree-sitter` CLI (build half only)
#   BB_VB_CORPUS   root holding runtime-mvb/ p3d/ dismt/ tankex/ (default below)
#   BB_VB_BUILDLOG where the build half's log goes (default /tmp/vb-build.log)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
[ -n "${BB_VB_BIN:-}" ] && export PATH="$BB_VB_BIN:$PATH"
# The CLI itself is NOT vendored: it is an 18.8 MB ELF binary, and this repo
# installs tooling rather than committing it. `--no-build` never needs it.
command -v tree-sitter >/dev/null 2>&1 || [ -x "${BB_VB_BIN:-/nonexistent}/tree-sitter" ] || \
  echo "note: tree-sitter CLI not on PATH — the BUILD half will fail; --no-build still works"
export PATH="$ROOT/node_modules/.bin:$PATH"
TSX=$ROOT/node_modules/.bin/tsx
PROBES=$ROOT/script/m14/tmp
VAL=$HERE
FLOOR=$VAL/grammar-floor.json
CAND=${BB_VB_CANDIDATE:-$VAL/grammar-candidate.json}
BUILDLOG=${BB_VB_BUILDLOG:-/tmp/vb-build.log}
ACCEPT=0
[ "${1:-}" = "--accept" ] && ACCEPT=1
[ "${1:-}" = "--no-build" ] || "$HERE/repair-loop.sh" >"$BUILDLOG" 2>&1
BUILD_RC=$?
if [ "${1:-}" != "--no-build" ]; then
  if ! grep -qE "^cases: [0-9]+ pass / 0 fail" "$BUILDLOG"; then
    echo "BUILD or REPRO CASES FAILED — see $BUILDLOG"
    grep -E "GENERATE FAILED|BUILD FAILED|FAIL |cases:" "$BUILDLOG" | head -30
    exit 1
  fi
  echo "repro cases: $(grep -o 'cases: .*' "$BUILDLOG" | head -1)"
fi

OUT=$(OUT=$CAND BB_VB_CORPUS="${BB_VB_CORPUS:-$HOME/fixtures/vb-corpus}" $TSX $PROBES/grammar-baseline.ts 2>&1)
echo "$OUT" | tail -12
echo ""

CLEAN=$(python3 -c "import json;print(json.load(open('$CAND'))['aggregate']['cleanPct'])")
echo "aggregate clean%: $CLEAN"

if [ "$ACCEPT" = "1" ]; then
  cp "$CAND" "$FLOOR"
  echo "ACCEPTED as the floor: $FLOOR"
  exit 0
fi

if [ ! -f "$FLOOR" ]; then
  echo "NO FLOOR yet — run with --accept to record one"
  exit 2
fi

python3 $PROBES/gate-compare.py "$FLOOR" "$CAND"
exit $?
