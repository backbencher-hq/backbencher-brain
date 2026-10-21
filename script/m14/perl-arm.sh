#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# perl LANE — THE ARM.  (lane-owned probe script: `script/m14/perl-arm.sh`)
#
# WHAT THIS RUNS AND WHY IT IS WRITTEN THIS WAY
#
# * THE CORPUS ROOT IS NAMED.  The corpus has TWO roots (the gate's default
#   `$HOME/fixtures/repositories`, 199 repos, and the campaign's own
#   symlink farm `$PWD/.corpus`, 202 repos).  24 of the 48 lanes admit a
#   DIFFERENT file set under each; perl admits 427 under the default and 656
#   under the farm.  Every recorded perl population in the fleet ledger is the
#   FARM (656).  So this script pins the farm and PRINTS it, and the log's own
#   header repeats it.
#
# * THE POPULATION IS THE WHOLE ADMITTED SET.  `0` is the gate's "no cap"
#   argument — 656/656, not a stride.  A stride is never a population.
#
# * `--dump` IS RAISED.  The gate's `--dump` truncates at BB_DUMP_LIMIT (40 by
#   default).  A truncated dump is a PREFIX, not a sample: the first rows are
#   the rows the gate reaches first, and the javascript lane measured the
#   resulting class-share bias at 3.7x.  So the limit is raised here, and the
#   dump's own BOUND marker is checked against the gate's TOTAL row after the
#   run (a truncated dump would print the marker and the run would be refused
#   as a population).
#
# * THE EXIT CODE IS CAPTURED BEFORE ANY OTHER COMMAND.  A reported result must
#   be the result, not a command substitution's side effect (fleet finding
#   3.33: `echo "$(date …) $lang exit=$?"` runs the substitution FIRST, `date`
#   resets `$?`, and every exit code reads 0).
#
# * NO `--index`.  perl is in NEITHER the gate's INDEX_SPECS nor production's
#   PROJECT_INDEX_EXTENSIONS, so an indexed perl arm would build ZERO repo
#   indexes and be a measured structural non-arm.  The no-index arm IS
#   production's population for perl.
#
# USAGE
#   bash script/m14/perl-arm.sh <outfile> [--index] [--repo=a,b]
# ─────────────────────────────────────────────────────────────────────────────
set -u

OUT="${1:-validation/m14/fixtures/perl/arm-whole.log}"
shift || true

export BB_CORPUS_ROOT="${BB_CORPUS_ROOT:-$PWD/.corpus}"
# THE DUMP BOUND IS RAISED (see above).  3,000,000 rows is far above perl's
# whole population of non-resolved edges.
export BB_DUMP_LIMIT="${BB_DUMP_LIMIT:-3000000}"

echo "=== perl ARM ==="
echo "root:   $BB_CORPUS_ROOT"
echo "out:    $OUT"
echo "dump:   BB_DUMP_LIMIT=$BB_DUMP_LIMIT"

# THE READ SET — the digests are over WHAT THE ARM READS, not over the tree.
# (Fleet rule 3.26: a digest over more than the arm read changes for the wrong
# reason.)  The corpus itself is digested separately, over the admitted files.
for f in \
  src/ast/real-perl-analyzer.ts \
  src/ast/project-index.ts \
  src/ast/engine.ts \
  src/ast/types.ts \
  script/m14/incoming-gate.ts \
  script/m14/incoming-rule.ts
do
  if [ -f "$f" ]; then
    printf 'read-set  sha1 %s  %s\n' "$(sha1sum "$f" | cut -c1-16)" "$f"
  else
    printf 'read-set  MISSING  %s\n' "$f"
  fi
done

bun run script/m14/incoming-gate.ts perl pl,pm,t,pod,perl 0 --dump "$@" > "$OUT" 2>&1
RC=$?                       # <-- CAPTURED FIRST, before anything else runs
echo "=== exit code: $RC ==="
echo "=== log: $OUT ==="
exit $RC
