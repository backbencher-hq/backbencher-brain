import fs from "node:fs"
import path from "node:path"
import { deriveRustContainsTruth } from "../oracles/rust-contains"
import { LANGS } from "../differential"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cfg: any = (LANGS as any).rust
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
const parser = new P(); parser.setLanguage(gl)
const mod = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
const analyzer = new (mod as any)[cfg.className]()
const f = process.argv[2]
const src = fs.readFileSync(f, "utf8")
const root = parser.parse(src).rootNode
const truth = new Set(deriveRustContainsTruth(root).map((e) => e.target))
const res: any = analyzer.analyze(root, src, f)
const rels = (res.relationships ?? []).filter((r: any) => String(r.type) === "contains")
console.log(`truth ${truth.size}, analyzer contains ${rels.length}`)
const only = rels.filter((r: any) => !truth.has(String(r.target))).map((r: any) => `${String(r.source)} -> ${String(r.target)}`)
const tOnly = [...truth].filter((t) => !rels.some((r: any) => String(r.target) === t))
console.log("analyzer-only:", only.slice(0, 14).join(", "))
console.log("truth-only:", tOnly.slice(0, 10).join(", "))
