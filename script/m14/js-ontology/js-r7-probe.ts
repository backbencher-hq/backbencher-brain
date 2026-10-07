// Probe: what node type does the JS grammar give `null`, `undefined`, `Na`, `this`,
// `NaN`? R7's placeholder question turns on the answer, so it is asked of the
// GRAMMAR, not of a classifier. AST walk, no regex.
import { readFileSync } from "node:fs"
import { getParser } from "../../../src/ast/engine"

const parser = await getParser("javascript")
const src = [
  "function f(a) {",
  "  var x = null;",
  "  var y = undefined;",
  "  var z = NaN;",
  "  var w = Na;",
  "  var u = this;",
  "  return typeof a === 'null' ? null : undefined;",
  "}",
  "var o = { unknown: 1, 'na': 2 };",
  "g('unknown'); g(Na); g(null);",
].join("\n")
const tree = await parser.parse(src, "probe.js")
const stack: any[] = [tree.rootNode]
const rows: string[] = []
while (stack.length) {
  const n = stack.pop()
  if (!n) continue
  if (n.type === "identifier" || n.type === "property_identifier" || n.type.endsWith("word")) {
    rows.push(`${n.type}  ${n.text}`)
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) stack.push(c)
  }
}
console.log("identifier/property_identifier nodes in the probe source:")
for (const r of rows) console.log("  " + r)