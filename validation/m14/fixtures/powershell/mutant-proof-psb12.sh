#!/bin/bash
# PS25/PS26/PS27 SOURCE-revert proof.
#
# `script/m60/powershell-mutants.ts` is referenced by nothing (the lane's own
# finding 2, 177 mutants across 7 lanes), and `script/m14/mutate-analyzer.ts`
# imports only `./fsharp-mutants`, so `BB_MUTANT_ONLY="powershell/" bun run
# script/m14/mutate-analyzer.ts` prints `matched 0 of 1483 mutants` and exits 3.
# That makes the shared mutation gate unable to say anything about this lane.
#
# So these three are proven the other way: the SOURCE is reverted to its pre-fix
# form, one hunk at a time, and the lane's own fixture suite must FAIL. A revert
# that leaves the suite passing is a fixture that does not pin the fix, and it is
# reported as such rather than as a pass.
#
# The source is restored byte-identically at the end and the restore is VERIFIED
# with a sha256 comparison, because a proof script that leaves the tree modified
# is worse than no proof script.
set -uo pipefail
cd "$(dirname "$0")/../../../.." || exit 2
SRC=src/ast/real-powershell-analyzer.ts
BAK=$(mktemp)
cp "$SRC" "$BAK"
[ -f "$SRC" ] || { echo "FATAL: $SRC not found from $(pwd) — the script's own cd is wrong, and every RESULT below would be a vacuous SURVIVED"; exit 2; }
BEFORE=$(sha256sum "$SRC" | cut -d' ' -f1)
[ -n "$BEFORE" ] || { echo "FATAL: empty sha256"; exit 2; }

restore() { cp "$BAK" "$SRC"; }
trap 'restore' EXIT

run_fixtures() {
  timeout 900 bun run script/m14/run-fixtures.ts --lang powershell 2>&1 \
    | grep -E "^(PASS|FAIL) +powershell/overrides-.*psb1[23]|^summary:"
}

check() {
  local id="$1" desc="$2"
  echo "=============================================================="
  echo "REVERT $id — $desc"
  echo "--------------------------------------------------------------"
  # The revert must actually LAND, or the RESULT below is a vacuous SURVIVED: an
  # earlier version of this script had a wrong `cd`, every python heredoc failed
  # with FileNotFoundError, the fixture suite passed untouched, and the script
  # printed SURVIVED four times and then "RESTORE: byte-identical" on two EMPTY
  # hashes — which compared equal. So the revert is asserted, and the hash compare
  # refuses empty strings.
  if ! grep -q "REVERTED" "$SRC"; then
    echo "RESULT $id: REVERT DID NOT LAND — the marker is absent from $SRC, so this result means nothing"
    restore
    return
  fi
  run_fixtures | grep -E "overrides-|summary"
  if run_fixtures | grep -q "^FAIL  powershell/overrides-"; then
    echo "RESULT $id: CAUGHT — the fixture suite fails with $id reverted"
  else
    echo "RESULT $id: SURVIVED — $id is NOT pinned by the fixture suite"
  fi
  restore
}

echo "control (all three fixes present):"
run_fixtures | grep -E "overrides-"

# ---- PS25: the export wildcard guard -------------------------------------
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
s=s.replace('if (!name || isExportWildcard(name)) return',
            'if (!name || name.startsWith("*")) return  // PS25 REVERTED')
open(p,'w',encoding='utf8').write(s)
PY
check PS25 "addExport's wildcard guard back to the positional startsWith(\"*\")"

# ---- PS26: the overrides modifier/kind precision ------------------------
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
s=s.replace('''const memberOverrides = (derived: MemberFact, base: MemberFact): boolean => {
  if (base.isHidden) return false
  if (base.isStatic) return false
  return derived.kind === base.kind
}''','''const memberOverrides = (_derived: MemberFact, _base: MemberFact): boolean => {
  return true // PS26 REVERTED — the name match alone
}''')
open(p,'w',encoding='utf8').write(s)
PY
check PS26 "memberOverrides back to a bare name match"

# ---- PS27: the lexer-split name recovery --------------------------------
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
s=s.replace('''    if (isNamePrefix) prefix = named[i].text''','''    if (false && isNamePrefix) prefix = named[i].text  // PS27 REVERTED (name half)''')
open(p,'w',encoding='utf8').write(s)
PY
check PS27a "memberHeaderFacts stops rejoining the split name"

python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
s=s.replace('''    else modifiers.push(named[i].text.toLowerCase())''','''    else if (false) modifiers.push(named[i].text.toLowerCase())  // PS27 REVERTED (modifier half)''')
open(p,'w',encoding='utf8').write(s)
PY
check PS27b "memberHeaderFacts stops counting a post-type class_attribute as a modifier"

# ---- PS28a: classMembers resets on redeclaration --------------------------
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
s=s.replace('          if (!classMembers.has(className)) classMembers.set(className, new Set())',
            '          classMembers.set(className, new Set())  // PS28a REVERTED')
open(p,'w',encoding='utf8').write(s)
PY
check PS28a "classMembers.set on every class_statement, so a redeclaration drops the earlier members"

# ---- PS28b: the overrides name match is case-sensitive -------------------
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf8').read()
s=s.replace('? [...inherited].find((m) => m.name.toLowerCase() === wanted)',
            '? [...inherited].find((m) => m.name === cand.memberName)  // PS28b REVERTED')
open(p,'w',encoding='utf8').write(s)
PY
check PS28b "the overrides name match back to case-sensitive"

restore
AFTER=$(sha256sum "$SRC" | cut -d' ' -f1)
echo "=============================================================="
echo "source sha256 before: $BEFORE"
echo "source sha256 after : $AFTER"
if [ -z "$AFTER" ]; then
  echo "RESTORE: MISMATCH — empty hash, which would compare equal to an empty BEFORE"
  exit 1
fi
if [ "$BEFORE" = "$AFTER" ]; then
  echo "RESTORE: byte-identical ($AFTER)"
else
  echo "RESTORE: MISMATCH — the tree was left modified"
  exit 1
fi
rm -f "$BAK"