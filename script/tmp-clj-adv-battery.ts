// tmp-clj-adv-battery.ts — ADVERSARIAL battery: run analyzer on inline cases, print edges/symbols.
// Usage: bun run script/tmp-clj-adv-battery.ts [--tree] [file]
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
const mod: any = await import("../src/ast/real-clojure-analyzer")
const analyzer = new mod.RealClojureAnalyzer()

const argv = process.argv.slice(2)
const wantTree = argv.includes("--tree")
const fileArg = argv.find((a: string) => !a.startsWith("--"))

const run = (label: string, src: string, showTree = false) => {
  const root = p.parse(src).rootNode
  if (showTree || wantTree) {
    const walk = (n: any, d: number, idx: number) => {
      console.log(`${"  ".repeat(d)}[${idx}] ${n.type} L${n.startPosition.row + 1} :: ${n.namedChildCount > 0 ? "" : JSON.stringify(n.text.slice(0, 40))}`)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, d + 1, i) }
    }
    console.log(`==== TREE ${label} ====`)
    walk(root, 0, 0)
  }
  const res = analyzer.analyze(root, src, "/tmp/adv.clj")
  console.log(`==== ${label} ====`)
  for (const s of res.symbols) {
    console.log(`SYM ${s.name} [${s.kind}] owner=${s.ownerName} scope=${s.scope} params=${JSON.stringify((s.parameters || []).map((x: any) => x.name))} docstring=${JSON.stringify((s as any).docstring ?? null)} comments=${JSON.stringify(s.comments ?? null)}`)
  }
  for (const r of res.relationships) {
    console.log(`REL ${r.source} -[${r.type}]-> ${r.target} line=${r.line_number ?? "NULL"} arity=${JSON.stringify(r.metadata?.callArity ?? null)} meta=${JSON.stringify(r.metadata)}`)
  }
  for (const i of res.imports) console.log(`IMP ${i.module} items=${JSON.stringify(i.items)} line=${(i as any).line ?? "NULL"}`)
}

