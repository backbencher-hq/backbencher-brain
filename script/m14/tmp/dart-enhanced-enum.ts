import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
const p = new P(); p.setLanguage(gl)
const root = p.parse(`enum Suit {
  hearts(1), spades(2);
  const int code;
  Suit(this.code);
  int get doubled => code * 2;
  void log() {}
}
`).rootNode
const e = (root.namedChildren ?? [])[0]
console.log("enum:", e?.type)
for (const c of e?.namedChildren ?? []) {
  console.log(`  child: ${c.type}  ${JSON.stringify(c.text.slice(0, 44))}`)
  if (c.type === "enum_body") for (const g of c.namedChildren ?? []) console.log(`      ${g.type}  ${JSON.stringify(g.text.slice(0, 40))}`)
}
