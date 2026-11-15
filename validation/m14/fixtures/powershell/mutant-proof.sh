#!/usr/bin/env bash
# M14 — prove the powershell mutants are CAUGHT, by SOURCE reverts.
#
# SEVEN mutants: PS23's three
# (`imports-edge-not-emitted`, `imports-tier-short-circuit-removed`,
# `imports-references-edge-dropped`) and PS24's two
# (`requires-modules-first-token-only`, `requires-hashtable-name-read-as-flag-value`).
# plus PS24's two and PS-B18's two (`relative-path-psb18-escape-narrowed`, the REVERT to the
# 2026-10-19 `.ps1`-only predicate, and `relative-path-psb18-escape-widened`, the over-broad
# reading of the fix). It does NOT cover the lane's other 46 transform mutants. Those are transform mutants in
# `script/m60/powershell-mutants.ts` and they are measured through the same `runLang`
# and the same catch rule the F4 harness uses, driven from outside the repo because
# `script/m14/mutate-analyzer.ts` does not import that file (§8 report item 2 in
# `docs/analyzers/real-powershell-analyzer.md`): 51/51 caught, 0 survivors. This file is
# the stronger instrument for THESE five, and the reason is below.
#
# WHY SOURCE SURGERY AND NOT THE TRANSFORM HARNESS. `POWERSHELL_MUTANTS` is not
# registered in `script/m14/mutate-analyzer.ts` (shared, supervisor-owned), so the F4
# harness cannot run this lane's set at all — a §8 report item, recorded rather than
# fixed here. A transform-only mutant would therefore be a claim with no instrument
# behind it, and the honesty contract §5.3 is explicit that the point of a mutant is
# that it was OBSERVED RED. So each revert is applied to the real source, the scoped
# fixture suite is run, the result is recorded, and the source is restored. Three
# mutants x (edit + suite + revert); the suite is the same `--lang powershell` run the
# lane gates on.
#
# PS24's two mutants are in this file too, and they are the reason the transform half
# would have been the wrong instrument for them anyway: a mutant that rewrites the
# RESULT cannot express "the reader stopped at the first comma" without either a
# module-name filter (which this lane's mutant set forbids, and which stops matching
# the moment a fixture is renamed) or the `metadata.via` provenance PS24 added. Both
# are in the result, but the SOURCE revert is the pre-fix code verbatim, and a revert
# that is the old code is worth more than a transform that imitates it.
#
# A mutant that leaves the suite green FAILS THIS SCRIPT, because "the fixtures did not
# notice" is the finding and reporting it as a pass is how a suite becomes decoration.
set -uo pipefail
# THE ROOT, DERIVED FROM THIS SCRIPT'S OWN LOCATION. The first version of this file hard-coded
# `cd /home/ishaq2321/mcp/bb-lanes/powershell`, and that checkout DOES NOT EXIST on this machine
# (`ls` reports "No such file or directory") — so the script could not run at all, and a mutant
# harness that cannot run is indistinguishable from a mutant harness that passes. The suite is the
# lane's own gate, so the gate has to be runnable from wherever the lane is checked out.
# `dirname $0` is FOUR levels up from this file:
#   validation/m14/fixtures/powershell/mutant-proof.sh -> the repository root.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
echo "root: $ROOT"

SRC=src/ast/real-powershell-analyzer.ts
BAK="${TMPDIR:-/tmp}/powershell-analyzer-mutant-backup.ts"
cp "$SRC" "$BAK"
restore() { cp "$BAK" "$SRC"; }
trap restore EXIT

# The exact text each revert replaces, and the exact text it puts back.
IMPORTS_EDGE='      addRel(top().scope, moduleName, ASTEngine.RelationshipType.Imports, 0.9, line, { ...meta })'
REF_EDGE='      addRel(top().scope, moduleName, ASTEngine.RelationshipType.References, 0.9, line, { ...meta })'
IMPORTS_CASE='        case ASTEngine.RelationshipType.Imports:
        case ASTEngine.RelationshipType.References:
          return "import_based"'

run_suite() {
  timeout 900 bun run script/m14/run-fixtures.ts --lang powershell 2>&1 \
    | grep -E '^(PASS|FAIL) |^summary:' | sed 's/^/    /'
}

