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

const CASES = [
  `#inst "2020-01-01"`,
  `#Foo[1 2]`,
  `(defn ^:private pf [x] x)`,
  `(def ^:private pv 1)`,
  `(defn f "doc" [x] 1)`,
  `(deftest ^:integration t (is x))`,
  `(deftest plain-t (is x))`,
  `(extend-protocol P String (px [_] 1) (py [this] 2))`,
  `(extend-type String P (px [_] 1) Q (qx [_] 2))`,
  `(proxy [Object java.io.Closeable] [] (close [] 1))`,
  `(defrecord R [a b] P (px [_] 1))`,
  `(defmethod m :x [a] a)`,
  `(defn f [a b & rest] a)`,
  `(defn g [{:keys [a b] :as m} {x :x} [c d]] a)`,
  `(defn h ([] 1) ([x] x))`,
  `'clojure.string`,
  `'[clojure.string :as s]`,
  `#probe.recs.Rec{:x 1}`,
  `#my/tag [1 2]`,
  `(require '[a.b :as b] '[c.d])`,
  `(:require [clojure.string :as s :refer [join]])`,
  `(import '(java.util Date UUID))`,
  `(:import [java.util Date UUID])`,
  `(reify P (px [_] 3))`,
  `^{:a 1} x`,
]

for (const src of CASES) {
  console.log(`\n### ${src}`)
  const walk = (n: any, d: number) => {
    if (d > 6) return
    console.log(`${"  ".repeat(d)}${n.type}${n.childCount === 0 ? ` ${JSON.stringify(n.text).slice(0, 40)}` : ""}${n.isNamed ? "" : " (anon)"}`)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, d + 1) }
  }
  walk(p.parse(src).rootNode, 0)
}
// ── field probes: does `name` still resolve when meta_lit precedes it? ──
for (const src of [`(defn ^:private pf [x] x)`, `(def ^:private pv 1)`, `(deftest ^:integration t (is x))`, `(defn q [x] x)`]) {
  const root = p.parse(src).rootNode
  const list = root.namedChild(0)!
  for (let i = 1; i < list.namedChildCount; i++) {
    const c = list.namedChild(i)
    if (!c || c.type !== "sym_lit") continue
    const f = c.childForFieldName("name")
    const kids: string[] = []
    for (let j = 0; j < c.namedChildCount; j++) kids.push(c.namedChild(j)!.type)
    console.log(`FIELD ${src} -> child${i}: name-field=${f ? JSON.stringify(f.text) : "NULL"}; raw=${JSON.stringify(c.text)}; kids=[${kids.join(",")}]`)
  }
}
process.exit(0)
