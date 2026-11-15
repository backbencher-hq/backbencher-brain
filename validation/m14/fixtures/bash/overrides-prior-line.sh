#!/usr/bin/env bash
# Round 17: `overridesLine` must name the declaration IN EFFECT, not the first one.
#
# `redefinition-overrides.sh` declares `greet` TWICE. For two declarations the first
# and the immediately-prior are the same row, so that fixture cannot tell the two
# readings apart — which is why the defect survived it. This file declares `f` FOUR
# times, where the two readings diverge on the third declaration and every one after.
#
# The defect: the analyzer recorded the FIRST declaration of a name and published it
# as `overridesLine`. A redefinition does not displace the first declaration it
# happens to be preceded by — it displaces the definition the running shell would
# have called, which is the most recent one before it. So on this file the first-
# declaration reading publishes 8 and 4 for the third and fourth `f`, and a consumer
# that trusts the key draws an `overrides` edge to a row the definition never
# replaced. The line is a real declaration either way, which is what makes the error
# silent: nothing about the edge looks malformed.
#
# Measured on the 600-file corpus sample with the first-declaration behaviour: all 30
# ambiguous `overrides` edges resolved `overridesLine` to a real declaration of the
# name, and only 9 were the immediately-prior one. The other 21 named an earlier one.
# `probe-bash-contains-overrides-ceiling.mts` is the instrument.

f() {
  echo one
}

f() {
  echo two
}

# The third declaration is where the two readings diverge: the immediately-prior
# declaration is the SECOND one, not the first.
f() {
  echo three
}

# And the fourth, which the first-declaration reading answers identically to the
# third — so both wrong rows name the same row and a two-row fixture cannot catch
# the difference.
f() {
  echo four
}

# Declared twice and never three times: for this name first == prior, so it is the
# CONTROL. Its edge must name the first declaration, and this is the row that would
# be lost if "prior" were implemented as "the latest declaration overall" — the
# mistake in the opposite direction, which a chain-only fixture cannot catch.
g() {
  echo g-one
}

g() {
  echo g-two
}

# A `function`-keyword declaration and a `name()` declaration share one name, so the
# two spellings must not be tracked separately. `h` is declared once each way.
h() {
  echo h-plain
}

function h() {
  echo h-keyword
}

f
g
h
