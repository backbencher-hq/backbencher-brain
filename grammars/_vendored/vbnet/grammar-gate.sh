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
export PATH="$HOME/fixtures/bin:$HOME/.local/bin:$PATH"
ROOT=$HOME/backbencher-brain
TSX=$ROOT/node_modules/.bin/tsx
PROBES=$HOME/fixtures/probes
VAL=$HOME/fixtures/validation
FLOOR=$VAL/grammar-floor.json
CAND=$VAL/grammar-candidate.json
ACCEPT=0
[ "${1:-}" = "--accept" ] && ACCEPT=1
[ "${1:-}" = "--no-build" ] || "$ROOT/../fixtures/grammar-repro/repair-loop.sh" >/tmp/vb-build.log 2>&1
BUILD_RC=$?
if [ "${1:-}" != "--no-build" ]; then
  if ! grep -qE "^cases: [0-9]+ pass / 0 fail" /tmp/vb-build.log; then
    echo "BUILD or REPRO CASES FAILED — see /tmp/vb-build.log"
    grep -E "GENERATE FAILED|BUILD FAILED|FAIL |cases:" /tmp/vb-build.log | head -30
    exit 1
  fi
  echo "repro cases: $(grep -o 'cases: .*' /tmp/vb-build.log | head -1)"
fi

OUT=$(OUT=$CAND $TSX $PROBES/grammar-baseline.ts 2>&1)
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
