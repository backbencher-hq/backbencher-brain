#!/usr/bin/env bash
# Does the COMMITTED tree still pass the perl lane's own gates?
#
# WHY THIS EXISTS
# ---------------
# Four times in one session, a co-agent commit built on a stale `git read-tree`
# silently reverted perl work, and nothing noticed:
#
#   57341a16  dropped `classifyEvidenceTier` from real-perl-analyzer.ts AND the
#              27 meta.evidenceClass pins from the seven expectation files. With
#              the pins gone, perl/evidence-tiers-collapsed SURVIVES.
#   39be5b62  dropped the forbidImports/forbidExports `note` exemption from
#              run-fixtures.ts, so two more perl mutants survive.
#   a42df7ed  deleted script/m14/tmp/perl-zero-regex.mts outright.
#
# Every time the WORKTREE was correct and only HEAD was wrong, so every gate run
# in place passed. A suite that reports 26/26 mutants on a dirty worktree and
# 20/23 on HEAD is not a suite, and the gap is invisible unless something runs
# the gates against a clean checkout of the commit. That is this script.
#
# It checks HEAD out into a throwaway git worktree, points it at the same
# node_modules, and runs the lane's gates THERE. A dirty, staged or half-applied
# worktree cannot make it pass.
#
# It reports only; it never writes an artifact. `perl-evidence.sh` is the
# generator. The differential is skipped here because it is the slow check and the
# two canonical lanes are already exercised by the artifact — the point of this
# gate is to catch a REVERT, which the fast checks detect just as well.
#
# usage: bash script/m14/tmp/perl-head-gate.sh
# exit:  0 if HEAD is healthy, 1 if any check fails
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH="<corpus-root>/.bun/bin:$PATH"

HEAD_SHA="$(git rev-parse --short HEAD)"
WT="${TMPDIR:-/tmp}/perl-head-gate-$$"
FAIL=0
declare -a ROWS=()

cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; }
trap cleanup EXIT

echo "perl HEAD gate — checking out $HEAD_SHA into a throwaway worktree"
cleanup
git worktree add --detach "$WT" HEAD >/dev/null 2>&1 || { echo "FATAL: could not create worktree"; exit 1; }
ln -s "$(pwd)/node_modules" "$WT/node_modules" 2>/dev/null || true

# check <id> <label> <shell-snippet>
# The snippet runs in $WT and must print GATE_OK on success. Anything else —
# including a non-zero exit — is a failure, and the tail of its output is shown.
# WHY EVERY SNIPPET THAT TESTS A COMMAND'S OUTPUT USES A HERE-STRING:
#
# This script runs under `set -o pipefail`, and a pipeline's status there is the
# RIGHTMOST NON-ZERO member. Several of the tools below exit non-zero BY DESIGN —
# `completeness-inventory` exits 1 because sections E and F are honestly red, and
# that is the correct outcome for it to report. So
#
#     bun <tool> 2>&1 | grep -c "what I want" && echo GATE_OK
#
# is ALWAYS false here: grep succeeds, bun exits 1, pipefail hands the `&&` a
# status of 1, and the check reports an empty result on a perfectly healthy tree.
# It cost this gate a false red, then a false green when `|| true` was added to
# swallow the status — after which the check could not tell "healthy" from "the
# command never ran".
#
# The fix is to take the producer's output as DATA rather than as a pipeline
# member: `grep -c "what I want" <<< "$(bun <tool> 2>&1)"`. grep is then the only
# command whose status matters, and the tool's own exit code — which is often the
# very thing being asserted — is correctly ignored.
#
# A bare `grep -q FILE` needs none of this and is used as-is: no producer, no
# pipeline, nothing for pipefail to poison.
check() {
  local id="$1" label="$2" snippet="$3"
  local out rc
  out="$(cd "$WT" && eval "$snippet" 2>&1)"; rc=$?
  if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q 'GATE_OK'; then
    ROWS+=("pass|$id|$label")
  else
    FAIL=1
    ROWS+=("FAIL|$id|$label (rc=$rc)")
    printf '%s\n' "$out" | tail -5 | sed "s/^/      | /"
  fi
}

