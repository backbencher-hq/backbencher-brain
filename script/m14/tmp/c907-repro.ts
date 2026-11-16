// script/m14/tmp/c907-repro.ts — the exact shape that hides jq's jv_dumpf/jv_dump.
//
// The earlier 907 probes SLICED the file (lines 219-420), which manufactures the
// imbalance itself — so their "root is one ERROR" finding describes the slice, not
// the corpus file. This one parses the WHOLE file and locates each function by its
// own name offset, then walks up to the top-level node and down to the definition.
//
// Run: bun script/m14/tmp/c907-repro.ts [path]
import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const FILE = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/jq/src/jv_print.c"
const src = readFileSync(FILE, "utf8")
const tree = parser.parse(src)
const root = tree.rootNode

const lineOf = (idx: number) => src.slice(0, idx).split("\n").length

console.log(`file: ${FILE} (${src.split("\n").length} lines, tree hasError=${root.hasError})`)
console.log("top-level nodes:")
for (let i = 0; i < root.namedChildCount; i++) {
  const c = root.namedChild(i)
  console.log(`  ${String(i).padStart(3)} ${c.type.padEnd(20)} L${c.startPosition.row + 1}-L${c.endPosition.row + 1}  ${c.hasError ? "[has ERROR]" : ""}`)
}

for (const name of ["jv_dumpf", "jv_dump", "jv_show"]) {
  // find the DEFINITION site: a line that starts the definition, not a call
  const re = new RegExp(`^[a-zA-Z_][^;\\n]*\\b${name}\\s*\\(`, "m")
  const m = re.exec(src)
  if (!m) {
    console.log(`\n${name}: no definition-shaped line found`)
    continue
  }
  const off = m.index + m[0].indexOf(name)
  console.log(`\n${name}: definition candidate at L${lineOf(off)}  | ${m[0].slice(0, 70).trim()}`)
  // deepest node containing the name
  let node: any = root
  const path: any[] = []
  for (;;) {
    let next: any = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c.startIndex <= off && off < c.endIndex) {
        next = c
        break
      }
    }
    if (!next) break
    node = next
    path.push(node)
  }
  console.log("  chain (outer -> inner):")
  for (const n of path) {
    console.log(`    ${n.type.padEnd(22)} L${n.startPosition.row + 1}-L${n.endPosition.row + 1} ${n.hasError ? "[ERROR]" : ""}`)
  }
  // The shape that matters: what the ERROR and its nearest wrapping node hold.
  const err = path.find((n: any) => n.type === "ERROR" || n.type === "declaration")
  if (err) {
    console.log(`  ${err.type} L${err.startPosition.row + 1}-L${err.endPosition.row + 1} children:`)
    for (let i = 0; i < err.namedChildCount; i++) {
      const c = err.namedChild(i)
      console.log(`    - ${c.type.padEnd(22)} L${c.startPosition.row + 1}-L${c.endPosition.row + 1}  ${JSON.stringify(c.text.split("\n")[0].slice(0, 50))}`)
    }
    console.log(`    text head: ${JSON.stringify(err.text.split("\n")[0].slice(0, 60))}`)
    console.log(`    text tail: ${JSON.stringify(err.text.split("\n").slice(-1)[0].slice(0, 40))}  endsWith;=${err.text.trimEnd().endsWith(";")}`)
  }
}
