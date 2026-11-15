#!/usr/bin/env bash
# BD9 — a `source`/`.` target is a PATH, reported as the shell will read it.
#
# The first version of this decision "improved" the lane by resolving a relative
# path against the sourcing file's own directory. That was WRONG, and the F5
# differential is what proved it: bash resolves a relative `source` against
# $PWD at RUN TIME, not against the script's location, so the rewrite turned
# `source ./eng/common/tools.sh` inside `eng/common/` into the nonexistent
# `eng/common/eng/common/tools.sh`. Three rows on the pinned corpus disagreed
# with the oracle because of it.
#
# What is pinned here:
#   * a literal path is reported AS WRITTEN, `./sibling.sh` and not
#     `fixtures/bash/sibling.sh`;
#   * a path built from a variable is reported as the path EXPRESSION and
#     LABELLED `resolution: "dynamic"`, never presented as a resolved file —
#     16 of the lane's 23 pre-wave import edges on the pinned corpus were of
#     this form, and dropping them instead would delete 70% of the import graph;
#   * a path whose quoting wraps only PART of the expression
#     (`"$(dirname "$0")"/lib.sh`) is de-quoted, because a filesystem path cannot
#     contain a quote character and the stray leading quote made the target
#     unmatchable. That shape was the last disagreement on the pinned corpus.

scriptroot=/opt/tools
source ./sibling.sh
source "$scriptroot/helper.sh"
. ./also-sibling.sh
. "$(dirname "$0")"/next-to-me.sh