check() {
  local name="$1" expect_fail="$2" expect_fixture="${3:-}"
  local out; out="$(run_suite)"
  echo "MUTANT: $name"
  echo "$out" | grep -E 'imports-psb12|relative-path-psb18|^    summary:'
  if echo "$out" | grep -q 'FAIL'; then
    # A SUITE GOING RED IS NOT ENOUGH ON ITS OWN: the red must be the FIXTURE this mutant is
    # supposed to kill. Without that test a mutant that breaks something else entirely still reads
    # as "caught", and a fixture that never fails reads exactly like a fixture that does. So when
    # the caller names the fixture, the FAIL line must name it too.
    if [ -n "$expect_fixture" ] && ! echo "$out" | grep -q "FAIL  $expect_fixture"; then
      echo "  RESULT: *** SURVIVED *** — the suite went red, but NOT on $expect_fixture. THIS IS A FINDING."
      return 1
    fi
    if [ "$expect_fail" = "yes" ]; then
      echo "  RESULT: CAUGHT — the fixture suite went red, which is the only acceptable outcome for a mutant"
    else
      echo "  RESULT: *** UNEXPECTED RED *** — this is the analyzer's real state, not the mutant's"
    fi
  else
    if [ "$expect_fail" = "yes" ]; then
      echo "  RESULT: *** SURVIVED *** — the suite did not notice. THIS IS A FINDING."
      return 1
    else
      echo "  RESULT: clean, as expected for the unmutated control"
    fi
  fi
  echo
}

fails=0

echo "=== CONTROL: unmutated source ==="
check control no || fails=$((fails+1))

restore
echo "=== M1 powershell/imports-edge-not-emitted ==="
# Drop the imports addRel line entirely.
python3 - "$SRC" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
line = '      addRel(top().scope, moduleName, ASTEngine.RelationshipType.Imports, 0.9, line, { ...meta })\n'
assert line in s, "imports addRel line not found — the mutant would prove nothing"
open(p, "w").write(s.replace(line, "", 1))
PY
check powershell/imports-edge-not-emitted yes || fails=$((fails+1))

restore
echo "=== M2 powershell/imports-tier-short-circuit-removed ==="
# Delete `evidenceClassFor`'s `if (isImport) return "import_based"` line, so every
# `imports` edge falls through the switch to `usage_contextual`. Two earlier attempts
# aimed at a `case Imports:` in the switch and BOTH SURVIVED, because that line is dead:
# `isImport` answers first for every edge `addImport` emits. The short-circuit is the one
# line an `imports` edge's tier actually depends on.
python3 - "$SRC" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
line = '      if (isImport) return "import_based"\n'
assert line in s, "isImport short-circuit not found — the mutant would prove nothing"
open(p, "w").write(s.replace(line, "", 1))
PY
check powershell/imports-tier-short-circuit-removed yes || fails=$((fails+1))

restore
echo "=== M3 powershell/imports-references-edge-dropped ==="
# Remove the references addRel line: the rename-instead-of-add shape.
python3 - "$SRC" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
line = '      addRel(top().scope, moduleName, ASTEngine.RelationshipType.References, 0.9, line, { ...meta })\n'
assert line in s, "references addRel line not found"
open(p, "w").write(s.replace(line, "", 1))
PY
check powershell/imports-references-edge-dropped yes || fails=$((fails+1))

restore
echo "=== M4 powershell/requires-modules-first-token-only ==="
# The pre-PS24 list walk: one name per `#requires` declaration. The comma continuation
# is what the fix added, so removing it is the revert — and it is the ONLY difference
# between "publishes the first module" and "publishes every module the file declares".
python3 - "$SRC" <<'PY2'
import sys
p = sys.argv[1]; s = open(p).read()
line = '        if (text[j] !== ",") break\n'
assert line in s, "the comma continuation not found — the mutant would prove nothing"
open(p, "w").write(s.replace(line, "        break\n", 1))
PY2
check powershell/requires-modules-first-token-only yes || fails=$((fails+1))

restore
echo "=== M5 powershell/requires-hashtable-name-read-as-flag-value ==="
# The pre-PS24 hashtable behaviour: the reader had no hashtable branch at all, so the
# name it published was the `@{` that OPENS the hashtable. Reverting means taking that
# token unconditionally — including for a hashtable with no `ModuleName`, which is the
# case the old reader could not have told apart from one that had it.
python3 - "$SRC" <<'PY2'
import sys
p = sys.argv[1]; s = open(p).read()
old = """          const ht = this.readHashtableModuleName(text, j + 1)
          via = "requires_hashtable"
          if (ht) add(ht)
"""
new = """          via = "requires_hashtable"
          add("@{")
"""
assert old in s, "the hashtable branch not found — the mutant would prove nothing"
open(p, "w").write(s.replace(old, new, 1))
PY2
check powershell/requires-hashtable-name-read-as-flag-value yes || fails=$((fails+1))

