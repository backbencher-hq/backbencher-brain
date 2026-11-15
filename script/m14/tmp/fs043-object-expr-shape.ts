// fs043 — the DIRECT children of an object expression, for a bare interface name.
//
// `objectExpressionInterface` finds the interface by searching the subtree for a `dot_expression`
// and falling back to a bare identifier. When the interface is BARE (`{ new IDisposable with … }`)
// the first branch finds nothing of its own and keeps descending — into the member bodies — so
// `Thread.CurrentThread.CurrentUICulture` becomes the interface and the row reads
// `implements Main -> CurrentUICulture`.
//
// The fix has to be structural, so this prints the direct children in order, which is what
// "the name right after `new`" actually means in the tree.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) { await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") }); (P as any).__init = true }
const f = process.argv[2]!, want = Number(process.argv[3]!)
const src = fs.readFileSync(f, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const t = parser.parse(src)!
;(function walk(n: any) {
  if (n.type === "object_expression" && n.startPosition.row + 1 === want) {
    console.log(`object_expression @L${want}  text=${JSON.stringify(n.text.slice(0, 90))}`)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      console.log(`   [${i}] ${c.type.padEnd(24)} ${JSON.stringify(c.text.slice(0, 60))}`)
    }
    console.log("   --- first DOT_EXPRESSION found at depth<=4 anywhere in the subtree:")
    let best: any = null
    ;(function d(x: any, dep: number) {
      if (dep > 4 || best) return
      for (let i = 0; i < x.namedChildCount; i++) {
        const c = x.namedChild(i)
        if (c.type === "dot_expression") { best = c; return }
        d(c, dep + 1)
      }
    })(n, 0)
    console.log(`   ${best ? `${best.type} ${JSON.stringify(best.text.slice(0, 60))}` : "(none)"}`)
    return
  }
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
})(t.rootNode)
