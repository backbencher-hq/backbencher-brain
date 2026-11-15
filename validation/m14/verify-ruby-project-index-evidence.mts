import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { emptyProjectIndex, indexTree, RUBY_DECLARATION_SPEC } from "../../src/ast/project-index"

if (process.argv.some(arg => arg.startsWith("--mutate-"))) {
  Bun.plugin({
    name: "ruby-override-algorithm-mutation",
    setup(build) {
      build.onLoad({ filter: /real-ruby-analyzer\.ts$/ }, ({ path }) => {
        const source = readFileSync(path, "utf8")
        const dispatch = process.argv.includes("--mutate-dispatch")
        const hierarchy = process.argv.includes("--mutate-hierarchy")
        const original = dispatch ? 's.isStatic === true ? "singleton" : "instance"'
          : hierarchy ? "while (!inFileMethods?.has(s.name))" : "r.confidence = 0.65"
        assert.ok(source.includes(original), "mutation must reach the production decision")
        return { contents: source.replaceAll(original, dispatch ? '"instance"'
          : hierarchy ? "while (false && !inFileMethods?.has(s.name))" : "r.confidence = 0.95"), loader: "ts" }
      })
    },
  })
}
const { ASTEngine } = await import("../../src/ast/engine")
const { deriveRubyEdges } = await import("../../script/m14/ruby-truth")

const savedFlag = process.env.BB_RUBY_INDEX_CONSUME
process.env.BB_RUBY_INDEX_CONSUME = "1"
async function analyze(base: string, source: string) {
  const index = emptyProjectIndex()
  index.complete = true
  const parsed = await ASTEngine.parseTree("base.rb", base)
  assert.equal(parsed.tree.rootNode.hasError, false)
  indexTree(parsed.tree.rootNode, index, RUBY_DECLARATION_SPEC, "base.rb")
  parsed.tree.delete()
  const result = await ASTEngine.parseFile("child.rb", source, { projectIndex: index })
  assert.deepEqual(result.errors, [])
  return result
}

const wrongNamespace = await analyze("module Wrong\n class Base\n def run; end\n end\nend\n", "class Child < Wanted::Base\n def run; end\nend\n")
const wrongEdge = wrongNamespace.relationships.find(edge => edge.type === "overrides")!
assert.ok(wrongEdge)
assert.notEqual(wrongEdge.metadata?.projectIndexVerified, true, "another namespace's Base must not verify Wanted::Base")
assert.equal(wrongEdge.confidence, 0.5)
assert.notEqual(wrongNamespace.relationships.find(edge => edge.type === "extends")?.metadata?.projectIndexDeclared, true)

const singleton = await analyze("class Base\n def self.run; end\nend\n", "class Child < Base\n def run; end\nend\n")
const singletonEdge = singleton.relationships.find(edge => edge.type === "overrides")!
assert.notEqual(singletonEdge.metadata?.projectIndexVerified, true, "singleton method names do not prove an instance override")
assert.equal(singletonEdge.metadata?.evidenceClass, "inferred")
assert.ok(singletonEdge.confidence < 0.9)

const candidate = await analyze("class Base\n def run; end\nend\n", "class Child < Base\n def run; end\nend\n")
const candidateEdge = candidate.relationships.find(edge => edge.type === "overrides")!
assert.equal(candidateEdge.metadata?.projectIndexNameCandidate, true)
assert.equal(candidateEdge.metadata?.evidenceClass, "inferred")
assert.equal(candidateEdge.confidence, 0.65)
assert.equal(candidate.metadata?.projectIndex?.verifiedOverrides, 0)

const local = await analyze("", "class Base\n def run; end\nend\nclass Child < Base\n def run; end\nend\n")
const localEdge = local.relationships.find(edge => edge.type === "overrides")!
assert.equal(localEdge.metadata?.reasonCode, "in-file-verified")
assert.equal(localEdge.metadata?.evidenceClass, "structural")
assert.equal(localEdge.confidence, 0.95)

const dispatchSource = `class Base
  def self.class_only; end
  def instance_only; end
  def instance_ok; end
  def self.class_ok; end
  class << self
    def block_ok; end
  end
end
class Child < Base
  def class_only; end
  def self.instance_only; end
  def instance_ok; end
  def self.class_ok; end
  class << self
    def block_ok; end
  end
end
class Mid < Base; end
class GrandChild < Mid
  def instance_ok; end
  def self.class_ok; end
end
`
const dispatch = await analyze("", dispatchSource)
const dispatchEdges = dispatch.relationships.filter(edge => edge.type === "overrides")
assert.deepEqual(dispatchEdges.map(edge => [edge.source, edge.target, edge.metadata?.dispatchKind]).sort(), [
  ["Child.block_ok", "Base.block_ok", "singleton"],
  ["Child.class_ok", "Base.class_ok", "singleton"],
  ["Child.instance_ok", "Base.instance_ok", "instance"],
  ["GrandChild.class_ok", "Base.class_ok", "singleton"],
  ["GrandChild.instance_ok", "Base.instance_ok", "instance"],
])
const { tree } = await ASTEngine.parseTree("dispatch.rb", dispatchSource)
assert.deepEqual(deriveRubyEdges(tree.rootNode).filter(edge => edge.label === "overrides").map(edge => [edge.from, edge.target]).sort(),
  dispatchEdges.map(edge => [edge.source, edge.target]).sort())
tree.delete()

if (savedFlag === undefined) delete process.env.BB_RUBY_INDEX_CONSUME
else process.env.BB_RUBY_INDEX_CONSUME = savedFlag
console.log("Ruby override dispatch kinds stay separate; name indexes retain inferred evidence")
process.exit(0)
