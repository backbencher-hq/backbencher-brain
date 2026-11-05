#!/usr/bin/env bash
# KOTLIN ARM RUNNER — the WHOLE-POPULATION arm, as ONE COMMAND, ready for the moment the
# heavy arm token frees.
#
# WHAT THIS IS. The kotlin lane's arm is `script/m14/incoming-gate.ts kotlin kt,kts <W> --offset=<K>`
# over the 2,346 admitted `.kt`/`.kts` files (2,067 .kt + 279 .kts, 8 repos). It is small enough to
# fit a turn in principle, but the fleet measures a population as a UNION OF DISJOINT SLICES any
# time a run could die, because a partial walk is a prefix, not a population. This runner is that
# loop plus everything around it:
#
#   1. TAKE the heavy token (the queue is the order; a lane that is not at the head is refused
#      with the queue printed). `take` ALSO STARTS THE DETACHED BEAT DAEMON, which is the only
#      liveness signal that cannot be CPU-starved by the arm itself.
#   2. WALK the slices. Width is CALIBRATED IN-RUN: start at 1,000; on the first slice that is
#      REAPED (no `TOTAL` row — a partial file is evidence, not a slice), fall back to 500 and
#      keep going. Widths may therefore MIX, and the merge is written for exactly that: it checks
#      CONTIGUITY of the claimed ranges, not a uniform width.
#   3. BEAT from inside the loop (before and after every slice) on top of the daemon.
#   4. CONTROL THE POPULATION, ON EVERY SLICE. The gate prints its own discovered population on
#      the CHUNK line (`admitted files [a, b) of N`); N MUST equal this lane's census-derived
#      population. A disagreement is a CONTROL FAILURE, not a note: the gate and the census
#      would then be measuring different populations, and the closure would be a claim about
#      neither (`--population` is a CHECK, not an escape — it must equal the census).
#   5. MERGE with `merge-arm-slices.ts --population <census> --write <closure>`, which REFUSES a
#      hole, an overlap, a slice whose parsed count is not its claimed width, and a closure whose
#      eleven terms do not sum to the edge count. Nothing is written unless every check passes.
#   6. RELEASE the token, so the next lane in the queue runs.
#
# ★ THE COMPLETION TEST, AND THE DEFECT IT EXISTS TO PREVENT. The gate's exit code 1 is its NORMAL
# VERDICT (a failing resolution clause), not a failed run — a healthy slice that fails the
# resolution clause exits 1. ⇒ THE COMPLETION TEST IS
#       [ rc -le 1 ] && grep -q "^TOTAL" && measured == width
# and NOTHING ELSE. A runner that tested `rc -eq 0` would reap every GOOD slice and retry it at the
# fallback width forever (that exact defect shipped in a sibling lane's runner and cost an hour).
#
# RESUME IS THE DEFAULT. A slice file that already carries a `TOTAL` row, the right claimed range,
# and the right measured width is SKIPPED, so re-running this same command after a turn death
# continues from the first missing slice. The merge is the acceptance test — a hole is refused,
# never rounded.
#
# THE POPULATION IS READ FROM THIS LANE'S OWN CENSUS ARTIFACT, never hard-coded:
#   validation/m14/measurements/kotlin-extended-types-census.json  (population.admitted)
# corroborated by the lane's emission census
#   validation/m14/measurements/kotlin-renders-emission-census.json (population.admitted)
# — two independent whole-population walks of the SAME admission rule; if they disagree, this
# runner refuses to run (exit 4), because two different populations cannot both be the lane's.
#
# USAGE
#   bash script/m14/kotlin-arm-runner.sh --dry-run     # print the plan + exact commands, touch nothing
#   bash script/m14/kotlin-arm-runner.sh --check       # validate whatever slices exist, merge READ-ONLY
#   bash script/m14/kotlin-arm-runner.sh               # take the token, run the arm, merge, release
#   bash script/m14/kotlin-arm-runner.sh --wait        # same, but WAIT for the queue to reach kotlin
#
# OPTIONS
#   --wait                  poll `take` (60 s) until the token frees; refuse to start without it
#   --width N               first slice width (default 1000)
#   --fallback N            width after the first reap (default 500; never re-raised)
#   --population N          must EQUAL the census-derived admitted count (a check, not an escape)
#   --dir PATH              slice directory (default .tmp-kotlin-arm/slices)
#   --out PATH              merged closure path (default validation/m14/results/kotlin-whole-population-closure.json)
#   --dry-run               plan only; no token, no slices, no writes
#   --check                 inspect + merge-read-only only; no token, no slices, no writes
#   --no-release            leave the token held on success (debugging; NOT the normal shape)
#   --no-merge              skip the merge step (should not be used for an arm that is claimed)
#
# EXIT
#   0 arm complete + merged (or dry-run/check clean) · 2 usage · 3 token unavailable
#   4 population/census disagreement (CONTROL FAILURE) · 5 a slice could not complete even at
#   the fallback width · 6 the merge refused the slices (a hole/overlap/closure failure: resume,
#   do not round) · 7 memory floor refused the token (someone else is using the machine: retry later)
#
# WHAT DOES NOT BELONG HERE: no analyzer change, no fixture, no declaration. This runner only
# MEASURES; the declaration is rebuilt from the closure it writes.
set -u
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || { echo "KOTLIN ARM RUNNER: cannot cd to $ROOT" >&2; exit 2; }

