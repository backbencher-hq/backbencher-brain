// script/m14/tmp/oc-param-shape.ts — print the parent chain of every identifier
// inside a PARAMETER LIST, for the shapes that matter to the OC-E uses leak
// (`uses register_block -> handler` fired from the block-parameter DECLARATION).
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const cases = [
    `void f(void (^handler)(NSString *)) {\n  int x = 0;\n}\n`,
    `void f(int n) {\n  int x = 0;\n}\n`,
    `void f(NSString *name) {\n  int x = 0;\n}\n`,
    `void f(void (^cb)(int a)) {\n  int x = 0;\n}\n`,
    `@implementation A\n- (void)go:(void (^)(int))done {\n  int x = 0;\n}\n@end\n`,
    `void f(void (^h)(int)) {\n  void (^local)(int) = 0;\n}\n`,
    `void f(int *ptr) {\n  int x = 0;\n}\n`,
  ]
  for (const src of cases) {
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    console.log("SRC:", JSON.stringify(src.split("\n").slice(0, 2).join(" ").slice(0, 70)))
    const walk = (n: any, depth: number) => {
      if (n.type === "identifier" || n.type === "field_identifier" || n.type === "function_declarator" || n.type === "block_pointer_declarator" || n.type === "pointer_declarator" || n.type === "parameter_declaration" || n.type === "method_parameter" || n.type === "parenthesized_declarator" || n.type === "block_literal") {
        const chain: string[] = []
        let up = n
        while (up) { chain.push(up.type); up = up.parent }
        if (n.type === "identifier") console.log(`   id "${n.text}"  chain: ${chain.slice(0, 5).join(" < ")}`)
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), depth + 1)
    }
    walk(root, 0)
  }
}
main()
