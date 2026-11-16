import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`const v = 1;\nfn f() -> u32 { v }\n`).rootNode
  const walk = (n: any): void => {
    if (n.type === "ERROR" || n.isMissing) console.log(`BAD ${n.type} @${n.startIndex} text=${JSON.stringify(n.text.slice(0, 30))} missing=${n.isMissing}`)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  console.log("hasError:", root.hasError)
  walk(root)
  const dump = (n: any, dp: number): void => {
    if (dp > 3) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 22)))
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), dp + 1)
  }
  dump(root, 0)
}
main()
