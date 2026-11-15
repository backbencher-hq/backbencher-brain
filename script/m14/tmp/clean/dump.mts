import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = process.cwd()
const targets = process.argv.slice(2)
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P(); parser.setLanguage(grammar)
for (const f of targets) {
  const src = fs.readFileSync(f, "utf8")
  const t: any = parser.parse(src)
  const lines = src.split("\n")
  const v = (x: any) => {
    if (x.type === "class_declaration") {
      let hasCtx = false
      for (let i = 0; i < x.namedChildCount; i++) if (x.namedChild(i).type === "class_context") hasCtx = true
      if (hasCtx) {
        const start = x.startPosition.row, end = x.endPosition.row
        console.log(`\n--- ${path.basename(f)}:${start + 1} ---`)
        for (let r = start; r <= Math.min(end, start + 8); r++) console.log(`  ${r+1}| ${lines[r]}`)
        console.log(`  TREE: ${x.toString().slice(0, 300)}`)
      }
    }
    for (let i = 0; i < x.childCount; i++) v(x.child(i))
  }
  v(t.rootNode)
}