# ── arguments ────────────────────────────────────────────────────────────────────────────────
WAIT=0; WIDTH=1000; FALLBACK=500; POP_OVERRIDE=""; DIR=".tmp-kotlin-arm/slices"
# CANONICAL PATH, REGISTERED MEASUREMENT RECORD. The closure is the arm's MEASUREMENT (meta +
# the eleven-term arithmetic), not a harness-v2 claim: claims in `validation/m14/results/*.json` are
# written only by evidence-harness `emitEvidence`. It has a live consumer (`kotlin-declaration.ts`),
# so it is a NAMED registration in the harness's MEASUREMENT_RECORDS allowlist (validate() accepts
# it as parseable JSON, lists it by name, and never as a claim). See results/archive/README.md.
OUT="validation/m14/results/kotlin-whole-population-closure.json"
DRY=0; CHECK=0; RELEASE=1; MERGE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) WAIT=1 ;;
    --width) WIDTH="${2:?--width needs a number}"; shift ;;
    --fallback) FALLBACK="${2:?--fallback needs a number}"; shift ;;
    --population) POP_OVERRIDE="${2:?--population needs a number}"; shift ;;
    --dir) DIR="${2:?--dir needs a path}"; shift ;;
    --out) OUT="${2:?--out needs a path}"; shift ;;
    --dry-run) DRY=1 ;;
    --check) CHECK=1 ;;
    --no-release) RELEASE=0 ;;
    --no-merge) MERGE=0 ;;
    -h|--help) sed -n '2,96p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "KOTLIN ARM RUNNER: unknown argument '$1' (try --help)" >&2; exit 2 ;;
  esac
  shift
done
case "$WIDTH$FALLBACK$POP_OVERRIDE" in *[!0-9]*) echo "KOTLIN ARM RUNNER: widths and population must be integers" >&2; exit 2 ;; esac
[ "$WIDTH" -ge 1 ] || { echo "KOTLIN ARM RUNNER: --width must be >= 1" >&2; exit 2; }
[ "$FALLBACK" -ge 1 ] || { echo "KOTLIN ARM RUNNER: --fallback must be >= 1" >&2; exit 2; }
[ "$FALLBACK" -le "$WIDTH" ] || { echo "KOTLIN ARM RUNNER: --fallback must not exceed --width" >&2; exit 2; }

# ── the population: the census's admitted count, with every source printed ──────────────────
CENSUS="validation/m14/measurements/kotlin-extended-types-census.json"
CENSUS2="validation/m14/measurements/kotlin-renders-emission-census.json"
read_admitted() {  # file -> admitted count on stdout, empty on failure
  [ -f "$1" ] || { echo ""; return; }
  awk -F': *' '/"admitted":/ {gsub(/,/, "", $2); print $2; exit}' "$1"
}
POP=""; POP_SRC=""
if [ -f "$CENSUS" ]; then
  POP="$(read_admitted "$CENSUS")"
  POP_SRC="census artifact $CENSUS (population.admitted)"
fi
if [ -z "$POP" ]; then
  echo "KOTLIN ARM RUNNER: cannot read the admitted count — $CENSUS is absent."
  echo "  The census measures the population; guessing it here would make the closure a claim about nothing."
  exit 4
