import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-fsharp.wasm")))
const p = new P(); p.setLanguage(gl)
for (const f of process.argv.slice(2)) {
  const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
  console.log(`\n=== ${path.basename(f)}`)
  const walk = (n: any, d: number): void => {
    if (n.type === "type_definition" || n.type === "type_extension") {
      console.log(`${n.type}:`)
      for (const k of n.namedChildren ?? []) console.log(`   ${k.type}  ${JSON.stringify(k.text.slice(0,42).replace(/\n/g," "))}`)
      for (const k of n.namedChildren ?? []) {
        const g = (k.namedChildren ?? []).map((x: any) => `${x.type}`).join(",")
        if (g) console.log(`      ${k.type} -> ${g}`)
      }
    }
    for (const c of n.namedChildren ?? []) walk(c, d + 1)
  }
  walk(root, 0)
  if (f.endsWith(".fsi")) {
    const walk2 = (n: any): void => {
      if (["member_defn", "function_or_value_defn", "type_extension"].includes(n.type)) {
        console.log(`  ${n.type}:`)
        for (const k of n.namedChildren ?? []) console.log(`     ${k.type}  ${JSON.stringify(k.text.slice(0,40).replace(/\n/g," "))}`)
        if (walk2.count < 3) { walk2.count = (walk2.count ?? 0) + 1 }
      }
      for (const c of n.namedChildren ?? []) walk2(c)
    }
    walk2.count = 0
    walk2(root)
  }
}
