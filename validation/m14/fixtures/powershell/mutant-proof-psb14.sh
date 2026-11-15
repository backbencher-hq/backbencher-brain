#!/bin/bash
# PS29/PS30 SOURCE-revert proof.
#
# ## Why this script exists when a mutation gate now runs
#
# Pass 2 reported that `script/m60/powershell-mutants.ts` was referenced by nothing and
# that `BB_MUTANT_ONLY="powershell/"` printed `matched 0 of 1521` and exited 3. At HEAD
# that is FIXED — `script/m14/mutate-analyzer.ts:28` imports `POWERSHELL_MUTANTS` and
# :2429 spreads it into `MUTANTS`, and a scoped run reports 51 of 51 caught. The four
# mutants for PS29/PS30 were added to that file and run through the real harness.
#
# This script is the SECOND, independent line, and it is here because of what PS29 and
# PS30 do to the census:
#
#   · PS29 relabels 123 edges from `instantiates` to `uses`. The edges DO NOT MOVE.
#   · PS30 changes one metadata key on 106 `exports` rows. Nothing else moves.
#
# So `census.ts` prints the same relationship TOTAL before and after both fixes, and a
# resolution rate cannot tell them apart either — `instantiates -> typeName` and
# `uses -> typeName` resolve identically against the same file's symbol table, because
# `typeName` is declared in both cases. Reverting the SOURCE and requiring the fixture
# suite to fail is the instrument that can see them.
#
# ## The two vacuous-pass modes this script refuses
#
# Pass 2's first version had a wrong `cd`, so every python heredoc failed with
# FileNotFoundError, the untouched suite passed, and the script printed SURVIVED four
# times — then printed "RESTORE: byte-identical" on two EMPTY hashes, which compare
# equal. So: the `cd` is asserted, the revert is asserted by a REVERTED marker that must
# be present in the source, and the restore comparison refuses an empty hash on either
# side. A revert that does not land is reported as MEANINGLESS, never as SURVIVED.
set -uo pipefail
cd "$(dirname "$0")/../../../.." || exit 2
SRC=src/ast/real-powershell-analyzer.ts
BAK=$(mktemp)
cp "$SRC" "$BAK"
[ -f "$SRC" ] || { echo "FATAL: $SRC not found from $(pwd) — the script's own cd is wrong, and every RESULT below would be a vacuous SURVIVED"; exit 2; }
BEFORE=$(sha256sum "$SRC" | cut -d' ' -f1)
[ -n "$BEFORE" ] || { echo "FATAL: empty sha256"; exit 2; }
echo "source sha256 before: $BEFORE"

restore() { cp "$BAK" "$SRC"; }
trap 'restore' EXIT

run_fixtures() {
  timeout 900 npx tsx script/m14/run-fixtures.ts --lang powershell 2>&1
}

# The set of fixtures that FAIL right now, as `id` per line. A revert is judged by
# whether it ADDS a failure to this set — NOT by whether any failure exists.
#
# ## Why this is not the obvious implementation
#
# The first version tested `grep -q "^FAIL  powershell/"`, which asks "does anything
# fail". That is a vacuous CAUGHT the moment the control is already red: this lane's
# control went red for an unrelated reason (a fixture comment was edited, which shifted
# the line numbers its own expectation pinned, so `new-object-variable-psb14` failed
# before any revert was applied) and all five reverts reported CAUGHT against that same
# pre-existing failure. Five green results, none of them evidence.
#
# This is the same shape as the two vacuous modes pass 2 recorded — a wrong `cd` making
# every heredoc fail, and `byte-identical` printed on two EMPTY hashes — and it is the
# reason the control is captured and diffed rather than assumed green.
failing_fixtures() {
  run_fixtures | grep -E "^FAIL  powershell/" | awk '{print $2}' | sort
}

CONTROL_FAILURES="$(failing_fixtures)"
CONTROL_COUNT=$(printf '%s' "$CONTROL_FAILURES" | grep -c . || true)
echo "control failing fixtures (${CONTROL_COUNT}):"
if [ "$CONTROL_COUNT" -gt 0 ]; then printf '%s\n' "$CONTROL_FAILURES"; else echo "  (none)"; fi

# report <id> <desc> — the revert is already in the source.
report() {
  local id="$1" desc="$2"
  echo "=============================================================="
  echo "REVERT $id — $desc"
  echo "--------------------------------------------------------------"
  if ! grep -q "REVERTED" "$SRC"; then
    echo "RESULT $id: MEANINGLESS — the REVERTED marker is absent from $SRC, so the fixture result below says nothing"
    restore
    return
  fi
  local now count newfails
  now="$(failing_fixtures)"
  count=$(printf '%s' "$now" | grep -c . || true)
  newfails=$(comm -13 <(printf '%s\n' "$CONTROL_FAILURES" | grep . | sort) <(printf '%s\n' "$now" | grep . | sort))
  if [ -n "$newfails" ]; then
    echo "RESULT $id: CAUGHT — the revert adds $(printf '%s' "$newfails" | tr '\n' ' ')(failing now: ${count}, control: ${CONTROL_COUNT})"
  else
    echo "RESULT $id: SURVIVED — $id is NOT pinned by the fixture suite (failing now: ${count}, control: ${CONTROL_COUNT}, no NEW failure)"
  fi
  restore
}

