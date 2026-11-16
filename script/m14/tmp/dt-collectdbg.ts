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
  const src = `void runTests(
  Future<WebSocket> Function(Uri uri, {Iterable<String>? protocols})
  webSocketFactory,
) {
  testCloseRemote(webSocketFactory);
}
`
  const root = p.parse(src).rootNode
  const an: any = new RealDartAnalyzer()
  // find formal_parameter, dump children + test both collectors
  const walk = (n: any): void => {
    if (n.type === "formal_parameter") {
      const kids: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); kids.push(`${c.type}:'${c.text.slice(0, 24)}'`) }
      console.log("formal_parameter kids:", kids.join(" | "))
      console.log("  analyzer finds:", (an as any).findChildByType(n, "identifier")?.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  const r: any = await an.analyze(root, src, "t.dart")
  console.log("rels:", JSON.stringify((r.relationships ?? []).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
  const mod: any = await import("../../../script/m14/differential")
  console.log("ora:", JSON.stringify(mod.deriveDartBareUses(root, (r as any).symbols ?? []).map((x: any) => `${x.label}[->${x.target}]`)))
}
main()
