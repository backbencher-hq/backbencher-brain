// script/m14/tmp/oc-callee-uses.ts — family adjudication probe for one objc row:
// does the C-family path emit `uses` for a bare CALLEE identifier (a function
// pointer / block parameter invoked as `cb(1)`), or does the `calls` edge own it?
// Same question for a parameter read in ARGUMENT position (php/dart precedent).
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const cLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const cmod: any = await import(path.join(ROOT, "src/ast/real-c-analyzer"))
  const srcs = [
    `void f(void (*cb)(int)) {\n  cb(1);\n}\n`,
    `void g(int n) {\n  printf("%d", n);\n}\n`,
    `void h(void (*cb)(int)) {\n  int x = 0;\n}\n`,
    `void k(void (*cb)(int)) {\n  cb(1);\n  cb(2);\n}\n`,
  ]
  for (const src of srcs) {
    const p = new P(); p.setLanguage(cLang)
    const r: any = await new cmod.RealCAnalyzer().analyze(p.parse(src).rootNode, src, "t.c")
    console.log("SRC:", JSON.stringify(src))
    for (const e of r.relationships ?? []) console.log(`   ${e.type} ${e.source} -> ${e.target}  (line ${(e as any).line_number})`)
  }
  const ocLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const ocmod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))
  const cases: Array<[string, string]> = [
    ["decl+call", `void register_block(void (^handler)(NSString *)) {\n  handler(@"x");\n}\n`],
    ["decl only", `void register_block(void (^handler)(NSString *)) {\n  int x = 0;\n}\n`],
    ["plain param decl only", `void take(int n) {\n  int x = n;\n}\n`],
    ["plain param unused", `void take(int n) {\n  int x = 0;\n}\n`],
  ]
  for (const [label, ocSrc] of cases) {
    const p2 = new P(); p2.setLanguage(ocLang)
    const r2: any = await new ocmod.RealObjectiveCAnalyzer().analyze(p2.parse(ocSrc).rootNode, ocSrc, "t.m")
    console.log(`OBJC [${label}]:`, JSON.stringify(ocSrc))
    for (const e of r2.relationships ?? []) console.log(`   ${e.type} ${e.source} -> ${e.target}  (line ${(e as any).line_number})`)
    if (!(r2.relationships ?? []).length) console.log("   (none)")
  }
}
main()
