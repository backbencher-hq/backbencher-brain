// fs045 — is the type being EXTENDED named anywhere in the extension's own subtree?
//
// `default _.Accessibility = FSharpAccessibility(taccessPublic)` (Symbols.fs:724) extends a type
// declared 690 lines earlier (line 33). The `calls`/`instantiates` rule asks whether the callee
// IS the enclosing type, and here the enclosing `anon_type_defn` is ANONYMOUS — so the comparison
// has nothing to compare and the row falls through to `calls`.
//
// Two attempts to fix this have already been made and reverted, both by guessing what the name
// node looks like. So this prints the type_name nodes in reach and their positions, and the
// answer is whichever of them the tree actually offers.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) { await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") }); (P as any).__init = true }
const f = process.argv[2]!, want = Number(process.argv[3]!)
const src = fs.readFileSync(f, "utf8")
const p = new P(); p.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const t = p.parse(src)!
;(function walk(n: any, d = 0) {
  if (d > 16) return
  if (n.type === "type_extension_elements" && n.startPosition.row + 1 <= want && want <= n.endPosition.row + 1) {
    console.log(`type_extension_elements  L${n.startPosition.row + 1}-${n.endPosition.row + 1}`)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      console.log(`  child[${i}] ${c.type.padEnd(26)} L${c.startPosition.row + 1} ${JSON.stringify(c.text.slice(0, 64))}`)
    }
    const names: string[] = []
    ;(function d2(x: any, dep: number) {
      if (dep > 8) return
      for (let i = 0; i < x.namedChildCount; i++) {
        const c = x.namedChild(i)
        if (c.type === "type_name") names.push(`${c.text}@L${c.startPosition.row + 1}`)
        d2(c, dep + 1)
      }
    })(n, 0)
    console.log(`  type_name in subtree (depth<=8): ${JSON.stringify(names)}`)
    return
  }
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), d + 1)
})(t.rootNode)
