import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-fsharp.wasm")))
const p = new P(); p.setLanguage(gl)
const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
console.log("top-level:", (root.namedChildren ?? []).map((c: any) => c.type).join(" "))
for (const c of root.namedChildren ?? []) {
  if (c.type !== "file" && c.type !== "named_module" && c.type !== "namespace") continue
  console.log(`\n${c.type}:`)
  for (const k of c.namedChildren ?? []) console.log(`   ${k.type}  ${JSON.stringify(k.text.slice(0,40).replace(/\n/g," "))}`)
}
// a member_defn's name shape
const walk = (n: any): void => {
  if (n.type === "method_or_prop_defn") {
    console.log("\nmethod_or_prop_defn:")
    for (const k of n.namedChildren ?? []) console.log(`   ${k.type}  ${JSON.stringify(k.text.slice(0,34))}`)
    return
  }
  for (const c of n.namedChildren ?? []) walk(c)
}
walk(root)
