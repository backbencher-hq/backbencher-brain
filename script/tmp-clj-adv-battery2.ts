import * as fs from "node:fs"; import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass(); p.setLanguage(g)
const mod: any = await import("../src/ast/real-clojure-analyzer")
const analyzer = new mod.RealClojureAnalyzer()
const run = (label: string, src: string) => {
  const res = analyzer.analyze(p.parse(src).rootNode, src, "/tmp/adv2.clj")
  console.log(`==== ${label} ====`)
  for (const s of res.symbols) console.log(`SYM ${JSON.stringify(s.name)} [${s.kind}] owner=${s.ownerName} params=${JSON.stringify((s.parameters||[]).map((x:any)=>x.name))} doc=${JSON.stringify((s as any).docstring ?? null)}`)
  for (const r of res.relationships) console.log(`REL ${r.source} -[${r.type}]-> ${r.target} line=${r.line_number ?? "NULL"} arity=${JSON.stringify(r.metadata?.callArity ?? null)}`)
}
const CASES: Array<[string,string]> = [
  ["defmulti-method", `(ns adv.dm)\n(defmulti area :type)\n(defmethod area :circle [c] (circle-area c))\n(defmethod area :square [s] (square-area s))`],
  ["self-ns", `(ns my.ns)\n(defn f [] (my.ns/g 1))\n(defn h [me] (me/g 2))`],
  ["self-alias", `(ns my.ns (:require [my.ns :as me]))\n(defn f [] (me/g 1))`],
  ["splicing-readcond", `(ns adv.sr (:require [a.b :as ab]))\n(defn f [] #?@(:clj [(ab/x) (local-call)]))`],
  ["ns-docstring", `(ns adv.nd "namespace doc" (:require [a :as a]))`],
  ["def-value-vs-doc", `(ns adv.dv)\n(def x "value")\n(def y "doc" 1)`],
  ["defrecord-meta", `(ns adv.rm2)\n(defrecord ^:mutable R [x] P (m [_] (inner)))\n(defprotocol ^:x Q (q [this]))`],
  ["toplevel-require-multi", `(ns adv.tr)\n(require '[clojure.string :as s] '[clojure.set :as st])\n(defn f [] (s/join "," (st/union #{1} #{2})))`],
  ["case-sym", `(ns adv.cs)\n(defn f [k] (case k foo (a) bar (b)))`],
  ["anon-invoked", `(ns adv.ai)\n(defn f [] (#(helper %) 1))`],
  ["varquote-deref", `(ns adv.vq)\n(defn f [] @#'g (var h) @(i))`],
]
for (const [l,s] of CASES) { try { run(l,s) } catch(e:any){ console.log(`==== ${l} ERROR ${e.message}`) } }
