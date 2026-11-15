#!/usr/bin/env bash
# BD8b: redefining a function IS an override, and the lane omitted the type.
#
# Bash has no classes, no interfaces and no inheritance, so `overrides` has no
# superclass to point at — which is how this type came to be ruled inapplicable
# along with `extends`, `implements` and `instantiates`. That ruling was WRONG for
# this one: a second declaration of a function replaces the first, which is an
# override in the only sense the language has one. The differential could not find
# it because the oracle omitted `overrides` too, and two implementations that both
# say nothing agree perfectly; the ontology-coverage gate found it by measuring the
# language instead of diffing the code. Measured: 57 redefinitions across 38 of
# 2,747 admitted files.

greet() {
  echo "hello"
}

# defined ONCE — the control. No `overrides` edge may exist for this name, and the
# absent direction is asserted explicitly so the contract cannot be satisfied by an
# analyzer that emits the edge unconditionally.
only_once() {
  echo "single"
}

# defined a SECOND time: this declaration replaces the one above.
greet() {
  echo "hi"
}

greet
only_once
