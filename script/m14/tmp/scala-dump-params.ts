import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
async function main(): Promise<void> {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const p = new P(); p.setLanguage(gl)
  const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
  const want = process.argv[3]
  const walk = (n: any): void => {
    if (n.type.includes("function") && String(n.text).includes(want)) {
      console.log(`\n${n.type}: ${JSON.stringify(String(n.text).slice(0, 50))}`)
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c || c.type !== "parameters") continue
        console.log(`  parameters ${JSON.stringify(c.text)}  (childCount=${c.childCount} named=${c.namedChildCount})`)
        for (let j = 0; j < c.childCount; j++) {
          const g = c.child(j)!
          console.log(`    [${j}] ${g.type.padEnd(18)} named=${g.isNamed}  ${JSON.stringify(String(g.text))}`)
        }
      }
    }
    for (const c of n.namedChildren ?? []) walk(c)
  }
  walk(root)
}
main()
