import * as fs from "fs"
import * as path from "path"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  for (const stmt of [`a?.b.c();`, `o.b.c();`, `a?.b();`, `a.b();`]) {
    const src = `void m() {\n  ${stmt}\n}\n`
    const root = p.parse(src).rootNode
    const r: any = await new RealDartAnalyzer().analyze(root, src, "t.dart")
    const rels = (r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)
    const mod: any = await import("../../../script/m14/differential")
    const ora = mod.deriveDartEdges(root).map((x: any) => `${x.label}[->${x.target}]`)
    console.log(stmt, "=> AN:", JSON.stringify(rels), "OR:", JSON.stringify(ora))
  }
}
main()
