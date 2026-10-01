import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await (wts as any).Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const parser = new P(); parser.setLanguage(grammar)

const files = process.argv.slice(2)
for (const f of files) {
  const src = readFileSync(f, "utf8")
  const root = parser.parse(src).rootNode
  // find class_interface_clause occurrences and their owner
  const stack: any[] = [root]
  const found: any[] = []
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "class_interface_clause") {
      const parent = n.parent
      let ownerName = parent?.childForFieldName?.("name")?.text
      if (!ownerName) { for (let i = 0; i < (parent?.namedChildCount ?? 0); i++) { const c = parent.namedChild(i); if (c?.type === "name") { ownerName = c.text; break } } }
      found.push({ parentType: parent?.type, ownerName, text: n.text, children: Array.from({ length: n.namedChildCount }, (_, i) => n.namedChild(i)?.text) })
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  const res: any = await ASTEngine.parseFile(f, src)
  const impl = res.relationships.filter((r: any) => r.type === "implements")
  console.log(`\n### ${path.basename(f)}`)
  console.log(`  AST class_interface_clause: ${found.length}`)
  for (const x of found) console.log(`    parent=${x.parentType} owner=${x.ownerName} children=${JSON.stringify(x.children)}`)
  console.log(`  analyzer implements edges: ${impl.length}`)
  for (const e of impl) console.log(`    ${e.source} -> ${e.target} (line ${e.line_number})`)
}
process.exit(0)
