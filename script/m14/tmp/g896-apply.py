#!/usr/bin/env python3
"""#896: turn RealGroovyAnalyzer's if/else dispatch chain into a handler map.

Chosen for PROVABLE behaviour preservation:
  * every branch BODY moves verbatim (dedented by 4),
  * the containers (symbols/relationships/imports/maps/stacks) are destructured
    as consts, so their mutations pass through unchanged,
  * only the loop-carried SCALARS are rewritten (newContext, pushedScope,
    currentPackage, parentContext, content) to the walk state,
  * traversal (the stack loop, exit items, child pushes) stays in analyze(),
    so dispatch and traversal are separated by construction.

Dry run:  python3 script/m14/tmp/g896-apply.py --dry
Apply:    python3 script/m14/tmp/g896-apply.py
"""
import re
import sys

SRC = "src/ast/real-groovy-analyzer.ts"
DRY = "--dry" in sys.argv

text = open(SRC).read()
lines = text.split("\n")

CHAIN_START = '      if (type === "package_declaration") {'
start = lines.index(CHAIN_START)
tail_comment = next(i for i in range(start, len(lines)) if "Closures, local variables, gstrings" in lines[i])
end = tail_comment - 1
while lines[end].strip() != "}":
    end -= 1

boundary_re = re.compile(r'^      (?:\} else if|if) \(')
bounds = [i for i in range(start, end + 1) if boundary_re.match(lines[i])]
TYPE_RE = re.compile(r'type === "([a-z_]+)"')

NAMES = {
    ("package_declaration",): "handlePackageDeclaration",
    ("import_declaration",): "handleImportDeclaration",
    ("method_invocation",): "handleMethodInvocation",
    ("explicit_constructor_invocation",): "handleExplicitConstructorInvocation",
    ("juxt_function_call",): "handleJuxtFunctionCall",
    ("leading_dot_call",): "handleLeadingDotCall",
    ("object_creation_expression",): "handleObjectCreationExpression",
    ("enum_constant",): "handleEnumConstant",
    ("field_declaration", "constant_declaration"): "handleFieldDeclaration",
    ("method_declaration", "constructor_declaration", "function_definition"): "handleMethodDeclaration",
    ("class_declaration", "interface_declaration", "trait_declaration",
     "enum_declaration", "record_declaration", "annotation_type_declaration"): "handleTypeDeclaration",
}

branches = []
for bi, b in enumerate(bounds):
    h = b
    while not lines[h].strip().endswith("{"):
        h += 1
    types = TYPE_RE.findall("\n".join(lines[b:h + 1]))
    key = tuple(types) if tuple(types) in NAMES else tuple(sorted(types))
    if key not in NAMES:
        raise SystemExit(f"unexpected branch keys {types} at line {b+1}")
    body_end = (bounds[bi + 1] - 1) if bi + 1 < len(bounds) else (end - 1)
    branches.append({"name": NAMES[key], "types": list(key), "body": lines[h + 1:body_end + 1]})

CONTAINERS = ["symbols", "relationships", "imports", "errors", "symbolMap",
              "classHierarchy", "overrideTasks", "scopeStack"]
SCALARS = ["newContext", "pushedScope", "currentPackage", "parentContext", "content"]

def rewrite(body):
    out, counts = [], {}
    for ln in body:
        if ln.lstrip().startswith("//"):
            out.append(ln)
            continue
        assert ln[:4] in ("    ", ""), repr(ln)
        ln = ln[4:]
        assert not re.search(r'\b(const|let|var)\s+type\s*=', ln), ln
        for sc in SCALARS:
            ln, n = re.subn(r'(?<![\w.])' + sc + r'\b', "s." + sc, ln)
            counts[sc] = counts.get(sc, 0) + n
        out.append(ln)
    return out, counts

total_counts = {}
for br in branches:
    br["body"], c = rewrite(br["body"])
    for k, v in c.items():
        total_counts[k] = total_counts.get(k, 0) + v
    br["used"] = [c2 for c2 in CONTAINERS if any(re.search(r'(?<![\w.])' + c2 + r'\b', l) for l in br["body"])]

print("branch table:")
for br in branches:
    print(f"  {br['name']:36} keys={','.join(br['types'])[:70]:70} lines={len(br['body']):>4} containers={','.join(br['used'])}")
print("scalar rewrites in moved bodies:", total_counts)

# expected rewrite counts — a change here means the chain moved under us
EXPECT = {"newContext": 39, "pushedScope": 3, "currentPackage": 4, "parentContext": 16, "content": 2}
for k, v in EXPECT.items():
    got = total_counts.get(k, 0)
    if got != v:
        print(f"  NOTE: {k} rewrites {got} (expected ~{v})")

if DRY:
    sys.exit(0)

# ---- in-place rewrites BELOW the chain (indices are original, edits first) ----
def sub_line(idx, pattern, repl, count=None):
    old = lines[idx - 1]
    new = re.sub(pattern, repl, old)
    assert new != old, f"line {idx}: nothing replaced in {old!r}"
    lines[idx - 1] = new

