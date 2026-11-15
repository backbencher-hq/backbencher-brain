#!/usr/bin/env bash
# Implicit binding sites: bash BINDS a name without ever writing NAME=...
# Every shape below was read off the pinned grammar's tree, not off analyzer
# output — see validation/m14/fixtures/bash/probe-bash-binding-shapes.mts.

# `for NAME in words` — POSIX 6.7.3 assigns each word to NAME. The pinned grammar
# carries it as a bare `variable_name` child of `for_statement`.
for loop_var in alpha beta; do
  echo "$loop_var"
done

# `for NAME; do ... done` — the no-`in` spelling binds the same way.
for bare_var; do
  echo "$bare_var"
done

# `read NAME` — POSIX 6.2.5 assigns stdin to NAME. The grammar gives the target
# as a plain `word`, indistinguishable by TYPE from a flag.
read plain_target

# A flag that takes a value consumes the next SIBLING, and that sibling is a
# `string` node here — so `prompted` is still a target and not a lost word.
read -r -p "Name: " prompted

# An env prefix and a redirection are neither an option nor a target; they just
# advance the scan, so the name after them is still found.
IFS='/:' read -ra split_args <<< "$1"

# A BUNDLED option takes its value from inside the bundle when something follows
# the value letter, and from the next sibling when the value letter is LAST.
# `-u3` therefore binds nothing itself and `fd_target` is a real target — which is
# the shape that tells the two rules apart. An earlier version of the collector
# asked only whether the bundle CONTAINED a value letter, so it consumed
# `fd_target` and dropped a binding bash actually makes.
read -u3 fd_target
read -rp "Name: " prompt_reply
mapfile -tO 3 offset_array < "$src"

# The option's VALUE need not be quoted. `read -p Enter value extra_target` binds
# `extra_target`, and `Enter` is the PROMPT — not a variable. A collector that
# does not know `-p` takes a value declares `Enter`, which is a fabrication, so
# this row is what makes the value-option table observable rather than decorative.
read -p Enter value extra_target

# mapfile fills an ARRAY (bash 4.0), so the binding is an array one.
mapfile -t line_array < "$src"

# `printf -v NAME` assigns the formatted output to NAME (bash 4.1).
printf -v fmt_target '%s' "$fmt_source"

# ---- shapes that must DECLINE rather than fabricate ----

# A computed name is not a name. The grammar gives each of these a node type
# that is not `word`, which is the whole filter.
printf -v "$2" '%s' "$REPLY"
read "$computed_target"

# A glob is a `word` and is not a shell identifier.
read *.txt

# A comment, a string literal and a heredoc body are not commands. A text
# matcher would have declared a variable from each of these three.
# read commented_out
echo "read quoted_out"
cat <<'HEREDOC'
read heredoc_out
HEREDOC

# `read` with no target at all assigns REPLY, which the shell defines.
read

# A binding inside a function belongs to that function's scope, not the script's.
scoped_reader() {
  read inner_target
  echo "$inner_target"
}

fmt_source=seed
echo "$loop_var $bare_var $plain_target $prompted $split_args $fmt_target $fmt_source"
scoped_reader