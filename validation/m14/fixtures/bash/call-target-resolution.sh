#!/usr/bin/env bash
# Call-target resolution: which definition does a `calls` edge reach, and what
# does a `$name` read mean when the file also declares `name` as a function?
#
# Both shapes were found by applying the fields an edge PUBLISHES to the file's
# real symbol table (`probe-bash-published-resolvability.mts`, production
# `parseFile`, 400-file hash-order sample), which is a different question from
# counting how many symbols share an edge's target NAME:
#
#   type        edges   ambiguous  -> 0 cand   -> 1 cand   -> >1 cand   decided by
#   calls       5,097          6      100.0%        0   0.0%      0  0.0%  (nothing)
#   uses        7,856      1,187        0.0%    1,097 92.4%     90  7.6%  targetKind
#   contains    3,775        658        0.0%      658 100%       0  0.0%  edgeLine
#
# `calls` was the only type no published field could answer, and `isFunctionCall`
# could not answer it: that flag says the target IS a function declared in this
# file, not WHICH one, so as a filter it discards every candidate (6 of 6 leave
# zero). The corpus shape is kubernetes/third_party/gimme/gimme, where
# `_version_sort` is defined at 125 and redefined at 127 and call sites at 535,
# 565 and 581 name it.

# ---- a redefinition, and a call that must reach the LATER one ----
#
# bash has no nested function scope: a name resolves to the most recent definition
# executed before the call, which for a script read top to bottom is the latest
# definition at or before the call site. The edge must publish that line.
worker_a() { echo "first definition"; }
worker_a() { echo "second definition"; }

# The call is AFTER both definitions, so both are in play and the answer is the
# later one. An implementation that kept the FIRST (the way the `overrides` edge
# points backwards) answers the wrong line here.
run_after_both() {
  worker_a
}

# ---- a call BEFORE both definitions: no definition is in effect there ----
#
# bash permits the forward reference — the callee can be defined before the
# caller's body runs — so the text order does not settle it and the edge must
# DECLINE, naming what it observed and publishing no line.
forward_reference() {
  defined_later
}

defined_later() { echo "defined after the caller"; }

# ---- the same shape from the other direction: two calls, one name ----
#
# Both rows must carry their own line, and the two lines differ, which is what
# makes this a per-EDGE attribution rather than a per-name one. An implementation
# that resolved the name once per file and reused the answer would give both rows
# the same line and pass the single-call cases above.
probe_first() {
  worker_a
  echo "between"
  worker_a
}

# ---- a unique function name must grow NO metadata ----
#
# The absence is the assertion, and it is the payload constraint: 5,097 `calls`
# edges on this sample and 55,222 on the corpus. Only a name with two or more
# declarations is ambiguous, and only those edges gain a key.
only_declared_once() { echo "one definition, no ambiguity"; }
caller_of_unique() {
  only_declared_once
}

# ---- a `$name` read in a file that also declares `name` as a FUNCTION ----
#
# `declSites` keys variables, aliases and locals and never functions, so a name
# declared as both looks unique to it while the published symbol table holds two
# declarations — the edge then publishes nothing and a consumer matching by name
# has two candidates. Measured at 4 edges on the sample, e.g.
# dart-sdk/pkg/vm/tool/shared_functions.sh:58 `uses -> host_arch` against
# function@7 and variable@56.
#
# `$name` is a parameter expansion: it reads a VARIABLE, and a function is not
# reachable through `$`. So the function symbol is not a candidate for the edge and
# the answer is the variable — under its own `targetResolution` value, because a
# consumer filtering candidates on kind must be able to see that kind is what
# decided this row.
shared_name() { echo "I am the function"; }
shared_name=variable_value

read_the_variable() {
  echo "$shared_name"
}

# A `calls` edge naming the same pair is the CONTROL: it must reach the FUNCTION,
# not the variable, so the two rules cannot be one rule with a sign error. The
# `uses` edge for this same pair is asserted above, reaching line 85; this one
# reaches 84. If both resolved to the same line, one of the two rules has a sign
# error and the fixture cannot tell which.
call_the_function() {
  shared_name
}

# ---- the decline, which needs the name declared TWICE and both times after ----
#
# `declaredAfterUse` is a third outcome and it is not the same as "unambiguous":
# here the name IS claimed by two published declarations and neither is in effect
# at the call site. The row must say so and publish NO line. Picking the nearer of
# the two would be the invented attribution this mechanism exists to prevent, and
# this is the only shape in the file that can produce it.
caller_before_any_definition() {
  late_worker
}

late_worker() { echo "one"; }
late_worker() { echo "two"; }

# ---- a name that is BOTH a command and a variable, with ONE function ----
#
# The corpus shape that a 400-file sample cannot see: 105 whole-corpus `calls`
# edges publish nothing, and the two families are distinct.
#
# This one is a function and a variable — `command_name` at 127, the variable at
# 128. Among FUNCTION declarations the name is unique, so the redefinition rule
# declines (correctly: there is nothing to choose between) and the edge would
# publish nothing at all — while the published symbol table holds two
# declarations of the name and a consumer matching by target has two candidates.
# A command position cannot denote a variable, so the single function IS the
# answer and the edge says so. Measured: swift-nio/scripts/nio-diagnose:398
# `calls -> nio_pids` against variable@136 and function@151.
command_name() { echo "the function"; }
command_name=variable_value

caller_of_both() {
  command_name
}

# The `uses` row for the same pair is asserted in the expectation too, and it must
# reach the VARIABLE — so the two rules cannot be one rule with a sign error.
read_the_other() {
  echo "$command_name"
}

# ---- `exports`: the edge carries the EXPORT line, not the declaration's ----
#
# Rounds 5 and 9 both recorded that `exports` was already disambiguated, on the
# ground that the edge puts the declaration's line on it. It does not: it puts the
# line of the `export` STATEMENT, which is the declaration's line only when the
# two are the same statement. Measured on the whole corpus, applying the edge's
# own line to the published symbol table leaves 29 of 96 ambiguous `exports` edges
# with zero candidates — e.g. `nvm_supports_xz -[exports]-> PATH @37` against
# constant@8 and constant@21. The 400-file sample saw two ambiguous `exports`
# edges and both coincided, which is why the claim survived nine rounds.
EXPORTED_NAME=one

writes_the_same_name() {
  EXPORTED_NAME=two
}

# Neither declaration is on this line, so the edge's own line answers nothing. The
# answer is the file-scope declaration: an `export` statement exports the value
# the name currently holds, which at this point in the file is the file-scope one.
export EXPORTED_NAME

# A second, independent `exports` edge to the same name from inside a function, so
# the scope walk is exercised from a scope that declares the name itself. Its
# answer is that function's own declaration, not the file's.
exports_from_its_own_scope() {
  export EXPORTED_NAME
  echo "$EXPORTED_NAME"
}