for n in range(tail_comment + 1, tail_comment + 13):      # the tail: pushes
    if re.search(r'(?<![\w.])(newContext|pushedScope)\b', lines[n - 1]):
        sub_line(n, r'(?<![\w.])(newContext|pushedScope)\b', lambda m: "walk." + m.group(1))
sub_line(753, r'(?<![\w.])currentPackage\b', "walk.currentPackage")
sub_line(769, r'(?<![\w.])currentPackage\b', "walk.currentPackage")
assert lines[832].strip() == "currentPackage,", lines[832]
lines[832] = lines[832].replace("currentPackage,", "currentPackage: walk.currentPackage,")

# ---- delete the chain, then convert its head into the dispatch --------------
del lines[start:end + 1]

STATE_BLOCK = '''    // #896 (handler-map refactor): the WALK STATE. `analyze` owns TRAVERSAL —
    // the stack loop, its exit items, the child pushes — and the handlers below
    // own EXTRACTION, reading and mutating this object and nothing else. The
    // containers are references, so handler mutations land in the same arrays
    // the rest of this method consumes; the scalars are the loop-carried state
    // the chain used to keep as locals.
    const walk: GroovyWalkState = {
      content,
      symbols,
      relationships,
      imports,
      symbolMap,
      classHierarchy,
      overrideTasks,
      scopeStack,
      parentContext: undefined,
      newContext: undefined,
      pushedScope: false,
      currentPackage: "",
    }'''
decl = lines.index('    let currentPackage = ""')
lines[decl:decl + 1] = STATE_BLOCK.split("\n")

setup = '''      walk.parentContext = parentContext
      walk.newContext = parentContext
      walk.pushedScope = false
      const handler = this.nodeHandlers.get(node.type)
      if (handler) handler(node, walk)'''
old_setup = ["      let newContext = parentContext", '      const type = node.type', "      let pushedScope = false"]
i0 = lines.index(old_setup[0])
assert lines[i0:i0 + 3] == old_setup, lines[i0:i0 + 3]
lines[i0:i0 + 3] = setup.split("\n")

# ---- the handlers + the dispatch table, right after analyze() ---------------
HANDLER_DOC = '''
  // ── #896: node-type dispatch table ────────────────────────────────────────
  // `analyze` walks (push/visit/pop); these handlers extract. Each is a named
  // method taking the walk state, so a handler can be exercised on its own —
  // which is what the review asked for and what the if/else chain prevented.
  // The misparse guards (§ juxt_function_call / field_declaration) are named
  // handlers here for the same reason: they stay individually testable, and
  // #841 rounds 3/14/22 measured them as load-bearing, so they are kept.
  private nodeHandlersCache?: Map<string, (node: Node, s: GroovyWalkState) => void>

  private get nodeHandlers(): Map<string, (node: Node, s: GroovyWalkState) => void> {
    if (!this.nodeHandlersCache) {
      const m = new Map<string, (node: Node, s: GroovyWalkState) => void>()
      const reg = (types: string[], h: (node: Node, s: GroovyWalkState) => void) => {
        for (const t of types) m.set(t, h)
      }
'''
for br in branches:
    keys = ", ".join(f'"{t}"' for t in br["types"])
    HANDLER_DOC += f'      reg([{keys}], (n, s) => this.{br["name"]}(n, s))\n'
HANDLER_DOC += '''      this.nodeHandlersCache = m
    }
    return this.nodeHandlersCache
  }
'''

STATE_IFACE = '''
/**
 * #896 — the groovy walk state. `analyze` owns traversal; the `handleX`
 * methods own extraction. Nothing else is shared between them.
 */
interface GroovyWalkState {
  content: string
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  symbolMap: Map<string, ASTEngine.UniversalSymbol>
  classHierarchy: Map<string, string[]>
  overrideTasks: OverrideTask[]
  scopeStack: Scope[]
  parentContext: Scope | undefined
  newContext: Scope | undefined
  pushedScope: boolean
  currentPackage: string
}
'''

out = "\n".join(lines)
# handlers go after analyze() ends (marker: the return object's tail)
anchor = '''        analysisVersion: "5.0.0-groovy-pure-ast",
      },
    }
  }
'''
assert out.count(anchor) == 1, out.count(anchor)
handlers = HANDLER_DOC
for br in branches:
    handlers += f"\n  private {br['name']}(node: Node, s: GroovyWalkState): void {{\n"
    if br["used"]:
        handlers += "    const { " + ", ".join(br["used"]) + " } = s\n"
    handlers += "    const type = node.type\n"
    handlers += "\n".join(br["body"]) + "\n  }\n"
out = out.replace(anchor, anchor + handlers)
# the state interface goes before the class
out = out.replace("export class RealGroovyAnalyzer", STATE_IFACE.lstrip("\n") + "\nexport class RealGroovyAnalyzer", 1)
open(SRC, "w").write(out)
print(f"\nwrote {SRC}: {len(out.splitlines())} lines (was {len(text.splitlines())})")
print(f"handlers: {len(branches)}")
