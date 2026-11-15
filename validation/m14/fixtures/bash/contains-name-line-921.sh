#!/usr/bin/env bash
# BD1 / M60 #921: a contains edge names the line the CHILD'S NAME is written on.
# The store resolves a containment edge by exactly that line, so an edge carrying
# the declaration node's start line resolves to the wrong row when a declaration
# wraps. Here the assignment's own name is on line 6 and its value on line 7.

WRAPPED_NAME="first" \
  && echo "$WRAPPED_NAME"
