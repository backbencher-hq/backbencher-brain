#!/usr/bin/env bash
# BD11-assigned-flag-is-file-level: the flag answers a QUESTION ABOUT THE FILE,
# so it cannot depend on where the read sits in it.
#
# The published contract, quoted from docs/analyzers/real-bash-analyzer.md:
# "metadata.isAssignedInFile is set when the file assigns the name UNDER ANY OWNER".
# Nothing in that sentence mentions position, and nothing in the field's NAME
# mentions position either — it is not `isAssignedBeforeThisLine`.
#
# The implementation evaluated it MID-WALK, against `declaredSymbols`, which the
# same walk fills. So the answer depended on how much of the file the walk had
# already passed, and the smallest possible demonstration is two lines:
#
#     echo "before: $LATE"      ->  uses -> LATE @1   ABSENT
#     LATE=1
#     echo "after: $LATE"       ->  uses -> LATE @3   TRUE
#
# One file, one name, one declaration, two answers. That is a self-contradiction
# inside a single parseFile result, so it needs no oracle to be a finding — and
# it is invisible to a differential, whose oracle never published the field.
#
# Measured over the 400-file hash-order sample: 37 (file, target) pairs in 25 files
# carried BOTH answers — 193 edges saying not-assigned against 184 saying assigned
# — and a further 15 pairs (50 edges) were declared after every read of the name,
# so no contradiction showed and they were wrong for the same reason. 243 of 7,856
# reads, 3.1%. (probe-bash-assigned-flag-order.mts)

# 1. The whole defect. `LATE` is assigned at line 31, so the read at line 30 and
#    the read at line 32 are the same question with the same answer.
echo "before: $LATE"
LATE=1
echo "after: $LATE"

# 2. The same shape across a scope boundary, which is the case the contract's
#    "under any owner" clause exists for. The assignment is at MODULE scope and
#    the read is inside a function declared ABOVE it, so the read's own scope
#    holds no declaration of the name at all.
reads_module_late() {
  echo "from inside the function: $LATE"
}

# 3. Read-before-declaration where the name is bound by a construct OTHER than an
#    assignment, so the cross-scope suffix index is what answers it. `read`'s
#    target is a binding site published by extractImplicitBinding.
reads_implicit() {
  echo "implicit: $IMPLICIT_TARGET"
}
read -r IMPLICIT_TARGET

# 4. Two declarations of one name in two scopes, with the reads straddling them.
#    The read above the function-local one must still be flagged — BD11 does not
#    ask whether the name is bound YET, and the targetResolution keys on the edge
#    are what carry "which declaration, and is it after this line".
outer_shadow() {
  echo "outer: $SHADOWED"
}
inner_shadow() {
  local SHADOWED="function local"
  echo "inner: $SHADOWED"
}
outer_shadow
inner_shadow

# 5. The NEGATIVE direction, pinned here as well as in bash/assigned-in-file, so
#    this fixture cannot be satisfied by an analyzer that emits the field
#    unconditionally. Nothing in this file assigns these two.
echo "environment supplies $FROM_THE_ENVIRONMENT"
echo "and $ALSO_FROM_THE_ENVIRONMENT"

reads_module_late
reads_implicit