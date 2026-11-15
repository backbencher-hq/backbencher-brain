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
const hist = new Map<string, number>()
const walk = (n: any): void => { hist.set(n.type, (hist.get(n.type) ?? 0) + 1); for (const c of n.namedChildren ?? []) walk(c) }
walk(root)
console.log("node types:", [...hist].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,v])=>`${k}=${v}`).join("  "))
for (const n of ["module_defn"]) {
  const find = (x: any): any => { if (x.type === n) return x; for (const c of x.namedChildren ?? []) { const r = find(c); if (r) return r } return null }
  const m = find(root)
  if (m) { console.log(`\n${n}:`); for (const k of m.namedChildren ?? []) console.log(`   ${k.type}  ${JSON.stringify(k.text.slice(0,40).replace(/\n/g," "))}`) }
}
for (const t of ["val_defn", "binding"]) {
  const find = (x: any): any => { if (x.type === t) return x; for (const c of x.namedChildren ?? []) { const r = find(c); if (r) return r } return null }
  const m = find(root)
  if (m) { console.log(`\n${t}:`); for (const k of m.namedChildren ?? []) console.log(`   ${k.type}  ${JSON.stringify(k.text.slice(0,40))}`) }
}
