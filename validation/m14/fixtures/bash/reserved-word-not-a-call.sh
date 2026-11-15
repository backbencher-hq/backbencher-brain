#!/usr/bin/env bash
# M60 reserved-word guard. A reserved word is not a command: bash consumes
# `if`/`then`/`fi`/`esac`/`case` itself, so no script can invoke one. When the
# grammar loses track of a construct it hands the keyword back as a `command`,
# and the analyzer was emitting an edge to it.
#
# Every shape below is a verbatim corpus line, named in the expectation file.
# The positive expectations matter as much as the forbids: they pin that a REAL
# command on the same damaged lines still produces its edge, which is the half of
# the decision that the A/B in guard-ab-bash-calls.ts measured (reserved words
# removed: 30 fabrications, 0 real calls).

# kubernetes/cluster/gce/config-test.sh:468 — an `if` whose `fi` is in a fragment
# the grammar cannot see. Emitted `calls -> if` and `calls -> then`.
if [[ -n "${LOGROTATE_FILES_MAX_COUNT:-}" ]]; then

# kubernetes/third_party/gimme/gimme:935 — `if ! case … in`. Emitted `calls -> case`.
if ! case "${GIMME_TYPE}" in

# ohmyzsh/lib/clipboard.zsh:66 — one line, two reserved words.
elif [ -n "${DISPLAY:-}" ] && (( ${+commands[xsel]} )); then

# kubernetes/third_party/gimme/gimme:945 — `esac; then`. Emitted `calls -> esac`.
esac; then

# A real command inside the same damaged region. It MUST keep its edge: this is
# what distinguishes the reserved-word guard from the damage guard that was
# measured and rejected (it removed 15 real `kube::log::status` calls).
/usr/bin/true --version