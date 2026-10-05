#!/usr/bin/env bash
# Per-lane incoming diagnosis: WHY are targets ambiguous or unresolved?
#
# Answers, per lane, the three questions that decide what to fix:
#
#   A. AMBIGUOUS  — is the published symbol NAME a unique identifier?
#      If most ambiguous targets have no distinct qualifiedName, the name carries no file
#      identity and same-named declarations in different files collapse into one node.
#      Measured: sql 118/118 (100%), python 61/61, graphql 67/67, lua 266/300 (89%).
#
#   B. FORMAT MISMATCH — does the unresolved target's FINAL SEGMENT match a published name?
#      If yes, the emitter and the publisher disagree on the target string and the edge
#      would resolve if they agreed. graphql: 6,451 unresolved, 99% dotted, and 100% of
#      those have a published final segment. That is ~6,340 `contains` edges failing on a
#      naming convention rather than on anything semantic. Cheapest real win available.
#
#   C. EXTERNAL — the remainder: stdlib, BCL, database catalogs. Legitimately outside the
#      corpus, but emitted indistinguishably from a local reference, so they pollute the
#      unresolved count. `os:*`, `re:*`, `getcwd`, `join`, `sqlite_master`, `pg_trigger_depth`.
#
# Usage: bash script/m14/diagnose-incoming.sh <lang> <extension> [file-count]
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LANG_NAME="${1:?usage: diagnose-incoming.sh <lang> <ext> [files]}"
EXT="${2:?need a file extension}"
N="${3:-80}"
CR="${BB_CORPUS_ROOT:-$HOME/fixtures/repositories}"

echo "### diagnose-incoming — $LANG_NAME (.${EXT}, ${N} files)"
echo "# population: first ${N} of $(find "$CR" -name "*.$EXT" -type f | wc -l) .${EXT} files, sorted by path."
echo "# resampling changes the numbers; compare like for like."
echo

cd "$REPO"
node --experimental-strip-types "$REPO/script/m14/diagnose-incoming.mts" \
  "$LANG_NAME" "$EXT" "$N" "$CR" 2>&1 | grep -v '^\[INFO\]'