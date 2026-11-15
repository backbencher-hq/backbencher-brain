// cpp-oracle-site.ts — what does the cpp ORACLE derive, and at which site?
// The oracle's edges carry no line, so this walks the tree and prints the
// ancestry of every `template_function` whose name matches the queried targets,
// next to the oracle's (label,target) set. Used to settle, for the fmt explicit
// specializations (`template <> constexpr auto num_bits<native_int128>() -> int`),
// whether the ORACLE's `uses num_bits` edge is a read of the declared name or a
// real read elsewhere in the file.
//
//   bun script/m14/tmp/cpp-oracle-site.ts <file> [name ...]
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

import { fileURLToPath } from "node:url"
const __filename = fileURLToPath(import.meta.url)

const HERE = (import.meta as any).dir ?? path.dirname((import.meta as any).filename ?? __filename)
const ROOT = path.resolve(HERE, "..", "..", "..")
const file = path.resolve(process.argv[2])
const names = new Set(process.argv.slice(3))
const content = fs.readFileSync(file, "utf8")

const { deriveCppEdges, deriveCppBareUses } = await import(`${ROOT}/script/m14/differential.ts`)

await (Parser as any).init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
const parser = new Parser()
parser.setLanguage(grammar)
const root = parser.parse(content).rootNode

console.log("=== oracle edges for the queried names ===")
for (const e of deriveCppEdges(root)) {
  if (names.size === 0 || names.has(e.target)) {
    console.log(`ORACLE ${e.label} ${e.from} -> ${e.target}`)
  }
}
console.log("=== oracle BARE-USES edges for the queried names ===")
for (const e of (deriveCppBareUses as any)(root)) {
  if (names.size === 0 || names.has(e.target)) {
    console.log(`BARE-USES ${e.label} ${e.from} -> ${e.target}${e.line ? ` (line ${e.line})` : ""}${e.fullCallee ? ` fullCallee=${e.fullCallee}` : ""}`)
  }
}

console.log("=== every tree occurrence of those identifiers, with ancestry ===")
const stack: any[] = [root]
while (stack.length > 0) {
  const n = stack.pop()!
  if ((n.type === "identifier" || n.type === "field_identifier" || n.type === "template_function") && names.has(n.text)) {
    const anc: string[] = []
    let p = n.parent
    for (let i = 0; i < 6 && p; i++) { anc.push(p.type); p = p.parent }
    const line = n.startPosition?.row + 1
    console.log(`SITE line=${line} text=${n.text} ancestry=${anc.join(" < ")}`)
    const gp = n.parent?.parent
    if (gp?.childForFieldName) {
      const f = gp.childForFieldName("declarator")
      console.log(`     grandparent=${gp.type} declaratorField=${f ? f.type + `[${f.startIndex}..${f.endIndex}]` : "none"} parentSpan=[${n.parent.startIndex}..${n.parent.endIndex}] selfSpan=[${n.startIndex}..${n.endIndex}]`)
    }
    const src = content.slice(Math.max(0, content.lastIndexOf("\n", n.startIndex - 60)), content.indexOf("\n", n.endIndex + 40))
    console.log(`     src: ${src.replace(/\s+/g, " ").slice(0, 160)}`)
  }
  for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
}
