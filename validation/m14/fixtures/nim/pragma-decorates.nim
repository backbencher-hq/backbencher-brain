# NIM decorates fixture — the pragma-TEMPLATE class at rung R3, pinned in BOTH directions.
#
# The census measured 294 pragma-use sites naming a DECLARED pragma template (48 distinct
# `template X() {.pragma.}` declarations in 20 files) over the whole 6,063-file admitted
# population — an APPLIED CALLABLE in a pragma position, which is the `decorates` contract
# (src/ast/types.ts:131-144). A compiler directive is NOT: `{.inline.}` tells the compiler how
# to treat the declaration and applies no callable, so it must never become a row.
#
# ONLY a declaration-owned pragma name resolving to a FILE-LOCAL pragma template emits
# `decorates`; a template imported from another file is out of a per-file analyzer's reach
# (the lane's standard per-file caveat, NIMD2).
#
# THE CONSTRUCT IS REAL AND THIS IS NOT A COMPILER-RUN CLAIM: the form is Nim's own custom-pragma
# spelling (`template myAttr() {.pragma.}`, the manual's example), and the corpus measures 48 such
# declarations in 20 files under nim/tests/pragmas/* and nimterop's api surfaces — the census
# artifact names every one of them with its file and line. No Nim toolchain is installed on this
# host, so this fixture does not claim `nim check`; it claims the construct exists in compiler-
# exercised source, which is measured.

template myMarker() {.pragma.}

proc decorated*() {.myMarker.} =
  1

proc directiveOnly*() {.inline.} =
  2
