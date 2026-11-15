#!/usr/bin/env bash
# A command name that also names something local: the edge is correct and the
# consumer's candidate set is wrong.
#
# Found by taking apart the 5 `calls` edges a whole-corpus pass left bare
# ambiguous — several published declarations, nothing published to choose between
# them (validation/m14/fixtures/bash/probe-bash-published-resolvability.mts
# --all, 4185 files / 127 repos, production parseFile). Two of the five were
#
#   ohmyzsh/plugins/pip/pip.plugin.zsh:107  pipupall -[calls]-> xargs
#   ohmyzsh/plugins/pip/pip.plugin.zsh:115  pipunall -[calls]-> xargs
#     ... against  variable@106  variable@114
#
# and the comment on the branch that skipped them read "an external binary names
# nothing local". That is false for a name the file also declares. The `xargs`
# there is /usr/bin/xargs, so the EDGE is right; what was wrong was the silence,
# which left a consumer matching reverse edges by target to pick one of two
# variables by a rule nobody chose.
#
# So these edges gain `targetResolution: "commandNameIsExternal"` and
# `collidesWithLocalDeclaration: true`, and NO line. Command position resolves to
# a function or to a PATH lookup, never to a variable, so there is no
# declaration at the call line the call denotes; the fact a consumer needs is the
# KIND the name collides with, and the two fields together let it discard the
# variable candidates instead of choosing among them.

# ---- the corpus shape, minimal: one name, two variable declarations, two calls ----
#
# `local xargs=` twice is what makes the candidate set >1. Re-declaring is what
# a sourced script does when the same plugin is loaded along two paths, and it is
# the only reason a bare `xargs` is ambiguous here.
local xargs=
local xargs=

# Both of these RUN the binary. Neither denotes either `local` above.
xargs -n1 echo one
xargs -n1 echo two

# ---- one declaration is still a collision ----
#
# `single` in the measurement corpus: one local declaration leaves the candidate
# set at 1, so the edge was never in the ambiguous table and never appeared in a
# count of bare edges. It still needs the label, because a consumer that resolves
# by NAME across the file finds the variable, and a consumer resolving within the
# file must be told to discard it. Counting only the ambiguous ones would report
# this as free and it is not.
local ripgrep=
ripgrep --version

# ---- a name that is a FUNCTION takes the other path entirely ----
#
# `isFunctionCall` is true, so the edge is resolved against function declarations
# by bash's own rule (latest definition at or before the call) and the
# `commandNameIsExternal` label must NOT appear. A file can declare a name as
# both a variable and a function; the function wins in command position, and
# labelling the edge as external would be the wrong fact about the right edge.
greet() { echo "hello"; }
greet

# ---- no local declaration: nothing to collide with, so nothing is published ----
#
# The payload constraint. Every `calls` edge in this file and on the corpus must
# not grow keys. 56,217 `calls` edges at whole corpus: an implementation that
# published the collision on every external command would add two keys to the
# overwhelming majority of them to say what the edge's target already said.
curl -s https://example.com

# ---- a word from inside a damaged span is NOT a command name ----
#
# `local x=$( (` leaves an unbalanced command substitution; the grammar hands
# back the remainder and the next line's `key` becomes the command name of a
# `command` node that sits INSIDE an ERROR subtree. The same three edges at whole
# corpus are the residual this shape accounts for:
#
#   Paket/completion/paket-completion.zsh:1486          -[calls]-> key
#   kubernetes/cluster/gce/util.sh:3829                 -[calls]-> name
#   kubernetes/cluster/gce/util.sh:4057                 -[calls]-> name
#
# `key` IS declared locally, so the collision test would pass and the label would
# be published — telling a consumer that wreckage reaches an external binary. So
# the position flag `commandInErrorRecovery` is checked FIRST and the label is
# withheld. This is the only row in the file that can be right for the wrong
# reason without the flag, which is why both mutants below die on it.
#
# `local key` is declared BEFORE the damage on purpose: it is what gives `key` a
# local candidate, which is the precondition for the label being published at
# all. The declaration is a real declaration and the edge is wreckage, and the
# only thing separating those two facts is the position flag.
#
# ADJACENCY IS LOAD-BEARING and was measured to be. `local key` / `local x=$( (`
# / `key` with nothing between puts the `key` command node INSIDE the ERROR
# subtree, and the flag fires. Insert a blank line OR a comment between the
# damage and the command and the ERROR span closes: the flag goes false, the
# collision test passes on `key`'s local variable, and the edge is published as
# `commandNameIsExternal` — which is the FALSE claim this flag exists to prevent.
# The measurement is in the note on the `forbidRelationships` row for `key`.
local key
local x=$( (
key
