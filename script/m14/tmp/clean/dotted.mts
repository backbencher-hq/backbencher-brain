import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/ishaq2321/mcp/bb-lanes/clean"
const WIDE = path.join(ROOT, "script", "m14", "clean-wide-manifest.txt")
const files = fs.readFileSync(WIDE, "utf8").split("\n").map(s=>s.trim()).filter(Boolean).filter(p=>fs.existsSync(p))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P(); parser.setLanguage(grammar)
let n = 0
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  let t: any; try { t = parser.parse(src) } catch { continue }
  if (!t) continue
  const v = (x: any) => {
    if (x.type === "class_declaration") {
      const dt: any[] = []
      for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c.type === "dotted_type") dt.push(c) }
      if (dt.length) {
        n++
        const line = x.startPosition.row + 1
        const lines = src.split("\n")
        console.log(`\n--- ${path.relative("/home/ishaq2321/bb_tests/repositories", f)}:${line} ---`)
        for (let r = x.startPosition.row; r <= Math.min(x.endPosition.row, x.startPosition.row + 4); r++) console.log(`  ${r+1}| ${lines[r]}`)
        for (const d of dt) console.log(`   dotted_type: ${JSON.stringify(d.toString().slice(0,120))}`)
      }
    }
    for (let i = 0; i < x.childCount; i++) v(x.child(i))
  }
  v(t.rootNode); t.delete?.()
}
console.log(`\nclass_declaration nodes carrying a dotted_type: ${n}`)
