#!/usr/bin/env bash
# Repeat the xml ruling gate and keep EVERY run, including the ones that die.
#
# Why this exists: one run of `ruled-gate.ts` on this tree exited 1 with no verdict
# table and no [BB-HANG] line, and the runner at that point printed nothing about why
# (fixed in the commit that added the UNEXPLAINED NON-ZERO EXIT block). A single
# observation cannot distinguish "intermittent shared-engine death" from "that one run
# was unlucky", so the question needs n>1 and every iteration has to be retained —
# a driver that stopped at the first failure would measure only the failure rate of
# well-behaved runs.
#
# Each iteration writes its OWN log, so a failure is inspectable rather than averaged
# away. The summary line at the end is the only thing meant to be read at a glance.
#
#   usage: gate-repeat.sh <iterations> [outdir]
#   writes: <outdir>/<n>.log  — present ONLY when iteration n has RETURNED
#
# ------------------------------------------------------------------------------------
# WHY THE LOG IS BUILT THROUGH `.partial` AND RENAMED — this driver recorded two deaths
# that never happened, and the mechanism was HERE, not in the gate.
#
# The previous version redirected straight into `<n>.log` with `>`. `>` creates and
# TRUNCATES the file when the shell opens it, which is BEFORE the child runs, so from the
# moment iteration n starts there is a file at the final-looking name `<n>.log` that
# grows one line at a time. A reader who lists the directory mid-run finds exactly the
# artifact a death produces: a log with the header and no verdict table. Two iterations
# of this driver were committed on exactly that reading — 22f51ac4b filed "iteration 4
# DIED with no diagnostic", and a43b918a5 filed a "second death" at iteration 6 and
# reasoned at length about two distinct causes from them. Both completed, exit 0.
#
# The proof is in this repository and needs no mtimes, because the summary line for
# iteration n is emitted by the PARENT after the child returns:
#
#   22f51ac4b  4.log = 14 lines, byte-identical to the first 14 lines of a clean run;
#              summary.txt = 3 iter lines, no iter=4  -> iteration 4 had not returned
#   a43b918a5  6.log = 14 lines, byte-identical to the same 14 lines;
#              summary.txt = 5 iter lines, no iter=6  -> iteration 6 had not returned
#
# 4-at-death and 6-at-death are byte-identical to EACH OTHER, which is the shape of one
# observation error recorded twice rather than of two engine events. And both logs are
# now complete and byte-identical to 1/2/3/5.log (md5 ccad7219405f1a9ddb603a7e8d85d890),
# all six exit 0 with 10 verdict rows.
#
# So the corrected count is 0 deaths in 6, and the real defect this file had was that it
# produced evidence indistinguishable from a death. Three changes fix that:
#
#   1. the child writes `<n>.partial`; the parent renames it to `<n>.log` after the child
#      RETURNS. A file at the final name is therefore, by construction, a finished run.
#   2. a `GATE_REPEAT_ITER_DONE` sentinel carrying the iteration, the exit status and the
#      elapsed seconds is appended inside the `.partial` before the rename, so a completed
#      log is self-certifying and a hand-truncated or half-copied one is detectable.
#   3. an existing `<n>.log` is never overwritten. The old `seq 1 $N` numbering reused
#      1..N on every invocation, which is how the ITERATION-4 DEATH ARTIFACT was
#      destroyed by the next invocation of this same driver — a43b918a5 recorded that it
#      no longer existed on disk while 22f51ac4b still cited it. Pass a different N, or a
#      different outdir, or move the old files.
#
# The script prints `DEATH` / `CLEAN` per iteration, and treats a log without the
# sentinel as DEATH-BY-EVIDENCE rather than guessing why.
set -u
N="${1:-6}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
REL="validation/m14/measurements/xml/gate-repeat"
# An absolute outdir is used as given; a relative one is resolved against the repo root.
case "${2:-$REL}" in
  /*) OUT="$2" ;;
  *) OUT="$ROOT/${2:-$REL}" ;;
esac
SENTINEL='GATE_REPEAT_ITER_DONE'
mkdir -p "$OUT"
cd "$ROOT" || exit 1

echo "outdir: $OUT   iterations: $N" >"$OUT/summary.txt"

for i in $(seq 1 "$N"); do
  final="$OUT/$i.log"
  partial="$OUT/$i.partial"

  # Change 3: refuse to clobber a committed artifact rather than destroying it silently.
  if [ -e "$final" ]; then
    echo "iter=$i SKIPPED (refusing to overwrite $(basename "$final"), which already exists)" \
      | tee -a "$OUT/summary.txt"
    continue
  fi

  start=$(date +%s)
  # Change 1: every byte the child writes lands in `.partial`, never at the final name.
  BB_XML_WORKERS=1 npx tsx validation/m14/fixtures/xml/ruled-gate.ts \
    >"$partial" 2>&1
  status=$?
  secs=$(( $(date +%s) - start ))

  # Change 2: the sentinel goes in while the file is still `.partial`, so the rename below
  # publishes a log that carries its own proof of having finished.
  printf '%s iter=%s exit=%s secs=%s\n' "$SENTINEL" "$i" "$status" "$secs" >>"$partial"

  rows=$(grep -cE '^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates) +(EMITTED|RULED)' "$partial" || true)
  unexplained=$(grep -c 'UNEXPLAINED NON-ZERO EXIT' "$partial" || true)
  hangs=$(grep -c '\[BB-HANG\]' "$partial" || true)
  walked=$(grep -o 'walked=[0-9]*' "$partial" | sort -u | tr '\n' ',')
  sentinel_count=$(grep -c "$SENTINEL" "$partial" || true)
  if [ "$sentinel_count" -eq 1 ]; then verdict=CLEAN; else verdict="DEATH(evidence-truncated: sentinel x$sentinel_count)"; fi

  mv "$partial" "$final"
  echo "iter=$i exit=$status verdict=$verdict verdictRows=$rows unexplained=$unexplained hangLines=$hangs secs=$secs walked=$walked" \
    | tee -a "$OUT/summary.txt"
done

# The count is the measurement, so print it rather than leaving it to be counted by hand.
total=$(grep -c '^iter=' "$OUT/summary.txt" || true)
deaths=$(grep -c 'verdict=DEATH' "$OUT/summary.txt" || true)
echo "TOTAL iterations=$total deaths=$deaths outdir=$OUT" | tee -a "$OUT/summary.txt"