#!/usr/bin/env bash
# GraphQL lane — every gate, in dependency order, against the WIRED wasm.
#
#   ./script/m14/tmp/graphql/run-all.sh            # the wired wasm
#   ./script/m14/tmp/graphql/run-all.sh --corpus   # also the corpus sweep, the A/B and the perf gates
#
# Nothing here takes an argument that could point it at a different grammar
# except the corpus sweep, which compares two grammars ON PURPOSE. Every other
# gate runs against wasm/tree-sitter-graphql.wasm exactly as production does.
set -u
# Self-locating: the lane directory is this script's own, and the repository root
# is four levels up. It used to `cd /home/ishaq2321/bb_tests`, which meant the
# whole suite was unrunnable from a clone — the failure mode this move exists to
# remove. `GQL_CORPORA` still defaults to the external corpus checkout, and says
# so when it is absent rather than silently measuring nothing.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
CORPORA="${GQL_CORPORA:-/home/ishaq2321/bb_tests/graphql/repos}"
cd "$ROOT" || exit 1
export GQL_WASM="${GQL_WASM:-$ROOT/wasm/tree-sitter-graphql.wasm}"
export GQL_CORPORA="$CORPORA"
OUT="$HERE/out"; mkdir -p "$OUT"
if [ ! -d "$CORPORA" ]; then
  echo "NOTE: the third-party corpus is not present at $CORPORA."
  echo "      Gates 8, 8b and 9 need it (47 real .graphql files from graphql-js,"
  echo "      graphiql and neo4j/graphql at pinned revisions). Every probe that"
  echo "      reads it records the revision it used, so this is a fetch step, not a"
  echo "      silent empty measurement."
fi
FAIL=0
run() { # label, command...
  local label="$1"; shift
  echo ""
  echo "=============================================================="
  echo "  $label"
  echo "=============================================================="
  if "$@"; then
    echo "  -> PASS  $label"
  else
    echo "  -> FAIL  $label"
    FAIL=1
  fi
}

run "1. source guards (zero regex, no structural text scan)" npx tsx "$HERE"/probe/no-text-scan.mts
run "2. grammar census (every node type and field the grammar produces)" npx tsx "$HERE"/probe/grammar-census.mts
run "3. grammar gaps (113 specification constructs, valid and invalid)" npx tsx "$HERE"/probe/grammar-gaps.mts
run "4. contract battery (59 hand-audited cases)" npx tsx "$HERE"/probe/contract-battery.mts
run "5. differential (hand-derived ground truth)" npx tsx "$HERE"/differential/differential.mts
run "6. mutation (every defect the review found, re-introduced)" npx tsx "$HERE"/differential/mutation.mts

