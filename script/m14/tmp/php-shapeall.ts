import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(process.argv[2], "utf8")
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const watch = new Set((process.argv[3] ?? "").split(","))
  const walk = (n: any): void => {
    if ((n.type === "variable_name" || n.type === "name") && watch.has(n.text.replace(/^\$/, ""))) {
      const chain: string[] = []
      let c: any = n
      while (c) { chain.push(`${c.type}[${c.startIndex}-${c.endIndex}]`); c = c.parent }
      console.log(`--- '${n.text}' @${n.startIndex}: ` + chain.slice(0, 7).join(" < "))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
