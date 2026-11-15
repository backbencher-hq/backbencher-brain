// Find the minimal real shape for #907 round 2: a ROOT-level ERROR that holds a
// definition header arriving as `ERROR > pointer_declarator > function_declarator`
// (jq util.c:617) or `ERROR > function_declarator` (jq jv.c:673), plus a call in
// the same region that must NOT be recovered.
//
// Run: bun script/m14/tmp/c907-fixture2.ts
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { parseFile } from "../../../src/ast/pool-worker"

const CANDIDATES: Array<[string, string]> = [
  ["toplevel-brace-split", [
    "static int helper(int x) { return x + 1; }",
    "void gone(void) {",
    "  if (helper(1)) {",
    "    helper(2);",
    "  } else {",
    "#ifdef NOPE",
    "  }",
    "#endif",
    "}",
    "",
    "char *",
    "late_ptr(const char *buf)",
    "{",
    "  return (char *)buf;",
    "}",
    "static double",
    "late_static(int n)",
    "{",
    "  return n * 0.5;",
    "}",
    "int call_site(void) { return (int)late_static(2); }",
    "",
  ].join("\n")],
  ["preproc-ifdef-brace", [
    "void swallowed(void) {",
    "  int a = 1;",
    "#ifdef FOO",
    "  if (a) {",
    "#else",
    "  } else {",
    "#endif",
    "  a++;",
    "}",
    "char *",
    "later(const char *s)",
    "{",
    "  return (char *)s;",
    "}",
    "",
  ].join("\n")],
]

for (const [label, src] of CANDIDATES) {
  const { tree } = await ASTEngine.parseTree("/tmp/c907-fixture2.c", src)
  const roots: string[] = []
  const walk = (n: any, d: number): void => {
    if (d <= 2) roots.push(`${"  ".repeat(d)}${n.type}[${n.startPosition.row + 1}-${n.endPosition.row + 1}]`)
    if (d >= 3) return
    for (const c of n.children ?? []) walk(c, d + 1)
  }
  walk(tree.rootNode, 0)
  const wts: any = await import("web-tree-sitter")
  void wts
  const tmp = `/tmp/c907-fix-${label}.c`
  const fs = await import("node:fs")
  fs.writeFileSync(tmp, src)
  const r: any = await parseFile(tmp, "/tmp")
  const fns = (r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => `${s.name}@${s.startLine}`)
  console.log(`\n=== ${label} ===`)
  console.log(`  tree: ${roots.slice(0, 14).join("\n        ")}`)
  console.log(`  analyzer functions: ${fns.join(", ") || "(none)"}`)
}