if [ "${1:-}" = "--corpus" ]; then
  run "8. corpus sweep (real repositories)" npx tsx "$HERE"/probe/corpus-sweep.mts "$CORPORA"
  run "8b. project-level resolution (every APPLICABLE target, judged at project scope)" \
    npx tsx "$HERE"/probe/project-resolution.mts "$CORPORA"
  # A differential whose ground truth omits a family agrees PERFECTLY with an
  # analyzer that omits it, so counting can never find a whole missing family.
  # This gate asks the only question that can: does every position the
  # specification makes referenceable actually appear? Its fixture provokes all
  # 15 families, so a MISS is a regression and not an absent construct.
  run "8c. construct coverage (every referenceable family, provoked then emitted)" \
    npx tsx "$HERE"/probe/master-relationships.mts "$HERE/fixtures-constructs"
  # The A/B compares the WIRED grammar against the one it REPLACED, which is kept
  # byte-for-byte at grammar-rebuild/tree-sitter-graphql-VENDORED-BEFORE.wasm
  # (sha256 9cd70f69…) so the comparison is reproducible forever. Both env vars
  # are explicit here on purpose: left to their defaults this probe would compare
  # the wired grammar with ITSELF and report changedFiles=0, which is a green
  # result that means nothing.
  echo ""
  echo "=============================================================="
  # The m14 fixture lane, run SCOPED. This gate exists because the two doc-truth
  # claims that used to assert "2/2 fixtures pass" read the cross-lane artifact
  # validation/m14/results/M14.0.F3.json, which only a run covering every lane may
  # write — so a fresh worktree could not substantiate them. Whether the fixtures
  # PASS is a gate; how many there are is asserted against the lane's own tracked
  # files. A scoped run writes no milestone evidence, by the runner's own rule.
  if npx tsx "$ROOT/script/m14/run-fixtures.ts" --lang graphql > "$OUT/m14-fixtures.log" 2>&1; then
    echo "  -> PASS  8d. m14 fixture lane (scoped; writes no milestone evidence)"
  else
    echo "  -> FAIL  8d. m14 fixture lane"
    tail -20 "$OUT/m14-fixtures.log"
    FAIL=1
  fi
  # Degenerate inputs and pathological depth. This gate exists because the corpus,
  # the differential and the battery all feed the analyzer well-formed, shallow,
  # ASCII GraphQL — and that comfortable test set hid a RangeError at 2,749 levels
  # of list nesting, plus three more recursions that only a 20,000-clause file
  # reached. `A & B & C` never triggered it, so no representative corpus would have.
  run "8e. robustness (degenerate inputs, and depth past the old failure point)" \
    npx tsx "$HERE"/probe/robustness.mts
  echo "  9. extraction A/B (wired grammar vs the grammar it replaced)"
  echo "=============================================================="
  if GQL_WASM=/home/ishaq2321/backbencher-brain/wasm/tree-sitter-graphql.wasm \
     GQL_LABEL_A=wired \
     GQL_CANDIDATE="$HERE/grammar-rebuild/tree-sitter-graphql-VENDORED-BEFORE.wasm" \
     GQL_LABEL_B=previous-wasm \
     npx tsx "$HERE"/probe/extraction-ab.mts "$CORPORA"; then
    echo "  -> PASS  9. extraction A/B"
  else
    echo "  -> FAIL  9. extraction A/B"
    FAIL=1
  fi
  echo ""
  echo "=============================================================="
  echo "  10. performance attribution (the cost the review measured)"
  echo "=============================================================="
  # One cell per process: the four cells in one process produced numbers that
  # moved by 2x between runs of the same binary, which is machine contention and
  # not the code.
  for cell in A B; do
    npx tsx "$HERE"/probe/perf-attribution.mts --cell $cell 2>/dev/null | tail -1
  done
  echo "  (informational, not a gate — the medians over repeated runs are in"
  echo "   out/perf-attribution.json and the number is recorded in the m12"
  echo "   complexity artifact as performanceTruth)"
  echo ""
  echo "=============================================================="
  echo "  10b. accessor budget (machine-independent cost, and a real gate)"
  echo "=============================================================="
  # Gate 10 measured WALL CLOCK, which on this machine moves by 2x between runs of
  # the same binary, so it can only ever be informational. This one counts the
  # tree-sitter accessor calls instead: the numbers are exact, so the O(n log n)
  # `namedChildCount` walk cannot come back unnoticed. It also runs the analyzer
  # and a baseline in ONE process, alternating, so the ratio it prints is immune to
  # machine drift. The A/B half is skipped when no baseline snapshot is present;
  # the budget half is not, because it is the gate.
  if npx tsx "$HERE"/probe/perf-interleaved.mts; then
    echo "  -> PASS  10b. accessor budget"
  else
    echo "  -> FAIL  10b. accessor budget"
    FAIL=1
  fi
fi

  # doc-truth runs LAST, and that ordering is load-bearing rather than cosmetic:
  # it re-derives 42 numbers from the artifacts, four of which (corpus-sweep,
  # project-resolution, perf-accessors, extraction-ab) are produced by gates 8,
  # 8b, 9 and 10b. It used to be gate 7, which passed only because those artifacts
  # were left over from an earlier run — so on a clean checkout the doc gate would
  # have failed on missing files, and the one gate whose job is to catch a stale
  # claim was the one that could not run.
  # The m12 corpus-errors artifact is regenerated here rather than trusted from
  # disk. The one that was on disk was a 1,970-byte placeholder carrying
  # `symbols: null` and the revision of the PRE-PATCH grammar, and it is what let a
  # manifest claim of 1 error file sit unchallenged against a measurement of 0.
  run "10b. m12 corpus errors (the manifest claim, re-measured)" npx tsx "$HERE"/probe/m12-corpus-errors.mts

  # The R9 relabel moved 7,892 edges from `uses` to `references` — it changed labels,
  # not facts, and the differential CANNOT see that: its ground truth was authored
  # against the pre-move labelling, so a relabel that kept every fact would agree with
  # itself. This gate is the two-set subtraction that can — tree-derived vs emitted,
  # both directions — and it needs the bb_tests corpus root rather than the lane's own
  # checkouts, so it is a --corpus gate.
  run "10c. declared-type round trip (no fabricated edge, no lost edge)" npx tsx "$HERE"/probe/declared-type-roundtrip.mts

  # The ontology census: all ten relationship types through production parseFile, with
  # the grammar inventory, the parse-tree probes, the per-type resolution rates and the
  # constructibility block. Same corpus requirement as 10c.
  run "10d. ontology census (ten types, three verdicts, six questions)" npx tsx "$HERE"/probe/ontology-census.mts

  run "11. doc truth (every number in the analyzer doc and the review, re-derived from its artifact)" npx tsx "$HERE"/probe/doc-truth.mts

echo ""
echo "=============================================================="
if [ "$FAIL" -eq 0 ]; then echo "  GRAPHQL LANE: ALL GATES PASS"; else echo "  GRAPHQL LANE: FAILURES PRESENT"; fi
echo "=============================================================="
exit "$FAIL"
