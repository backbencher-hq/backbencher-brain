#!/bin/bash
# A FUNCTION WHOSE NAME THE GRAMMAR SWALLOWED — `*)usage; exit 1 ;;`, four case
# arms, and a trailing command.
#
# ## The finding
#
# `functionName` (real-bash-analyzer.ts:1424) reads the grammar's own `name:`
# field first and returns `named.text` if it is non-empty. It has no condition on
# WHERE that field resolves. Limitation 33 of docs/analyzers/real-bash-analyzer.md
# asserted "a damaged region publishes no declaration" — which invites a guard
# dropping a function whose name sits anywhere near a damaged region.
#
# Measured whole corpus (`probe-bash-error-name-field.mts`, 4,133 admitted /
# 462,809 scanned / 120 repos):
#
#   function_definition nodes                6,773
#   `name:` field resolved                   6,773  (100%, always a `word`)
#   name node inside an ERROR span             427  (6.3% of definitions)
#     ERROR span starts BEFORE the definition   421  the definition is INTACT
#     ERROR span starts AT the definition          6  the definition is DAMAGED
#   published by production `parseFile`         427/427
#
# All 427 are REAL declarations. This file is the PLAIN-BASH instance of the
# population, taken from hledger/docker/run.sh:4 — 619 bytes, the third smallest
# of the 73 files carrying a site, and the only one that is bash rather than zsh.
# `function usage()` is declared in section 3 and CALLED from the case arm there,
# so the declaration is load-bearing: refusing it drops a function the file
# genuinely needs.
#
# ## WHAT IS ACTUALLY MEASURED ON THIS FILE, precisely
#
# The whole tail is ONE tree-sitter ERROR node spanning rows 76-129, and all four
# functions in this file sit inside it:
#
#   untouched_one   @76   name inside the ERROR span   PUBLISHED
#   untouched_two   @80   name inside the ERROR span   PUBLISHED
#   spaced_usage    @89   name inside the ERROR span   PUBLISHED
#   usage          @106   name inside the ERROR span   PUBLISHED
#
# So the demonstration is stronger than "a declaration survives a damaged
# region": FOUR real declarations come out of ONE damaged region, and production
# `parseFile` publishes all four. The guard limitation 33 invites would delete all
# four here and 427 corpus-wide.
#
# ## The cause is ONE BYTE — measured in ISOLATION, not in this file
#
# The trigger is the case arm written `*)usage; exit 1 ;;` with no space after
# the `*`. Verified against the pinned wasm on the construct ALONE:
#
#   case "$1" in ... *)usage; exit 1 ;; esac      ERROR node, name in its span
#   case "$1" in ... *) usage; exit 1 ;; esac     NO ERROR node
#
# That control is a probe measurement rather than a section of this file,
# because inside this file the ERROR span runs from row 76 to row 129 — it starts
# before section 2 and so encloses the spaced form too, which means an in-file
# "spaced" section cannot serve as the control. Saying so is the point: the
# finding is about the grammar's recovery, and the recovery's extent depends on
# the whole file.
#
# ## Provenance, and the limits of the reduction
#
# The trigger is unstable under reduction and this file does not pretend
# otherwise. Measured on the pinned wasm: three preceding arms do not span; four
# arms plus a trailing command do; five arms do. Dropping ANY trailing line from
# the 29-line corpus original stops the span forming. So section 3 is the corpus
# construct essentially VERBATIM rather than a hand-minimised reduction, because
# shorter forms do not reproduce the condition. That is a real limitation: this
# file pins the behaviour on THIS pinned grammar, and a future wasm that recovers
# better would make it vacuous rather than wrong. The corpus measurement in
# `probe-bash-error-name-field.mts` is the instrument that does not depend on the
# recovery continuing to behave this way.
#
# ## The mutant this exists to catch
#
# `bash/function-name-refused-in-damaged-file` (validation/m14/fixtures/bash/
# mutants-bash-lane.mts) is that guard: it drops any function whose name node has
# an ERROR ancestor. An earlier version of this fixture could NOT catch it —
# SURVIVED, 40/41 — because it built the condition from zsh
# `(( ${+commands[...]} ))` constructs with content after them, and that
# combination does not swallow a name.
#
# Pinned expectation, measured: production `parseFile` publishes 4 functions and
# 7 variables; 21 relationships (uses 6, calls 5, contains 10).

# ------------------------------------------------- 1. controls, before any damage
function untouched_one() {
  echo "one"
}

function untouched_two() {
  echo "two"
}

# ------------------------------------------------- 2. the spaced control
# The same shape as section 3 with ONE SPACE added after `*)`. Measured: no ERROR
# node here, so `spaced_usage`'s name is outside any span while `usage`'s is
# inside one. If a future grammar stops damaging section 3, this section is what
# shows the difference was the byte and not the declaration.
function spaced_usage() {
  echo "spaced"
}

cmd2="$1"
shift

case "$cmd2" in
    web) extra_args=""  ;;
    bash) extra_args="bash" ;;
    hledger) extra_args="hledger" ;;
    *) spaced_usage ;;
esac

# ------------------------------------------------- 3. the corpus shape, LAST
set -e -o pipefail

function usage() {
    echo "USAGE: $0 /path/to/journal [web|bash|hledger]"
}

journal=$(readlink -f "$1")
shift
[ -f "$journal" ] || { usage; exit 1; }
dir=$(dirname $journal)
file=$(basename $journal)

cmd="$1"
shift

case "$cmd" in
    web) extra_args=""  ;;
    bash) extra_args="bash" ;;
    hledger) extra_args="hledger" ;;
    *)usage; exit 1 ;;
esac

untouched_one
untouched_two
spaced_usage
docker container run --rm -it --volume "$dir:/data" hledger "$@"