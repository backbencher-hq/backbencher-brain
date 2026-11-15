// script/m14/tmp/dt-exttype-shape.ts — the `extension type` shape (Dart 3) and how
// the dart analyzer scopes its members TODAY.
//
// Found by script/m14/tmp/dt-dup-census.ts over the FULL extent of both pinned
// corpora: 132 "program-scope duplicate names" in dart-http's generated JNI/objc
// bindings are members of `extension type` declarations (303 decls in 4 files) —
// a container the census did not know either, which is exactly why they surfaced.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const SRC = `
extension type NSCachedURLResponse._(objc.ObjCObject object$) implements objc.ObjCObjectBase {
  static bool isA(objc.ObjCObject? obj) => obj == null ? false : true;

  int get length => 0;
}

extension type NSLocking._(objc.ObjCProtocol object$) {
  void lock() {}
}
`

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P()
  p.setLanguage(LANG)
  const root = p.parse(SRC).rootNode
  console.log("-- CST shape (depth 2)")
  const walk = (n: any, d: number) => {
    if (d > 4) return
    const field = n.parent ? ["name", "type", "body"].filter((f) => {
      const c = n.parent.childForFieldName?.(f)
      return c && c.startIndex === n.startIndex && c.endIndex === n.endIndex
    }).join("|") : ""
    const shown = n.childCount === 0 ? ` "${n.text}"` : ""
    console.log(`${"  ".repeat(d)}${n.type}${field ? ` [field=${field}]` : ""}${shown}`)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, d + 1) }
  }
  walk(root, 0)
  const mod: any = await import(path.join(ROOT, "src/ast/real-dart-analyzer"))
  const r = await new mod.RealDartAnalyzer().analyze(root, SRC, "exttype-probe.dart")
  console.log("-- analyzer TODAY")
  for (const s of r.symbols ?? []) {
    console.log(`  symbol ${String(s.kind).padEnd(9)} name=${s.name.padEnd(28)} owner=${String(s.ownerName).padEnd(24)} scope=${JSON.stringify(s.scope)}`)
  }
  for (const e of r.relationships ?? []) {
    console.log(`  edge   ${String(e.type).padEnd(10)} ${String(e.source).padEnd(24)} -> ${e.target}  @${e.line_number}`)
  }
}
main()
