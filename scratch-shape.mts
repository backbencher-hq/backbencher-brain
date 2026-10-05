import { readFileSync } from "node:fs"
import * as path from "node:path"
const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join("$HOME/mcp/bb-lanes/json", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join("$HOME/mcp/bb-lanes/json", "wasm", "tree-sitter-json.wasm"))
const p = new Parser(); const lang = await Language.load(wasm); p.setLanguage(lang)
for (const f of process.argv.slice(2)) {
  const t = p.parse(readFileSync(f, "utf8"))
  const r = t.rootNode
  console.log(f)
  console.log("  root", r.type, "children", JSON.stringify(r.namedChildren.map((c: any) => c.type)))
  const dump = (n: any, d: number): void => {
    if (d > 3) return
    console.log("  " + "  ".repeat(d) + n.type + "  " + JSON.stringify(String(n.text ?? "").slice(0, 40)))
    for (let i = 0; i < n.namedChildCount && i < 4; i++) { const c = n.namedChild(i); if (c) dump(c, d + 1) }
  }
  dump(r, 0)
  t.delete?.()
}
