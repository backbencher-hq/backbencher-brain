#!/usr/bin/env bash
# bash has NO construction form. Every construct below LOOKS like instantiation to a naive
# reader and NONE of them is one: an array literal, an associative array, a command literally
# named `new`, a function used as a factory, and command substitution. This fixture pins the
# ABSENCE of `instantiates` edges from a real bash source (see the expectation's authoredFrom).
arr=(one two three)
declare -A map=([a]=1 [b]=2)
new thing
Class() { printf '%s\n' "$1"; }
Class value
made=$(Class "$(date +%s)")
printf '%s %s %s %s\n' "${arr[0]}" "${map[a]}" "$made" "$(command -v bash)"
