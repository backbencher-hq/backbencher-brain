#!/usr/bin/env bash
# THE STRADDLE CONTROL — MEASURED, NOT BOUNDED.
#
# ★ WHAT THIS IS FOR. The arm was run in five disjoint slices of the sorted admitted list, and the
#   resolution scope is PER PROJECT. A repository longer than one slice STRADDLES a slice boundary,
#   so the half that is not in the slice cannot see the collisions in the other half — and a name
#   that would be ambiguous reads UNIQUE, so the edge RESOLVES. The gate says so in its own
#   population line, in every chunk: "A stride sample truncates each project's symbol table too, so
#   its project-scoped RESOLVED share is biased UP — a name whose collision lives in an unsampled
#   file of the same repository reads unique here." ⇒ THE CHUNK SUM'S `resolved` IS BIASED UPWARD.
#
# ★ WHY A CONTROL AND NOT A BOUND. A bias whose size nobody measured is a bias nobody can reason
#   about. ⇒ ONE REPOSITORY IS MEASURED THREE WAYS ON THE SAME SMALL SLOT: WHOLE (one call, its
#   full admitted set in one project scope), SPLIT (two calls, the same files in two project
#   scopes), and the two are compared per type. The DIFFERENCE is the straddle effect, measured on
#   a real repository of the admitted population.
#
# THE REPOSITORY. `vault` — 825 admitted files, and the admitted list is sorted by ABSOLUTE PATH, so
# vault's files are CONTIGUOUS and they SPAN the [7402, 8226) window, which the five-slice arm cut
# at 8000 ⇒ vault is one of the repositories the arm actually split.
#
# ALL THREE CALLS FIT THE SMALL SLOT (≤2,000 files per call): 825, 412 and 413.
set -u
LANE=html
TOKEN="script/m14/arm-token.sh"
# ★ THE ADMITTED SPELLINGS COME FROM THE ROUTER'S ONE TABLE, AND THIS SCRIPT KEEPS NO COPY OF
#   THEM. The table is script/m14/language-extensions.ts (it MOVED there on 2026-10-22, because the
#   heritage probe carried its own map, had no `cpp` entry, and measured an EMPTY POPULATION and
#   printed a clean-looking zero over it). ⇒ A LIST COPIED INTO A SHELL SCRIPT IS A LIST THAT WILL
#   DIVERGE, and the arm's population is the fleet's population for this lane: it must be the
#   router's, read.
EXTS="$(bun -e 'import { extensionsFor } from "./script/m14/language-extensions.ts"; console.log(extensionsFor("html").map((e) => e.replace(/^\./, "")).join(","))')"
if [ -z "$EXTS" ]; then echo "THE ROUTER'S TABLE GAVE NO SPELLINGS FOR html — the arm is NOT measured."; exit 3; fi
OUT_DIR="validation/m14/measurements/html-straddle"
REPO="${1:-vault}"
WHOLE=2000
HALF=412

mkdir -p "$OUT_DIR"

# THE SLOT IS TAKEN, NOT ASSUMED. The small slot is ONE at a time fleet-wide and other lanes are
# using it, so this script WAITS for it rather than failing on the first refusal — and it never
# uses `force`, because a lock that can be taken by force is a lock nobody can trust. The wait is
# bounded, and a bounded wait that expires leaves the control UNMEASURED and says so.
take_slot () {
  local waited=0
  while [ "$waited" -lt 10800 ]; do
    if bash "$TOKEN" take-small "$LANE" "$WHOLE" >/dev/null 2>&1; then
      echo "--- the small slot is held by this lane (waited ${waited}s)"
      return 0
    fi
    sleep 20
    waited=$((waited + 20))
  done
  return 1
}

run_one () {
  local tag="$1"; shift
  if ! take_slot; then
    echo "SMALL SLOT NOT AVAILABLE for $tag after 10800s — the control is NOT measured."; exit 3
  fi
  ( while true; do sleep 45; bash "$TOKEN" beat "$LANE" >/dev/null 2>&1 || true; done ) &
  local beat_pid=$!
  BB_CORPUS_ROOT="${BB_CORPUS_ROOT:-$PWD/.corpus}" \
    bun run script/m14/incoming-gate.ts html "$EXTS" "$@" > "$OUT_DIR/$REPO-$tag.txt" 2>&1
  local rc=$?
  kill "$beat_pid" >/dev/null 2>&1 || true
  bash "$TOKEN" release "$LANE" >/dev/null 2>&1 || true
  echo "--- $tag: exit=$rc → $OUT_DIR/$REPO-$tag.txt"
  [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ] || exit "$rc"
}

echo "=== THE STRADDLE CONTROL ON REPO '$REPO' ==="
run_one whole  "$WHOLE" --index --repo="$REPO"
run_one half-a "$HALF" --index --repo="$REPO" --offset=0
run_one half-b "$HALF" --index --repo="$REPO" --offset=$HALF

echo "=== comparing ==="
bun run script/m14/html-straddle-compare.ts "$REPO"
