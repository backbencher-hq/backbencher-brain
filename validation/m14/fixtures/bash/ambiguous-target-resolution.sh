#!/usr/bin/env bash
# Ambiguous target resolution: one edge, N declarations, and WHICH one it means.
#
# The incoming-edge instruction is explicit that this is the lane's problem and
# not the traversal code's:
#
#   "A TARGET THAT RESOLVES TO MORE THAN ONE PUBLISHED SYMBOL. The reverse walk
#    picks one by a rule nobody chose... An ambiguous target is ONE edge
#    attributed to ONE declaration. Counting it as N is how a name collision
#    becomes a wrong refactor."
#
# Measured on the 400-file hash-order sample (probe-bash-ambiguity.mts):
# 1,879 edges across five types name a target more than one published symbol
# answers to. 100% of those candidate sets sit on DISTINCT startLines, so no
# consumer is forced to choose between two declarations on the same row.
#
# `contains`, `exports` and `overrides` were already disambiguated before this
# file existed: all three put the DECLARATION's line on the edge. `uses` and
# `calls` put the USE SITE's line there, which is a different line, so the
# declaration was unrecoverable from the row. This fixture pins the fix.

# ---- the shape: one name, one declaration per function, read in each ----

# Module-scope declaration first, so a rule that ignores scope has a WRONG
# answer available to it. `read_scope` must resolve to the file-level one even
# though it is declared later in the file, because scope beats position.
SHARED=value_at_module_scope

read_scope() {
  SHARED=value_in_read_scope
  echo "$SHARED"
}

# Same name, different function. `read_other` must NOT resolve to
# `read_scope`'s declaration, and the row proves it by carrying line 10.
read_other() {
  SHARED=value_in_read_other
  echo "$SHARED"
}

# A use BEFORE any declaration of the name in its own scope. The analyzer
# publishes nothing rather than pointing at a declaration that does not exist yet
# at that point in the file — `uses` to SHARED here must carry no targetLine.
read_early() {
  echo "$SHARED"
  SHARED=value_assigned_after_the_read
}

# ---- a name that is NOT ambiguous must grow no metadata at all ----
#
# The absence is the assertion. `targetLine` is published only when more than one
# declaration of the name exists in the file, so a unique name carries no
# `targetLine` and no `targetResolution`. An implementation that published the
# key unconditionally would pass every other row here and is measured at 15.2%
# of `uses` edges paying for information they do not have.
UNIQUE_ONLY_DECLARATION=1
echo "$UNIQUE_ONLY_DECLARATION"

# ---- the kind is the PUBLISHED kind, and that is a constraint on it ----
#
# `targetKind` mirrors the kind of the symbol the edge resolves to, so a consumer
# joining on (name, line, kind) cannot miss. That means it can only ever be a kind
# the graph HAS: `declare -a SHAPES=()` publishes a `variable`, not an array, and
# the array/scalar fact travels on the symbol's `isArray` metadata instead. An
# earlier draft of this file asserted an `array` targetKind and it was wrong — a
# value the index has no kind for is a join that finds nothing, which is worse than
# saying `variable` and leaving isArray to the symbol.
declare -a SHAPES=()
first() { SHAPES=(a b); echo "${SHAPES[@]}"; }
second() { SHAPES=(c); echo "${SHAPES[@]}"; }

echo "$UNIQUE_ONLY_DECLARATION $SHAPES"
# ---- the branch that DECLINES, which is the one that must exist ----
#
# `gamma` reads a name that two OTHER functions declare and neither the file nor
# gamma itself does. There is no correct single declaration to name, so the edge
# publishes targetResolution and NO line. Publishing the nearest of the two would
# be precisely the invented attribution the whole mechanism exists to prevent —
# and it is the failure mode the other two mutants cannot produce, because they
# lose resolution rather than fabricate it.
alpha() { LATE_DECLARED=1; }
beta()  { LATE_DECLARED=2; }
gamma() { echo "$LATE_DECLARED"; }

# Two declarations in the SAME scope cannot happen — a second assignment is a
# reassignment, not a declaration — so the tie case the corpus measurement found
# (49 of 1,879 edges) can only arise between scopes. This is the one shape that
# does put two candidates at the same nearest line: a function and the file both
# declaring the name, and a use in a THIRD function... which resolves by scope, not
# by tie. Stated here because the fixture cannot manufacture it and the doc must
# not imply it was asserted.
