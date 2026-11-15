import fs from "node:fs"
import path from "node:path"
import { deriveDartContainsTruth } from "../oracles/dart-contains"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
const p = new P(); p.setLanguage(gl)
const src = `class Arrays {
  static final _id_asList = _class.staticMethodId("x");
  static final _asList = _id_asList;
  static List asList(Object o) => throw 0;
  static List asList(int a, int b) => throw 0;
}
enum Color { red, green }
`
const root = p.parse(src).rootNode
console.log("top-level node types:", (root.namedChildren ?? []).map((c: any) => c.type).join(", "))
const classNode = (root.namedChildren ?? []).find((c: any) => c.type === "class_definition")
console.log("class_body present?", !!(classNode?.namedChildren ?? []).find((c: any) => c.type === "class_body"))
console.log("class_body children:", ((classNode?.namedChildren ?? []).find((c: any) => c.type === "class_body")?.namedChildren ?? []).map((c: any) => c.type).join(", "))
console.log("\nderived:")
for (const e of deriveDartContainsTruth(root)) console.log(`  ${e.from} -> ${e.target}`)