echo "control (both fixes present):"
run_fixtures | grep -E "^summary:"

# ---- PS29a: the variable type name is re-published as `instantiates` ------
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
OLD='''              if (constructedFrom && nodeIsAVariableReference(constructedFrom)) {'''
NEW='''              if (false as boolean) { // PS29a REVERTED — every New-Object target is a type name again'''
if s.count(OLD)!=1:
    print("ANCHOR NOT UNIQUE: %d"%s.count(OLD)); sys.exit(4)
open(p,'w',encoding='utf8').write(s.replace(OLD,NEW))
PY
report PS29a "the New-Object variable form is published as \`instantiates\` again"

# ---- PS29b: `commandArgs` stops handing over the UNWRAPPED node ------------
# The shape work belongs to `commandArgs`: it is the reader that unwraps
# `array_literal_expression > unary_expression` and pushes the `variable` it finds, which
# is why `nodeIsAVariableReference` is a single node-type test. Reverting the handoff to
# hand over the WRAPPER instead puts an `array_literal_expression` in front of a
# `variable`, and the test then reads false. This revert is the one that earns the
# predicate its keep: reverting the PREDICATE instead leaves the suite green, because
# `commandArgs` has already done the unwrapping.
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
OLD='          if (v) { out.push(stripDollar(v.text)); sourceNodes?.push(v); continue }'
NEW='          if (v) { out.push(stripDollar(v.text)); sourceNodes?.push(c); continue } // PS29b REVERTED — hand over the wrapper'
if s.count(OLD)!=1:
    print("ANCHOR NOT UNIQUE: %d"%s.count(OLD)); sys.exit(4)
open(p,'w',encoding='utf8').write(s.replace(OLD,NEW))
PY
report PS29b "commandArgs hands over the wrapper instead of the variable node it unwrapped"

# ---- PS29c: the node handoff is removed altogether -------------------------
# The OTHER DIRECTION, and the one that keeps the fix from being a blanket suppression.
# With no node reported at all, `constructedFrom` is null for every `New-Object`, so the
# variable form is never recognised and every edge stays an `instantiates` — including the
# 41 the fix removed. Caught by the four `uses` rows and by `uses == 4` in psb14.
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
OLD='          if (v) { out.push(stripDollar(v.text)); sourceNodes?.push(v); continue }'
NEW='          if (v) { out.push(stripDollar(v.text)); continue } // PS29c REVERTED — no node reported'
if s.count(OLD)!=1:
    print("ANCHOR NOT UNIQUE: %d"%s.count(OLD)); sys.exit(4)
open(p,'w',encoding='utf8').write(s.replace(OLD,NEW))
PY
report PS29c "no node is reported at all, so no New-Object target is recognised as a variable"

# ---- PS30a: `via` goes back to the command name --------------------------
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
OLD='                  const via = `-${flag}`'
NEW='                  const via = leaf  // PS30a REVERTED — the command name, not the flag'
if s.count(OLD)!=1:
    print("ANCHOR NOT UNIQUE: %d"%s.count(OLD)); sys.exit(4)
open(p,'w',encoding='utf8').write(s.replace(OLD,NEW))
PY
report PS30a "the exports \`via\` is the command name again, so no row names its flag"

# ---- PS30b: `via` is dropped from the edge entirely -----------------------
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
OLD='powershellSpecific: true, viaExportModuleMember: true, via, fileLevel: atFileScope(),'
NEW='powershellSpecific: true, viaExportModuleMember: true, fileLevel: atFileScope(), // PS30b REVERTED — no via on the edge'
if s.count(OLD)!=1:
    print("ANCHOR NOT UNIQUE: %d"%s.count(OLD)); sys.exit(4)
open(p,'w',encoding='utf8').write(s.replace(OLD,NEW))
PY
report PS30b "the exports edge stops carrying metadata.via at all"

restore
AFTER=$(sha256sum "$SRC" | cut -d' ' -f1)
echo "=============================================================="
echo "source sha256 after : ${AFTER:-EMPTY}"
if [ -z "$AFTER" ]; then
  echo "RESTORE: MEANINGLESS — the after-hash is EMPTY, and an empty string compares equal to an empty string"
  exit 2
fi
if [ "$AFTER" = "$BEFORE" ]; then
  echo "RESTORE: byte-identical"
  exit 0
fi
echo "RESTORE: FAILED — $AFTER != $BEFORE"
exit 2