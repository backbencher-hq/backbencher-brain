#!/bin/bash
# Bisect: remove one conflict from grammar.js, rebuild, test W2 (dotted chain call).
set -u
G=<corpus-root>/mcp/backbencher-brain/grammars/tree-sitter-groovy/grammar.js
V=/tmp/g841-variant
run_variant() {
  local name="$1"; local pyfile="$2"
  rm -rf "$V"; mkdir -p "$V"
  python3 "$pyfile" < "$G" > "$V/grammar.js"
  cp <corpus-root>/mcp/backbencher-brain/grammars/tree-sitter-groovy/package.json "$V/"
  ln -sfn <corpus-root>/mcp/backbencher-brain/grammars/tree-sitter-groovy/node_modules "$V/node_modules"
  cd "$V"
  tree-sitter generate > gen.txt 2>&1
  if [ $? -ne 0 ]; then echo "$name: GENERATE FAILED"; tail -3 gen.txt; return; fi
  tree-sitter build --wasm > build.txt 2>&1
  if [ $? -ne 0 ]; then echo "$name: BUILD FAILED"; tail -3 build.txt; return; fi
  local ok=$(cd <corpus-root>/mcp/backbencher-brain && timeout 120 bun script/m14/tmp/g841-bisect-probe.ts "$V/tree-sitter-groovy.wasm" | grep -c "^OK")
  echo "$name: probe OK count = $ok/5"
}
rm -rf "$V"; mkdir -p "$V"

# Variant A: drop the method_invocation self-conflict
cat > /tmp/g841-va.py <<'PY'
import sys
src = sys.stdin.read()
needle = "    // #841 round 3: `super.m()[i]` — self-nesting through the super prefix.\n    [$.method_invocation],\n"
assert needle in src, "A needle missing"
print(src.replace(needle, ""))
PY
run_variant "A (no [\$.method_invocation])" /tmp/g841-va.py

# Variant B: drop the field_access self-conflict
cat > /tmp/g841-vb.py <<'PY'
import sys
src = sys.stdin.read()
needle = "    // #841 round 3: `super.x.@y[i]` — self-nesting through the super prefix.\n    [$.field_access],\n"
assert needle in src, "B needle missing"
print(src.replace(needle, ""))
PY
run_variant "B (no [\$.field_access])" /tmp/g841-vb.py

# Variant C: drop both
cat > /tmp/g841-vc.py <<'PY'
import sys
src = sys.stdin.read()
src = src.replace("    // #841 round 3: `super.m()[i]` — self-nesting through the super prefix.\n    [$.method_invocation],\n", "")
src = src.replace("    // #841 round 3: `super.x.@y[i]` — self-nesting through the super prefix.\n    [$.field_access],\n", "")
print(src)
PY
run_variant "C (no both)" /tmp/g841-vc.py

# Variant D: drop the object_creation_expression self-conflict
cat > /tmp/g841-vd.py <<'PY'
import sys
src = sys.stdin.read()
needle = "    // #841 round 3: `new Outer().new Inner()` — the object-creation rule is\n    // self-nesting through the primary '.' prefix; GLR decides.\n    [$.object_creation_expression],\n"
assert needle in src, "D needle missing"
print(src.replace(needle, ""))
PY
run_variant "D (no [\$.object_creation_expression])" /tmp/g841-vd.py