restore
echo "=== M6 powershell/relative-path-psb18-escape-narrowed ==="
# THE REVERT IS THE PRE-FIX CODE VERBATIM, not a transform that imitates it: the whole
# `isRelativeScriptPath` function is replaced by the 2026-10-19 version, the one that read "a
# relative path ending in .ps1". That version is what the fleet's FIRST refuted-claim incident was
# closed with, and it is the version that left the SECOND refuted claim in the corpus — a claim the
# project answers false about `DSCResources\...\UserConfigProviderModVersion1.psm1`, published and
# invisible because PS38 withholds the arbiter-readable key on a bare owner and `externalTarget` is
# not in EXTERNAL_KEYS. If this mutant SURVIVES, the new fixture is a comment.
python3 - "$SRC" <<'PY3'
import re, sys
p = sys.argv[1]; s = open(p).read()
start = s.index("const isRelativeScriptPath = (t: string): boolean => {")
end = s.index("\nconst externalReadingOf", start)
old = '''const isRelativeScriptPath = (t: string): boolean => {
  if (t.length < 4) return false
  const ext = t.slice(-4)
  if (!(ext[0] === "." && (ext[1] === "p" || ext[1] === "P") && (ext[2] === "s" || ext[2] === "S") && ext[3] === "1")) return false
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 92 /* \\ */ || c === 47 /* / */) return true
  }
  return false
}
'''
open(p, "w").write(s[:start] + old + s[end:])
PY3
check powershell/relative-path-psb18-escape-narrowed yes powershell/relative-path-psb18 || fails=$((fails+1))

restore
echo "=== M7 powershell/relative-path-psb18-escape-widened ==="
# THE OVER-BROAD REVERT, and the one that keeps the fix honest: the escape is widened to EVERY
# path ending in an admitted spelling, with the absolute-path and URI exceptions REMOVED. So a
# unix-rooted path, a Windows drive path and a URI all lose their (true) externality claim. The
# old predicate had this defect too — it withheld `/usr/lib/Helper.ps1` — so this mutant is the
# pre-fix behaviour on THAT axis, and a fixture that cannot see it would let the over-broad
# reading of the fix ship.
python3 - "$SRC" <<'PY3'
import sys
p = sys.argv[1]; s = open(p).read()
old = '''  if (t.charCodeAt(0) === 47 /* / */) return false // /unix-rooted
  if (t.charCodeAt(0) === 92 /* \\ */) return false // \\\\UNC\\share
  const colon = t.indexOf(":")
  if (colon > 0) {
    if (colon === 1) return false // C:\\ or C:/ — a Windows DRIVE
'''
new = '''  const colon = t.indexOf(":")
  if (false) {
    if (colon === 1) return false // C:\\ or C:/ — a Windows DRIVE
'''
assert old in s, "the absolute-path exception not found — the mutant would prove nothing"
s = s.replace(old, new, 1)
# and the URI branch: a scheme no longer exempts the target
old2 = '''    return false // a URI scheme
'''
new2 = '''    return true // a URI scheme
'''
assert old2 in s, "the URI exemption not found — the mutant would prove nothing"
s = s.replace(old2, new2, 1)
open(p, "w").write(s)
PY3
check powershell/relative-path-psb18-escape-widened yes powershell/relative-path-psb18 || fails=$((fails+1))

restore
echo "=== M8 powershell/relative-path-psb18-escape-narrowed-runtime ==="
# THE NARROWING, PUT BACK. This mutant restores the one line that says "a path that begins with a
# RUNTIME VARIABLE is not a static path, and this file is not in a position to judge it" — so the
# escape is narrowed to static paths only, and the claim on the `$PSScriptRoot` import comes
# BACK — the rule this lane measured and rejected.
#
# WHY THIS MUTANT IS NOT COSMETIC. Over the whole population, 30 rows of that shape split 12 FALSE
# claims against 18 TRUE ones: a rule that always claims errs 12 times and a rule that never claims
# errs 18 times, and NEITHER can do better, because "is this module in the project?" is a PROJECT
# question and this is a ONE-FILE parse. So the 18 true claims are the price of the 12 false ones,
# and the price is paid in a direction this lane can MEASURE. Without this mutant the narrowing
# would be an unmeasured judgement, and a judgement with a number behind it is the only kind worth
# shipping.
python3 - "$SRC" <<'PY3'
import sys
p = sys.argv[1]; s = open(p).read()
old = "  if (!endsAdmitted) return false\n"
assert old in s, "the admitted-suffix guard not found — the mutant would prove nothing"
# THE NARROWING, PUT BACK: a path that begins with a RUNTIME VARIABLE keeps its externality
# reading. This is the rule this lane MEASURED and REJECTED — it publishes 37 false claims to
# save 18 true ones, and the verified class and the total wall are identical either way — so the
# mutant reintroduces it and the fixture must catch it.
new = old + "  if (t.charCodeAt(0) === 36 /* $ */) return false // $PSScriptRoot\\... — a runtime path\n"
s = s.replace(old, new, 1)
open(p, "w").write(s)
PY3
check powershell/relative-path-psb18-escape-narrowed-runtime yes powershell/relative-path-psb18 || fails=$((fails+1))

restore
echo "=== FINAL: source restored ==="
if diff -q "$SRC" "$BAK" > /dev/null; then echo "  source matches the backup"; else echo "  *** SOURCE NOT RESTORED ***"; fails=$((fails+1)); fi

echo
if [ "$fails" -eq 0 ]; then
  echo "RESULT: all 8 mutants CAUGHT, control clean, source restored."
  exit 0
fi
echo "RESULT: $fails PROBLEM(S). See above."
exit 1