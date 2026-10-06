#!/usr/bin/env bash
# FAILS if any analyzer uses a regular expression. Regex over source text matches
# comments and string literals, misses nested syntax, and breaks silently on the
# next grammar version. Everything must go through the tree-sitter AST.
#
# Usage: no-regex-gate.sh [subdir-of-src/ast]
#
# ── THIS FILE USED TO BE A TEXT SCAN, AND IT WAS WRONG ──────────────────────────
#
# The previous implementation was `grep -nE` over the analyzer sources, with a
# comment filter that only dropped lines STARTING with //, *, or /*. Its own header
# above explains why that is the wrong approach; it then did it anyway, and reported
#
#     FAIL — 187 regex uses
#
# against an AST census of the same tree, which reports 5. The gap is almost entirely
# false positives of two kinds the filter cannot see:
#
#   1. REGEXES IN THE MIDDLE OF BLOCK COMMENTS. A `//` or `*` on the first line of a
#      comment does not make the fifth line of that comment code. The zig and yaml
#      hits were comment lines carrying file paths.
#   2. REGEX-LOOKING METHOD CALLS ON STRING LITERALS. The gate's pattern includes
#      `.split(`, so `content.split("\n")` counts as a "regex use". That was the ONLY
#      hit on real-zig-analyzer.ts:
#          1133:  linesOfCode: content.split("\n").length,
#      There is no regex on that line. There is a newline escape in a string.
#
# A gate that reports 187 where the truth is 5 does not protect anything: it trains
# its readers to ignore it, and the one real regex it eventually misses is lost in the
# noise. So this gate no longer scans. It DELEGATES to the tree-sitter census, which
# is the authoritative instrument, and reports that instrument's own verdict.
#
# One arbiter per question. A second, weaker implementation of the same check is not a
# safety net, it is a second opinion nobody asked for.
set -uo pipefail
cd "$(dirname "$0")/../.."

CENSUS=validation/m12/results/regex-census.json
GATE=script/m12/verify-regex-census.ts
[ "${1:-}" != "" ] && DIR="$1" || DIR="src/ast"

if [ ! -f "$CENSUS" ]; then
  echo "no-regex-gate: $CENSUS is missing — run: npx tsx script/m12/regex-census.ts --head"
  exit 2
fi

echo "no-regex-gate: delegating to the tree-sitter census (AST), not a text scan."
echo "census describes: $(python3 -c "import json;print(json.load(open('$CENSUS'))['describes'])")"
echo "scanned: $(python3 -c "import json;print(json.load(open('$CENSUS'))['analyzersScanned'])") analyzers"
echo "--------------------------------------------------------------------------"

# The census records every regex usage across ALL analyzers, including ones owned by
# other laptops. This gate cannot tell the supervisor which lane owns which file, and
# guessing would be worse than reporting, so it reports all of them.
#
# SCOPE, stated because a count without its population is a finding about the wrong
# thing. An earlier draft of THIS file took a subdirectory argument and then ignored
# it, printing whole-tree numbers that read as though they were scoped — the exact
# defect docs/M14-HONESTY-CONTRACT.md was written about, committed in the same session.
# So the scope is now applied, and the population behind it is printed either way.
python3 - "$CENSUS" "$DIR" <<'PY'
import json, sys, os
d = json.load(open(sys.argv[1]))
scope = sys.argv[2]
total_files = d["analyzersScanned"]
# The in-scope POPULATION must be derived from the filesystem, not from the census.
#
# `perFile` only lists files that HAVE a regex — 2 of them — so counting it against
# `analyzersScanned` (48) reports "2 of 48 in scope" for a directory that contains all
# 48. That is the population defect again, one level down: mixing two populations that
# happen to both be integers. The scope's real membership is "files matching
# real-*-analyzer.ts under DIR", so glob for exactly that.
import glob
scanned = [os.path.basename(p) for p in glob.glob(os.path.join(scope, "real-*-analyzer.ts"))]
scanned_set = set(scanned)
if not scanned_set:
    print(f"scope: {scope} — 0 analyzers matched real-*-analyzer.ts")
    print("  That is an empty population, NOT a pass. Check the path.")
    sys.exit(2)
rows = [(f["file"], u) for f in d["perFile"] for u in f["usages"] if f["file"] in scanned_set]
scoped_scanned = scanned
rows.sort(key=lambda t: (t[0], t[1]["line"]))
print(f"scope: {scope} — {len(scoped_scanned)} of {total_files} scanned analyzers in scope")
if len(scoped_scanned) < total_files:
    print(f"  NOTE: {total_files - len(scoped_scanned)} analyzer(s) OUTSIDE this scope are not counted here;")
    print(f"        run with no argument for the whole tree.")
for fn, u in rows:
    print(f"  {fn}:{u['line']}  {u['source'][:44]:46} {u.get('operation','')}")
print(f"  TOTAL {len(rows)} in scope  (whole tree: {d['totalRegexUsages']})")
sys.exit(1 if rows else 0)
PY
rc=$?

if [ $rc -eq 0 ]; then
  echo "PASS — 0 regex literals, by AST census"
else
  echo "FAIL — regex literals present. Replace with tree-sitter AST walks."
  echo "       (node.type, named children, cursor) — never text matching."
fi

# The census must also AGREE with HEAD, or "0 regexes" may just mean "the artifact is
# stale". verify-regex-census.ts is what checks that, so run it too: a passing count
# from a stale census is the same false assurance this file used to give.
echo "--------------------------------------------------------------------------"
npx tsx "$GATE" 2>&1 | tail -3
exit $rc
