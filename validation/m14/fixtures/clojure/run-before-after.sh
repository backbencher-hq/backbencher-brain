#!/usr/bin/env bash
# CLOJURE LANE — THE BEFORE/AFTER PAIR THE LEAD REPRODUCES, run by the LANE'S OWN whole-population
# instrument, so the movement is reproducible WITHOUT the fleet's arm token and the Lead's token-held
# arm can be checked against it.
#
# WHAT IT DOES, in order:
#   1. the analyzer's digest as the working tree has it (BOTH lane changes in);
#   2. a COPY of that file — the restore source, never git, because a restore that reads from git
#      can lose the thing under test;
#   3. the analyzer at HEAD (BOTH changes reverted) — the BEFORE;
#   4. the BEFORE run: the lane's instrument, which imports the arbiter's own `classifyEdge` and
#      reproduces the gate's TABLE 1 line AND its ten per-label rows, asserted, exit 4 on a
#      mismatch — plus a dump in the GATE'S OWN six-column format;
#   5. the analyzer restored from the COPY — the AFTER;
#   6. the AFTER run, the same way;
#   7. the row-level reconciliation of the two dumps, on the gate's own identity PLUS an occurrence
#      counter (a plain Map under-counts: two rows can share one identity);
#   8. the digest check — the working tree is byte-identical to where it started.
#
# THE INSTRUMENT IS THE LANE'S, NOT THE GATE'S, and that is deliberate: the gate's arm is the
# authority and it takes the fleet's token; this pair is reproducible on demand and is what the
# Lead's arm is checked against.
#
# Usage: bash validation/m14/fixtures/clojure/run-before-after.sh
set -uo pipefail
cd "$(dirname "$0")/../../../.."
ROOT="$PWD"
LOG="validation/m14/fixtures/clojure/lane-logs"
mkdir -p "$LOG"
export BB_CORPUS_ROOT="$ROOT/.corpus"
KEEP="$LOG/.analyzer-after-copy.ts"

# THE BEFORE REVISION IS ANCHORED TO A COMMIT, NOT TO "HEAD".
#
# The first version of this script took the BEFORE analyzer from `HEAD`, and it was CORRECT only
# while the lane's change was uncommitted — the moment the change was committed, `HEAD` BECAME the
# changed analyzer and the "BEFORE" arm silently measured the AFTER. **A baseline that is an
# ambient pointer is not a baseline.** It is a named revision here, and the revision is printed on
# every run so a reader can see WHICH analyzer produced the BEFORE.
BEFORE_REV="${CLOJURE_BEFORE_REV:-e2510abaf^}"
WORKING_DIGEST=$(git hash-object src/ast/real-clojure-analyzer.ts)
BEFORE_DIGEST=$(git rev-parse "$BEFORE_REV:src/ast/real-clojure-analyzer.ts")
echo "analyzer digest  WORKING TREE (both lane changes in): $WORKING_DIGEST"
echo "analyzer digest  BEFORE ($BEFORE_REV, the pre-change analyzer): $BEFORE_DIGEST"
cp src/ast/real-clojure-analyzer.ts "$KEEP"
echo "analyzer digest  WORKING TREE (both lane changes in): $WORKING_DIGEST"

