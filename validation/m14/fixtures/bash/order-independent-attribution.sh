#!/usr/bin/env bash
# Order-independent attribution: an edge's target must be resolved against the
# WHOLE file, not against the part of the file the walk had reached.
#
# `resolveDeclaration` asks "is this name declared more than once in this file?",
# and that question was being asked from inside the walk that emits the edges.
# `declSites` is filled by `noteDeclaration` at the same traversal, so a `uses`
# edge was compared only with the declarations the walk had ALREADY passed. The
# published answer therefore depended on where in the file the read sat, which is
# not a property of the name:
#
#   measured over all 4,130 admitted files — 4,220 `uses` edges in 400 files
#   named a target with two or more declarations in their own file and published
#   NO `targetResolution`, every one of them because of that ordering.
#
# For a consumer those rows are indistinguishable from a name that really is
# unique in the file, and that is the whole defect: "this name is declared once"
# and "the analyzer had not got to the other declaration yet" publish the same
# row. The fix re-asks the question against the finished index, with the SAME
# function, so there is one rule and not two.
#
# Both directions are asserted below, because a fix that simply started
# publishing `ambiguousInFile` everywhere would pass the first block and fail the
# second. The second block is the one that costs the edge its LINE.

# ---- declined: the read precedes every declaration of the name ----
#
# ORDER_MATTERS is declared twice, in two later functions. Neither the reading
# function nor the file declares it, so there is no single correct declaration
# and the edge must publish the refusal and no line.
probe_before_any_declaration() {
  echo "$ORDER_MATTERS"
}

declares_first() { ORDER_MATTERS=1; }
declares_second() { ORDER_MATTERS=2; }

# ---- resolved: the read is early, its own scope already declared it ----
#
# The declaration in the reading scope is at or before the read, so this one IS
# resolvable and must carry that line — even though the second declaration sits
# further down the file and was not yet in the index when the edge was emitted.
declares_in_own_scope_first() {
  OWN_EARLY=1
  echo "$OWN_EARLY"
}

declares_the_same_name_later() { OWN_EARLY=2; }

# ---- the absence is still an absence ----
#
# DECLARED_ONCE has one declaration in this file, so its `uses` edge must carry
# no target metadata at all, in either pass. The second pass re-asks the
# question for EVERY unattributed `uses` edge, so this row is what stops that
# from becoming "attach the keys to everything".
DECLARED_ONCE=1
echo "$DECLARED_ONCE"