check tsc "tsc --noEmit has no perl diagnostics" \
  'test "$(grep -c "real-perl" <<< "$(npx tsc --noEmit -p tsconfig.json 2>&1)")" -eq 0 && echo GATE_OK'

check truth "M12: 32/32 pinned facts, no line mismatches" \
  'grep -c "\"fail\": 0" <<< "$(bun script/m14/tmp/perl-truth.mts 2>/dev/null)" >/dev/null && echo GATE_OK'

# The expected counts are DERIVED from the repo, not written down here.
#
# The previous form was `grep -c "all 23 mutants caught"`, and it rotted: the
# lane grew to 26 mutants, the literal no longer matched, and this gate went red
# for a reason that had nothing to do with perl being broken -- the HEAD gate
# exists precisely to catch *real* divergence, so a check that fires on its own
# staleness trains you to ignore it. Worse, `grep -c` was being used as a
# presence test with the count piped to /dev/null, so a run that caught 3 of 26
# while still printing the summary line would have passed.
#
# Now: every expectation file in the lane's fixture dir must have a PASS and
# none may FAIL, and every perl mutant in the harness must be CAUGHT and none
# SURVIVED. Both are self-maintaining, and both fail on a partial run.
# Self-contained, and therefore measured in $WT: the snippet is the only place
# that can see HEAD's bytes. Deriving the expected counts in the parent shell
# would read MY worktree while the run itself read HEAD -- a gate that compares
# the commit against the thing it is supposed to be checking.
check fixtures "every perl fixture expectation passes" \
  'o=$(bun script/m14/run-fixtures.ts --lang perl 2>&1); n=$(ls validation/m14/fixtures/perl/*.expectation.json 2>/dev/null | wc -l); p=$(grep -c "^PASS  perl/" <<< "$o" || true); f=$(grep -c "^FAIL  perl/" <<< "$o" || true); echo "expectations=$n pass=$p fail=$f"; test "$n" -ge 1 && test "$p" -eq "$n" && test "$f" -eq 0 && echo GATE_OK'

check mutants "every perl mutant is caught" \
  'o=$(BB_MUTANT_ONLY=perl/ bun script/m14/mutate-analyzer.ts 2>&1); n=$(grep -c "id: \"perl/" script/m14/mutate-analyzer.ts || true); c=$(grep -c "^CAUGHT  perl/" <<< "$o" || true); s=$(grep -c "^SURVIVED  perl/" <<< "$o" || true); echo "mutants=$n caught=$c survived=$s"; test "$n" -ge 1 && test "$c" -eq "$n" && test "$s" -eq 0 && echo GATE_OK'

check zeroregex "zero regex, proven by the M12 AST scanner" \
  'grep -c "perl: 0 regex" <<< "$(bun script/m14/tmp/perl-zero-regex.mts 2>&1)" >/dev/null && echo GATE_OK'

# The four structural pins, each of which a past revert removed. They are grep
# checks on HEAD's own bytes, which is the point: this gate is what notices when
# a commit quietly un-does one of them.
check has-analyzer "the perl analyzer is present and non-trivial" \
  'test -s src/ast/real-perl-analyzer.ts && test "$(grep -c RealPerlAnalyzer src/ast/real-perl-analyzer.ts)" -ge 1 && echo GATE_OK'

# The ownership gate, run INSIDE the throwaway worktree, so it reads HEAD's
# content rather than the worktree's. That is the whole point of putting it here
# and not only in the docs: this script is the only thing in the repository that
# checks out HEAD, and the failure it exists to catch is content that is present
# in the worktree and absent from the commit. A revert that every in-place gate
# calls healthy is exactly what the other 19 checks here cannot see -- they run
# the lane, and the lane is fine. This row asks whether the lane is still THERE.
check perl-ownership \
  "every perl-owned invariant is present in HEAD's CONTENT, not just in its history" \
  'bash script/m14/tmp/perl-ownership-gate.sh --quiet >/dev/null 2>&1 && echo GATE_OK'

check spec-classified "every declared type is in exactly one bucket (57341a16 removed PERLD12-14)" \
  'grep -q PERLD12 script/m14/spec/perl-completeness.json && grep -q classification_note script/m14/spec/perl-completeness.json && echo GATE_OK'

