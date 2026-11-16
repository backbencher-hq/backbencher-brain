import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const file = process.argv[2]
  const src = fs.readFileSync(file, "utf8")
  const root = await parseSrc(src)
  console.log("err=" + root.hasError)
  const r: any = await new RealPhpAnalyzer().analyze(root, src, "t.php")
  console.log("rels:", JSON.stringify((r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
  console.log("ora:", JSON.stringify(mod.derivePhpEdges(root).map((x: any) => `${x.label}[->${x.target}]`)))
}
main()
