// The widened #907 rule scans ERROR nodes at file scope, so the one fabrication
// risk is a `#define` whose BODY is definition-shaped: `#define DEF(n) void n(void) {`.
// If the damaged tree surfaces `n` as a function_declarator under an ERROR, the
// recovery would catalogue the macro PARAMETER as a file symbol. Measured here
// directly, plus the invocation form (`DEF(real_name)`), which expands to a real
// definition and is the case a naive textual rule would wrongly catch.
//
// Run: bun script/m14/tmp/c907-macro-probe.ts
import { writeFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/pool-worker"
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["macro-body-definition", [
    "#define C907_DEF(n) void n(void) { }",
    "C907_DEF(c907_from_macro)",
    "static int c907_plain(void) { return 1; }",
    "",
  ].join("\n")],
  ["macro-body-brace-open", [
    "#define C907_DEF(n) void n(void) {",
    "C907_DEF(c907_from_macro)",
    "}",
    "static int c907_plain(void) { return 1; }",
    "",
  ].join("\n")],
  ["macro-param-in-degraded-region", [
    "void broken(void) {",
    "  int a = 1;",
    "#ifdef FOO",
    "  if (a) {",
    "#else",
    "  } else {",
    "#endif",
    "  a++;",
    "}",
    "#define C907_DEF(n) void n(void) { }",
    "C907_DEF(c907_from_macro)",
    "",
  ].join("\n")],
]

for (const [label, src] of CASES) {
  const tmp = `/tmp/c907-macro-${label}.c`
  writeFileSync(tmp, src)
  const { tree } = await ASTEngine.parseTree(tmp, src)
  const dump: string[] = []
  const walk = (n: any, d: number): void => {
    if (d > 3) return
    dump.push(`${"  ".repeat(d)}${n.type}[${n.startPosition.row + 1}-${n.endPosition.row + 1}] ${n.childCount === 0 ? JSON.stringify(n.text.slice(0, 24)) : ""}`)
    for (const c of n.children ?? []) walk(c, d + 1)
  }
  walk(tree.rootNode, 0)
  const r: any = await parseFile(tmp, "/tmp")
  const fns = (r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => `${s.name}@${s.startLine}`)
  console.log(`\n=== ${label} ===`)
  console.log(dump.slice(0, 16).map((l) => "  " + l).join("\n"))
  console.log(`  analyzer functions: ${fns.join(", ") || "(none)"}`)
  console.log(`  FABRICATION (a macro parameter named 'n'): ${fns.some((f: string) => f.startsWith("n@")) ? "YES" : "no"}`)
}