# `completeness-inventory` exits 1 whenever ANY section fails, and sections E and
# F fail BY DESIGN for perl — they are written by the canonical 30-language sweep,
# which is the milestone owner's run. This check therefore tests the OUTPUT, not
# the exit code, so it asks the question it means to ask and does not inherit the
# status of the two sections that are honestly red.
# Asked as "section A did NOT fail", not as "a pass line was printed". The two
# are not the same test: the script only prints its per-section list when a lane
# HAS a failure, so grepping for `pass  section-a-structural` is guaranteed to
# match exactly when the lane is broken. That inverted check reported a healthy
# HEAD as unhealthy — the same class of error as the `pipefail` and `grep -q`
# bugs above it, and the third time this gate's own plumbing, rather than perl,
# has been the thing that was wrong.
check completeness "completeness section A passes on HEAD" \
  'out="$(bun script/m14/completeness-inventory.ts --lang perl 2>&1)"; \
   case "$out" in *"FAIL  section-a-structural"*|*"in NO bucket"*) exit 1;; esac; echo GATE_OK'

# The claim that was FALSE in the docs for a whole wave. The pin being green
# says the grammar is pinned; only this audit says the analyzer has no dead
# branches, and only this audit was being asked.
check grammar-audit "F1 grammar cell: 0 unknown types, 0 unknown fields" \
  'grep -cE "^perl +PASS +refs= *[0-9]+ unknown=0 unknownFields=0" <<< "$(bun script/m14/audit-analyzer-grammar.ts 2>&1)" >/dev/null && echo GATE_OK'

check has-evidence "the machine-evidence artifact is committed" \
  'test -s validation/m14/results/M14.6.perl.json && grep -q "\"language\": \"perl\"" validation/m14/results/M14.6.perl.json && echo GATE_OK'

check has-review "the master review is committed" \
  'test -s reviews/perl/master-review.md && grep -q "PERL-MR1" reviews/perl/master-review.md && echo GATE_OK'

check has-tiers "evidence tiers are classified (57341a16 removed this)" \
  'grep -q classifyEvidenceTier src/ast/real-perl-analyzer.ts && echo GATE_OK'

check has-tierpins "the fixtures PIN the tiers (57341a16 removed these too)" \
  'test "$(grep -h -c meta.evidenceClass validation/m14/fixtures/perl/*.expectation.json | paste -sd+ | bc)" -ge 25 && echo GATE_OK'

check has-forbidfix "forbidImports/forbidExports exempt note (39be5b62 removed this)" \
  'grep -qF "if (k === \"comment\" || k === \"note\") return true" script/m14/run-fixtures.ts && echo GATE_OK'

check has-extkeyword "bare-extends keyword reaches addBase" \
  'grep -q "REASON.mooExtendsKeyword, arg" src/ast/real-perl-analyzer.ts && echo GATE_OK'

check has-allowlist "the class-naming receiver allowlist exists" \
  'grep -q "private namesAClass" src/ast/real-perl-analyzer.ts && echo GATE_OK'

check has-oracle-allowlist "the oracle carries the same allowlist" \
  'grep -q "const namesAClass" script/m14/differential.ts && echo GATE_OK'

check has-oracle-insub "the oracle derives bare-new inside a sub" \
  'grep -q "indirectClassOf(n)" script/m14/differential.ts && echo GATE_OK'

check has-regex-instrument "the zero-regex instrument is committed (a42df7ed deleted it)" \
  'test -s script/m14/tmp/perl-zero-regex.mts && echo GATE_OK'

check has-commit-guard "the commit guard is committed" \
  'test -s script/m14/tmp/perl-commit-owned.sh && echo GATE_OK'

echo
echo "perl HEAD gate @ $HEAD_SHA"
for r in "${ROWS[@]}"; do
  IFS='|' read -r status id label <<<"$r"
  printf "  %-4s %-20s %s\n" "$status" "$id" "$label"
done
echo
if [ "$FAIL" -ne 0 ]; then
  echo "HEAD IS NOT HEALTHY. A correct-looking worktree is not evidence: a stale-base"
  echo "read-tree reverts files silently, and that has happened four times here."
  exit 1
fi
echo "HEAD passes every perl gate: $(printf '%s' "${ROWS[@]}" | grep -o 'pass|' | wc -l) checks."
echo "A dirty worktree cannot have hidden a revert."
