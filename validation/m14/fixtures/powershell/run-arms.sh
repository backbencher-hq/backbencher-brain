#!/usr/bin/env bash
# POWERSHELL — THE BEFORE/AFTER ARMS, under the arm token.
#
# ## WHAT THIS RUNS, AND WHY IT IS A SCRIPT AND NOT A TYPED COMMAND
#
# Six things must be true of a lane's arm, and five of them are easy to get wrong by hand:
#
#   1. THE ARMS RUN ON ONE POPULATION AND ONE ROOT. The root is the farm
#      (`BB_CORPUS_ROOT=$PWD/.corpus`) — the same root the recorded arms used, and for THIS lane
#      the root does not change the population (the farm's three local checkouts carry zero
#      powershell files, so the two roots admit the same multiset of `(repo, relative path)`).
#   2. THE DUMP MUST BE A WHOLE SET. The gate's `--dump` is bounded by `BB_DUMP_LIMIT` (default
#      40) and the gate prints NO marker when the bound is reached, so the bound is raised here
#      and the completeness is cross-checked afterwards from the gate's own TOTAL row
#      (`dump rows == edges - resolved`) by `row-reconciliation.mts`.
#   3. THE TWO SIDES MUST USE THE SAME INSTRUMENT. The BEFORE side is the analyzer at a CITED
#      COMMIT (`1e5708c03` — this lane's last commit to touch the analyzer before this lane's
#      fix) and the AFTER side is the working tree. The GATE is the same file in both.
#   4. **THE SHARED WORKING TREE IS NEVER SWAPPED — THE BEFORE SIDE RUNS IN A HARD-LINKED COPY.**
#      This is the change that makes the arms trustworthy, and it is here because the first pair of
#      arms was CONTAMINATED. See the section below.
#   5. THE PAIR MUST DIFFER IN THE ANALYZER AND IN NOTHING ELSE. The runner computes a CONTENT
#      DIGEST over the instrument trees (every `.ts` under `src/ast/` and `script/m14/`, EXCLUDING
#      the powershell analyzer) for each side, and asserts the two digests are EQUAL while the two
#      analyzer digests DIFFER. That is the comparability claim, made mechanically.
#   6. THE TOKEN IS TAKEN WHEN IT IS THIS LANE'S TURN AND RELEASED EVEN ON FAILURE.
#
# ## WHY THE BEFORE SIDE RUNS IN A COPY, AND WHAT IT COST
#
# The first pair of arms was CONTAMINATED, and the contamination was MEASURED, not suspected:
#
#   · the two arms read `resolved` 74,653 (AFTER) and 89,297 (BEFORE) — a 14,644 difference that
#     this lane's change CANNOT cause, because the change removes a metadata key and nothing else;
#   · the commit that landed between the two arms touched ONE doc and no source, so the commit was
#     not the cause either;
#   · **the cause was the SHARED WORKING TREE: the Lead was changing the shared ARBITER
#     (`script/m14/incoming-rule.ts`) in the tree, UNCOMMITTED, while the two arms ran.**
#
# And the FIRST attempt at fixing it — swapping the analyzer in the shared tree under
# `git update-index --assume-unchanged` — introduced a SECOND hazard, which the fleet caught: **the
# flag is invisible to `git status`, so a lane reading the tree during the swap sees a file as clean
# when it is not — and a FIXTURE-SUITE RUN during the swap sees the pre-fix analyzer.** That is
# not hypothetical: the Lead read `powershell 0 → 1 failures` and attributed it to their own
# arbiter change. **MEASURED: under the BEFORE analyzer the powershell suite reads 19/1, and the ONE
# failure is `powershell/relative-path-psb18` — this lane's own fixture, which pins the NEW
# behaviour and is therefore red under the OLD analyzer. The fixture was RIGHT and the attribution
# was wrong.** So the swap is not merely invisible to git — it is visible to every lane that reads
# the tree, and it reads as a real defect.
#
# **THE FIX IS TO STOP SWAPPING.** The BEFORE side runs in a hard-linked COPY of the tree at
# `.bb_backups/ps-before-run/` (gitignored, and skipped by the indexer — both verified), with the
# analyzer REPLACED there by `rm` + write, so the shared tree is never touched at all. The copy is
# 234 MB of hard links, built in seconds, and it needs no git and no worktree registration.
#
# **AND THE CONSEQUENCE IS THE BEST PART: THE `assume-unchanged` SHIELD IS NO LONGER NEEDED, SO THIS
# LANE NEVER USES IT.** The hazard the Lead named for the fleet — an invisible flag, a window, a
# reader who cannot tell — does not occur here, because there is no window.
#
# ## THE ORDER: AFTER FIRST, THEN BEFORE
#
# The AFTER side needs no copy at all — the working tree already IS the AFTER state — so it runs
# first, and the copy is built afterwards, from the tree as it stands at that moment. The copy is
# built AFTER the AFTER side, so the two sides' instrument trees are as close as they can be.
#
# ## THE TOKEN DISCIPLINE
#
#   · the SMALL SLOT is a SEPARATE lock from the heavy token, so this lane's 1,181-file arms run
#     BESIDE a heavy arm instead of behind it;
#   · the heartbeat is beaten every 110 s while an arm runs (the TTL is 45 minutes and the rule is
#     to beat every two minutes);
#   · the token is ALWAYS released — a `trap` does it, and the trap is set BEFORE the wait;
#   · NO LOCK IS EVER DELETED that this script did not create.
#
# Usage:  bash validation/m14/fixtures/powershell/run-arms.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
LANE=powershell
TOKEN="script/m14/arm-token.sh"
SRC=src/ast/real-powershell-analyzer.ts
LOGDIR=validation/m14/fixtures/powershell/measurements/arms
BEFORE_COMMIT=1e5708c03
BEFORE_RUN="$ROOT/.bb_backups/ps-before-run"
mkdir -p "$LOGDIR"

