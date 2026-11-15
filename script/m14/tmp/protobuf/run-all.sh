#!/usr/bin/env bash
# Protobuf lane — every gate, in order, with a single verdict.
#
# The ordering is deliberate: the GRAMMAR gates run before the EXTRACTION gates,
# because a failure in the first group makes the numbers in the second group
# untrustworthy rather than merely wrong. A summary that reports a symbol count
# without saying the grammar accepted every construct is how a lane reports
# numbers it did not earn.
#
# Corpora are NOT tracked. Stage them per script/m14/tmp/protobuf/corpus-manifest.json
# (default /home/ishaq2321/bb_tests/protobuf/repos). The corpus gates skip loudly
# and do not pretend to have run.
set -uo pipefail
cd "$(dirname "$0")/../../../.." || exit 1

PB=script/m14/tmp/protobuf
pass=0; fail=0; skip=0
declare -a RESULTS=()

run() {
  local name="$1"; shift
  printf '\n\033[1m=== %s ===\033[0m\n' "$name"
  if timeout 3000 npx tsx "$@" 2>&1 | grep -vE '^\[(INFO|WARN|ERROR)\]' | sed 's/^/  /'; then
    pass=$((pass+1)); RESULTS+=("PASS  $name")
  else
    fail=$((fail+1)); RESULTS+=("FAIL  $name")
  fi
}

# ---- gate group 1: the grammar contract ---------------------------------
# The pin gate needs BUN (it reads `import.meta.dir`), not tsx, and it verifies
# EVERY lane regardless of --lane, which only scopes writes. After the m48-recovery
# merge (1ce88e40) the nim and vb lanes are red on their own vendored-tree
# digests; those are another lane's state and are reported here as an advisory,
# never folded into this lane's verdict and never hidden. This lane fails only
# on a `PIN FAILURE protobuf:` line.
printf '\n\033[1m=== grammar pin (source<->wasm provenance) ===\033[0m'
pinout="$(timeout 3000 bun script/m14/verify-grammar-pins.ts 2>&1 | grep -vE '^\[(INFO|WARN|ERROR)\]')"
# The tool must have actually RUN. An earlier version of this gate grepped for a
# protobuf line and for the absence of a failure line, and reported PASS when
# the script died on a syntax error in ANOTHER lane's entry — a false pass on a
# tool that never executed. If the script cannot print its own summary, this
# gate is red, full stop.
if ! echo "$pinout" | grep -qE "lane\(s\) match their record|grammar pins FAILED"; then
  echo "  FAIL: script/m14/verify-grammar-pins.ts did not run to a verdict."
  echo "$pinout" | grep -iE "error|expected" | head -4 | sed 's/^/    /'
  fail=$((fail+1)); RESULTS+=("FAIL  grammar pin (shared tool could not run)")
else
  echo "$pinout" | grep -E "^\s*protobuf\s" | sed 's/^/  /'
  if echo "$pinout" | grep -q "PIN FAILURE protobuf:"; then
    echo "  FAIL: protobuf drifted"; echo "$pinout" | grep "PIN FAILURE protobuf:" | sed 's/^/    /'
    fail=$((fail+1)); RESULTS+=("FAIL  grammar pin (protobuf drifted)")
  else
    pass=$((pass+1)); RESULTS+=("PASS  grammar pin (protobuf matches its record)")
  fi
fi
other="$(echo "$pinout" | grep -c "PIN FAILURE" || true)"
if [ "$other" -gt 0 ]; then
  echo "  ADVISORY: $other pin failure(s) in OTHER lanes (not this lane's gate):"
  echo "$pinout" | grep "PIN FAILURE" | sed 's/^/    /'
fi
# Independent recomputation of THIS lane's pin, straight from disk, so the
# verdict above does not rest on one tool being healthy. This is the gate that
# actually decides this lane's pin status while the shared tool is broken.
run "grammar pin (independent, from disk)"     "$PB/probe/grammar-pin.mts"

run "grammar census (every node type classed)"  "$PB/probe/grammar-census.mts"
run "grammar gaps (+ necessity, - negatives)"   "$PB/probe/grammar-gaps.mts"

# ---- gate group 2: what the analyzer publishes --------------------------
run "corpus breadth (4 corpora, phantoms)"      "$PB/probe/corpus.mts"
run "extraction A/B vs the pre-patch grammar"   "$PB/probe/extraction-ab.mts"

# ---- gate group 3: the analyzer's own contract -------------------------
run "contract battery + mutations"              "$PB/probe/contract-battery.mts"
run "production path (ASTEngine.parseFile)"     "$PB/probe/production-path.mts"
run "robustness (degenerate + deep input)"      "$PB/probe/robustness.mts"
run "no-regex / no-text-scan"                   "$PB/probe/no-text-scan.mts"
run "m12 corpus errors (the `corpus` cell)"    "$PB/probe/m12-corpus-errors.mts"
run "doc truth (every documented claim)"        "$PB/probe/doc-truth.mts"

printf '\n\033[1m=== VERDICT ===\033[0m\n'
for r in "${RESULTS[@]}"; do printf '  %s\n' "$r"; done
printf '\n  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
