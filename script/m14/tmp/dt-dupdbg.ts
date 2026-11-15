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
  const src = `class Store {
  int count = 0;
  void inits(int p) {
    var s = 'hi $p and \${count + 1}';
  }
}
`
  const root = p.parse(src).rootNode
  const r: any = await new RealDartAnalyzer().analyze(root, src, "t.dart")
  console.log(JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.target) === "count" || String(x.target) === "p"), null, 1))
}
main()
