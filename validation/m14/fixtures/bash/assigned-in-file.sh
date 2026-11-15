#!/usr/bin/env bash
# BD-assigned-in-file: does a read name get ASSIGNED anywhere in this file?
#
# The field is emitted on TRUE only, so absence means false. This fixture pins
# BOTH directions, because a field that is only ever tested when present proves
# nothing about the case a consumer actually hits most often: a name that is not
# ours at all.

# assigned at module scope, then read INSIDE a function. This is the case the
# field exists for: the read's owner is the function, so a lookup keyed on the
# read's own scope cannot see a module-level assignment.
PORT=8080
configure_port() {
  echo "using $PORT"
}

# assigned as a function PARAMETER
greet() {
  local who="$1"
  echo "hi $who"
}

# assigned nowhere in this file, and not a shell-defined name either
echo "cache lives at $CACHE_ROOT"
echo "current user is $CURRENT_USER"

# a module-scope assignment read from the top level
BASE_DIR="/opt/app"
echo "base is $BASE_DIR"

configure_port
greet world
