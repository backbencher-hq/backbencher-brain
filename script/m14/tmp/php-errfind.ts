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
  const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
  console.log("hasError:", root.hasError)
  const walk = (n: any, d: number): void => {
    if (n.type === "ERROR" || n.isMissing) {
      console.log("BAD:", n.type, "missing=" + n.isMissing, JSON.stringify(n.text.slice(0, 60)), "at line", n.startPosition.row + 1)
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
  }
  walk(root, 0)
  // arguments shapes for FCC
  const walk2 = (n: any): void => {
    if (n.type === "arguments") {
      const kids: string[] = []
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); kids.push(`${c.isNamed ? "" : "'"}${c.type}${c.isNamed ? "" : "'"}`) }
      console.log("ARGS:", kids.join(" "))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk2(n.namedChild(i))
  }
  walk2(root)
}
main()
