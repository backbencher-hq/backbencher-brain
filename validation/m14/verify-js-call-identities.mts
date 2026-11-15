import assert from "node:assert/strict"
import ts from "typescript"
import { ASTEngine } from "../../src/ast/engine"
import { compareEdgeIdentities, deriveJavaScriptEdges } from "../../script/m14/differential"

const file = "calls.js"
const source = `
function first() { service.run() }
function second() { service.run() }
const third = () => service.run()
class Fourth { fourth() { service.run() } }
queueMicrotask(() => service.run())
`
const compilerTree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const compilerSources: string[] = []
const visit = (node: ts.Node): void => {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "run") {
    let owner = node.parent
    while (owner && !ts.isFunctionLike(owner)) owner = owner.parent
    if (owner && ts.isFunctionLike(owner)) {
      const name = owner.name ?? (ts.isVariableDeclaration(owner.parent) ? owner.parent.name : undefined)
      if (name && ts.isIdentifier(name)) compilerSources.push(name.text)
    }
  }
  ts.forEachChild(node, visit)
}
visit(compilerTree)
assert.equal(compilerSources.length, 4)

const { tree } = await ASTEngine.parseTree(file, source)
try {
  const oracle = deriveJavaScriptEdges(tree.rootNode, { callSources: true }).filter(edge => edge.label === "calls" && edge.target === "run")
  const named = oracle.filter(edge => edge.from !== "(expr)")
  assert.deepEqual(named.map(edge => edge.from).sort(), compilerSources.sort())
  assert.equal(oracle.filter(edge => edge.from === "(expr)").length, 1)
  const result = await ASTEngine.parseFile(file, source)
  const actual = result.relationships.filter(edge => edge.type === "calls" && edge.target === "run")
    .map(edge => ({ label: edge.type, from: edge.source, target: edge.target }))
  const good = compareEdgeIdentities(oracle, actual)
  assert.equal(good.matched, 4)
  assert.equal(good.missing.length, 0)
  assert.equal(good.unverifiable.length, 1)
  const mutant = compareEdgeIdentities(oracle, actual.filter(edge => edge.from !== "second"))
  assert.deepEqual(mutant.missing.map(edge => edge.from), ["second"])
  assert.equal(mutant.matched, 3)
} finally {
  tree.delete()
}
console.log("JavaScript caller identities agree with the compiler AST and reject a dropped caller")
process.exit(0)
