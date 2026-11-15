#!/usr/bin/env bash
# BD10: isFunctionCall and isExternalCommand are mutually exclusive facts, and
# the answer does not depend on where the definition sits. The pre-wave emitter
# set BOTH flags true on every call, so a call to a function defined in the same
# file claimed to be an external binary.
#
# `forward` is CALLED on line 12 and DEFINED on line 20 — the normal shape of a
# shell script, and the case a pre-order walk gets wrong: it reaches the command
# before the declaration, so deciding from what the walk has seen so far makes
# the flag a function of layout rather than of meaning.

helper() {
  echo helper
}

forward
helper
grep -q x file
alias ll='ls -la'
ll

forward() {
  echo forward
}
