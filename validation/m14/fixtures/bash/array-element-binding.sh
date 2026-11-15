#!/usr/bin/env bash
# BD-array-element-binding: `name[index]=value` is a BINDING of `name`.
#
# `arr[i]=v` creates the array when it does not exist, so it declares `arr` in
# exactly the class the analyzer already recognises for `NAME=value`, a `for`
# loop variable and a `read` target. The grammar holds that LHS one level deeper
# than the bare case — `variable_assignment > subscript > variable_name` — so the
# declaration handler, which read a DIRECT `variable_name` child, dropped it. The
# file published no symbol, every read of the name had nothing to resolve
# against, and BD11 classified those reads as environment-supplied.
#
# Measured on the 400-file hash-order sample: 19 such sites in 15 files, 16
# distinct (file, owner, name) pairs, 5 of them unpublished.
# (probe-bash-array-element-binding.mts)

# 1. The whole defect in three lines. The read at line 18 names a declaration this
#    file makes at line 19, and before the fix this file published NO symbol for
#    it and that read carried no `isAssignedInFile`.
echo "count so far: ${NEVER_DECLARED[0]-none}"
NEVER_DECLARED[0]="created by element assignment"
echo "after: ${NEVER_DECLARED[0]}"

# 2. A module-scope array built ONLY by element assignment.
declare -a TOP_LEVEL
TOP_LEVEL[first]="one"
TOP_LEVEL[second]="two"
echo "top level: ${TOP_LEVEL[first]} ${TOP_LEVEL[second]}"

# 3. The scope contrast, and it is the half that was invisible: the file already
#    publishes COMPREPLY at module scope, so a name-only dedup key reads the
#    function-scoped binding below as already published. `extractAssignment`
#    keys on `${owner}\u0000${name}`, so these are TWO declarations of one name.
COMPREPLY=(alpha beta)
rewrite_completion() {
  local i
  for ((i = 0; i < ${#COMPREPLY[@]}; i++)); do
    COMPREPLY[i]=${COMPREPLY[i]#alpha-}
  done
  echo "${COMPREPLY[@]}"
}

# 4. The same construct as a `local`, so the array is function-scoped and never
#    exists at module scope at all.
declare_local_array() {
  local -a scoped
  scoped[0]="only here"
  echo "${scoped[0]}"
}

# 5. A bare assignment of the same name, which must NOT publish a second symbol:
#    `declaredSymbols` already holds it, exactly as a repeated `X=1` adds nothing.
NEVER_DECLARED[1]="second element"
NEVER_DECLARED="now a plain assignment, same owner, already declared"

rewrite_completion
declare_local_array