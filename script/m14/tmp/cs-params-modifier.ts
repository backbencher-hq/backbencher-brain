// script/m14/tmp/cs-params-modifier.ts — `void M(params string[] a)` published
// NO parameter at all (measured by cs-param-type-hunt.ts on 10 shapes). What is
// the grammar's node, and does the analyzer's parameter loop see it?
import * as fs from "fs"
import * as path from "path"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P()
  p.setLanguage(LANG)
  const dump = (n: any, dp: number, max: number) => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + `${n.type} named=${n.isNamed} :: ${JSON.stringify((n.text ?? "").slice(0, 34))}`)
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), dp + 1, max)
  }
  for (const src of [
    "class C { void M(params string[] a) { } }",
    "class C { void M(this string a, int b) { } }",
    "class C { void M(ref int a) { } }",
    "class C { void M(in int a) { } }",
    "class C { void M(out int a) { } }",
  ]) {
    const root = p.parse(src).rootNode
    const stack = [root]
    let pl: any = null
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "parameter_list") { pl = n; break }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
    console.log(`\nsrc: ${src}`)
    if (pl) dump(pl, 1, 3)
  }
}

main()
