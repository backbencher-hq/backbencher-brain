// For the failing .gradle files, print the ERROR node's OWN text (not just its
// start line) plus surrounding lines, so the real construct is visible instead
// of the recovery point.
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { ASTEngine } from "../../../src/ast/engine"

const REPO = "/home/ishaq2321/bb_tests/repositories/grails-core"
const files = process.argv.slice(2)

async function main(): Promise<void> {
  for (const file of files) {
    const src = readFileSync(`${REPO}/${file}`, "utf8")
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    if (!root || !root.hasError) {
      console.log(`\n### ${file}: no error`)
      continue
    }
    console.log(`\n### ${file}`)
    const stack: any[] = [root]
    let shown = 0
    while (stack.length > 0 && shown < 3) {
      const n = stack.pop()!
      if (n.type === "ERROR" || n.isMissing) {
        shown++
        const r = n.startPosition.row
        const lines = src.split("\n")
        console.log(`  ERROR ${n.isMissing ? "(missing) " : ""}@${r + 1}:${n.startPosition.column}`)
        console.log(`    node text: ${JSON.stringify(n.text.slice(0, 140))}`)
        for (let i = Math.max(0, r - 2); i <= Math.min(lines.length - 1, r + 3); i++) {
          console.log(`    ${i === r ? ">" : " "} ${i + 1}: ${lines[i]?.slice(0, 120)}`)
        }
        // children types
        const kids: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i).type)
        console.log(`    children: [${kids.join(", ")}]`)
      }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
