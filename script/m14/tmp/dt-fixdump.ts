import * as fs from "fs"
import * as path from "path"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const file = "validation/m14/fixtures/dart/value-reads.dart"
  const src = fs.readFileSync(path.join(ROOT, file), "utf8")
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const r: any = await new RealDartAnalyzer().analyze(root, src, file)
  console.log("SYMS:", JSON.stringify((r.symbols ?? []).map((s: any) => `${s.kind}:${s.ownerName ? s.ownerName + "." : ""}${s.name}`)))
  console.log("RELS:", JSON.stringify((r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
}
main()