fi
# THE SECOND WHOLE-POPULATION WALK MUST AGREE. They measure the same admission rule from different
# instruments (construct census vs analyzer-emission census); a disagreement means one of them is
# measuring something else, so the runner refuses rather than picking a favourite.
if [ -f "$CENSUS2" ]; then
  POP2="$(read_admitted "$CENSUS2")"
  if [ -n "$POP2" ] && [ "$POP2" != "$POP" ]; then
    echo "KOTLIN ARM RUNNER: CONTROL FAILURE — the two census artifacts disagree on the population:" >&2
    echo "  $CENSUS  -> ${POP}" >&2
    echo "  $CENSUS2 -> ${POP2}" >&2
    echo "  Two different populations cannot both be this lane's. Fix the measurement, not the runner." >&2
    exit 4
  fi
fi
# --population IS A CHECK, NOT AN ESCAPE: it must equal the census.
if [ -n "$POP_OVERRIDE" ] && [ "$POP_OVERRIDE" != "$POP" ]; then
  echo "KOTLIN ARM RUNNER: CONTROL FAILURE — --population ${POP_OVERRIDE} disagrees with the census's ${POP}." >&2
  echo "  The population is READ from $CENSUS; an override that differs would make the closure a claim" >&2
  echo "  about a number no instrument measured. Refusing." >&2
  exit 4
fi

echo "KOTLIN ARM RUNNER — script/m14/kotlin-arm-runner.sh"
echo "  population: ${POP} admitted files ($POP_SRC)"
echo "  slices:     ${DIR} (width ${WIDTH}, falling to ${FALLBACK} on the first reap)"
echo "  merge out:  ${OUT}"
echo "  token:      $([ "$CHECK$DRY" -gt 0 ] && echo "not taken (check/dry-run)" || echo "take, beat, release")"

# ── slice-state helpers ─────────────────────────────────────────────────────────────────────
slice_file() { printf '%s/kotlin-%s-%s.txt' "$DIR" "$1" "$2"; }

# The gate's own discovered total on the CHUNK line (`admitted files [a, b) of N`).
slice_claimed_total() {
  sed -n "s/.*admitted files \[[0-9]*, [0-9]*) of \([0-9]*\),.*/\1/p" "$1" 2>/dev/null | head -1
}

# The gate's own claimed measured count for the slice.
slice_measured() {
  sed -n "s/.*admitted files \[$2, $3) of [0-9]*, and \([0-9]*\) of them were measured.*/\1/p" "$1" 2>/dev/null | head -1
}

# A slice is COMPLETE when its file carries (a) the gate's CHUNK line naming THIS exact range,
# (b) a TOTAL row, and (c) a measured count equal to the range's width. Anything else is a
# partial file: kept as evidence, never merged.
slice_complete() {
  local f="$1" start="$2" end="$3"
  [ -f "$f" ] || return 1
  grep -q "^TOTAL" "$f" || return 1
  grep -q "admitted files \[$start, $end)" "$f" || return 1
  [ "$(slice_measured "$f" "$start" "$end")" = "$((end - start))" ] || return 1
  return 0
}

count_slices() {
  local n=0
  [ -d "$DIR" ] || { echo 0; return; }
  while IFS= read -r f; do
    [ -n "$f" ] && n=$((n + 1))
  done < <(find "$DIR" -maxdepth 1 -name "kotlin-*.txt" -type f 2>/dev/null | sort)
  echo "$n"
}

# ── CHECK: report coverage and run the merge READ-ONLY (no token, no writes) ───────────────
if [ "$CHECK" -eq 1 ]; then
  echo
  echo "CHECK — slice state in ${DIR}:"
  [ -d "$DIR" ] || { echo "  no slice directory yet (first run starts at offset 0)"; exit 0; }
  found="$(count_slices)"
  complete=0; partial=0
  for f in "$DIR"/kotlin-*.txt; do
    [ -e "$f" ] || continue
    if grep -q "^TOTAL" "$f" 2>/dev/null; then complete=$((complete + 1)); else partial=$((partial + 1)); fi
  done
  echo "  slice files: ${found} · with TOTAL: ${complete} · partial (reaped): ${partial}"
  echo "  merge (READ-ONLY; refuses a hole/overlap/closure failure):"
  if bun run script/m14/merge-arm-slices.ts --dir "$DIR" --population "$POP"; then
    echo "  CHECK OK — the slices present form a contiguous, closed tiling; a full arm merges."
    exit 0
  else
    echo "  CHECK: merge refused (the slices present do NOT cover ${POP} yet — that is expected mid-arm)."
    echo "  The runner resumes at the first missing offset; re-run without --check to continue."
    exit 6
  fi
fi