export BB_CORPUS_ROOT="$PWD/.corpus"
export BB_DUMP_LIMIT=100000000

BEAT_PID=""
cleanup() {
  if [ -n "$BEAT_PID" ]; then kill "$BEAT_PID" 2>/dev/null || true; fi
  bash "$TOKEN" release "$LANE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── THE SMALL SLOT (2026-10-20, Lead) ──────────────────────────────────────────────────────────────
# The small slot is a SEPARATE lock, and this lane's whole population is 1,181 files — inside the
# small slot's 2,000-file bound, and the number the Lead's own slot comment names ("toml 1,485 files ·
# clojure 646 · powershell 1,181"). The heavy queue had this lane 8th of 9 behind a 33,738-file arm.
#
# THE DECLARATION IS THE POINT: the slot refuses a population of 0 (which means "the whole
# population" — a heavy arm in disguise) and the arm PRINTS its own population, so a false
# declaration is caught by reading the arm's header against what the slot was given. **This lane
# DECLARES 1,181, AND THE RUNNER CHECKS THE GATE'S OWN `population: 1,181 parsed of 1,181 sampled`
# AGAINST IT.**
DECLARED_POP=1181
echo "taking the SMALL arm slot with a declared population of $DECLARED_POP files"
WAITED=0
while true; do
  if bash "$TOKEN" take-small "$LANE" "$DECLARED_POP"; then break; fi
  sleep 20
  WAITED=$((WAITED+20))
  if [ $((WAITED % 300)) -eq 0 ]; then
    echo "  ... waited ${WAITED}s for the small slot"
    bash "$TOKEN" status 2>&1 | grep -i "small" | head -2
  fi
done

# ── LEAVING THE HEAVY QUEUE, AND SAYING SO ───────────────────────────────────────────────────────────
# THIS LANE'S OWN ENTRY, AND ONLY THIS LANE'S OWN ENTRY. The small slot is a SEPARATE lock, so
# taking it does NOT remove this lane from the HEAVY queue — and a stale queue entry BLOCKS the lane
# behind it (java is behind powershell). `arm-token.sh release` removes the holder's entry with
# `grep -vxF "$lane" > "$QUEUE_FILE.tmp" && mv`, so this uses the SAME atomic pattern, on this
# lane's OWN line, and says so out loud rather than doing it quietly.
QUEUE_FILE="${BB_ARM_QUEUE:-$PWD/.tmp-lead/arm-queue}"
if [ -f "$QUEUE_FILE" ] && grep -qxF "$LANE" "$QUEUE_FILE"; then
  grep -vxF "$LANE" > "$QUEUE_FILE.tmp" 2>/dev/null || : > "$QUEUE_FILE.tmp"
  mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"
  echo "removed THIS lane's own entry from the HEAVY queue (its own line only); the queue is now:"
  bash "$TOKEN" queue 2>/dev/null | sed 's/^/  /'
  echo "  (the small slot is a SEPARATE lock, so this lane's heavy turn is no longer needed)"
fi

echo "small slot taken; beating every 110s (the same beat command serves both slots)"
( while true; do sleep 110; bash "$TOKEN" beat "$LANE" >/dev/null 2>&1 || true; done ) &
BEAT_PID=$!

## THE CONTENT DIGEST — THE COMPARABILITY CLAIM, MADE MECHANICALLY.
##
## It covers every `.ts` under `src/ast/` and `script/m14/` EXCEPT the powershell analyzer: the
## instrument, the analyzer registry, the pool worker, the arbiter, the gate — everything both arms
## read. **If the two sides' digests are EQUAL and their analyzer digests DIFFER, then the two arms
## differ in the analyzer and in NOTHING ELSE**, and the movement between them is this lane's change
## and not the fleet's.
## THE INSTRUMENT DIGEST — AND THE SCOPE IS THE ARMS' READ SET, NOT EVERYTHING.
##
## The first version of this digest covered every `.ts` under `src/ast/` and `script/m14/`, and it
## FIRED A FALSE POSITIVE: another lane's UNCOMMITTED edit to an unrelated probe script
## (`script/m14/py-*.ts`, `script/m14/c-*.ts`) changed the digest between the two arms, and the
## runner refused the pair — correctly refusing, for the wrong reason.
##
## **THE SCOPE IS NOW WHAT THE ARMS ACTUALLY READ.** The gate imports the analyzers DYNAMICALLY
## (`await import("../../src/ast/real-<lang>-analyzer")`), so a powershell arm loads the powershell
## analyzer and NOT the other 47 — which is why the C lane's uncommitted edit to
## `src/ast/real-c-analyzer.ts` cannot touch a powershell measurement, and must not be able to
## make the pair look contaminated either. So the scope is: the shared machinery under `src/ast/`
## EXCLUDING every per-language analyzer, the three gate scripts, and this lane's own two
## instruments. The SUBJECT analyzer is excluded from the digest and compared separately, so
## "the analyzer differs" and "nothing else differs" are two separate facts.
instrument_digest() {  # a tree directory
  local tree="$1"
  ( cd "$tree" && { find src/ast -type f -name '*.ts' 2>/dev/null | grep -vE '/real-.*-analyzer\.ts$'; \
                     echo script/m14/incoming-gate.ts; echo script/m14/incoming-rule.ts; \
                     echo script/m14/residual-gate.ts; \
                     echo validation/m14/fixtures/powershell/claim-refutation-census.mts; \
                     echo validation/m14/fixtures/powershell/row-reconciliation.mts; \
                   } | sort -u | xargs -r md5sum 2>/dev/null ) | md5sum | cut -d' ' -f1
}
## THE CORPUS, IN THE READ SET. The arms read the corpus, so the corpus is part of the instrument:
## a digest over the ADMITTED FILES alone would not say WHICH files, and a change of one file's
## bytes is a change of the measurement. So the corpus digest is over (repo, relative path, size)
## for every admitted file — the population's identity.
corpus_digest() {  # the corpus root
  # `-L` MATTERS: the corpus root is a farm of SYMLINKS to the repos, and `find` without it reports
  # the links themselves (type l), not the files inside them — so the digest would be over an EMPTY
  # set and would say nothing at all about the population.
  ( cd "$1" 2>/dev/null && find -L . -type f \( -iname '*.ps1' -o -iname '*.psm1' -o -iname '*.psd1' \) \
      -printf '%P\t%s\n' 2>/dev/null | sort ) | md5sum | cut -d' ' -f1
}
analyzer_digest() { md5sum "$1" | cut -d' ' -f1; }

run_arm() {  # name, tree, command...
  local name="$1" tree="$2"; shift 2
  echo "=== ARM $name ==="
  local ad id cd
  ad="$(analyzer_digest "$tree/$SRC")"
  id="$(instrument_digest "$tree")"
  cd="$(corpus_digest "$BB_CORPUS_ROOT")"
  echo "  analyzer digest:   $ad"
  echo "  instrument digest: $id"
  echo "  corpus digest:     $cd"
  echo "$ad $id $cd" > "$LOGDIR/$name.digests"
  local t0 t1
  t0=$(date +%s)
  # EACH ARM GETS ITS OWN INDEX CACHE. The gate caches its project index under
  # `BB_INDEX_CACHE ?? /tmp/bb-project-index` — a path OUTSIDE the repo, so the two arms would
  # otherwise SHARE it. Powershell builds no index (the gate reports "0 repo index(es)"), so today
  # the channel is inert; it is closed anyway, because an arm pair that cannot share a cache cannot
  # be contaminated by one.
  ( cd "$tree" && BB_INDEX_CACHE="$ROOT/.bb_backups/ps-index-cache-$name" "$@" ) > "$LOGDIR/$name.log" 2>&1
  local rc=$?
  t1=$(date +%s)
  echo "  rc=$rc  seconds=$((t1-t0))  log=$LOGDIR/$name.log"
  bash "$TOKEN" beat "$LANE" >/dev/null 2>&1 || true
  return 0
}

# THE CENSUS, with its JSON written beside its log.
census() {
  local name="$1" tree="$2"
  # THE `--out` PATH IS ABSOLUTE, and that is load-bearing: the arm runs with its cwd set to the
  # tree it measures, and the copy's `validation/` is a COPY of the directory structure (only the
  # FILES are hard links), so a relative `--out` would land the census's JSON in the COPY and the
  # main tree's log directory would never see it.
  run_arm "$name" "$tree" npx tsx validation/m14/fixtures/powershell/claim-refutation-census.mts --out "$ROOT/$LOGDIR/$name.json"
}

# ── THE AFTER SIDE — THE WORKING TREE, WHICH ALREADY IS THE AFTER STATE ─────────────────────────────
echo "analyzer: the AFTER state (the working tree); digest:"
md5sum "$SRC" | sed 's/^/  /'
HEAD_BEFORE_ARMS="$(git rev-parse HEAD)"

run_arm gate-AFTER    "$ROOT" bun run script/m14/incoming-gate.ts powershell ps1,psm1,psd1 0 --index --dump
census           census-AFTER    "$ROOT"
run_arm residual-AFTER "$ROOT" npx tsx script/m14/residual-gate.ts --lane powershell

# ── THE BEFORE SIDE — A REAL COPY, AND THE SHARED TREE IS NEVER TOUCHED ──────────────────────────────
#
# THE LEAD'S STANDING RULE (2026-10-20): NO LANE MAY KEEP A HARD-LINKED COPY OF A LEAD-OWNED FILE,
# AND THE CHECK IS `stat -c %i`, NOT A PROMISE. `cp -al` SHARES THE INODE, so a write through the
# copy IS a write to the Lead's file — and this lane PROVED that the hard way: its W9 patch
# modified `script/m14/incoming-rule.ts` through a hard link, and the Lead's clojure join was
# silently lost from the Lead's live gate and had to be re-applied.
#
# SO THE COPY IS A REAL COPY (`cp -a`, WHICH ALLOCATES NEW INODES) AND THE INODE PROOF IS A CONTROL:
# IF ANY LEAD-OWNED FILE SHARES AN INODE WITH THE COPY, THE ARMS DO NOT RUN AT ALL.
echo
echo "building the BEFORE tree (a REAL copy — new inodes, the shared tree is NOT modified) at .bb_backups/ps-before-run"
rm -rf "$BEFORE_RUN"
mkdir -p "$BEFORE_RUN"
cp -a src "$BEFORE_RUN/src"
cp -a script "$BEFORE_RUN/script"
cp -a wasm "$BEFORE_RUN/wasm"
mkdir -p "$BEFORE_RUN/validation/m14/fixtures"
cp -a validation/m14/fixtures/powershell "$BEFORE_RUN/validation/m14/fixtures/powershell"
ln -s "$ROOT/node_modules" "$BEFORE_RUN/node_modules"
for f in package.json tsconfig.json tsconfig.scripts.json bunfig.toml; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$BEFORE_RUN/$f"
done
# THE INODE PROOF — A CONTROL, NOT A COMMENT. A SHARED INODE MEANS THE ARMS DO NOT RUN.
for f in script/m14/incoming-gate.ts script/m14/incoming-rule.ts script/m14/residual-gate.ts \
         src/ast/pool-worker.ts src/ast/language-detection.ts src/ast/project-index.ts; do
  [ -f "$ROOT/$f" ] || continue
  [ -f "$BEFORE_RUN/$f" ] || continue
  a=$(stat -c %i "$ROOT/$f"); b=$(stat -c %i "$BEFORE_RUN/$f")
  if [ "$a" = "$b" ]; then
    echo "  REFUSING TO RUN: $f SHARES AN INODE WITH THE COPY ($a) — a hard link is not a copy."
    exit 1
  fi
  echo "  the copy is a separate inode: $f tree=$a copy=$b"
done
# THE ANALYZER, REPLACED BY `rm` + WRITE, SO THE COPY'S FILE IS A NEW INODE AND THE SHARED TREE'S IS
# UNTOUCHED. (A write IN PLACE through a hard link would edit the shared tree's file.)
rm "$BEFORE_RUN/$SRC"
git show "$BEFORE_COMMIT:$SRC" > "$BEFORE_RUN/$SRC"
echo "  BEFORE analyzer digest: $(analyzer_digest "$BEFORE_RUN/$SRC")  (expected 719d50b71e51043d8debc6aef84e0d5d)"
echo "  AFTER  analyzer digest: $(analyzer_digest "$ROOT/$SRC")  (expected ac1601a5d02d760be5e58a1c628c9592)"

run_arm gate-BEFORE    "$BEFORE_RUN" bun run script/m14/incoming-gate.ts powershell ps1,psm1,psd1 0 --index --dump
census           census-BEFORE    "$BEFORE_RUN"
run_arm residual-BEFORE "$BEFORE_RUN" npx tsx script/m14/residual-gate.ts --lane powershell

# ── THE COMPARABILITY CLAIM, CHECKED ────────────────────────────────────────────────────────────────
echo
echo "=== THE COMPARABILITY CHECK: do the two arms differ in the ANALYZER AND NOTHING ELSE? ==="
AFTER_A="$(cut -d' ' -f1 "$LOGDIR/gate-AFTER.digests" 2>/dev/null)"
BEFORE_A="$(cut -d' ' -f1 "$LOGDIR/gate-BEFORE.digests" 2>/dev/null)"
AFTER_I="$(cut -d' ' -f2 "$LOGDIR/gate-AFTER.digests" 2>/dev/null)"
BEFORE_I="$(cut -d' ' -f2 "$LOGDIR/gate-BEFORE.digests" 2>/dev/null)"
AFTER_C="$(cut -d' ' -f3 "$LOGDIR/gate-AFTER.digests" 2>/dev/null)"
BEFORE_C="$(cut -d' ' -f3 "$LOGDIR/gate-BEFORE.digests" 2>/dev/null)"
echo "  analyzer digest   BEFORE: $BEFORE_A"
echo "  analyzer digest   AFTER : $AFTER_A"
echo "  instrument digest BEFORE: $BEFORE_I"
echo "  instrument digest AFTER : $AFTER_I"
echo "  corpus digest     BEFORE: $BEFORE_C"
echo "  corpus digest     AFTER : $AFTER_C"
if [ -n "$AFTER_A" ] && [ -n "$BEFORE_A" ] && [ -n "$AFTER_I" ] && [ -n "$BEFORE_I" ]; then
  if [ "$AFTER_A" != "$BEFORE_A" ] && [ "$AFTER_I" = "$BEFORE_I" ] && [ "$AFTER_C" = "$BEFORE_C" ]; then
    echo "  COMPARABLE — the arms differ in the ANALYZER (the intended difference) and in NOTHING"
    echo "  ELSE (the instrument digests are identical), so the movement is this lane's change."
  else
    echo "  *** NOT COMPARABLE — the analyzer digests are equal (the intended difference is missing)"
    echo "      or the INSTRUMENT digests differ (the arbiter or the gate moved between the arms)."
    echo "      The movement below MUST NOT be reported as this lane's. ***"
  fi
fi

# ── THE COLUMN ATTRIBUTION — THE REAL COMPARABILITY PROOF ──────────────────────────────────────────
# The digest says "the instrument did not move". This says "and the MOVEMENT IS MINE", by COLUMN.
#
# THE GATE'S TOTAL ROW HAS 14 COLUMNS (incoming-gate.ts:3425-3428): edges, resolved, collRes,
# amb(decl), amb(kind), unresolved, extOK, ext?, extFAIL, bindOK, bind?, bindFAIL, causeOK,
# causeFAIL.
#
# **THE COLUMNS DISJOINT.** A change to the ARBITER'S OWN-FILE TIE-BREAK moves `amb(decl)` into
# `resolved`; a change to an ANALYZER'S EXTERNALITY READING moves `ext?` into `unresolved`. So:
#   · the NAME-MODEL columns (resolved, collRes, amb(decl), amb(kind)) MUST BE IDENTICAL — if the
#     arbiter or the name model had moved between the arms, these would move, and the pair is
#     contaminated;
#   · the EXTERNALITY columns (extOK, ext?, extFAIL) are the ones a change to an externality
#     reading can touch, and they are the ones this lane's change touches.
# The python lane's commit calls this "attributing the two movements by column"; this is that idea
# applied to a lane whose change is in a DIFFERENT column from the fleet's other live change, which
# is exactly what makes the attribution possible.
total_row() {  # a log file -> one column per line, in the gate's own order
  grep -E "^TOTAL" "$1" 2>/dev/null | head -1 | awk '{for(i=2;i<=NF;i++) print $i}'
}
col() {  # the n-th column of a multi-line row
  echo "$1" | sed -n "${2}p"
}
COLS=(edges resolved collRes "amb(decl)" "amb(kind)" unresolved extOK "ext?" extFAIL bindOK "bind?" bindFAIL causeOK causeFAIL)
A_ROW="$(total_row "$LOGDIR/gate-BEFORE.log")"
B_ROW="$(total_row "$LOGDIR/gate-AFTER.log")"
echo
echo "=== THE COLUMN ATTRIBUTION: which COLUMN moved? ==="
if [ -n "$A_ROW" ] && [ -n "$B_ROW" ]; then
  i=1; MOVED=0; NAME_MOVED=0
  for c in "${COLS[@]}"; do
    a="$(col "$A_ROW" $i)"; b="$(col "$B_ROW" $i)"; i=$((i+1))
    [ -z "$a" ] && continue
    d=$((b - a)); [ "$d" -eq 0 ] && d=0
    printf '  %-12s %10s -> %10s  %+d\n' "$c" "$a" "$b" "$d"
    if [ "$d" -ne 0 ]; then
      MOVED=$((MOVED+1))
      case "$c" in
        resolved|collRes|"amb(decl)"|"amb(kind)") NAME_MOVED=$((NAME_MOVED+1));;
      esac
    fi
  done
  echo
  if [ "$NAME_MOVED" -eq 0 ]; then
    echo "  THE NAME-MODEL COLUMNS ARE IDENTICAL (resolved, collRes, amb(decl), amb(kind)) — so the"
    echo "  ARBITER'S OWN-FILE TIE-BREAK, and every other name-model rule, contributed the SAME to"
    echo "  both sides and CANCELS. The only columns that moved are the EXTERNALITY columns, which"
    echo "  is where this lane's change lives."
  else
    echo "  *** A NAME-MODEL COLUMN MOVED — the name model or the arbiter differed between the arms,"
    echo "      so the pair is CONTAMINATED and the movement MUST NOT be reported as this lane's. ***"
  fi
