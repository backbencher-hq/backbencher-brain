// Lane-local AST dumper. Prints the named-node tree of one file so a claim
// about "the grammar puts X here" can be read off a real parse instead of
// assumed. NO REGEX: depth/limit are numbers, node types are compared with ===.
//
// Usage: tsx validation/m14/kotlin/kotlin-ast-dump.ts <file> [maxDepth] [typeFilter]
import { readFileSync } from "node:fs"
import { getParser } from "../../../src/ast/engine"

async function main() {
  const file = process.argv[2]
  const maxDepth = Number(process.argv[3] || 99)
  const filter = process.argv[4] || ""
  if (!file) { console.error("usage: kotlin-ast-dump.ts <file> [maxDepth] [typeFilter]"); process.exit(2) }
  const content = readFileSync(file, "utf8")
  const parser = await getParser("kotlin")
  const pr = await parser.parse(content, file)
  const root = pr.rootNode
  let printed = 0
  const LIMIT = 4000
  const stack: Array<{ n: any; d: number }> = [{ n: root, d: 0 }]
  while (stack.length) {
    const { n, d } = stack.pop() as any
    if (filter && n.type !== filter) {
      // still descend
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push({ n: c, d: d + 1 }) }
      continue
    }
    const txt = n.text.length > 60 ? n.text.slice(0, 60).split("\n").join("\\n") + "..." : n.text
    printed++
    if (printed <= LIMIT) console.log(`${"  ".repeat(Math.min(d, 40))}${n.type} [${n.startPosition.row + 1}:${n.startPosition.column + 1}] ${JSON.stringify(txt)}`)
    if (d >= maxDepth) continue
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push({ n: c, d: d + 1 }) }
  }
  if (printed > LIMIT) console.log(`... ${printed - LIMIT} more nodes not printed`)
  console.log(`hasError=${root.hasError}`)
}
main().catch((e) => { console.error(String(e)); process.exit(1) })