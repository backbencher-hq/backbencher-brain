#!/bin/bash
# Bisect round-3 conflicts: remove ONE, generate; if required, note it; else build+probe.
set -u
BR=<corpus-root>/mcp/backbencher-brain
G=$BR/grammars/tree-sitter-groovy/grammar.js
V=/tmp/g841-variant
declare -a NAMES=(
"LIT_MI_JUXT:[$._literal, $.method_invocation, $._juxt_function_name]"
"LIT_MI:[$._literal, $.method_invocation]"
"PRIM_TY_MI:[$.primary_expression, $.method_invocation, $._unannotated_type]"
"JUXT4:[$.primary_expression, $.method_invocation, $._unannotated_type, $._juxt_function_name]"
"PRIM_MI_TYEXP:[$.primary_expression, $.method_invocation, $.type_expression]"
"PRIM_MI_TYEXP_JUXT:[$.primary_expression, $.method_invocation, $.type_expression, $._juxt_function_name]"
"TPL_MI:[$.template_expression, $.method_invocation]"
"PRIM_FA:[$.primary_expression, $.field_access]"
"LIT_FA:[$._literal, $.field_access]"
"FA_GT:[$.field_access, $.generic_type]"
"PRIM_FA_TY:[$.primary_expression, $.field_access, $._unannotated_type]"
)
for entry in "${NAMES[@]}"; do
  name="${entry%%:*}"; pat="${entry#*:}"
  rm -rf "$V"; mkdir -p "$V"
  python3 - "$pat" < "$G" > "$V/grammar.js" <<'PY'
import sys
pat = sys.argv[1]
src = sys.stdin.read()
lines = src.split("\n")
out, skip = [], False
for ln in lines:
    if pat.replace(" ", "") in ln.replace(" ", ""):
        skip = True  # drop the conflict line; its preceding comment line stays (harmless)
        continue
    out.append(ln)
print("\n".join(out))
PY
  cp "$BR/grammars/tree-sitter-groovy/package.json" "$V/"
  ln -sfn "$BR/grammars/tree-sitter-groovy/node_modules" "$V/node_modules"
  (cd "$V" && tree-sitter generate > gen.txt 2>&1)
  if [ $? -ne 0 ]; then echo "$name: REQUIRED (generate fails without it)"; continue; fi
  (cd "$V" && tree-sitter build --wasm > build.txt 2>&1)
  if [ $? -ne 0 ]; then echo "$name: BUILD FAILED"; continue; fi
  ok=$(cd "$BR" && timeout 120 bun script/m14/tmp/g841-bisect-probe.ts "$V/tree-sitter-groovy.wasm" | grep -c "^OK")
  echo "$name: probe OK = $ok/5"
done
