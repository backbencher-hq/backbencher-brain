#!/usr/bin/env bash
# HTML ARM — THE WHOLE ADMITTED POPULATION, IN FIVE DISJOINT CHUNKS, ON THE SMALL SLOT.
#
# WHY THIS FILE EXISTS. The html lane's admitted population is 8,888 files — 96 repositories, the
# router's own thirteen admitted spellings, the git-tracked set, under the engine's 1 MB cap. The
# fleet's heavy arm is ONE at a time and the queue is long, and the small slot takes at most 2,000
# files per call. ⇒ THE POPULATION IS WALKED IN FIVE DISJOINT CHUNKS OF THE SAME SORTED ADMITTED
# LIST THE GATE ITSELF SORTS (`incoming-gate.ts:532 found.sort()`), and the chunks are slices, not
# strides: chunk N is the admitted list's [N·2000, (N+1)·2000) window, so the five chunks are
# DISJOINT and their union is the population exactly.
#
# TWO MEASUREMENTS RUN HERE, BOTH CHUNKED, BOTH ON THE SMALL SLOT:
#   1. THE CONSTRUCT CENSUS (script/m14/html-extended-construct-probe.ts) — the whole-population
#      count of the five open types' constructs, and the template-family near miss. It is a
#      whole-population parse, so it needs a heavy arm; it is chunked the same way, and every
#      counter in it is additive, so the sum of five slices IS the census.
#   2. THE RESOLUTION ARM (script/m14/incoming-gate.ts) — the per-type emission counts and the
#      resolution closure, in the gate's own TABLE 1.
#
# THE SMALL SLOT IS TAKEN ONCE PER CHUNK, NOT ONCE FOR ALL TEN CALLS, because the slot's rule is
# "≤2,000 files per call" and the call is the chunk. Each chunk therefore takes the slot, runs, and
# releases — which returns the lane's ordinary-queue place at the BACK, so the lane does not lose
# its place in the heavy queue while it works the small slot.
#
# THE BEAT. The holder must beat every ≤120 s or it looks dead and the slot is reclaimed. The beat
# loop runs in the background for the whole call and is killed before the release.
#
# ★ THE EXTENSION LIST IS THE ROUTER'S OWN TABLE, IN THE ROUTER'S OWN SPELLING — all THIRTEEN of
#   them, not just `.html`. The pilot run of this arm passed `html` as the extension argument and
#   the gate said so out loud: "admitted extensions = .html (ONE spelling — check the lane does not
#   carry another)" and "corpus has 6786 .html files across 92 repos". ⇒ A `.html`-only arm measures
#   6,786 of the lane's 8,888 admitted files, and the template spellings (2,070 files) would be
#   absent from the measurement while still being in the population. The list is
#   `incoming-gate.ts:319`'s EXTENSION_LANGUAGE.html, spelled out here because the CLI takes a
#   comma-separated string.
#
# THE STRADDLE, DISCLOSED. The admitted list is sorted by ABSOLUTE PATH, so a repository's files are
# CONTIGUOUS — but a repository that is longer than one chunk STRADDLES a chunk boundary, and a
# straddling repository's key space is SPLIT across two chunks. The resolution scope is PER PROJECT
# (production's own scope), so a split project resolves fewer edges than it would whole. ⇒ THE CHUNK
# SUM IS THE POPULATION'S BUCKETS, AND ITS `resolved` IS A LOWER BOUND ON THE WHOLE-POPULATION
# FIGURE: a split key space can only move edges OUT of `resolved`. The straddling repositories are
# named and counted by script/m14/html-population.ts.
set -u

LANE=html
OUT_DIR="validation/m14/measurements/html-arm"
CENSUS_DIR="validation/m14/measurements/html-census"
POP=2000
OFFSETS="0 2000 4000 6000 8000"
TOKEN="script/m14/arm-token.sh"
EXTS="html,htm,xhtml,hbs,twig,pug,erb,mustache,ejs,liquid,njk,jinja,j2"

mkdir -p "$OUT_DIR" "$CENSUS_DIR"

run_chunk () {
  local off="$1"
  echo "=== CHUNK offset=$off ==="
  if ! bash "$TOKEN" take-small "$LANE" "$POP"; then
    echo "SMALL SLOT REFUSED for chunk $off — the chunk is NOT measured. Re-run this script."
    exit 3
  fi
  ( while true; do sleep 45; bash "$TOKEN" beat "$LANE" >/dev/null 2>&1 || true; done ) &
  local beat_pid=$!

  # ── THE CONSTRUCT CENSUS, OVER THIS CHUNK ──────────────────────────────────────────────────────
  # IT IS OPTIONAL, AND THE REASON IS THE SLOT. The census is a whole-population parse and the
  # small slot is ONE at a time fleet-wide, so spending a slot window on a measurement whose
  # console artifact already exists (validation/m14/measurements/html-extended-constructs-2026-10-22.txt,
  # which is what the spec's citations name) would cost the ARM a window it needs more. The
  # census is a COUNT over the whole population; the arm is the RESOLUTION CLOSURE, and the closure
  # is the deliverable that does not exist yet. ⇒ ARM-ONLY BY DEFAULT; `HTML_ARM_WITH_CENSUS=1`
  # re-enables the census in the same windows.
  local census_rc=0
  if [ "${HTML_ARM_WITH_CENSUS:-0}" = "1" ]; then
    BB_CORPUS_ROOT="${BB_CORPUS_ROOT:-$PWD/.corpus}" \
      bun run script/m14/html-extended-construct-probe.ts --offset="$off" --limit="$POP" \
        --json "$CENSUS_DIR/chunk-$off.json" \
      > "$CENSUS_DIR/chunk-$off.txt" 2>&1
    census_rc=$?
  fi

  # ── THE RESOLUTION ARM, OVER THE SAME CHUNK ──────────────────────────────────────────────────
  BB_CORPUS_ROOT="${BB_CORPUS_ROOT:-$PWD/.corpus}" \
    bun run script/m14/incoming-gate.ts html "$EXTS" "$POP" --index --offset="$off" \
    > "$OUT_DIR/chunk-$off.txt" 2>&1
  local arm_rc=$?

  kill "$beat_pid" >/dev/null 2>&1 || true
  bash "$TOKEN" release "$LANE" >/dev/null 2>&1 || true
  echo "--- chunk $off: census exit=$census_rc · arm exit=$arm_rc"
  echo "    census: $CENSUS_DIR/chunk-$off.json  ·  arm: $OUT_DIR/chunk-$off.txt"
  if [ "$census_rc" -ne 0 ] || { [ "$arm_rc" -ne 0 ] && [ "$arm_rc" -ne 1 ]; }; then
    echo "chunk $off FAILED (census=$census_rc arm=$arm_rc) — stopping; the remaining chunks were NOT measured."
    exit 1
  fi
}

for off in $OFFSETS; do
  run_chunk "$off"
done

echo "ALL FIVE CHUNKS MEASURED."
echo "  census: $CENSUS_DIR/chunk-{0,2000,4000,6000,8000}.json  →  script/m14/html-census-merge.ts"
echo "  arm:    $OUT_DIR/chunk-{0,2000,4000,6000,8000}.txt    →  script/m14/html-arm-merge.ts"
