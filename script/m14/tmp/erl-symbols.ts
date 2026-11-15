import fs from "node:fs"
import path from "node:path"
import { LANGS } from "../differential"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const f = process.argv[2]
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cfg: any = (LANGS as any).erlang
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
const parser = new P(); parser.setLanguage(gl)
const mod = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
const analyzer = new (mod as any)[cfg.className]()
const src = fs.readFileSync(f, "utf8")
const res: any = analyzer.analyze(parser.parse(src).rootNode, src, f)
console.log("symbols:")
for (const s of res.symbols ?? []) console.log(`  ${String(s.kind).padEnd(11)} ${JSON.stringify(s.name).padEnd(18)} owner=${JSON.stringify(String(s.ownerName ?? "-").slice(0, 44))}`)
console.log("contains:")
for (const r of (res.relationships ?? []).filter((x: any) => String(x.type) === "contains")) console.log(`  ${String(r.source).slice(0,40)} -> ${r.target}`)

const byKind = new Map<string, number>()
for (const s of res.symbols ?? []) byKind.set(String(s.kind), (byKind.get(String(s.kind)) ?? 0) + 1)
console.log("\nsymbol kinds:", [...byKind].map(([k, v]) => `${k}=${v}`).join(" "))
console.log("records/types/macros declared in source:")
for (const line of src.split("\n")) if (/^-(record|type|define|spec|export_type)\b/.test(line.trim())) console.log("  " + line.trim().slice(0, 70))
