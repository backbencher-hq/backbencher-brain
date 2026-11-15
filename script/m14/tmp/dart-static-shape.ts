import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
const p = new P(); p.setLanguage(gl)
const src = `class Arrays {
  static final _id_asList = _class.staticMethodId("x", _class.asList);
  static final _asList = _id_asList;
  static List asList(Object o) => throw 0;
  static List asList(int a, int b) => throw 0;
  late final List<int>? _cache;
  covariant num get length => 0;
}
`
const root = p.parse(src).rootNode
const cls = (root.namedChildren ?? [])[0]
const body = (cls?.namedChildren ?? []).find((c: any) => c.type === "class_body")
const sub = (n: any, d: number): void => {
  console.log("  ".repeat(d) + `${n.type}  ${JSON.stringify(n.text.slice(0, 60))}`)
  if (d < 4) for (const c of n.namedChildren ?? []) sub(c, d + 1)
}
for (const c of body?.namedChildren ?? []) sub(c, 1)
