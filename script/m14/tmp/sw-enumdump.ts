import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(fs.readFileSync("/tmp/sw-enum.swift", "utf8")).rootNode
  const walk = (n: any, d: number): void => {
    if (n.type === "enum_entry" || (n.type === "call_expression" && n.text.includes("success"))) {
      const dump = (m: any, dd: number): void => {
        const t = m.isNamed ? m.type : `'${m.text.slice(0, 10)}'`
        const id = m.isNamed && ["simple_identifier", "type_identifier"].includes(m.type) ? ` '${m.text.slice(0, 16)}'` : ""
        console.log("  ".repeat(dd) + t + id)
        if (dd > 4) return
        for (let i = 0; i < m.childCount; i++) dump(m.child(i), dd + 1)
      }
      console.log(`--- ${n.type} '${n.text.slice(0, 30)}'`)
      dump(n, 0)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), d + 1)
  }
  walk(root, 0)
}
main()
