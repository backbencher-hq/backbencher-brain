// fs042 — what node does a DU case with a DEFAULT body actually come back as?
//
// The lane's `instantiates` rule (callee is the enclosing type) was keyed on the owner's name
// being the literal "constructor", so a union case fell through to `calls`. The obvious fix —
// "is this application inside a `union_type_case`?" — did not fire, and an inert rule is worse
// than no rule: it reads as coverage and measures as nothing. So this prints the node types on
// the line, with the ancestor chain, rather than assuming the grammar spells the case the way
// the node-type name suggests.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) { await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") }); (P as any).__init = true }
const f = process.argv[2]!
const want = Number(process.argv[3]!)
const src = fs.readFileSync(f, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const t = parser.parse(src)!
let seen = 0
;(function walk(n: any, d = 0) {
  if (d > 14 || seen > 8) return
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c.startPosition.row + 1 === want && c.text.length < 140) {
      const chain: string[] = []
      let cur: any = c
      for (let k = 0; k < 6 && cur; k++) { chain.push(cur.type); cur = cur.parent }
      console.log(`  L${want} ${c.type.padEnd(26)} ${JSON.stringify(c.text).slice(0, 76)}`)
      console.log(`      ${chain.join(" < ")}`)
      seen++
    }
    walk(c, d + 1)
  }
})(t.rootNode)
