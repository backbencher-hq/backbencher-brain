import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const source = readFileSync("src/ast/real-xml-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of source.matchAll(/(?:type\s*===\s*|findDirectChild\([^,]+,\s*|new Set\(\[)(?:["'])([A-Za-z_]+)(?:["'])/g)) {
  if (match[1]) refs.add(match[1])
}
const parser = await ASTEngine.getParser("xml")
const observed = new Set<string>()
const fixtureDir = "validation/m12/fixtures/xml"
const shapeInputs = [
  ...readdirSync(fixtureDir).filter((f) => /\.(xml|xsd)$/i.test(f)).sort().map((file) => readFileSync(join(fixtureDir, file), "utf8")),
  // The current production corpus is clean XML/XSD and contains no internal
  // DTD subset. Exercise the grammar's DTD declaration vocabulary separately
  // so defensive handlers are shape-verified without claiming corpus support.
  `<!DOCTYPE book PUBLIC "-//ACME//DTD BOOK 1.0//EN" "book.dtd" [<!ELEMENT book (title)> <!ATTLIST book id CDATA #REQUIRED>]><book id="b"><title/></book>`,
]
for (const input of shapeInputs) {
  const tree = parser.parse(input)
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const node = stack.pop()!
    observed.add(node.type)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  tree.delete?.()
}
const live = [...refs].filter((type) => observed.has(type)).sort()
const dead = [...refs].filter((type) => !observed.has(type)).sort()
const result = {
  analyzer: "xml",
  grammar: "vendored wasm/tree-sitter-xml.wasm",
  fixtureFiles: readdirSync(fixtureDir).filter((f) => /\.(xml|xsd)$/i.test(f)).sort(),
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedFixtureNodeTypes: [...observed].sort(),
  passed: live.length > 0 && dead.length === 0,
}
writeFileSync("validation/m12/results/xml-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
