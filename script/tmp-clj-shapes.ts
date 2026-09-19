// tmp-clj-shapes.ts — node shapes for the census's unreferenced structural
// types (tagged literals, ns-maps, deref, var-quote, set, map).
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass()
p.setLanguage(g)

for (const src of [
  `#inst "2020-01-01"`,
  `#my/tag (call-x)`,
  `#Foo[1 2]`,
  `#:ns{:a 1}`,
  `@st`,
  `#'some-fn`,
  `(defn w [x] [y z])`,
  `(reify P (px [_] 3))`,
]) {
  console.log(`\n### ${src}`)
  const walk = (n: any, d: number) => {
    console.log(`${"  ".repeat(d)}${n.type}${n.childCount === 0 ? ` ${JSON.stringify(n.text).slice(0, 32)}` : ""}${n.isNamed ? "" : " (anon)"}`)
    if (d >= 5) return
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, d + 1) }
  }
  walk(p.parse(src).rootNode, 0)
}
process.exit(0)
