import { readFileSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"
import * as path from "node:path"
const ROOT = "/home/ishaq2321/mcp/bb-lanes/sql"
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser(); parser.setLanguage(language as any)
const f = process.argv[2]
const t = parser.parse(readFileSync(f, "utf8"))
console.log("root type:", t.rootNode.type, "hasError:", t.rootNode.hasError)
const stack: any[] = [t.rootNode]
while (stack.length) {
  const n = stack.pop()!
  if (n.type === "ERROR" || n.isMissing) console.log(`  ${n.isMissing ? "MISSING" : "ERROR"} ${JSON.stringify(n.text.slice(0,70))} @${n.startPosition.row+1}`)
  for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
}
