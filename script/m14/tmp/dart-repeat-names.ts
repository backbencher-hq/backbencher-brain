import fs from "node:fs"
import path from "node:path"
import { LANGS } from "../differential"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cfg: any = (LANGS as any).dart
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
const parser = new P(); parser.setLanguage(gl)
const mod = await import(path.join(ROOT, "src/ast", `${cfg.analyzerFile}.ts`))
const analyzer = new (mod as any)[cfg.className]()
// a class with: 2 constructors, 2 same-named methods, 2 same-named getters
const src = `class R {
  R.a(int x) : v = x;
  R.b(String s) : v = 0;
  int get v => 1;
  int get w => 2;
  static int f(int a) => 1;
  static int f(String b) => 2;
  static int f(double c) => 3;
}
`
const res: any = analyzer.analyze(parser.parse(src).rootNode, src, "/tmp/r.dart")
console.log("symbols the analyzer publishes for R:")
for (const s of (res.symbols ?? []).filter((x: any) => x.ownerName === "R")) {
  console.log(`  ${String(s.kind).padEnd(11)} ${JSON.stringify(s.name)}  line=${s.range?.startLine}`)
}
const contains = (res.relationships ?? []).filter((r: any) => String(r.type) === "contains" && r.source === "R")
console.log("\ncontains rows:")
for (const r of contains) console.log(`  ${r.source} -> ${r.target}`)
