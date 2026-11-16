#!/bin/bash
# Verify the round-4 first design: a command reading attached to `expression`
# generally, with a SHARED argument list (the shape whose wasm the prior session
# recorded as breaking the dollar-slashy canary). The prior session's bisect was
# not re-runnable (its build was overwritten), so this rebuilds it from the
# committed grammar and measures the canary directly.
#
# The committed grammar is not modified: everything happens in /tmp.
set -u
BR=<corpus-root>/mcp/backbencher-brain
V=/tmp/g841-global-attach
rm -rf "$V"; mkdir -p "$V"

cd "$BR"
git show HEAD:grammars/tree-sitter-groovy/grammar.js > "$V/grammar.js"
cp grammars/tree-sitter-groovy/package.json "$V/"
ln -sfn "$BR/grammars/tree-sitter-groovy/node_modules" "$V/node_modules"

python3 - "$V/grammar.js" <<'PY'
import sys
p = sys.argv[1]
src = open(p).read()

# 1. add the command reading to the general expression choice (shared list)
anchor = "      $.integral_type,\n      $.floating_point_type,\n      $.void_type,\n    ),\n"
assert anchor in src, "expression anchor not found"
src = src.replace(anchor, "      $.integral_type,\n      $.floating_point_type,\n      $.void_type,\n      $.juxt_function_call,\n    ),\n", 1)

# 2. declare the conflicts generate() demanded for this shape
conflict_anchor = "    [$.expression, $.statement, $.closure],\n"
if conflict_anchor not in src:
    src = src.replace("    [$._literal, $._juxt_function_name],\n",
                      "    [$._literal, $._juxt_function_name],\n    [$.expression, $.statement, $.closure],\n    [$._juxt_argument_list],\n    [$._juxt_argument_list, $.map_item],\n", 1)
open(p, "w").write(src)
print("patched")
PY

cd "$V"
if ! tree-sitter generate > gen.txt 2>&1; then
  echo "RESULT: generate REJECTED this design"
  grep -A8 "Unresolved conflict" gen.txt | head -12
  exit 0
fi
if ! tree-sitter build --wasm > build.txt 2>&1; then
  echo "RESULT: build FAILED"; tail -5 build.txt; exit 0
fi
echo "built global-attach wasm: $(sha256sum tree-sitter-groovy.wasm | cut -c1-12)"

# 3. measure the canary + the target shape directly against the global design
cd "$BR"
timeout 120 bun -e '
const fs = require("fs");
(async () => {
  const wts = await import("web-tree-sitter");
  const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language;
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" });
  const lang = await L.load(fs.readFileSync(process.argv[1]));
  const parser = new P(); parser.setLanguage(lang);
  const cases = [
    ["F  dollar-slashy + triple-quoted (canary)", "def rx = $/a/b/$\ndef t = \x27\x27\x27multi\nline\x27\x27\x27\n"],
    ["Y3 two closures in assign (target)", "class A {\n  def f(p) {\n    p = p.then { it * 2 } then { println it }\n  }\n}\n"],
    ["W6 array-typed local + dotted read", "class C {\n  void m(ac) {\n    String[] p = ac.environment.activeProfiles\n  }\n}\n"],
    ["W1 dotted chain call", "class C { def m(p) { return p.layout.buildDirectory.dir(\x27x\x27) } }\n"],
  ];
  for (const [cls, src] of cases) {
    console.log((parser.parse(src).rootNode.hasError ? "FAIL" : "OK  ") + " " + cls);
  }
})();
' "$V/tree-sitter-groovy.wasm"
