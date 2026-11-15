#!/usr/bin/env bash
# `uses` edges must say whether THIS FILE binds the read name as a variable.
#
# The gap this closes was measured, not guessed. On the pinned corpus
# (600 `*.sh` files, path order, production parseFile, digest 6d5542aa6d6640e2)
# 490 `uses` edges reach a name no file in the window declares, and a whole-corpus
# pass over 3,748 tracked bash files found a real declaration for 101 of them.
# Those 101 are NOT external — they read a variable a sourced file assigns — so
# `isExternal` would be a false claim. What is true and checkable is "no variable
# in this file binds it", and before this change the row said nothing at all,
# leaving a read that binds nothing indistinguishable from one that binds
# ambiguously.

# 1. A name this file NEVER declares: must be published as not bound here.
export BOUNDARY_FIXTURE_DECLARED="yes"
echo "reading ${BOUNDARY_FIXTURE_UNDECLARED} which this file never assigns"

# 2. A name this file DOES declare, once. Unambiguous, so no targetResolution is
#    published — but the binding fact is, and it must be true.
BOUNDARY_FIXTURE_SINGLE="one"
echo "reading ${BOUNDARY_FIXTURE_SINGLE}"

# 3. A name this file declares TWICE, so `resolveDeclaration` engages and the two
#    published facts must not contradict each other: bound in this file, and the
#    outermost declaration is the one in effect at the read.
BOUNDARY_FIXTURE_TWICE="outer"
function boundary_fixture_reader() {
    local BOUNDARY_FIXTURE_TWICE="inner"
    echo "reading ${BOUNDARY_FIXTURE_TWICE} from inside the function"
}
boundary_fixture_reader

# 4. The counter-case for the field NAME. This file declares the name as a FUNCTION
#    and never as a variable, so a read of it finds no VARIABLE binding — which is
#    exactly what `variableDeclaredInFile: false` asserts, and why the field must not
#    be called "declaredInFile". Bash cannot reach a function through `$name`.
boundary_fixture_only_a_function() {
    echo "this is the function body, not a variable"
}
echo "reading ${BOUNDARY_FIXTURE_ONLY_A_FUNCTION} which is declared only as a function"