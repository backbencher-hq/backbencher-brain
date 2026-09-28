// tmp-clj-ns-shape.ts — dump all symbols (name/owner/line) for a file plus the
// parse shape of its first ns form.
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

const F = process.argv[2]
const src = fs.readFileSync(F, "utf8")
const root = p.parse(src).rootNode
console.log("── symbols (name | kind | owner | line):")
for (const s of analyzer.analyze(root, src, F).symbols) {
  console.log(`  ${JSON.stringify(s.name)} | ${s.kind} | owner=${JSON.stringify(s.ownerName)} | L${s.range?.startLine}`)
}
console.log("── first ns form shape:")
const walk = (n: any, d: number) => {
  if (d > 4) return
  const field = (f: string) => { const c = n.childForFieldName?.(f); return c ? ` ${f}=${JSON.stringify(c.text.slice(0, 30))}` : "" }
  console.log(`${"  ".repeat(d)}${n.type}${field("name")}${field("namespace")} L${n.startPosition.row + 1} :: ${n.namedChildCount > 0 ? "" : JSON.stringify(n.text.slice(0, 40))}`)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, d + 1) }
}
let found = false
for (let i = 0; i < root.namedChildCount && !found; i++) {
  const c = root.namedChild(i)
  if (c && c.type === "list_lit" && c.namedChild(1) && JSON.stringify(c.text.slice(0, 40)).includes("ns")) {
    walk(c, 0)
    found = true
  }
}
