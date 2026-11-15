import assert from "node:assert/strict"
import { ASTEngine } from "../../src/ast/engine"
import {
  compareEdgeIdentities, deriveCSharpEdges, deriveCSharpContains, derivePhpEdges, deriveSwiftBareUses,
  qualifyCallableSources,
} from "../../script/m14/differential"
import { deriveRubyEdges } from "../../script/m14/ruby-truth"

const cases = [
  {
    file: "identity.php",
    source: `<?php
class Counter {
  private int $value = 1;
  function first(int $argument) { $local = $argument; return $this->value + $local; }
  function second(int $argument) { return $this->first($argument); }
  function create() { return new class {
    function invoke() { return new ResultValue(); }
  }; }
}
enum Choice { case First; function opposite() { return self::First; } }
`,
    oracle: (root: any, symbols: any[]) => derivePhpEdges(root, true),
    edges: [
      { label: "uses", from: "first", target: "Counter.value" },
      { label: "uses", from: "first", target: "first\0argument" },
      { label: "calls", from: "second", target: "Counter.first" },
      { label: "instantiates", from: "invoke", target: "ResultValue" },
      { label: "uses", from: "opposite", target: "Choice.First" },
    ],
  },
  {
    file: "identity.cs",
    source: `class Example {
  void First() { Service.Run(); new Example(); }
  void Second() { Service.Run(); new Example(); }
  void Outer() { void Local() { Service.Release(); } Local(); }
  ~Example() { Service.Dispose(); }
}`,
    oracle: (root: any) => [...deriveCSharpEdges(root, undefined, true), ...deriveCSharpContains(root)],
    edges: [
      { label: "calls", from: "First", target: "Run" },
      { label: "calls", from: "Second", target: "Run" },
      { label: "instantiates", from: "First", target: "Example" },
      { label: "instantiates", from: "Second", target: "Example" },
      { label: "calls", from: "Local", target: "Release" },
      { label: "calls", from: "Outer", target: "Local" },
      { label: "contains", from: "Outer", target: "Local" },
      { label: "calls", from: "Finalize", target: "Dispose" },
    ],
  },
  {
    file: "identity.rb",
    source: `module Example
  class Counter
    def first; end
    include Shared
  end
end
`,
    oracle: (root: any) => deriveRubyEdges(root, undefined, "identity.rb"),
    edges: [
      { label: "contains", from: "Example", target: "Counter" },
      { label: "contains", from: "Counter", target: "first" },
      { label: "mixes_in", from: "Counter", target: "Shared" },
      { label: "exports", from: "identity", target: "Example" },
    ],
  },
  {
    file: "identity.swift",
    source: `class Example {
      var value = 0
      init() { $value.map { _ in self.value } }
    }`,
    oracle: (root: any, symbols: any[]) => deriveSwiftBareUses(root, symbols),
    edges: [{ label: "uses", from: "constructor", target: "value" }],
  },
]

for (const sample of cases) {
  const { tree } = await ASTEngine.parseTree(sample.file, sample.source)
  try {
    assert.equal(tree.rootNode.hasError, false, sample.file)
    const result = await ASTEngine.parseFile(sample.file, sample.source)
    assert.deepEqual(result.errors, [], sample.file)
    const oracle = sample.oracle(tree.rootNode, result.symbols)
    const actual = result.relationships.map(edge => ({
      label: edge.type, from: edge.source, target: edge.target,
    }))
    for (const expected of sample.edges) {
      assert.equal(compareEdgeIdentities([expected], oracle as any).matched, 1, "oracle " + JSON.stringify(expected))
      assert.equal(compareEdgeIdentities([expected], actual).matched, 1, "analyzer " + JSON.stringify(expected))
    }
    const removed = sample.edges[0]
    assert.equal(compareEdgeIdentities([removed], oracle.filter(edge =>
      edge.label !== removed.label || edge.from !== removed.from || edge.target !== removed.target) as any).missing.length, 1)
  } finally {
    tree.delete()
  }
}
const duplicateSource = `
class First
  def run
    service
  end
end
class Second
  def run
    service
  end
end
`
const duplicateTree = (await ASTEngine.parseTree("duplicate.rb", duplicateSource)).tree
try {
  const result = await ASTEngine.parseFile("duplicate.rb", duplicateSource)
  const truth = qualifyCallableSources(duplicateTree.rootNode,
    deriveRubyEdges(duplicateTree.rootNode).filter(edge => edge.label === "calls") as any)
  const actual = qualifyCallableSources(duplicateTree.rootNode,
    result.relationships.filter(edge => edge.type === "calls").map(edge => ({
      label: edge.type, from: edge.source, target: edge.target, line: edge.line_number,
    })))
  assert.equal(compareEdgeIdentities(truth, actual).matched, 2)
  assert.equal(compareEdgeIdentities(truth, actual.slice(0, 1)).missing.length, 1)
  assert.equal(qualifyCallableSources(duplicateTree.rootNode, [
    { label: "calls", from: "run", target: "service" },
  ])[0].from, "(expr)")
} finally {
  duplicateTree.delete()
}
console.log("Four-language oracle identity controls passed")
process.exit(0)
