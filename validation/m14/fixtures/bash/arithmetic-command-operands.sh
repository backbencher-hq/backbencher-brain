#!/usr/bin/env bash
# Round 8: a bare `(( … ))` is an arithmetic COMMAND, and its operands are reads.
#
# The dispatch already covered `$(( … ))` (`arithmetic_expansion`), `for (( … ))`
# (`c_style_for_statement`) and `((i++))` — the last only because its operand
# happens to arrive as a `postfix_expression`. The plain `(( … ))` form reaches the
# analyzer as a `compound_statement` wrapping a `binary_expression`, which nothing
# dispatched, so `((count < limit))` named two variables the graph never mentioned.
# The asymmetry was a grammar-shape accident, not a fact about bash.
#
# Measured before the change, from the tree and the published edge set rather than
# after it (probe-bash-arithmetic-operands.mts, 400-file hash-order sample):
# 89 arithmetic compound_statements in 32 files, 126 operand name nodes, 115
# distinct (target, line) pairs — 45 already published through the five dispatched
# types and 70 not. The census then measured uses 7,786 -> 7,856 and total
# relationships 16,984 -> 17,054, which is the 70.
#
# This fixture pins the operand shapes the grammar actually produces, plus the two
# properties a fix could get wrong in the other direction:

#   line 44  `(( count < limit ))`   binary operands        — the gap
#   line 45  `(( count++ ))`         postfix operand        — published since round 1,
#                                                          so this row is a REGRESSION pin
#   line 46  `(( --count ))`         unary operand          — never reached by any of the
#                                                          five dispatched types
#   line 47  `(( arr[0] = count ))`  subscript + bare operand
#   line 48  `(( ${count} + limit ))` `${…}` inside arithmetic; `${count}` was already
#                                                          published by the `expansion`
#                                                          branch, `limit` was not
#   line 51  TWO statements on ONE line naming the same variable. `addRel`'s dedupe
#            key is source|type|target|line with no statement identity, so this is
#            ONE edge — the property the lane's own prediction probe got wrong first
#            (it counted 72 candidates, and the census's 70 was right).
#   lines 53-54  an `if` whose CONDITION is arithmetic (line 53, new) and whose then-
#            BLOCK is a `compound_statement` that is not (line 54). The block's own
#            `simple_expansion` read of `$count` is published by the string-expansion
#            dispatch, so the block must contribute NOTHING extra: `uses -> count`
#            appears on lines 44,45,46,47,48,51,53,54 — eight edges, none of them a
#            second read of line 54 — and that count is what pins the predicate.

count=0
limit=10
arr=(alpha beta)

while (( count < limit )); do
  (( count++ ))
  (( --count ))
  (( arr[0] = count ))
  (( ${count} + limit ))
done

(( count++ )); (( count++ ))

if (( count < limit )); then
  echo "$count"
fi