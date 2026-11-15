import assert from "node:assert/strict"
import { ASTEngine } from "../../src/ast/engine"
import { compareEdgeIdentities, deriveSwiftBareUses, deriveSwiftEdges, qualifyCallableSources } from "../../script/m14/differential"

const file = "verification.swift"
const source = `
import Foundation
func deliver() {}
func first() { deliver() }
func second() { deliver() }
func overloaded(_ number: Int) { deliver() }
func overloaded(_ string: String) { deliver() }
enum Outcome { case make(Int) }
struct Factory { func make(_ number: Int) {} }
struct Counter {
    var count = 0
    func readCount() -> Int { self.count }
    func readBare() -> Int { count }
    func outer(_ counter: Counter) -> Int {
        func inner() -> Int { counter.count }
        return inner()
    }
}
struct Compared {
    static func == (left: Compared, right: Compared) -> Bool { compare(left, right) }
}
func construct() { _ = Outcome.make(1) }
func invoke(_ factory: Factory) { factory.make(2) }
class Base {
    func save(_ value: Int) {}
    func save(named value: String) {}
    func send(to value: Int) {}
}
class Child: Base {
    override func save(named item: String) {}
    override func send(to item: Int) {}
}
struct SharedValue {}
class Overloads {
    var member = 1
    init(_ value: Int) { consume(self.member); _ = SharedValue() }
    init(_ value: String) { consume(self.member); _ = SharedValue() }
}
`
const { tree } = await ASTEngine.parseTree(file, source)
try {
  assert.equal(tree.rootNode.hasError, false)
  const expected = ["first", "second"].map(from => ({ from, label: "calls", target: "deliver" }))
  const truth = deriveSwiftEdges(tree.rootNode)
  const qualified = qualifyCallableSources(tree.rootNode, truth.filter(edge => edge.target === "deliver"))
  assert.deepEqual(qualified.map(edge => edge.from), ["first", "second", "overloaded@6", "overloaded@7"])
  assert.equal(compareEdgeIdentities(expected, expected.slice(0, 1)).missing.length, 1)
  assert.ok(truth.some(edge => edge.from === "invoke" && edge.label === "calls" && edge.target === "make"))
  assert.ok(!truth.some(edge => edge.from === "construct" && edge.label === "calls" && edge.target === "make"))
  assert.ok(truth.some(edge => edge.from === "operator ==" && edge.label === "calls" && edge.target === "compare"))

  const result = await ASTEngine.parseFile(file, source)
  assert.ok(deriveSwiftBareUses(tree.rootNode, result.symbols)
    .some(edge => edge.from === "readBare" && edge.label === "uses" && edge.target === "count"))
  assert.ok(result.relationships.some(edge => edge.source === "readBare" && edge.type === "uses" && edge.target === "count"))
  for (const [from, label, target] of [
    ["Child", "extends", "Base"],
    ["construct", "instantiates", "Outcome"],
    ["readCount", "uses", "count"],
    ["inner", "uses", "count"],
    ["root", "references", "Foundation"],
  ]) {
    assert.ok(truth.some(edge => edge.from === from && edge.label === label && edge.target === target), `oracle: ${from} ${label} ${target}`)
    assert.ok(result.relationships.some(edge => edge.source === from && edge.type === label && edge.target === target), `analyzer: ${from} ${label} ${target}`)
  }
  assert.ok(result.relationships.some(edge => edge.source === "operator ==" && edge.type === "calls" && edge.target === "compare"))
  const actual = result.relationships.filter(edge => edge.target === "deliver")
    .map(edge => ({ from: edge.source, label: edge.type, target: edge.target, line: edge.line_number }))
  assert.equal(compareEdgeIdentities(expected, actual).matched, 2)
  const qualifiedActual = qualifyCallableSources(tree.rootNode, actual)
  assert.equal(compareEdgeIdentities(qualified, qualifiedActual).missing.length, 0)
  assert.equal(compareEdgeIdentities(qualified, qualifiedActual.filter(edge => edge.from !== "overloaded@7")).missing.length, 1)
  const usesAndConstruction = result.relationships.filter(edge =>
    edge.source === "constructor" && (edge.target === "member" || edge.target === "SharedValue"))
  for (const target of ["member", "SharedValue"]) {
    assert.equal(usesAndConstruction.filter(edge => edge.target === target).length, 2)
  }
  const overrides = result.relationships.filter(edge => edge.type === "overrides")
  assert.ok(overrides.some(edge => edge.source === "Child.save" && edge.target === "Base.save"
    && edge.metadata?.reasonCode === "overloaded-target-name" && edge.metadata?.evidenceClass === "inferred"))
  assert.ok(overrides.some(edge => edge.source === "Child.send" && edge.target === "Base.send"
    && edge.metadata?.evidenceClass === "structural"))
} finally {
  tree.delete()
}

const mismatched = await ASTEngine.parseFile(file, `
class Base { func send(to value: Int) {} }
class Child: Base { override func send(from value: Int) {} }
`)
const guesses = mismatched.relationships.filter(edge => edge.type === "overrides")
assert.ok(guesses.every(edge => edge.metadata?.evidenceClass === "inferred"))
assert.ok(guesses.some(edge => edge.metadata?.reasonCode === "first-parent-guess"))
console.log("Swift caller identities and override overload evidence verified")
process.exit(0)
