// Dump the readings for the round-12 leading-dot cases, so the fix is judged on
// the tree rather than on hasError alone.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: [string, string][] = [
  ["assign-then-dot", `class C { def p() { def x = foo()\n            .bar()\n            .baz()\n        return x } }\n`],
  ["cast-then-dot", `class A { def m(loaded) { ((org.example.Dirty) loaded)\n        .listDirtyPropertyNames() != null } }\n`],
  ["five-line-chain", `class B { def n(thing) { def d = thing\n            .sessions\n            .first()\n            .backingMap['Player']\n            .size() == 1\n        return d } }\n`],
  ["semicolon-control", `class D { def q() { def y = 1;\n        .trim() } }\n`],
]

const parser = await ASTEngine.getParser("groovy" as any)
for (const [name, src] of CASES) {
  const tree = parser.parse(src)
  const root = tree.rootNode
  console.log(`\n=== ${name}  hasError=${root.hasError} ===`)
  const lines = root.toString().split("\n")
  // print the region around any ERROR node, plus the head
  const errIdx = lines.findIndex((l) => l.includes("ERROR"))
  if (errIdx >= 0) {
    console.log(lines.slice(Math.max(0, errIdx - 3), errIdx + 6).join("\n"))
  } else {
    console.log(lines.slice(0, 12).join("\n"))
  }
}