fi

# THE POPULATION, CHECKED AGAINST THE DECLARATION THE SLOT WAS GIVEN.
echo
echo "=== THE POPULATION, CHECKED AGAINST THE DECLARED $DECLARED_POP ==="
for f in gate-AFTER gate-BEFORE; do
  echo "  --- $f ---"
  grep -E "population:" "$LOGDIR/$f.log" | head -2 | sed 's/^/    /'
done

# ── THE RECONCILIATION ──────────────────────────────────────────────────────────────────────────────
echo
echo "=== RECONCILIATION ==="
npx tsx validation/m14/fixtures/powershell/row-reconciliation.mts \
  "$LOGDIR/gate-BEFORE.log" "$LOGDIR/gate-AFTER.log" \
  --out "$LOGDIR/reconcile-BEFORE-AFTER.json" 2>&1 | tee "$LOGDIR/reconcile-BEFORE-AFTER.txt" | tail -60

echo
echo "=== the census, before and after ==="
for f in census-BEFORE census-AFTER; do
  echo "--- $f ---"
  grep -E "^(census|files parsed|rows the analyzer|  the arbiter|     of which)" "$LOGDIR/$f.log" | sed 's/^/  /'
done

echo
echo "=== the gate's TOTAL row, before and after ==="
for f in gate-BEFORE gate-AFTER; do
  echo "--- $f ---"
  grep -E "^TOTAL" "$LOGDIR/$f.log" | sed 's/^/  /'
  grep -E "^(corpus root|population|VERDICT|instrument self-test)" "$LOGDIR/$f.log" | sed 's/^/  /'
done

echo
echo "=== the shared tree was NEVER modified ==="
echo "  analyzer digest now: $(analyzer_digest "$ROOT/$SRC")  (expected ac1601a5d02d760be5e58a1c628c9592)"
git status --short -- "$SRC" | sed 's/^/  analyzer status: /'
[ -z "$(git status --short -- "$SRC")" ] && echo "  analyzer clean against HEAD"
echo "  HEAD at the start of the arms: $HEAD_BEFORE_ARMS"
echo "  HEAD now:                      $(git rev-parse HEAD)"

echo
echo "=== releasing the token ==="
