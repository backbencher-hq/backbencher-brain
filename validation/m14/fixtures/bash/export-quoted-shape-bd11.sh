#!/usr/bin/env bash
# BD11: `export "NAME=value"` is ONE node, and the extractor read only the other shape.
#
# The grammar hands `export NAME=value` to the extractor as a `variable_assignment` child with
# a `variable_name` inside it. It hands `export "NAME=value"` as a SINGLE `string` node with no
# `variable_assignment` and no `variable_name` anywhere beneath it — so the quoted form produced
# no symbol and no `exports` edge at all: silent, not merely mis-attributed. MEASURED on the
# pinned corpus before the fix (`probe-bash-silent-types.mts`): 7 export sites in 6 files, of
# which 2 are this shape (`completions-fallback/pipenv.bash:12`, `completions-fallback/jungle.bash:13`).
#
# This file pins BOTH directions. A static name must emit; a COMPUTED name must NOT, because a
# name assembled from an expansion (`_${ucname}_COMPLETE`) is not a name the graph can answer,
# and `exports -> _${ucname}_COMPLETE` would be the fabrication BD4 refuses for a computed
# command word. The read of `ucname` survives as `uses`, so the dependency is not lost.

# static quoted assignment: emit
export "QUOTED_STATIC=value"

# quoted BARE name, no `=`: also a site, because bash quote-removes it and exports the name
export "QUOTED_BARE"

# the plain unquoted control — the two shapes are not mutually exclusive
export PLAIN_UNQUOTED=1

# computed name: the expansion decides the NAME, so no `exports` edge may exist for it
ucname=pipenv
export "_${ucname}_COMPLETE=bash_source"
