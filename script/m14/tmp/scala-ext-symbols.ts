import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const p = new P(); p.setLanguage(gl)
const f = process.argv[2]
const a = new RealScalaAnalyzer()
const res: any = a.analyze(p.parse(fs.readFileSync(f, "utf8")).rootNode, fs.readFileSync(f, "utf8"), f)
const want = process.argv[3] ?? "isPackage"
for (const s of res.symbols ?? []) {
  if (!s.name.startsWith(want)) continue
  console.log(JSON.stringify({
    name: s.name, kind: s.kind, id: s.id, parent: s.parent, ownerName: s.ownerName, ownerKind: s.ownerKind,
    parameters: s.parameters, returnType: s.returnType,
    metadata: { ...s.metadata, annotations: undefined, doc: undefined },
  }, null, 1))
}
