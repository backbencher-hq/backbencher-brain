import assert from "node:assert/strict"
import { ASTEngine } from "../../src/ast/engine"
import { deriveGoEdges } from "../../script/m14/differential"

const file = "construction.go"
const source = `package sample
type Widget struct{}
func Run() int { return 0 }
func Work() { _ = Run(); _ = Widget{} }
`
const { tree } = await ASTEngine.parseTree(file, source)
try {
  assert.equal(tree.rootNode.hasError, false)
  const truth = deriveGoEdges(tree.rootNode)
  assert.ok(truth.some(edge => edge.label === "instantiates" && edge.target === "Run"))
  assert.ok(!truth.some(edge => edge.label === "renders" && edge.target === "Run"))
} finally {
  tree.delete()
}
const result = await ASTEngine.parseFile(file, source)
assert.deepEqual(result.errors, [])
assert.equal(result.relationships.find(edge => edge.type === "instantiates" && edge.target === "Run")?.metadata?.evidenceClass, "inferred")
assert.equal(result.relationships.find(edge => edge.type === "instantiates" && edge.target === "Widget")?.metadata?.evidenceClass, "structural")
console.log("Go oracle label and construction evidence passed")
process.exit(0)
