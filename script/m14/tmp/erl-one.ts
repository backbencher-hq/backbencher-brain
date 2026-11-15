import fs from "node:fs"
import path from "node:path"
import { deriveErlangContainsTruth } from "../oracles/erlang-contains"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm")))
const p = new P(); p.setLanguage(gl)
const f = process.argv[2]
const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
console.log("root type:", root.type)
const hist = new Map<string, number>()
for (const c of root.namedChildren ?? []) hist.set(c.type, (hist.get(c.type) ?? 0) + 1)
console.log("children:", [...hist].map(([k, v]) => `${k}=${v}`).join(" "))
const t = deriveErlangContainsTruth(root)
console.log(`derived ${t.length}:`, t.map((e) => e.target).join(", ").slice(0, 300))
