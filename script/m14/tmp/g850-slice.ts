// Parse a line range of a file, print hasError + the error node text.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const REPO = "/home/ishaq2321/bb_tests/repositories/grails-core"
const file = process.argv[2]
const from = parseInt(process.argv[3] ?? "1")
const to = process.argv[4] ? parseInt(process.argv[4]) : Infinity

async function main(): Promise<void> {
  const lines = readFileSync(`${REPO}/${file}`, "utf8").split("\n")
  const src = lines.slice(from - 1, Number.isFinite(to) ? to : undefined).join("\n")
  const parser = await ASTEngine.getParser("groovy" as any)
  const root = parser.parse(src)?.rootNode
  console.log(`--- ${file} lines ${from}..${Number.isFinite(to) ? to : "EOF"} (${src.split("\n").length} lines) ---`)
  console.log(`hasError=${root?.hasError}`)
  console.log(src.length > 600 ? src.slice(0, 600) + "…" : src)
  if (root?.hasError) {
    const stack: any[] = [root]
    let shown = 0
    while (stack.length && shown < 2) {
      const n = stack.pop()!
      if (n.type === "ERROR" || n.isMissing) {
        shown++
        console.log(`ERROR @${n.startPosition.row + 1}:${n.startPosition.column} ${JSON.stringify(n.text.slice(0, 200))}`)
        const kids: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i).type)
        console.log(`  children: [${kids.join(", ")}]`)
      }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
