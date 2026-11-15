import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = `@implementation C
- (void)go {
  void (^blk)(int) = ^(int n) { [self use:n]; };
  blk(3);
}
@end
`
  const root = p.parse(src).rootNode
  const walk = (n: any): void => {
    if (n.type === "identifier" && n.text === "blk") {
      const chain: string[] = []
      let c: any = n
      while (c) { chain.push(`${c.type}[${c.startIndex}-${c.endIndex}]`); c = c.parent }
      console.log("blk @", n.startIndex, "chain:", chain.join(" < "))
      const par = n.parent
      if (par && par.type === "call_expression") {
        const z = par.namedChild(0)
        console.log("  call namedChild(0):", z?.type, z?.startIndex, z?.endIndex, "same:", z?.startIndex === n.startIndex && z?.endIndex === n.endIndex)
      }
      if (par && par.type === "init_declarator") {
        console.log("  init namedChild(0):", par.namedChild(0)?.type, par.namedChild(0)?.startIndex)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
