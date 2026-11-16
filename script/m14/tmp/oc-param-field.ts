// script/m14/tmp/oc-param-field.ts — does parameter_declaration / method_parameter
// expose a `declarator` field (the structural way to prove an identifier is the
// parameter's DECLARED NAME rather than a value read)?
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const cases: Array<[string, string]> = [
    ["block param", `void f(void (^handler)(NSString *)) {\n  int x = 0;\n}\n`],
    ["pointer param", `void f(NSString *name) {\n  int x = 0;\n}\n`],
    ["plain param", `void f(int n) {\n  int x = 0;\n}\n`],
    ["method param", `@implementation A\n- (void)go:(void (^)(int))done {\n  int x = 0;\n}\n@end\n`],
    ["tp", `typedef int (*Fn)(int a, int b);\n`],
  ]
  for (const [label, src] of cases) {
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    console.log(`-- ${label}`)
    const walk = (n: any) => {
      if (n.type === "parameter_declaration" || n.type === "method_parameter") {
        const fields: string[] = []
        for (const f of ["declarator", "name", "type", "default_value"]) {
          const c = n.childForFieldName(f)
          if (c) fields.push(`${f}=${c.type}:"${c.text.slice(0, 24)}"`)
        }
        console.log(`   ${n.type} [${n.text.replace(/\n/g, " ").slice(0, 44)}] fields: ${fields.join(", ") || "(none)"} | namedChildren: ${Array.from({ length: n.namedChildCount }, (_, i) => n.namedChild(i).type).join(",")}`)
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(root)
  }
}
main()
