// What node type wraps `div` inside <div className="wrap"> in the JS grammar?
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const js = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const src = `function App() {\n  return (\n    <div className="wrap">\n      <Button label="Go" />\n    </div>\n  );\n}\n`
  const p = new P(); p.setLanguage(js)
  const root = p.parse(src).rootNode
  const walk = (n: any, d: number): void => {
    if (d > 6) return
    const inJsx = (() => { let x = n.parent; while (x) { if (x.type.startsWith("jsx")) return true; x = x.parent } return false })()
    if (n.type === "identifier" || n.type === "jsx_element" || n.type.startsWith("jsx_"))
      if (n.type.startsWith("jsx_")) console.log("  ".repeat(d) + "CHILDREN-OF " + n.type + ":")
      if (n.type === "jsx_opening_element" || n.type === "jsx_self_closing_element") for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) console.log("  ".repeat(d) + "  child: " + c.type + " = " + JSON.stringify(c.text.slice(0, 20))) } {
      console.log("  ".repeat(d) + n.type + " = " + JSON.stringify(n.text.slice(0, 26)) + (inJsx ? " [JSX]" : ""))
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, d + 1) }
  }
  walk(root, 0)
}
main()