# THE GATE'S OWN TABLE 1 ROWS, for the BEFORE arm — the recorded Part B arm, column for column.
# THE TIE-BREAK IS IN BOTH TABLES, AND THAT IS THE POINT.
#
# `incoming-rule.ts`'s own-file tie-break resolves an ambiguous row when the edge's OWN FILE declares
# the target and the target is a plain identifier. It is a RULE-level fact about the POPULATION, not
# a property of the analyzer — so it moves the BEFORE arm exactly as it moves the AFTER arm. The lane's
# FIRST pair predated the tie-break and read 26,791 resolved / 4,259 ambiguous on BOTH sides; with the
# tie-break, BOTH sides read 28,911 / 2,139. **THE ANALYZER CHANGE'S MOVEMENT IS IDENTICAL EITHER
# WAY** (unresolved -1,510, extOK +658, ext? +852, resolved 0, amb 0), and the tie-break's 2,120 is the
# same number in both arms.
#
# AND THE TOTALS BELOW ARE THE LEAD'S OWN ARM'S TOTALS (28,911 / 2,139 / 4,245 / ext? 852 / extFAIL 0,
# class sum 43,324 EXACT) — so this pair is asserted against the authority, not against a number this
# lane produced.
TABLE_BEFORE="calls:21506:13512:1235:2613:4146,uses:2365:647:264:1450:4,contains:6491:6491:0:0:0,imports:1429:714:58:152:505,references:5573:3016:89:907:1561,exports:4576:4087:489:0:0,extends:42:1:0:25:16,implements:286:172:1:49:64,overrides:128:40:2:86:0,instantiates:928:231:1:473:223"
TABLE_AFTER="calls:21506:13512:1235:1836:4466,uses:2365:647:264:1450:4,contains:6491:6491:0:0:0,imports:1429:714:58:0:546,references:5573:3016:89:330:1854,exports:4576:4087:489:0:0,extends:42:1:0:25:16,implements:286:172:1:49:64,overrides:128:40:2:86:0,instantiates:928:231:1:469:227"

run_one() {
  local tag="$1" edges="$2" resolved="$3" amb="$4" unres="$5" table="$6"
  bun run validation/m14/fixtures/clojure/production-binding-split.ts \
    --expect-edges "$edges" --expect-resolved "$resolved" --expect-amb "$amb" --expect-unres "$unres" \
    --expect-table "$table" \
    --json "$LOG/prodbind-$tag.json" --dump "$LOG/dump-$tag.txt" 2>&1 | tee "$LOG/prodbind-$tag.txt" | grep -vE "^\[INFO\]"
  return "${PIPESTATUS[0]}"
}

# ── THE BEFORE RUN: the analyzer at HEAD ──────────────────────────────────────────────────────────
git show "$BEFORE_REV:src/ast/real-clojure-analyzer.ts" > src/ast/real-clojure-analyzer.ts
echo ""
echo "=== BEFORE (the analyzer at $BEFORE_REV, both lane changes out) digest now: $(git hash-object src/ast/real-clojure-analyzer.ts) ==="
run_one BEFORE 43324 28911 2139 5755 "$TABLE_BEFORE"
BEFORE_RC=$?
echo "BEFORE run exit: $BEFORE_RC"

# ── THE AFTER RUN: the analyzer restored from the COPY ───────────────────────────────────────────
cp "$KEEP" src/ast/real-clojure-analyzer.ts
echo ""
echo "=== AFTER (the working tree's analyzer, both lane changes in) digest now: $(git hash-object src/ast/real-clojure-analyzer.ts) ==="
run_one AFTER 43324 28911 2139 4245 "$TABLE_AFTER"
AFTER_RC=$?
echo "AFTER run exit: $AFTER_RC"

# ── THE DIGEST CHECK ───────────────────────────────────────────────────────────────────────────
FINAL=$(git hash-object src/ast/real-clojure-analyzer.ts)
if [ "$WORKING_DIGEST" = "$FINAL" ]; then
  echo "DIGEST CHECK: the analyzer is byte-identical to where the run started ($FINAL)."
else
  echo "*** THE ANALYZER DID NOT COME BACK ($WORKING_DIGEST -> $FINAL) ***"
  rm -f "$KEEP"
  exit 1
fi
rm -f "$KEEP"

# ── THE ROW-LEVEL RECONCILIATION ─────────────────────────────────────────────────────────────────
echo ""
echo "=== ROW-LEVEL RECONCILIATION (the gate's own identity + an occurrence counter) ==="
bun run validation/m14/fixtures/clojure/reconcile-arms.ts "$LOG/dump-BEFORE.txt" "$LOG/dump-AFTER.txt" \
  --json "$LOG/reconcile-BEFORE-AFTER.json" | tee "$LOG/reconcile-BEFORE-AFTER.txt"

echo ""
echo "BEFORE exit $BEFORE_RC / AFTER exit $AFTER_RC — both must be 0 for the pair to stand."
if [ "$BEFORE_RC" -ne 0 ] || [ "$AFTER_RC" -ne 0 ]; then exit 1; fi