# ── DRY RUN: the exact commands, nothing executed ───────────────────────────────────────────
if [ "$DRY" -eq 1 ]; then
  echo
  echo "DRY RUN — the arm would run these commands, in this order:"
  echo "  1. bash script/m14/arm-token.sh take kotlin"
  echo "     (refuses unless kotlin is at the queue head; starts the detached beat daemon)"
  echo "  2. for each offset [0, ${POP}) in slices of ${WIDTH} (fallback ${FALLBACK} after a reap):"
  echo "       bash script/m14/arm-token.sh beat kotlin"
  echo "       BB_CORPUS_ROOT=\$PWD/.corpus bun run script/m14/incoming-gate.ts kotlin kt,kts <W> --offset=<K> > ${DIR}/kotlin-<K>-<K+W>.txt"
  echo "       bash script/m14/arm-token.sh beat kotlin"
  echo "     ★ completion test: rc <= 1 (exit 1 is the gate's NORMAL verdict) AND a ^TOTAL row"
  echo "       AND measured == width. NOT rc == 0 — that reaps healthy slices (a sibling lane's defect)."
  echo "     (a file without a TOTAL row is a REAP: renamed .reaped and the offset is retried at ${FALLBACK})"
  echo "     (every slice's CHUNK line total must equal ${POP} — a disagreement is a CONTROL FAILURE, exit 4)"
  echo "  3. bun run script/m14/merge-arm-slices.ts --dir ${DIR} --population ${POP} --write ${OUT}"
  echo "  4. bash script/m14/arm-token.sh release kotlin"
  echo
  echo "  slices that would be walked: $(( (POP + WIDTH - 1) / WIDTH )) at width ${WIDTH}"
  echo "  existing complete slices in ${DIR}: $(count_slices)"
  exit 0
fi

# ── take the token (waiting only if asked) ─────────────────────────────────────────────────
TAKE_OUT="$(bash script/m14/arm-token.sh take kotlin 2>&1)"
TAKE_RC=$?
if [ "$TAKE_RC" -eq 7 ]; then
  echo "KOTLIN ARM RUNNER: the MEMORY FLOOR refused the token — another lane's arm is using the machine." >&2
  echo "  Retry later; do NOT force it through. The floor is a safety property, not a formality." >&2
  exit 7
fi
if [ "$TAKE_RC" -ne 0 ]; then
  if [ "$WAIT" -eq 1 ]; then
    echo "KOTLIN ARM RUNNER: token not available yet — waiting for the queue (polling take every 60 s)."
    echo "  $TAKE_OUT" | sed 's/^/  /'
    for _ in $(seq 1 240); do
      sleep 60
      TAKE_OUT="$(bash script/m14/arm-token.sh take kotlin 2>&1)"; TAKE_RC=$?
      if [ "$TAKE_RC" -eq 0 ]; then break; fi
      if [ "$TAKE_RC" -eq 7 ]; then echo "KOTLIN ARM RUNNER: memory floor refused; retrying."; fi
    done
    if [ "$TAKE_RC" -ne 0 ]; then
      echo "KOTLIN ARM RUNNER: waited ~4 h and the token never freed; the queue is the order, not a hint." >&2
      echo "  Last take output: $TAKE_OUT" >&2
      exit 3
    fi
  else
    echo "KOTLIN ARM RUNNER: the token is not ours right now ($TAKE_OUT)" >&2
    echo "  Re-run with --wait to hold for the queue, or run this when kotlin reaches the head." >&2
    exit 3
  fi
fi
echo
echo "TAKE: $TAKE_OUT" | sed 's/^/  /'

