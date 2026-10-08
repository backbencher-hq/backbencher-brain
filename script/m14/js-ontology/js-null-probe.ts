// Probe: does a bare-read walk publish `uses -> null` / `uses -> undefined`?
// The census found `test -> null` and `test -> undefined` in lodash's test/test.js,
// and the grammar gives `null` and `undefined` their OWN node types (see
// js-r7-probe.ts: neither appears among the identifier nodes). If the walk reads a
// name off node.text without gating on node type, a KEYWORD LITERAL becomes an edge
// endpoint naming nothing in the source.
import { getParser } from "../../../src/ast/engine"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

const parser = await getParser("javascript")
const cases: [string, string][] = [
  ["null literal", "function f(a) {\n  return null;\n}\n"],
  ["undefined literal", "function f(a) {\n  return undefined;\n}\n"],
  ["NaN global", "function f(a) {\n  return NaN;\n}\n"],
  ["typeof compare to null string", "function f(a) {\n  return typeof a === 'null';\n}\n"],
  ["void zero", "function f(a) {\n  return void 0;\n}\n"],
  ["assign null to member", "function f(a) {\n  a.b = null;\n  return a.b;\n}\n"],
]
for (const [label, src] of cases) {
  const tree = await parser.parse(src)
  if (!tree) throw new Error("parser.parse returned no tree (null result)")
  const res: any = new RealJavaScriptAnalyzer().analyze(tree.rootNode, src, "probe.js")
  const rels = (res.relationships ?? []).filter((r: any) => r.type === "uses" || r.type === "calls")
  console.log(`${label}:`)
  for (const r of rels) console.log(`   ${r.type}  ${r.source} -> ${r.target}  c=${r.confidence}`)
  if (!rels.length) console.log("   (no uses/calls)")
  // also show what node types the operands actually are
  const stack: any[] = [tree.rootNode]
  const types = new Map<string, number>()
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    types.set(n.type, (types.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  console.log(`   node types: ${[...types.keys()].sort().join(" ")}`)
}