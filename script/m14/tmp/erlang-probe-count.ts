import * as fs from "fs"
import * as path from "path"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const file = process.argv[2]
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
const content = fs.readFileSync(file, "utf8")
const tree = parser.parse(content)
const r: any = new RealErlangAnalyzer().analyze(tree!.rootNode, content, file)
console.log(`symbols=${r.symbols.length} relationships=${r.relationships.length} exports=${r.exports.length} errors=${r.errors.length}`)
// how many top-level forms does the analyzer's own pre-pass see?
const forms: any[] = []
const stack: any[] = [...Array.from({ length: tree!.rootNode.namedChildCount }, (_, i) => tree!.rootNode.namedChild(tree!.rootNode.namedChildCount - 1 - i))]
while (stack.length) {
  const n = stack.pop()
  if (!n.isNamed) continue
  forms.push(n)
}
const byType = new Map<string, number>()
for (const f of forms) byType.set(f.type, (byType.get(f.type) ?? 0) + 1)
console.log("top-level form types:", [...byType.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([t,c])=>`${t}=${c}`).join(" "))
