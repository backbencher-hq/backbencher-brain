#!/usr/bin/env bash
# BD-shell-defined-vars: a read of a name the shell itself defines is still a
# read, but it is labelled so a consumer can tell it from a project variable.
# The pre-wave target list was unreadable because 23 edges to BASH_SOURCE looked
# like undeclared project variables.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "script is at $here"
echo "user is $UID, shell is $SHELL"
