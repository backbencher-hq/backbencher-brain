#!/usr/bin/env bash
# BD-gap-closure: `array` is read structurally. The pre-wave extractAssignment
# took an isArray parameter that its only caller passed as `false`, so
# metadata.isArray was constant-false on every plain assignment.

declare -a DECK=(alpha beta)
DECK2=(one two)
SCALAR=plain
