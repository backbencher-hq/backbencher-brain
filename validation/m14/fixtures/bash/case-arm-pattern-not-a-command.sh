#!/usr/bin/env bash
# M60 round-3 case-arm-pattern guard. A `case` arm's PATTERN is not a command,
# and the pinned grammar cannot close a `case` in the `!` position of an `if`, so
# the pattern arrives as a `command` whose `command_name` is the pattern word and
# whose child immediately after that name is an `ERROR` holding the arm's `)`.
#
# Pass 2 named four `calls` edges this region fabricates and DECLINED to close
# them, on the measurement that "every structural guard that would remove them
# costs more real calls than it saves" (guards B and E). That measurement was
# correct about B and E and wrong about the space they left: the guard keyed on
# the POSITION of the damage (immediately after `command_name`) rather than its
# mere presence costs 0 real calls on 400 and on 1,200 hash-ordered corpus files
# and removes 5 fabrications.
#
# Two of the five are not `calls` edges at all, and that is why the region was
# worth a sixth guard: the `source` arm's PATTERN is the word `source`, so that
# arm reaches the `source`/`.` branch and published
#
#   imports ->    _try_existing
#   references -> _try_existing
#
# `_try_existing` is a shell function defined at kubernetes/third_party/
# gimme/gimme:414, not a file. A fabricated MODULE DEPENDENCY is worse than a
# fabricated call, because `imports` is what bb_migrate and bb_impact read.
#
# The positive expectations below are the half that pins the guard's SCOPE. Each
# is a real command that the guard must NOT delete, and three of them are the
# counterexamples that killed the wider predicate the A/B also measured.

_try_existing() {
  echo "try existing"
}
_try_binary() { echo "try binary"; }
_try_source() { echo "try source"; }
_try_git() { echo "try git"; }

# kubernetes/third_party/gimme/gimme:935-940 — the defect, verbatim. Each arm
# pattern arrives as a command name; the `source` arm also reaches the source
# branch and fabricates two dependency edges.
if ! case "${GIMME_TYPE}" in
	binary) _try_existing binary || _try_binary "${GIMME_GO_VERSION}" ;;
	source) _try_existing source || _try_source || _try_git ;;
	git) _try_git ;;
	auto) _try_existing || _try_binary || _try_source || _try_git ;;
	*)
		echo >&2 "I don't know how to '${GIMME_TYPE}'."
		;;
	esac; then
	echo "unreachable"
fi

# POSITIVE 1 — a real `source` of a real file. This is the edge the guard sits
# directly above, and the reason it is keyed on the POSITION of the `)` rather
# than on the command's name: `source` is a legitimate command word.
source ./lib.sh
. ./other.sh

# POSITIVE 2 — `)` as an ordinary word ARGUMENT. `guard-f-soundness.mts` shows
# the wider predicate ("any direct ERROR child whose text is `)`") fires on this
# shape and would delete this real call. The positional predicate does not, and
# this line is the fixture that would catch it if it ever did. A NON-builtin
# command is used deliberately: `echo` and `printf` are refused by
# SHELL_BUILTINS, so either would pin nothing here. The parse is
# `command_name[awk] word[one] word[two] ERROR[)] word[three]` — the `)` is a
# direct child of the command, which is exactly what makes it F1's counterexample
# and not F2's.
awk one two ) three

# POSITIVE 3 — the shape guard E lost 15 real calls to. `V=2 cmd "…"` puts a
# `variable_assignment` in the command's own slot and the grammar puts an ERROR
# beside it, so "any direct ERROR child" refuses a real command.
V=2 kube::log::status "a real call on a damaged line"

# POSITIVE 4 — `(` immediately after a name is an argument, and `)` immediately
# after a name is not something valid bash produces at all.
echo (echo nested)
echo "$?"

# POSITIVE 5 — a normally-parsed `case` arm. Its pattern is a `word`, never a
# command, and the arm's body keeps its edge.
case "$GIMME_TYPE" in
	binary) /usr/bin/true --version ;;
	*) echo unknown ;;
esac

# POSITIVE 6 — a real command sitting on the same damaged region as the defect.
_try_existing binary
_try_git