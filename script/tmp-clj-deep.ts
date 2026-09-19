// tmp-clj-deep.ts — Clojure deep review: behavior battery #2 + corpus node-type
// census (mini-F8). Blind-spot candidates = structural node types occurring in
// the corpus that the analyzer NEVER references.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const parser = new ParserClass()
parser.setLanguage(g)
const mod: any = await import("../src/ast/real-clojure-analyzer")
const analyzer = new mod.RealClojureAnalyzer()

const DIR = "/tmp/bb-clj-deep"
fs.mkdirSync(DIR, { recursive: true })
function run(name: string, src: string): any {
  const fp = path.join(DIR, name)
  fs.writeFileSync(fp, src)
  return analyzer.analyze(parser.parse(src).rootNode, src, fp)
}
const rels = (res: any) => res.relationships.map((r: any) => `${r.source} -[${r.type}]-> ${r.target} line=${r.line_number ?? "NULL"}`)

// D1: TOP-LEVEL require/import after the ns form (no clauses in ns)
const D1 = `(ns probe.tl)
(require '[clojure.string :as s])
(import 'java.util.Date)
(defn go [] (s/join ","))
(defn mk [] (Date.))
`
const r1 = run("d1.clj", D1)
console.log("### D1 top-level require/import")
console.log("symbols:", r1.symbols.map((s: any) => s.name).join(", "))
console.log("imports:", r1.imports.map((i: any) => i.module).join(", ") || "(none)")
for (const r of rels(r1)) console.log("  " + r)

// D2: calls in def initializers + deftest bodies
const D2 = `(ns probe.defs)
(def state (make-state))
(defonce once (make-once))
(deftest my-test
  (is (works))
  (checks))
(defn after [] (ok))
`
const r2 = run("d2.clj", D2)
console.log("\n### D2 def-initializer / deftest calls")
console.log("symbols:", r2.symbols.map((s: any) => `${s.name}[${s.kind}]`).join(", "))
for (const r of rels(r2)) console.log("  " + r)

// D3: extend-protocol / reify / extend-type
const D3 = `(ns probe.ext)
(defprotocol P (px [this]))
(extend-protocol P
  String
  (px [_] 1))
(reify P
  (px [_] 2))
(defn use-reify [] (reify P (px [_] 3)))
`
const r3 = run("d3.clj", D3)
console.log("\n### D3 extend-protocol / reify")
console.log("symbols:", r3.symbols.map((s: any) => s.name).join(", "))
for (const r of rels(r3)) console.log("  " + r)

// D4: params — rest &, destructuring
const D4 = `(ns probe.p)
(defn f [& args] args)
(defn g [{:keys [a b]} c] [a b c])
`
const r4 = run("d4.clj", D4)
console.log("\n### D4 params")
for (const s of r4.symbols) console.log(`  ${s.name}: params=${JSON.stringify((s.parameters ?? []).map((p: any) => p.name))}`)

// D5: docs — docstring strings + leading comment blocks
const D5 = `(ns probe.docs)

;; Attaches to the next definition.
;; Second line.
(defn commented [x] x)

(defn documented "Doc string wins." [x] x)
(def documented-var "Doc v." 1)
`
const r5 = run("d5.clj", D5)
console.log("\n### D5 docs")
for (const s of r5.symbols) {
  const c = (s as any).comments
  if (c) console.log(`  ${s.name}: comments=${JSON.stringify(c)} docstring=${JSON.stringify((s as any).docstring)}`)
}

// D6: tagged literals / ctor literals
const D6 = `(ns probe.tags)
#inst "2020-01-01"
#Foo[1 2]
#probe.recs.Rec{:x 1}
#my/tag (call-x)
#my/tag [1 2]
(defn t [] #Foo[3 4])
`
const r6 = run("d6.clj", D6)
console.log("\n### D6 tagged literals")
for (const r of rels(r6)) console.log("  " + r)

// D7: impl owner identity for extend-protocol
const D7 = `(ns probe.owner)
(defprotocol P (px [this]))
(extend-protocol P
  String
  (px [_] 1))
`
const r7 = run("d7.clj", D7)
console.log("\n### D7 impl owners")
for (const s of r7.symbols) console.log(`  ${s.name}: owner=${s.ownerName} scope=${s.scope} impls=${(s.metadata ?? {}).isProtocolMethodImpl ?? false}`)

// D8: (:import [java.util Date UUID]) items
const D8 = `(ns probe.imp
  (:import [java.util Date UUID]))
`
const r8 = run("d8.clj", D8)
console.log("\n### D8 import vec items")
console.log(JSON.stringify(r8.imports.map((i: any) => ({ module: i.module, items: i.items }))))

// ── Corpus census ───────────────────────────────────────────────────────────
function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "target" || e.name === "node_modules") continue
      walk(p, acc)
    } else if (e.name.endsWith(".clj") || e.name.endsWith(".cljc") || e.name.endsWith(".cljs")) acc.push(p)
  }
  return acc
}
const files = walk("$HOME/fixtures/repositories/clojure").slice(0, 300)
const REFERENCED = new Set([
  "sym_lit", "kwd_lit", "list_lit", "vec_lit", "anon_fn_lit", "dis_expr",
  "comment", "meta_lit", "quoting_lit", "syn_quoting_lit", "unquoting_lit", "unquote_splicing_lit",
])
const typeCount = new Map<string, number>()
const typeLeaf = new Map<string, boolean>()
let errFiles = 0, relsTotal = 0, linedTotal = 0, docTotal = 0
for (const f of files) {
  let tree: any, res: any
  try {
    const src = fs.readFileSync(f, "utf8")
    tree = parser.parse(src)
    res = analyzer.analyze(tree.rootNode, src, f)
  } catch { continue }
  if ((res.errors ?? []).length > 0) errFiles++
  relsTotal += res.relationships.length
  for (const r of res.relationships) if (typeof (r as any).line_number === "number") linedTotal++
  for (const s of res.symbols) if ((s as any).docstring || (s.comments ?? []).length) docTotal++
  const stack = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.isNamed) {
      typeCount.set(n.type, (typeCount.get(n.type) ?? 0) + 1)
      if (!typeLeaf.has(n.type)) typeLeaf.set(n.type, n.namedChildCount === 0)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
console.log(`\n### CORPUS CENSUS (${files.length} files)`)
console.log(`rels=${relsTotal} lined=${linedTotal} symbolsWithDoc=${docTotal} parseErrorFiles=${errFiles}`)
console.log(`occurring named types: ${typeCount.size}`)
const sorted = [...typeCount.entries()].sort((a, b) => b[1] - a[1])
console.log("type (count, leaf?, referenced?):")
const blindCandidates: string[] = []
for (const [t, c] of sorted) {
  const ref = REFERENCED.has(t)
  const leaf = typeLeaf.get(t) !== false
  console.log(`  ${t.padEnd(26)} ${String(c).padStart(6)}  leaf=${leaf ? "y" : "n"}  ref=${ref ? "y" : "N"}`)
  if (!ref && !leaf) blindCandidates.push(t)
}
console.log(`\nBLIND-SPOT CANDIDATES (structural, unreferenced): ${blindCandidates.length}`)
for (const t of blindCandidates) console.log(`  ! ${t}`)
process.exit(0)
