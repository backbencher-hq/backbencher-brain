import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const p = new P(); p.setLanguage(gl)
const src = fs.readFileSync(process.argv[2], "utf8")
const root = p.parse(src).rootNode
const want = process.argv[3]
const walk = (n: any, d: number): void => {
  if (n.type.includes("function") && String(n.text).includes(want)) {
    console.log(`\n${n.type}: ${JSON.stringify(String(n.text).slice(0, 60))}`)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      console.log(`   [${i}] ${c.type}${c.isNamed ? "" : " (anon)"}  ${JSON.stringify(String(c.text).slice(0, 34))}`)
      for (let j = 0; j < c.namedChildCount; j++) {
        const g = c.namedChild(j)
        if (g) console.log(`        ${g.type}  ${JSON.stringify(String(g.text).slice(0, 30))}`)
      }
    }
  }
  for (const c of n.namedChildren ?? []) walk(c, d + 1)
}
async function main(): Promise<void> { walk(root, 0) }
main()
