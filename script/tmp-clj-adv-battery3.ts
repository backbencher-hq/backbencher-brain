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
  const res = analyzer.analyze(p.parse(src).rootNode, src, "/tmp/adv3.clj")
  console.log(`==== ${label} ====`)
  for (const r of res.relationships) console.log(`REL ${r.source} -[${r.type}]-> ${r.target} line=${r.line_number ?? "NULL"} arity=${JSON.stringify(r.metadata?.callArity ?? null)}`)
}
run("ctors", `(ns c)\n(defn a [] (->probe.recs.Rec 1))\n(defn b [] (->Rec 1))\n(defn d [] (new Rec 1))\n(defn e [] (Rec. 1))\n(defn g [] (java.util.Date. 1))`)
run("dotdot-single", `(ns d)\n(defn a [x] (.. x))\n(defn b [x] (. x))\n(defn c [x] (.-f x))\n(defn e [x] (.f x))`)
run("rename", `(ns r (:require [adv.lib :refer [old] :rename {old new}]))\n(defn f [] (new 1))`)
run("refer-rename", `(ns r2 (:refer-clojure :rename {map core-map}))\n(defn f [] (core-map inc [1]))`)
run("use-rename", `(ns r3 (:use [adv.lib :rename {old new}]))\n(defn f [] (new 1))`)
