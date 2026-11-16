import * as fs from "fs"
import * as path from "path"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const file = process.argv[2]
  const src = fs.readFileSync(file, "utf8")
  const root = p.parse(src).rootNode
  console.log("err=" + root.hasError)
  const r: any = await new RealSwiftAnalyzer().analyze(root, src, "t.swift")
  console.log("rels:", JSON.stringify((r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
  const mod: any = await import("../../../script/m14/differential")
  console.log("ora:", JSON.stringify(mod.deriveSwiftEdges(root).map((x: any) => `${x.label}[->${x.target}]`)))
}
main()
