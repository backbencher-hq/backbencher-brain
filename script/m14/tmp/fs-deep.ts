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
console.log("ALL node types:", [...hist].sort((a,b)=>b[1]-a[1]).slice(0,26).map(([k,v])=>`${k}=${v}`).join("  "))
