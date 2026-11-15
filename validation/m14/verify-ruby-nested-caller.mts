import assert from "node:assert/strict"
import { ASTEngine } from "../../src/ast/engine"
import { deriveRubyEdges } from "../../script/m14/ruby-truth"

const file = "nested_caller.rb"
const source = `
require "example/helper"
def configure
  worker
  settings.limit = 2
  Module.new do
    def execute(worker)
      worker.deliver
      inside_only = worker
    end
  end
  inside_only
end
`
const { tree } = await ASTEngine.parseTree(file, source)
try {
  assert.equal(tree.rootNode.hasError, false)
  const truth = deriveRubyEdges(tree.rootNode)
  const result = await ASTEngine.parseFile(file, source)
  assert.deepEqual(result.errors, [])
  assert.ok(result.symbols.some(symbol =>
    symbol.name === "execute" && symbol.ownerName === "configure" && symbol.metadata?.nestedDeclaration))
  for (const [from, target] of [["execute", "deliver"], ["configure", "worker"], ["configure", "inside_only"], ["configure", "settings"]]) {
    assert.ok(truth.some(edge => edge.label === "calls" && edge.from === from && edge.target === target), `oracle: ${from} -> ${target}`)
    assert.ok(result.relationships.some(edge => edge.type === "calls" && edge.source === from && edge.target === target), `analyzer: ${from} -> ${target}`)
  }
  assert.ok(!result.relationships.some(edge => edge.type === "calls" && edge.source === "configure" && edge.target === "deliver"))
  assert.ok(truth.some(edge => edge.label === "contains" && edge.from === "configure" && edge.target === "execute"))
  assert.ok(result.relationships.some(edge => edge.type === "contains" && edge.source === "configure" && edge.target === "execute"))
  for (const label of ["imports", "references"]) {
    assert.ok(truth.some(edge => edge.label === label && edge.from === "Global" && edge.target === "example/helper"))
    assert.ok(result.relationships.some(edge => edge.type === label && edge.source === "Global" && edge.target === "example/helper"))
  }
} finally {
  tree.delete()
}
const external = await ASTEngine.parseFile(file, `
class Child < Remote
  def work; end
end
`, { overrideCompanion: new Map([["Remote", new Set(["work"])]]) })
const edge = external.relationships.find(edge => edge.type === "overrides" && edge.source === "Child.work")
assert.equal(edge?.confidence, 0.65)
assert.equal(edge?.metadata?.evidenceClass, "inferred")
console.log("Ruby nested caller and file dependency identities verified")
process.exit(0)
