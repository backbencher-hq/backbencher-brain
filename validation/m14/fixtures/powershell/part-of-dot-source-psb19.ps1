# part-of-dot-source-psb19.ps1 — THE DOT-SOURCE IS AN INCLUSION, AND ITS TWO NEAR MISSES.
#
# A dot-source (`.`) runs the named script in the CALLER's scope: the sourced file's
# functions and variables land in this session state, so the file becomes PART of this
# unit. That is `part_of` (the contract's positive test).
#
# The CALL operator (`&`) runs the same kind of file in a CHILD scope of its own — a
# call, not an inclusion — and `Import-Module` loads a module into its OWN scope, which
# is an import. The fixture pins all three apart: a relabel that widens to `&` or to
# `Import-Module` fails the forbid rows below.

. ./lib.ps1
. .\modules\Wdu.psm1
. "$PSScriptRoot\tools\start.ps1"

& ./run.ps1

Import-Module ./helpers.psm1
