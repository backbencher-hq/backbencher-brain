import fs from "node:fs"
import path from "node:path"
import { LANGS } from "../differential"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const LL = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cfg: any = (LANGS as any).fsharp
const gl = await LL.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
const parser = new P(); parser.setLanguage(gl)
const mod = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
const analyzer = new (mod as any)[cfg.className]()
const src = fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], "utf8") : fs.readFileSync("/tmp/opencode/fs-sample.fsx", "utf8")
const res: any = analyzer.analyze(parser.parse(src).rootNode, src, "/tmp/opencode/fs-sample.fsx")
console.log("contains rows (owner -> target):")
for (const r of (res.relationships ?? []).filter((x: any) => String(x.type) === "contains")) console.log(`  ${r.source} -> ${r.target}`)
