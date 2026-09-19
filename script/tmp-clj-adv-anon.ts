import * as fs from "node:fs"; import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass(); p.setLanguage(g)
const anaMod: any = await import("../src/ast/real-clojure-analyzer")
const CORE = anaMod.CLOJURE_CORE_BUILTINS
const analyzer = new anaMod.RealClojureAnalyzer()

const run = (label: string, src: string) => {
  const res = analyzer.analyze(p.parse(src).rootNode, src, "/tmp/anon.clj")
  console.log(`==== ${label} ====`)
  for (const s of res.symbols) console.log(`SYM ${JSON.stringify(s.name)} [${s.kind}]`)
  for (const r of res.relationships) console.log(`REL ${r.source} -[${r.type}]-> ${r.target} line=${r.line_number ?? "NULL"} arity=${JSON.stringify(r.metadata?.callArity ?? null)}`)
}
run("anon-head-1", `(ns a)\n(defn f [] (#(helper %) 1))`)
run("anon-head-2", `(ns a)\n(defn f [] (map #(my.ns/conv %) xs))`)
run("anon-nested", `(ns a)\n(defn f [] (map #(outer (inner %)) xs))`)
run("fn-form", `(ns a)\n(defn f [] (map (fn [x] (helper x)) xs))`)

// corpus scan: anon_fn_lit whose first child is a non-builtin sym head
const symName = (nd: any): string => {
  if (!nd) return ""
  if (nd.type === "sym_lit") {
    const nm = nd.childForFieldName ? nd.childForFieldName("name") : null
    const ns = nd.childForFieldName ? nd.childForFieldName("namespace") : null
    if (nm && ns) return `${ns.text}/${nm.text}`
    if (nm) return nm.text
    return nd.text ?? ""
  }
  return nd.text ?? ""
}
const files: string[] = []
const walkDir = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) { if (e.name === ".git") continue; walkDir(fp) } else if (/\.(clj|cljs|cljc)$/.test(e.name)) files.push(fp) } }
walkDir("$HOME/fixtures/repositories/clojure"); walkDir("$HOME/fixtures/repositories/clj-kondo")
let shapeCount = 0, fileCount = 0; const samples: string[] = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const root = p.parse(src).rootNode
  const st: any[] = [root]; let hit = false
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type === "anon_fn_lit") {
      const first = n.namedChild(0)
      const nm = symName(first)
      if (first && first.type === "sym_lit" && nm && !CORE[nm] && !nm.startsWith("%") && !nm.endsWith(".") && !nm.startsWith(".")) {
        shapeCount++; hit = true
        if (samples.length < 6) samples.push(`${f}:${n.startPosition.row + 1} #(${nm} …)`)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  if (hit) fileCount++
}
console.log(`CORPUS: anon_fn_lit with non-builtin sym head: ${shapeCount} sites in ${fileCount} files`)
for (const s of samples) console.log(`  ${s}`)
