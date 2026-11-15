/**
 * Clojure master-review probe (M49 formula pass — reviews/clojure/master-review.md).
 * Runs candidate shapes through the REAL analyzer on the pinned grammar and
 * prints symbols / relationships for eyeball adjudication.
 *
 * Run: bun script/m14/tmp/clojure-review-probe.ts [caseId]
 */
import { getParser } from "../run-fixtures"

const mod: any = await import("../../../src/ast/real-clojure-analyzer")
const analyzer = new mod.RealClojureAnalyzer()
const parser = await getParser("clojure")

const CASES: { id: string; code: string }[] = [
  {
    id: "letfn-shadow",
    code: `(ns probe.letfn)
(defn run []
  (letfn [(comment [x] x)]
    (comment 1 2)))`,
  },
  {
    id: "let-shadow-control",
    code: `(ns probe.letshadow)
(defn run []
  (let [comment (fn [x] x)]
    (comment 1 2)))`,
  },
  {
    id: "defmethod-doc",
    code: `(ns probe.dm)
(defmulti area :shape)
(defmethod area "docstring" :circle [s] (:r s))
(defmethod area :square [s] (* (:side s) (:side s)))`,
  },
  {
    id: "meta-private",
    code: `(ns probe.meta)
(def ^{:private true} secret 1)
(defn run [] (inc secret))`,
  },
  {
    id: "reader-conditional",
    code: `(ns probe.cond)
(defn run [] #?(:clj (foo) :cljs (bar)))`,
  },
  {
    id: "records",
    code: `(ns probe.rec)
(defrecord Point [x y])
(defn make [] (->Point 1 2))
(defn ctor [] (Point. 3 4))`,
  },
  {
    id: "ns-requires",
    code: `(ns probe.ns
  (:require [bar.baz :as b]
            [qux.core :refer [x y]]))
(defn run [] (b/f) (x))`,
  },
  {
    id: "threading",
    code: `(ns probe.thread)
(defn f [x] x)
(defn g [x] x)
(defn run [v] (-> v (f) (g)))`,
  },
  {
    id: "case-default",
    code: `(ns probe.case)
(defn run [x]
  (case x
    :a 1
    :b 2
    0))`,
  },
  {
    id: "fn-scopes",
    code: `(ns probe.fn)
(defn g [] 1)
(defn run []
  (let [f (fn [] (g))]
    (f)))`,
  },
  {
    id: "multiarity",
    code: `(ns probe.multi)
(defn h
  ([] 1)
  ([x] x)
  ([x y] (+ x y)))`,
  },
  {
    id: "anon-fn",
    code: `(ns probe.anon)
(defn run [xs] (map #(+ % 1) xs))`,
  },
]

const only = process.argv[2]
for (const c of CASES) {
  if (only && c.id !== only) continue
  const tree = parser.parse(c.code)
  const r = analyzer.analyze(tree.rootNode, c.code, `probe/${c.id}.clj`)
  console.log(`\n══════════ ${c.id} ══════════`)
  console.log(`symbols: ${(r.symbols ?? []).map((s: any) => `${s.kind}:${s.ownerName && s.ownerName !== s.name ? s.ownerName + "." : ""}${s.name}@L${s.range?.start?.line ?? (s.range?.start?.row !== undefined ? s.range.start.row + 1 : "?")}${s.visibility === "private" ? " priv" : ""}${s.metadata?.params || s.parameters?.length ? ` params=${s.parameters?.length}` : ""}`).join(" | ")}`)
  console.log(`rels:`)
  for (const rel of r.relationships ?? []) {
    console.log(`  ${rel.type}: ${rel.source} -> ${rel.target}${rel.line_number ? ` @L${rel.line_number}` : ""}`)
  }
  if (r.errors?.length) console.log(`errors: ${r.errors.map((e: any) => e.message).join(" ; ")}`)
}
console.log("\ndone")
