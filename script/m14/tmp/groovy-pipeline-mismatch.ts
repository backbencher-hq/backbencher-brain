// Why do 34 grails-core files contain ERROR/MISSING nodes in a direct tree walk
// while ASTEngine.parseFile reports zero errors for them? The engine guards its
// walk with `if (tree.rootNode.hasError)`, then descends via `node.children`.
// This compares those two traversal APIs and `hasError` on the exact files that
// disagreed, so the masking rule is measured, not guessed.
//
// Usage: bun run script/m14/tmp/groovy-pipeline-mismatch.ts
import * as fs from "fs"
import { ASTEngine } from "../../../src/ast/engine"

const REPO = "/home/ishaq2321/bb_tests/repositories/grails-core"
const FILES = [
  "grails-core/src/test/resources/test-application.groovy",
  "grails-data-hibernate5/dbmigration/src/integration-test/resources/changelog-account-sql.groovy",
  "grails-spring-security/rest/core/grails-app/conf/logback.groovy",
]

function countViaChildIndex(root: any): { err: number; miss: number } {
  let err = 0
  let miss = 0
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "ERROR") err++
    if (n.isMissing) miss++
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return { err, miss }
}

function countViaChildren(root: any): { err: number; miss: number } {
  let err = 0
  let miss = 0
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "ERROR") err++
    if (n.isMissing) miss++
    const kids = n.children
    for (let i = 0; i < kids.length; i++) {
      if (kids[i]) stack.push(kids[i])
    }
  }
  return { err, miss }
}

async function main() {
  for (const rel of FILES) {
    const abs = REPO + "/" + rel
    if (!fs.existsSync(abs)) {
      console.log("ABSENT " + rel)
      continue
    }
    const src = fs.readFileSync(abs, "utf8")
    const parser = await ASTEngine.getParser("groovy")
    const tree = parser.parse(src)
    const root = tree.rootNode
    const viaIndex = countViaChildIndex(root)
    const viaChildren = countViaChildren(root)
    const parsed = await ASTEngine.parseFile(abs, src)
    console.log("")
    console.log("=== " + rel + " ===")
    console.log("   rootNode.hasError     : " + root.hasError)
    console.log("   rootNode.type         : " + root.type + "  isMissing=" + root.isMissing)
    console.log("   ERROR/MISSING via child(i): " + viaIndex.err + " / " + viaIndex.miss)
    console.log("   ERROR/MISSING via children: " + viaChildren.err + " / " + viaChildren.miss)
    console.log("   ASTEngine.parseFile errors: " + (parsed.errors ?? []).length)
    if ((parsed.errors ?? []).length > 0) {
      console.log("      first: " + (parsed.errors[0] as any).message + " @ line " + (parsed.errors[0] as any).range?.startLine)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
