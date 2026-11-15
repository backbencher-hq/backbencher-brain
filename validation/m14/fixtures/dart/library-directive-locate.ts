/**
 * Where does the dart grammar put `library dart.core;`?
 *
 * `library-directive-gap.ts` measured 52 of 3,000 files whose TEXT declares a library
 * with no usable top-level `library_name` child, and printed only the first six
 * top-level named children — so the directive may simply sit further down the list.
 * This one walks the WHOLE top-level list for a named file, then locates every node
 * whose span covers the directive's bytes, which names the node type to read.
 *
 * Usage: npx tsx validation/m14/fixtures/dart/library-directive-locate.ts <file>
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const file = process.argv[2]
const text = readFileSync(file, "utf8")
const m = /^[ \t]*library[ \t]+([A-Za-z_$][\w$]*(\s*\.\s*[A-Za-z_$][\w$]*)*)[ \t]*;/m.exec(text)
if (!m) throw new Error(`no library directive in ${file}`)
const startIndex = m.index
const endIndex = startIndex + m[0].length
console.log(`file        ${file}`)
console.log(`directive   ${JSON.stringify(m[0])}  bytes ${startIndex}..${endIndex}`)
console.log(`declares    ${JSON.stringify(m[1].replace(/\s+/g, ""))}\n`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))
const tree = parser.parse(text)
const root = tree.rootNode

console.log(`root ${root.type}  hasError=${root.hasError}  namedChildCount=${root.namedChildCount}\n`)
console.log("WHOLE top-level named child list:")
for (let i = 0; i < root.namedChildCount; i++) {
  const c = root.namedChild(i)
  if (!c) continue
  console.log(`  [${String(i).padStart(2)}] ${c.type.padEnd(22)} ${String(c.startPosition.row + 1).padStart(4)}:${String(c.startPosition.column + 1).padStart(3)}  bytes ${c.startIndex}..${c.endIndex}  ${JSON.stringify(c.text.trim().slice(0, 60))}`)
}

console.log("\nNODES CONTAINING the directive's bytes (deepest last):")
const hits: string[] = []
const stack: any[] = [root]
while (stack.length) {
  const n = stack.pop()
  if (n.startIndex <= startIndex && n.endIndex >= endIndex) {
    hits.push(`  ${n.type.padEnd(24)} ${String(n.startPosition.row + 1).padStart(4)}:${String(n.startPosition.column + 1).padStart(3)}  bytes ${n.startIndex}..${n.endIndex}  namedChildren=${n.namedChildCount}  ${JSON.stringify(n.text.trim().slice(0, 60))}`)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}
console.log(hits.join("\n"))

const nonEmpty = root.namedChildren.filter((c: any) => c.type === "library_name" && c.namedChildCount > 0)
console.log(`\ntop-level library_name nodes with a named child: ${nonEmpty.length}`)
for (const c of nonEmpty) console.log(`  ${JSON.stringify(c.text.trim())}`)