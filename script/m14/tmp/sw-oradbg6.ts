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
  const root = p.parse(`func m() {\n  log(x)\n}\n`).rootNode
  const mod: any = await import("../../../script/m14/differential")
  console.log("HEAD oracle:", JSON.stringify(mod.deriveSwiftEdges(root)))
}
main()
