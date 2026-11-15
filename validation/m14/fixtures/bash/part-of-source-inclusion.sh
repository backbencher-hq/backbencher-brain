#!/usr/bin/env bash
# BD16 — `source`/`.` is TEXTUAL INCLUSION into the CALLING shell's scope, so
# its relationship is `part_of`, not `imports`. The sourced file's text runs in
# this shell; its functions and variables ARE this file's; it shares the
# library's single scope, which is the `part_of` contract.
#
# The TARGET is the part's MODULE SYMBOL, never the path: the arbiter resolves
# target strings against SYMBOL NAMES and has no space for a filesystem path,
# where a path target measured 100% unresolved on 4,612 rows in the cpp lane.
# The written path is evidence and lives in `metadata.partPath`.
#
# The IMPOSTORS, forbidden below:
#   * `bash x.sh` / `sh x.sh` EXECUTE a file in a new process — never an inclusion;
#   * an inclusion inside `( … )` or `$( … )` runs in a FORKED shell, so the
#     included text never joins THIS file's scope;
#   * a path whose last segment is an expression (`source "$lib"`) names no part.

scriptroot=/opt/tools

source ./lib/helpers.sh
source "$scriptroot/helper.sh"
. ./lib/tools.sh
. "$(dirname "$0")"/next-to-me.sh

shell_scope_function() {
  source ./lib/inside-fn.sh
}

# IMPOSTOR 1: child-process EXECUTION of a file — a call, never an inclusion.
bash ./lib/child.sh
sh ./lib/child.sh

# IMPOSTOR 2: an inclusion inside a CHILD-PROCESS boundary.
( source ./lib/in-subshell.sh )
echo "$(source ./lib/in-cmdsub.sh; echo hi)"

# IMPOSTOR 3: the last path segment is an EXPRESSION.
source "$lib"
