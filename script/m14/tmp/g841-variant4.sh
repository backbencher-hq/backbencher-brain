#!/bin/bash
# Bisect round-4 changes: remove ONE, generate+build+probe F.
set -u
BR=<corpus-root>/mcp/backbencher-brain
G=$BR/grammars/tree-sitter-groovy/grammar.js
V=/tmp/g841-variant4

# Variant A: no command_expression rule + not in expression choice
cat > /tmp/g841-v4a.py <<'PY'
import sys, re
src = sys.stdin.read()
src = src.replace("""    // #841 round 3: value-position command chain — same shape as
    // juxt_function_call, but reachable inside expressions (`p = p.then { … }
    // then { … }`). Dynamic precedence -1 keeps it losing to every ordinary
    // expression reading, so it only wins where the chain shape has no other
    // parse (same contract as leading_dot_call).
    command_expression: $ => prec.dynamic(-1, seq(
      field('name', $._juxt_function_name),
      field('args', alias($._juxt_argument_list, $.argument_list)),
    )),
""", "")
src = src.replace("      $.command_expression,\n", "")
print(src)
PY

# Variant B: remove [$._juxt_argument_list] conflict only
cat > /tmp/g841-v4b.py <<'PY'
import sys
src = sys.stdin.read()
lines = src.split("\n")
out = []
skip_next = False
for i, ln in enumerate(lines):
    if "juxt argument list vs commaSep continuation inside the" in ln:
        continue  # drop comment line
    if ln.strip() == "[$._juxt_argument_list],":
        continue
    out.append(ln)
print("\n".join(out))
PY

# Variant C: remove [$._juxt_argument_list, $.map_item] conflict only
cat > /tmp/g841-v4c.py <<'PY'
import sys
src = sys.stdin.read()
lines = src.split("\n")
out = []
for ln in lines:
    if "`assert k: v` message colon vs a map_item argument." in ln:
        continue
    if ln.strip() == "[$._juxt_argument_list, $.map_item],":
        continue
    out.append(ln)
print("\n".join(out))
PY

# Variant D: remove the two record_pattern conflicts only
cat > /tmp/g841-v4d.py <<'PY'
import sys
src = sys.stdin.read()
lines = src.split("\n")
out = []
for ln in lines:
    if "`case Identifier(\u2026)` record pattern vs a juxt callee in" in ln or "same for reserved-word callees" in ln:
        continue
    if ln.strip() == "[$.primary_expression, $.method_invocation, $.record_pattern, $._juxt_function_name],":
        continue
    if ln.strip() == "[$.primary_expression, $.method_invocation, $.record_pattern],":
        continue
    out.append(ln)
print("\n".join(out))
PY

run_variant() {
  local name="$1"; local py="$2"
  rm -rf "$V"; mkdir -p "$V"
  python3 "$py" < "$G" > "$V/grammar.js"
  cp "$BR/grammars/tree-sitter-groovy/package.json" "$V/"
  ln -sfn "$BR/grammars/tree-sitter-groovy/node_modules" "$V/node_modules"
  (cd "$V" && tree-sitter generate > gen.txt 2>&1)
  if [ $? -ne 0 ]; then echo "$name: GENERATE FAILED"; grep -A6 "Unresolved conflict" gen.txt | head -8; return; fi
  (cd "$V" && tree-sitter build --wasm > build.txt 2>&1)
  if [ $? -ne 0 ]; then echo "$name: BUILD FAILED"; return; fi
  local res=$(cd "$BR" && timeout 120 bun script/m14/tmp/g841-bisect-probe.ts "$V/tree-sitter-groovy.wasm" 2>/dev/null | grep -c "OK" )
  local f=$(cd "$BR" && timeout 120 bun script/m14/tmp/g841-repro2.ts 2>/dev/null >/dev/null; timeout 60 bun -e '
    const wts = require("web-tree-sitter");
    (async () => {
      const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language;
      await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" });
      const lang = await L.load(require("fs").readFileSync(process.argv[2]));
      const parser = new P(); parser.setLanguage(lang);
      const src = "def rx = $/a/b/$\ndef t = \x27\x27\x27multi\nline\x27\x27\x27\n";
      const tree = parser.parse(src);
      console.log((tree.rootNode).hasError ? "F-FAIL" : "F-OK");
    })();
  ' "$BR/node_modules/web-tree-sitter" "$V/tree-sitter-groovy.wasm" 2>/dev/null)
  echo "$name: W-probe=$res/5 $f"
}

run_variant "A (no command_expression)" /tmp/g841-v4a.py
run_variant "B (no juxt-list conflict)" /tmp/g841-v4b.py
run_variant "C (no map_item conflict)" /tmp/g841-v4c.py
run_variant "D (no record_pattern conflicts)" /tmp/g841-v4d.py
