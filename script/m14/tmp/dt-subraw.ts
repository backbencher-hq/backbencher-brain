import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(fs.readFileSync("/tmp/dt-sub.dart", "utf8")).rootNode
  const walk = (n: any): void => {
    if (n.type === "identifier" && n.text === "xs" && n.startIndex > 30) {
      const par = n.parent
      console.log("xs parent:", par?.type)
      for (let i = 0; i < par.childCount; i++) {
        const c = par.child(i)
        console.log(`  child[${i}] named=${c.isNamed} type=${c.type} span=${c.startIndex}-${c.endIndex} same=${c.startIndex === n.startIndex && c.endIndex === n.endIndex}`)
      }
      console.log("xs.nextSibling:", n.nextSibling ? `named=${n.nextSibling.isNamed} type=${n.nextSibling.type} text=${n.nextSibling.text.slice(0, 8)}` : "null")
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
