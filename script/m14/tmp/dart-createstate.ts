import fs from "node:fs"
import path from "node:path"
import { LANGS } from "../differential"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const f = "<corpus-root>/bb_tests/repositories/dart-http/pkgs/ok_http/example/lib/main.dart"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cfg: any = (LANGS as any).dart
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
const parser = new P(); parser.setLanguage(gl)
const mod = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
const analyzer = new (mod as any)[cfg.className]()
const src = fs.readFileSync(f, "utf8")
const res: any = analyzer.analyze(parser.parse(src).rootNode, src, f)
console.log("all symbols in main.dart:")
for (const s of (res.symbols ?? [])) {
  console.log(`  ${String(s.kind).padEnd(11)} ${JSON.stringify(s.name).padEnd(24)} owner=${JSON.stringify(s.ownerName ?? null)} line=${s.range?.startLine}`)
}
console.log("\ncontains rows:")
for (const r of (res.relationships ?? []).filter((x: any) => String(x.type) === "contains")) {
  console.log(`  ${r.source} -> ${r.target}`)
}
