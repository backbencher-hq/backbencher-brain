// cpp-tree-dump.ts — print the parse tree (type, span, text) so a wrapper shape
// can be read off the grammar instead of guessed at.
//   bun script/m14/tmp/cpp-tree-dump.ts <file> [maxDepth]
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __filename = fileURLToPath(import.meta.url)

const HERE = (import.meta as any).dir ?? path.dirname((import.meta as any).filename ?? __filename)
const ROOT = path.resolve(HERE, "..", "..", "..")
const file = path.resolve(process.argv[2])
const maxDepth = parseInt(process.argv[3] ?? "99")
await (Parser as any).init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
const p = new Parser()
p.setLanguage(g)
const root = p.parse(fs.readFileSync(file, "utf8")).rootNode
const walk = (n: any, d: number, field: string | null) => {
  const t = n.text.replace(/\s+/g, " ")
  console.log(`${"  ".repeat(d)}${field ? field + ": " : ""}${n.type}${n.hasError ? " [ERROR]" : ""} [${n.startIndex}..${n.endIndex}] ${t.length > 70 ? t.slice(0, 70) + "…" : t}`)
  if (d >= maxDepth) return
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    let f: string | null = null
    for (const fn of ["declarator", "parameters", "body", "name", "function", "field", "argument", "size", "type", "default_value"]) {
      const x = n.childForFieldName?.(fn)
      if (x && x.id === c.id) { f = fn; break }
    }
    walk(c, d + 1, f)
  }
}
walk(root, 0, null)
