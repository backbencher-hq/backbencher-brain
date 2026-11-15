/** Dump the tree-sitter s-expression for a .jl file (or a line range), to navigate the AST
 *  the way the analyzer must. Probes in this lane read the tree; none of them regex. */
import { readFileSync } from "node:fs"
const REPO = "/home/ishaq2321/mcp/backbencher-brain"
const f = process.argv[2]!
const from = Number(process.argv[3] || 0)
const to = Number(process.argv[4] || 0)
const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const parser = await getParser("julia")
const content = readFileSync(f, "utf8")
const pr: any = await parser.parse(content, f)
const root = pr.rootNode
const show = (n: any, depth: number) => {
  const named = n.isNamed ? "" : " (anon)"
  const txt = n.namedChildCount === 0 ? ` ${JSON.stringify(n.text.slice(0, 90))}` : ""
  console.log(`${"  ".repeat(depth)}${n.type}${named} [${n.startPosition.row + 1}:${n.startPosition.column}-${n.endPosition.row + 1}:${n.endPosition.column}]${txt}`)
  for (let i = 0; i < n.namedChildCount; i++) show(n.namedChild(i), depth + 1)
}
if (from > 0) {
  const walk = (n: any) => {
    if (n.startPosition.row + 1 <= to && n.endPosition.row + 1 >= from && n.namedChildCount > 0) {
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    } else if (n.startPosition.row + 1 <= to && n.endPosition.row + 1 >= from) {
      show(n, 0)
    }
  }
  walk(root)
} else show(root, 0)
console.log("---- sexp ----")
console.log(root.toString().slice(0, 4000))
