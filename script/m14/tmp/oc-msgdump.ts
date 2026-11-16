import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = `@implementation C
- (void)m {
  [store objectForKey:k];
  [foo bar];
  [self fire];
  [Foo alloc];
  [a b:c d:e];
}
@end
`
  const root = p.parse(src).rootNode
  const dump = (n: any, d: number): void => {
    if (n.type === "message_expression") {
      console.log("MSG children:")
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        console.log(`  [${i}] named=${c.isNamed} type=${c.type} text=${c.text.slice(0, 24)}`)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d + 1)
  }
  dump(root, 0)
}
main()
