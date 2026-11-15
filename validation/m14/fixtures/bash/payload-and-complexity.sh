#!/usr/bin/env bash
# Payload matrix row 1b for bash: the complexity metadata the lane publishes must
# be a MEASUREMENT of the file's decision points, not a constant.
#
# The pre-wave analyzer set `metadata.cyclomaticComplexity` from a decision-point
# counter that never consulted `c_style_for_statement`, and set
# `metadata.complexity` to `symbols.length + relationships.length` — a number
# that moves when extraction changes and means nothing on its own. Both are
# pinned here so a change to either is a decision rather than a drift.
#
#   while (( count < limit )); do   → while_statement + binary_expression  = 2
#   if   [[ -n "$x" ]]; then       → if_statement + test_command           = 2
#   case … in … esac                → case_item                             = 1
#   plus the base 1
#   total cyclomaticComplexity = 8

readonly LIMIT=3

setup() {
  local count=0
  local x=""

  while (( count < LIMIT )); do
    count=$((count + 1))
  done

  if [[ -n "$x" ]]; then
    echo "set"
  fi

  case "${1:-}" in
    a) echo a ;;
    *) echo other ;;
  esac
}

setup
