#!/usr/bin/env bash
# FAILS if any analyzer uses a regular expression. Regex over source text matches
# comments and string literals, misses nested syntax, and breaks silently on the
# next grammar version. Everything must go through the tree-sitter AST.
# Usage: no-regex-gate.sh [subdir-of-src/ast]
set -uo pipefail
DIR="${1:-src/ast}"
FAIL=0; TOTAL=0
printf "%-38s %s\n" "FILE" "REGEX USES"
while read -r f; do
  n=$(grep -nE 'new RegExp\(|\.(match|matchAll|replace|replaceAll|search|split)\(|/(\\.|[^/[:space:]])+/[gimsuy]+' "$f" 2>/dev/null \
      | grep -vE '^\s*[0-9]+:\s*(//|\*|/\*)' | wc -l)
  TOTAL=$((TOTAL+n))
  if [ "$n" -gt 0 ]; then printf "%-38s %s\n" "$(basename "$f")" "$n"; FAIL=1; fi
done < <(ls "$DIR"/real-*-analyzer.ts 2>/dev/null)
echo "----------------------------------------"
if [ "$FAIL" -eq 0 ]; then echo "PASS — 0 regex uses across all analyzers"; exit 0; fi
echo "FAIL — $TOTAL regex uses. Replace with tree-sitter AST walks (node.type, named children, cursor)."
exit 1
