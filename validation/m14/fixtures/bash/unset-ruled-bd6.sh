#!/usr/bin/env bash
# BD6 / BA-G1: `unset` is RULED as unemittable — no relationship type in the
# ontology expresses unbinding a binding. The fixture FORBIDS any relationship
# naming the unset target at the unset line, so a future "helpful" edge fails
# rather than slips in.

TEMPORARY=/tmp/scratch
echo "$TEMPORARY"
unset TEMPORARY
