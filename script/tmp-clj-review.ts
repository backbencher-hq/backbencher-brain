// tmp-clj-review.ts — Clojure deep-review probe (raw analyzer, below the
// pool-worker mapping). Fixture battery for the suspected classes + corpus
// metrics. Nothing is a finding until this prints it.
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

const DIR = "/tmp/bb-clj"
fs.mkdirSync(DIR, { recursive: true })

function run(name: string, src: string): any {
  const fp = path.join(DIR, name)
  fs.writeFileSync(fp, src)
  return analyzer.analyze(parser.parse(src).rootNode, src, fp)
}
function report(label: string, res: any) {
  console.log(`\n### ${label}`)
  console.log("SYMBOLS:")
  for (const s of res.symbols) {
    const doc = s.comments ? ` doc=${JSON.stringify(String(s.comments[0]))}` : (s.docstring ? ` docstring=${JSON.stringify(s.docstring)}` : "")
    console.log(`  [${s.kind}] ${s.name} owner=${s.ownerName ?? "-"} scope=${s.scope ?? "-"} cplx=${s.metadata?.complexity ?? "-"}${doc}`)
  }
  console.log("RELATIONSHIPS:")
  for (const r of res.relationships) console.log(`  ${r.source} -[${r.type}]-> ${r.target}  line=${r.line_number ?? "NULL"}`)
  console.log(`PATTERNS: ${JSON.stringify(res.metadata?.patterns ?? [])}`)
  console.log(`FRAMEWORKS: ${JSON.stringify(res.metadata?.detectedFrameworks ?? [])}`)
}

// A. lines + per-site + multi-arity + docstrings
const A = `(ns probe.core
  "Namespace doc.")

(defn helper
  "Helper doc."
  [x] x)

(defn pick
  ([x] :one)
  ([x y] :two))

(defn run []
  (helper 1)
  (helper 2)
  (pick 1)
  (pick 1 2))
`
report("A: lines / per-site / multi-arity / docstrings", run("a.clj", A))

// B. alias-resolved protocol implementations
const B = `(ns probe.rec
  (:require [probe.protocols :as p]))

(defprotocol Proto (m [this]))

(defrecord Plain [a]
  Proto
  (m [_] 1))

(defrecord Aliased [a]
  p/Proto
  (m [_] 2))
`
report("B: implements alias (expect probe.protocols/Proto; actual p/Proto?)", run("b.clj", B))

// C. reader conditional + deref/var forms
const C = `(ns probe.rc)
(def state (atom 0))
(defn pick-platform []
  #?(:clj (clj-fn) :cljs (cljs-fn)))
(defn use-deref []
  @state
  #'clj-fn
  (after-deref))
`
report("C: reader-conditional / deref / var", run("c.clj", C))

// D. corpus metrics
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
const files = walk("$HOME/fixtures/repositories/clojure").slice(0, 250)
let rels = 0, lined = 0, docstrings = 0, calls = 0, slashImplements = 0
const slashSamples: string[] = []
const t0 = performance.now()
for (const f of files) {
  let res: any
  try {
    const src = fs.readFileSync(f, "utf8")
    res = analyzer.analyze(parser.parse(src).rootNode, src, f)
  } catch { continue }
  for (const r of res.relationships) {
    rels++
    if (typeof r.line_number === "number") lined++
    if (r.type === "calls") calls++
    if (r.type === "implements" && typeof r.target === "string" && r.target.includes("/")) {
      slashImplements++
      if (slashSamples.length < 8) slashSamples.push(`${f.replace(/^.*repositories\//, "")}: ${r.source} -> ${r.target}`)
    }
  }
  for (const s of res.symbols) if ((s as any).docstring || (s.comments && s.comments.length)) docstrings++
}
console.log(`\n### CORPUS (clojure repo, ${files.length} files)`)
console.log(`relationships=${rels} lined=${lined} (${((lined / Math.max(1, rels)) * 100).toFixed(2)}%) calls=${calls} symbolsWithDoc=${docstrings}`)
console.log(`implements-with-slash-target=${slashImplements}`)
for (const s of slashSamples) console.log("  " + s)
console.log(`ms=${Math.round(performance.now() - t0)}`)
process.exit(0)
