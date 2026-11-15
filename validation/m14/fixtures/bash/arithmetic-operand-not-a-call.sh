#!/usr/bin/env bash
# M60 arithmetic-operand guard. An arithmetic expression is a NUMBER being read,
# not a program being run, so bash can never call what is inside `$(( ))`.
#
# The pinned grammar models `$(( ))` correctly in the ordinary position and
# misparses it in exactly two shapes. In both, the operand arrives as a `command`
# node whose `command_name` is a VARIABLE, and the analyzer was emitting a
# `calls` edge to it at confidence 1.0 with `evidenceClass: structural` — that
# is, presenting a misparse as a parse fact.
#
# Every shape below is a verbatim corpus line, named in the expectation file.
# The positive expectations matter as much as the forbids: they pin that a REAL
# command reached through the same `$(( ))` machinery keeps its edge, because a
# command substitution nested inside an arithmetic expansion really does run.

attempt=0
force_known_update=1

# kubernetes/cluster/validate-cluster.sh:138 — an arithmetic expansion as the
# default operand of a parameter expansion inside a string. The grammar reads
# `$(` plus a subshell where `$((` was meant, so `attempt` came back as a
# command_name. Emitted `calls -> attempt` at line 138 while `attempt` was a
# variable declared at line 82.
last_run="${last_run:-$((attempt + ADDITIONAL_ITERATIONS - 1))}"

# kubernetes/third_party/gimme/gimme:551 — an arithmetic command under `!`.
# Two nested `subshell` nodes where one `((` belongs. Emitted
# `calls -> force_known_update`, a variable this same file assigns twice.
! ((force_known_update)) && echo "already known"

# POSITIVE 1 — the ordinary position, which the grammar gets right and the
# analyzer already read as a variable read. Pinned so a widening guard shows up.
((attempt++))
echo "$attempt"

# POSITIVE 2 — a real command substitution nested INSIDE an arithmetic
# expansion. `wc` is genuinely executed here, so it must keep its `calls` edge.
# This is the case an over-broad "refuse everything under `$((`" guard deletes,
# and it is why the guard keys on the enclosing node's own text.
v=$(( $(wc -l < /dev/null) + 1 ))
echo "$v"

# POSITIVE 3 — a real command substitution, which opens `$(` and not `$((`.
rel_date=$(date +"%B %d, %Y")
echo "$rel_date"

# POSITIVE 4 — a real subshell. `( (` written with the space bash requires is a
# subshell, not an arithmetic command, and `mytool` there is a genuine call. This
# is the shape one key of the guard too high would swallow, because a subshell
# looks like a parenthesised command until the text is compared.
( mytool --in-subshell )
{ mytool --in-brace-group; }
if true; then mytool --in-if-branch; fi