if (fileArg) {
  const src = fs.readFileSync(fileArg, "utf8")
  run(fileArg, src, wantTree)
} else {
  const CASES: Array<[string, string]> = [
    // ── 1. alias prototype pollution ────────────────────────────────
    ["proto-alias", `(ns adv.proto)\n(toString/f 1)\n(valueOf/g 2)\n(constructor/h 3)\n(hasOwnProperty/i 4)`],
    ["proto-implements", `(ns adv.proto2)\n(defrecord R [] toString/P (m [this] 1))`],
    // ── 2. refer-clojure :exclude ───────────────────────────────────
    ["refer-clojure-exclude", `(ns adv.rc (:refer-clojure :exclude [my-map]))\n(defn f [] (my-map 1))`],
    ["refer-clojure-exclude-comment", `(ns adv.rc2 (:refer-clojure :exclude [comment]))\n(comment (fab-edged))\n(defn g [] (real))`],
    // ── 3. comment shadow scan ──────────────────────────────────────
    ["comment-ns-sym", `(ns adv.c1)\n(comment (fab1))\n(foo/comment x)`],
    ["comment-map-key", `(ns adv.c2)\n(def m {comment 1})\n(comment (fab2))`],
    ["comment-param", `(ns adv.c3)\n(defn a [comment] (b comment))\n(comment (fab3))`],
    ["comment-kwd", `(ns adv.c4)\n(def m {:comment 1})\n(comment (fab4))`],
    ["comment-quoted", `(ns adv.c5)\n(def x 'comment)\n(comment (fab5))`],
    // ── 4. metadata values as code ──────────────────────────────────
    ["meta-value", `(ns adv.m1)\n(def ^{:doc (meta-fn)} x 1)\n(defn ^{:custom (meta-fn2)} f [] 1)`],
    ["meta-private-def", `(ns adv.m2)\n(def ^:private p 1)\n(def ^:dynamic *d* 2)\n(defn ^:private g [x] x)`],
    // ── 5. comments as docstrings ───────────────────────────────────
    ["trailing-comment", `(ns adv.t1)\n(def a 1) ; trailing note\n(defn b [] a)`],
    ["blank-sep-comment", `(ns adv.t2)\n;; unrelated header\n\n(defn c [] 1)`],
    ["single-semi", `(ns adv.t3)\n; single semi doc\n(defn d [] 1)`],
    // ── 6. threading ────────────────────────────────────────────────
    ["threading", `(ns adv.th)\n(defn f [x] (-> x foo bar))\n(defn g [x] (-> x (f1 1)))\n(defn h [x] (->> x (filter odd?) count))\n(defn i [x] (doto x (.setY 1) (.setZ 2)))\n(defn j [x] (.. x (m1) (m2)))\n(defn k [x] (cond-> x true (assoc :k 1)))\n(defn l [x] (as-> x $ (f2 $)))`],
    // ── 7. letfn ────────────────────────────────────────────────────
    ["letfn", `(ns adv.lf)\n(defn outer []\n  (letfn [(f [x] (g-inner x))\n          (g-inner [x] x)]\n    (f 1)))`],
    // ── 8. definterface ────────────────────────────────────────────
    ["definterface", `(ns adv.di)\n(definterface IFoo\n  (^int size [])\n  (^void run []))`],
    // ── 9. qualified quote + aliased comment ───────────────────────
    ["qualified-quote", `(ns adv.qq)\n(clojure.core/quote (fab6))`],
    ["aliased-comment", `(ns adv.ac (:require [clojure.core :as c]))\n(c/comment (fab7))`],
    // ── 10. cljc require forms ──────────────────────────────────────
    ["cljc-readcond", `(ns adv.cljc\n  #?(:clj (:require [clojure.string :as s])))\n(defn f [] (s/join "," [1]))`],
    ["cljc-require-macros", `(ns adv.rm\n  (:require-macros [adv.macros :as m]))\n(defn f [] (m/go))`],
    ["as-alias", `(ns adv.aa\n  (:require [foo.bar :as-alias fb]))\n(defn f [] (fb/x))`],
    // ── 11. arity with metadata args ────────────────────────────────
    ["arity-meta", `(ns adv.ar)\n(defn f [x] (g ^String x 1))\n(h ^:foo y)`],
    // ── 12. case constants ──────────────────────────────────────────
    ["case-const", `(ns adv.cc)\n(defn f [k] (case k (a b) :r :d))`],
    // ── 13. new / ctor ──────────────────────────────────────────────
    ["new-ctor", `(ns adv.nc)\n(defn f [] (new java.util.Date 1))\n(defn g [] (java.util.Date. 1))\n(defn h [] (->java.util.Date 1))`],
    // ── 14. defrecord with docstring ────────────────────────────────
    ["defrecord-doc", `(ns adv.rd)\n(defrecord Foo "record doc" [x y] P (m [_] 1))`],
    // ── 15. prefix list parenthesized ───────────────────────────────
    ["prefix-paren", `(ns adv.pp (:require (adv.prefix (sub :as sp))))\n(defn f [] (sp/one))`],
    // ── 16. comment inside syntax quote ─────────────────────────────
    ["sq-comment", `(ns adv.sq)\n(defmacro m [] \`(comment (dead)))\n(defn f [] 1)`],
    // ── 17. multi-line lines ────────────────────────────────────────
    ["lines-multiline", `(ns adv.ln)\n(defn f\n  "doc"\n  [x]\n  (foo\n    x))\n(def ^:private q\n  1)`],
    // ── 18. defn with meta docstring ────────────────────────────────
    ["meta-docstring", `(ns adv.md)\n(defn ^:private "docstring?" f [] 1)`],
  ]
  for (const [label, src] of CASES) {
    try { run(label, src) } catch (e: any) { console.log(`==== ${label} ==== ERROR ${e.message}`) }
  }
}