# ── the slice loop ──────────────────────────────────────────────────────────────────────────
mkdir -p "$DIR"
mkdir -p "$(dirname "$OUT")"
W="$WIDTH"
off=0
slices_done=0
reaps=0
while [ "$off" -lt "$POP" ]; do
  end=$((off + W))
  [ "$end" -gt "$POP" ] && end="$POP"
  f="$(slice_file "$off" "$end")"
  bash script/m14/arm-token.sh beat kotlin >/dev/null 2>&1 || true
  if slice_complete "$f" "$off" "$end"; then
    echo "  slice [$off, $end) already complete — resume skips it"
    off="$end"; slices_done=$((slices_done + 1)); continue
  fi
  if [ -f "$f" ] && ! grep -q "^TOTAL" "$f" 2>/dev/null; then
    # a partial left by an earlier death: keep it as evidence, do not let it read as a slice.
    # The evidence file deliberately does NOT end in `.txt`: the merge scans that directory for
    # `*.txt` slices and must never read a reap as a (dead) slice file.
    reaped="$(slice_file "$off" "$end").reaped-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "$f" "$reaped" 2>/dev/null || true
    echo "  partial slice at [$off, $end) set aside as $(basename "$reaped")"
  fi
  echo "  slice [$off, $end) width $W — $(date -u +%H:%M:%SZ) — starting"
  start_epoch="$(date +%s)"
  BB_CORPUS_ROOT="$PWD/.corpus" bun run script/m14/incoming-gate.ts kotlin kt,kts "$W" --offset="$off" > "$f.tmp" 2>&1
  rc=$?
  elapsed=$(( $(date +%s) - start_epoch ))
  bash script/m14/arm-token.sh beat kotlin >/dev/null 2>&1 || true
  measured="$(slice_measured "$f.tmp" "$off" "$end")"
  # ★ THE COMPLETION TEST. The gate's exit 1 is its NORMAL VERDICT code (a failing resolution
  # clause), not a failed run — a healthy slice can exit 1. Testing rc == 0 would REAP every good
  # slice and retry it at the fallback width forever (a sibling lane's runner shipped that defect
  # and it cost an hour). So: rc <= 1 AND a TOTAL row AND measured == width, and nothing else.
  if [ "$rc" -le 1 ] && grep -q "^TOTAL" "$f.tmp" 2>/dev/null && [ "${measured:-0}" = "$((end - off))" ]; then
    claimed="$(slice_claimed_total "$f.tmp")"
    if [ -n "$claimed" ] && [ "$claimed" != "$POP" ]; then
      echo "KOTLIN ARM RUNNER: CONTROL FAILURE — the gate discovered a population of ${claimed}, the census says ${POP}." >&2
      echo "  The gate and the census are measuring different populations; a closure over this run would be a claim about neither." >&2
      [ "$RELEASE" -eq 1 ] && bash script/m14/arm-token.sh release kotlin >/dev/null 2>&1 || true
      exit 4
    fi
    mv "$f.tmp" "$f"
    slices_done=$((slices_done + 1))
    echo "  slice [$off, $end) complete in ${elapsed}s — measured ${measured}/${end-off} (population ${claimed:-?})"
    off="$end"
    continue
  fi
  # REAPED (or a wrong-width report): keep the partial as evidence and fall back ONCE.
  reaped="$(slice_file "$off" "$end").reaped-$(date -u +%Y%m%dT%H%M%SZ)"
  { [ -f "$f.tmp" ] && mv "$f.tmp" "$reaped" 2>/dev/null; } || true
  reaps=$((reaps + 1))
  echo "  REAP at [$off, $end) after ${elapsed}s (rc=${rc}, measured ${measured:-none}) — partial kept as $(basename "$reaped" 2>/dev/null || echo "<none>")"
  if [ "$W" -gt "$FALLBACK" ]; then
    W="$FALLBACK"
    echo "  falling back to width $W and retrying the SAME offset (the union must stay contiguous)"
    continue
  fi
  echo "KOTLIN ARM RUNNER: a slice failed even at the fallback width — stopping rather than inventing a closure." >&2
  echo "  the token is released so the fleet is not blocked; re-run later (resume skips complete slices)." >&2
  [ "$RELEASE" -eq 1 ] && bash script/m14/arm-token.sh release kotlin >/dev/null 2>&1 || true
  exit 5
done

echo
echo "SLICES DONE: ${slices_done} · reaps ${reaps} · final width ${W} · range [0, ${POP})"

# ── merge (refuses a hole by construction) ─────────────────────────────────────────────────
if [ "$MERGE" -eq 1 ]; then
  echo "MERGE: bun run script/m14/merge-arm-slices.ts --dir ${DIR} --population ${POP} --write ${OUT}"
  if ! bun run script/m14/merge-arm-slices.ts --dir "$DIR" --population "$POP" --write "$OUT"; then
    echo "KOTLIN ARM RUNNER: THE MERGE REFUSED — nothing was written. The slices are not a closed tiling." >&2
    echo "  do NOT round, do NOT pad: re-run this command; resume starts at the first missing offset." >&2
    [ "$RELEASE" -eq 1 ] && bash script/m14/arm-token.sh release kotlin >/dev/null 2>&1 || true
    exit 6
  fi
  echo "MERGE OK — closure written to ${OUT}"
fi

[ "$RELEASE" -eq 1 ] && { echo -n "RELEASE: "; bash script/m14/arm-token.sh release kotlin 2>&1 | tail -1; }
echo "KOTLIN ARM RUNNER: DONE — the arm is measured; the declaration is rebuilt from ${OUT}."
