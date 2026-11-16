// Does `declaration` expose a `declarator` field, and does it separate a real
// declarator from a specifier-position macro left behind by a stacked macro?
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))

const cases: Array<[string, string]> = [
  ["real: int x;", `int x;\n`],
  ["real: static NSArray *g;", `static NSArray *g;\n`],
  ["real: int x = 1, y = 2;", `int x = 1, y = 2;\n`],
  ["real: NSString *const kFoo;", `NSString *const kFoo;\n`],
  ["damaged: two stacked macros", `NS_ASSUME_NONNULL_END\nPROTOCOL_MACRO\n@interface Foo : NSObject\n@end\n`],
  ["damaged: bare macro alone", `BARE_MACRO\ninta b;\n`],
]

for (const [label, src] of cases) {
  const p = new P()
  p.setLanguage(lang)
  const tree: any = p.parse(src)
  const decls: any[] = []
  const visit = (n: any) => {
    if (n.type === "declaration") decls.push(n)
    for (const c of n.children) visit(c)
  }
  visit(tree.rootNode)
  for (const d of decls) {
    const dec = d.childForFieldName?.("declarator")
    const named = d.namedChildren.map((c: any) => c.type + ":" + JSON.stringify(c.text.slice(0, 22)))
    console.log(
      `${label.padEnd(30)} hasError=${String(tree.rootNode.hasError).padEnd(5)} declaratorField=${dec ? dec.type + "/" + JSON.stringify(dec.text.slice(0, 18)) : "NONE"}\n    named=${JSON.stringify(named)}`,
    )
  }
  if (!decls.length) console.log(`${label.padEnd(30)} (no declaration node)`)
}
process.exit(0)
