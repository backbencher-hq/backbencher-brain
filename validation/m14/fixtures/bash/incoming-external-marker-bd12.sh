#!/usr/bin/env bash
# BD12: the incoming-side marker, and the NARROW evidence it is allowed to rest on.
#
# `script/m14/incoming-rule.ts` treats an external target as a declared exception rather than a
# defect — but only when the lane MARKS it, and the marker is a claim the corpus checks. This
# file pins both directions, because the interesting half is what must NOT be marked.
#
# A FIRST, WIDER RULE WAS MEASURED AND WITHDRAWN. It marked every call in a file with no
# `source`/`.` and no `eval`, arguing bash could then only resolve the name through PATH. On the
# gate's own population it marked 435 edges and 82 of them named a `function_definition` the same
# repository declares (62 were `kube::test::get_object_assert` in kubernetes) — a library file
# that sources nothing may itself be sourced by a file that has already defined the name. A
# marker wrong 18.9% of the time makes the number it removes meaningless.

# PATH-INVOKED: a shell function name cannot contain `/`, so this names a FILE, never a project
# declaration. MARKED.
/bin/expr 1 + 1

# PATH-INVOKED, relative. MARKED for the same reason: it is a path, not a function name.
./helper.sh --run

# UNQUALIFIED. `grep` is obviously a program, and this is exactly the claim that was withdrawn:
# a single-file analyzer cannot know whether some file of the project defines `grep` as a
# function, so the edge stays unresolved rather than being relabelled on a guess. NOT MARKED.
grep -q foo file.txt

# UNQUALIFIED for the same reason. NOT MARKED.
sed -n 1p file.txt

# A call to a function this file defines. NOT MARKED — it is a local call.
helper() {
  :
}
helper
