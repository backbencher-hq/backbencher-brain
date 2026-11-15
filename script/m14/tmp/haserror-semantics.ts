// A tree contains an ERROR node, yet rootNode.hasError is false. If that is the
// real semantics of the binding, then EVERY consumer that gates error detection
// on `rootNode.hasError` — `ASTEngine.parseFile` is one — silently reports
// "0 syntax errors" for those files. Measure the exact semantics before
// proposing a fix: is hasError false on the ERROR node itself, on its parents,
// and does it depend on how the node was reached?
//
// Usage: bun run script/m14/tmp/haserror-semantics.ts
import * as fs from "fs"
import { ASTEngine } from "../../../src/ast/engine"

const REPO = "/home/ishaq2321/bb_tests/repositories/grails-core"
const REL = "grails-core/src/test/resources/test-application.groovy"

async function main() {
  const src = fs.readFileSync(REPO + "/" + REL, "utf8")
  const parser = await ASTEngine.getParser("groovy")
  const tree = parser.parse(src)
  const root = tree.rootNode

  console.log("root: type=" + root.type + " hasError=" + root.hasError + " childCount=" + root.childCount)

  // Locate the ERROR node(s) and report the flags on the whole chain.
  const found: { node: any; chain: any[] }[] = []
  const walk = (n: any, chain: any[]) => {
    if (n.type === "ERROR" || n.isMissing) {
      if (found.length < 3) found.push({ node: n, chain: [...chain, n] })
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c, [...chain, n])
    }
  }
  walk(root, [])

  for (const f of found) {
    console.log("")
    console.log("=== ERROR node @ line " + (f.node.startPosition.row + 1) + " ===")
    console.log("   type=" + f.node.type + " isMissing=" + f.node.isMissing + " hasError=" + f.node.hasError)
    console.log("   text=" + JSON.stringify(String(f.node.text).slice(0, 60)))
    console.log("   ancestry (root -> node), hasError flag per level:")
    for (const a of f.chain) {
      console.log("     " + a.type.padEnd(22) + " hasError=" + a.hasError + " childCount=" + a.childCount)
    }
  }

  // Independent check: does the tree object itself expose an error flag, and
  // does a SECOND traversal agree? (rule out a one-shot/stale-handle artefact)
  console.log("")
  console.log("second parse, same file:")
  const tree2 = parser.parse(src)
  console.log("   root2.hasError = " + tree2.rootNode.hasError)
  let second = 0
  const stack: any[] = [tree2.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "ERROR" || n.isMissing) second++
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  console.log("   ERROR/MISSING nodes found = " + second + "  (hasError says " + tree2.rootNode.hasError + ")")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
