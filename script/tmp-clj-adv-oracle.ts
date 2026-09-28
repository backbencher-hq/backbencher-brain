// tmp-clj-adv-oracle.ts — compare analyzer edges vs deriveClojureEdges (oracle) on inputs.
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass(); p.setLanguage(g)
const anaMod: any = await import("../src/ast/real-clojure-analyzer")
const analyzer = new anaMod.RealClojureAnalyzer()
const diffMod: any = await import("./m14/differential")
const deriveClojureEdges = diffMod.deriveClojureEdges

const run = (label: string, src: string) => {
  const root = p.parse(src).rootNode
  const res = analyzer.analyze(root, src, "/tmp/adv.clj")
  const oEdges = deriveClojureEdges(root)
  const LABELS = new Set(["calls", "references", "extends", "implements", "instantiates", "overrides"])
  const aEdges = res.relationships.filter((r: any) => LABELS.has(r.type)).map((r: any) => `${r.type}|${r.source}|${r.target}`)
  const oSet = oEdges.filter((e: any) => LABELS.has(e.label)).map((e: any) => `${e.label}|${e.from}|${e.target}`)
  console.log(`==== ${label} ====`)
  console.log(`ANALYZER: ${JSON.stringify(aEdges)}`)
  console.log(`ORACLE:   ${JSON.stringify(oSet)}`)
  const oMiss = oSet.filter((e: string) => !aEdges.includes(e))
  const aUnex = aEdges.filter((e: string) => !oSet.includes(e))
  console.log(`ORACLE-not-in-analyzer (would be MISSING): ${JSON.stringify(oMiss)}`)
  console.log(`ANALYZER-not-in-oracle (would be unexplained): ${JSON.stringify(aUnex)}`)
}

const argv = process.argv.slice(2)
const fileArg = argv[0]
if (fileArg && /\.(clj|cljs|cljc)$/.test(fileArg)) {
  run(path.basename(fileArg), fs.readFileSync(fileArg, "utf8"))
} else {
  const CASES: Array<[string, string]> = [
    ["proto-alias", `(ns adv.proto)\n(toString/f 1)\n(valueOf/g 2)\n(constructor/h 3)\n(hasOwnProperty/i 4)`],
    ["refer-clojure-exclude", `(ns adv.rc (:refer-clojure :exclude [my-map]))\n(defn f [] (my-map 1))`],
    ["comment-skip-cljs", `(ns skip-args.comment\n  (:refer-clojure :exclude [comment])\n  (:require [cljs.core :as core]))\n\n(core/comment\n  (select-keys))`],
    ["string-clj-exclude", `(ns clojure.string\n  (:refer-clojure :exclude (replace reverse)))`],
    ["prefix-paren-oracle", `(ns adv.pp (:require (adv.prefix (sub :as sp))))\n(defn f [] (sp/one))`],
    ["as-alias", `(ns adv.aa (:require [foo.bar :as-alias fb]))\n(defn f [] (fb/x))`],
    ["cljc-readcond", `(ns adv.cljc\n  #?(:clj (:require [clojure.string :as s])))\n(defn f [] (s/join "," [1]))`],
    ["letfn", `(ns adv.lf)\n(defn outer [] (letfn [(f [x] (g-inner x)) (g-inner [x] x)] (f 1)))`],
    ["definterface", `(ns adv.di)\n(definterface IFoo (^int size []) (^void run []))`],
    ["meta-value", `(ns adv.m1)\n(def ^{:doc (meta-fn)} x 1)`],
    ["comment-map-key", `(ns adv.c2)\n(def m {comment 1})\n(comment (fab2))`],
    ["case-const", `(ns adv.cc)\n(defn f [k] (case k (a b) :r :d))`],
    ["dotdot", `(ns adv.dd)\n(defn j [x] (.. x (m1) (m2)))`],
    ["qualified-quote", `(ns adv.qq)\n(clojure.core/quote (fab6))`],
  ]
  for (const [label, src] of CASES) { try { run(label, src) } catch (e: any) { console.log(`==== ${label} ==== ERROR ${e.message}`) } }
}
