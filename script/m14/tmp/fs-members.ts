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
const want = new Set(["union_type_cases", "record_fields", "type_extension_elements", "union_type_case_defn", "function_or_value_defn"])
const sub = (n: any, d: number): void => {
  if (want.has(n.type)) {
    console.log(`${n.type}:`)
    for (const c of n.namedChildren ?? []) {
      const g = (c.namedChildren ?? []).map((k: any) => `${k.type}(${JSON.stringify(k.text.slice(0,18))})`).join(" ")
      console.log(`    ${c.type}  ${JSON.stringify(c.text.slice(0,26))}   -> ${g}`)
    }
  }
  for (const c of n.namedChildren ?? []) sub(c, d + 1)
}
sub(root, 0)
