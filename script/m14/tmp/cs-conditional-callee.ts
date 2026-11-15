// script/m14/tmp/cs-conditional-callee.ts — what node carries the callee of a
// null-conditional invocation (`Overflow?.Invoke(a)`, `x?.y?.Z(b)`)? The
// callee-name hygiene must accept these (the lane's CSD4 contract already pins
// them) while still refusing literals and other junk.
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
    console.log("  ".repeat(dp) + `${n.type} :: ${JSON.stringify((n.text ?? "").slice(0, 40))}`)
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), dp + 1, max)
  }
  for (const src of ["class C { void M() { Overflow?.Invoke(a); } }", "class C { void M() { x?.y?.Z(b); } }", "class C { void M() { h?.Invoke(this, e); } }"]) {
    const root = p.parse(src).rootNode
    const stack = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "invocation_expression") {
        const f = n.childForFieldName("function")
        console.log(`\nsrc: ${src}`)
        console.log(`  function field = ${f?.type} ${JSON.stringify(f?.text)}`)
        if (f) dump(f, 2, 3)
        break
      }
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
  }
}

main()
