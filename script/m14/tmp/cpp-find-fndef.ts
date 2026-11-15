// cpp-find-fndef.ts — print the subtree (and source text) of every
// function_definition whose text contains a needle, so a corpus shape can be read
// off the grammar exactly rather than guessed at.
//   bun script/m14/tmp/cpp-find-fndef.ts <file> <needle> [maxOutChars]
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __filename = fileURLToPath(import.meta.url)

const HERE = (import.meta as any).dir ?? path.dirname((import.meta as any).filename ?? __filename)
const ROOT = path.resolve(HERE, "..", "..", "..")
const file = path.resolve(process.argv[2])
const needle = process.argv[3]
const cap = parseInt(process.argv[4] ?? "3000")
const src = fs.readFileSync(file, "utf8")

await (Parser as any).init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
const p = new Parser()
p.setLanguage(g)
const root = p.parse(src).rootNode

const stack: any[] = [root]
let hits = 0
while (stack.length > 0) {
  const n = stack.pop()!
  if (n.type === "function_definition" && n.text.includes(needle)) {
    hits++
    console.log(`\n===== function_definition @line ${n.startPosition.row + 1} [${n.startIndex}..${n.endIndex}] hasError=${n.hasError}`)
    const walk = (x: any, d: number, field: string | null) => {
      const t = x.text.replace(/\s+/g, " ")
      console.log(`${"  ".repeat(d)}${field ? field + ": " : ""}${x.type}${x.hasError ? " [ERROR]" : ""} ${t.length > 90 ? t.slice(0, 90) + "…" : t}`)
      for (let i = 0; i < x.namedChildCount; i++) {
        const c = x.namedChild(i)
        let f: string | null = null
        for (const fn of ["declarator", "parameters", "body", "name", "type"]) {
          const y = x.childForFieldName?.(fn)
          if (y && y.id === c.id) { f = fn; break }
        }
        walk(c, d + 1, f)
      }
    }
    walk(n, 1, null)
    console.log(`----- source text (${Math.min(cap, n.text.length)} of ${n.text.length} chars):`)
    console.log(n.text.slice(0, cap))
    if (hits >= 2) break
  }
  for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
}
if (hits === 0) console.log(`no function_definition matched ${JSON.stringify(needle)}`)
