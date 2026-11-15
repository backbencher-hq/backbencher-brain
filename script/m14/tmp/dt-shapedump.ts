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
  const src = fs.readFileSync(process.argv[2], "utf8")
  const watch = new Set((process.argv[3] ?? "").split(","))
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const walk = (n: any): void => {
    if ((n.type === "identifier" || n.type === "type_identifier" || n.type === "selector" || n.type === "cascade_section" || n.type === "argument_part") && (watch.size === 0 || watch.has(n.text))) {
      const chain: string[] = []
      let c: any = n
      while (c) {
        const sib = c.previousNamedSibling ? `<-${c.previousNamedSibling.type}` : ""
        chain.push(`${c.type}[${c.startIndex}-${c.endIndex}]${c.isNamed ? "" : "(anon)"}${sib}`)
        c = c.parent
      }
      console.log(`--- ${n.type} '${n.text.slice(0, 30)}' @${n.startIndex}`)
      console.log("    " + chain.slice(0, 9).join(" < "))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
