import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { ASTEngine } from "../../src/ast/engine"
import { compareEdgeIdentities } from "../../script/m14/differential"

interface ClangNode {
  kind: string
  name?: string
  referencedDecl?: { kind: string; name: string }
  inner?: ClangNode[]
}

const source = `
void consume(void) {}
void first(void) { consume(); }
void second(void) { consume(); }
void control(void) {}
`
function findFunctionReference(node: ClangNode): string | undefined {
  if (node.referencedDecl?.kind === "FunctionDecl") return node.referencedDecl.name
  for (const child of node.inner ?? []) {
    const found = findFunctionReference(child)
    if (found) return found
  }
}

for (const [extension, language] of [["c", "c"], ["cpp", "c++"]]) {
  const clang = process.env.CLANG || "clang"
  const compilerTree: ClangNode = JSON.parse(execFileSync(clang, [
    "-x", language, "-fsyntax-only", "-Xclang", "-ast-dump=json", "-",
  ], { input: source, encoding: "utf8" }))
  const truth = (compilerTree.inner ?? []).flatMap(fn => {
    if (fn.kind !== "FunctionDecl" || !fn.name) return []
    const body = fn.inner?.find(node => node.kind === "CompoundStmt")
    return (body?.inner ?? []).flatMap(node => {
      const target = node.kind === "CallExpr" && node.inner?.[0] && findFunctionReference(node.inner[0])
      return target ? [{ label: "calls", from: fn.name!, target }] : []
    })
  })
  assert.equal(truth.length, 2)
  const result = await ASTEngine.parseFile(`calls.${extension}`, source)
  assert.deepEqual(result.errors, [])
  const actual = result.relationships.filter(edge => edge.type === "calls")
    .map(edge => ({ label: edge.type, from: edge.source, target: edge.target }))
  const comparison = compareEdgeIdentities(truth, actual)
  assert.equal(comparison.matched, truth.length)
  assert.deepEqual(comparison.missing, [])
  assert.deepEqual(comparison.unexpected, [])
  const mutant = compareEdgeIdentities(truth, actual.filter(edge => edge.from !== "second"))
  assert.deepEqual(mutant.missing.map(edge => edge.from), ["second"])
  console.log(`${language}: Clang agrees on both caller endpoints and catches a dropped edge`)
}
process.exit(0)
