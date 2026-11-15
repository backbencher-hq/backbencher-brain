// script/m14/tmp/cs-param-noname-tree.ts — the TREE for `void M(params int[])`,
// to find which child the analyzer reads as a name (it published `name: ""`).
import * as fs from "fs"
import * as path from "path"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(process.cwd(), "wasm/tree-sitter-c_sharp.wasm")))
  const p = new P()
  p.setLanguage(LANG)
  const dump = (n: any, dp: number) => {
    if (!n) return
    console.log("  ".repeat(dp) + `${n.type} named=${n.isNamed} field=${n.parent && n.parent.childForFieldName ? (n.parent.childForFieldName("name")?.id === n.id ? "name" : n.parent.childForFieldName("type")?.id === n.id ? "type" : "-") : "-"} :: ${JSON.stringify(String(n.text ?? "").slice(0, 30))}`)
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), dp + 1)
  }
  for (const src of ["class C { void M(params int[]) { } }", "class C { void M(params object[] rest) { } }"]) {
    console.log(`\n=== ${src}`)
    const root = p.parse(src).rootNode
    const stack = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "parameter_list") { dump(n, 1); break }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
  }
}

main()
