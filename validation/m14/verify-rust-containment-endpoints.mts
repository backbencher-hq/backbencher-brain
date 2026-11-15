import assert from "node:assert/strict"
import { ASTEngine } from "../../src/ast/engine"
import { deriveRustContainsTruth } from "../../script/m14/oracles/rust-contains"

const file = "containment.rs"
const source = `
mod sinks {
    struct Sink<T>(T);
    trait Write { fn write(&self); }
    impl<T> Write for Sink<T> { fn write(&self) {} }
    fn process() {
        if true { const LIMIT: usize = 10; let value = LIMIT; }
    }
}
`
const { tree } = await ASTEngine.parseTree(file, source)
try {
  assert.equal(tree.rootNode.hasError, false)
  const truth = deriveRustContainsTruth(tree.rootNode)
  const analysis = await ASTEngine.parseFile(file, source)
  const actual = analysis.relationships.filter(edge => edge.type === "contains")
  for (const [from, target] of [["sinks", "Sink::r#impl"], ["Sink", "write"], ["process", "LIMIT"]]) {
    assert.ok(truth.some(edge => edge.from === from && edge.target === target), `oracle: ${from} -> ${target}`)
    assert.ok(actual.some(edge => edge.source === from && edge.target === target), `analyzer: ${from} -> ${target}`)
  }
  assert.ok(!truth.some(edge => edge.target === "value"))
} finally {
  tree.delete()
}
console.log("Rust oracle and analyzer agree on nested const and impl ownership")
process.exit(0)
