#!/usr/bin/env bash
# PINS the bash wave fixture pack (M29 wave 3, language-onboarding protocol).
# Uniform wave convention: a greet function called from main, plus a named
# constant whose references must be resolvable.

set -euo pipefail

GREETING="hello"

greet() {
  local items=("$@")
  printf '%s %s\n' "$GREETING" "${#items[@]}"
}

main() {
  greet "a" "b"
  printf '%s\n' "$GREETING"
}

main
