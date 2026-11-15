import { Parser, Language } from "web-tree-sitter"
import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = "/home/ishaq2321/mcp/bb-lanes/sql"
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser(); parser.setLanguage(language as any)
const tree = parser.parse(readFileSync(process.argv[2], "utf8"))
const show = (n: any, d: number) => {
  if (d > 9) return
  console.log("  ".repeat(d) + n.type + (n.namedChildCount === 0 ? `  ${JSON.stringify(n.text.slice(0,30))}` : ""))
  for (let i = 0; i < n.namedChildCount; i++) show(n.namedChild(i), d + 1)
}
show(tree.rootNode, 0)
