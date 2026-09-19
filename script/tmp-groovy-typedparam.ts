// tmp-groovy-typedparam.ts — F5 triage: typed closure parameters `{ Type name ->`
// deriving `calls Type` on the oracle side (7 MISSING across grails-core/geb).
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
const p = new ParserClass()
p.setLanguage(g)
const anaMod: any = await import("../src/ast/real-groovy-analyzer")
const diffMod: any = await import("./m14/differential")

const F = "$HOME/fixtures/repositories/grails-core/grails-core/src/test/groovy/org/grails/compiler/injection/ASTValidationErrorsHelperSpec.groovy"
const src = fs.readFileSync(F, "utf8")
const root = p.parse(src).rootNode
const analyzer = new anaMod.RealGroovyAnalyzer()
const res = analyzer.analyze(root, src, F)
const rels = (res.relationships ?? []).map((r: any) => ({
  label: String(r.type ?? r.relationshipType ?? ""),
  target: String(r.target ?? ""),
  from: String(r.source ?? ""),
  meta: r.metadata ?? {},
}))
console.log("analyzer edges total:", rels.length)
console.log("-- analyzer edges with target 'Method':")
for (const r of rels) if (r.target === "Method") console.log("   ", JSON.stringify(r))

const truth: any[] = diffMod.deriveGroovyEdges(root)
console.log("oracle edges total:", truth.length)
console.log("-- oracle edges with target 'Method':")
for (const e of truth) if (e.target === "Method") console.log("   ", JSON.stringify(e))

console.log("-- parse shape L110-114:")
const walk = (n: any, d: number): void => {
  if (d > 10) return
  const L = n.startPosition.row + 1
  const E = n.endPosition.row + 1
  if (!(L > 114 || E < 110)) {
    console.log("   " + "  ".repeat(d) + n.type + (n.isNamed ? "" : " (anon)") + " L" + L + "-" + E + (n.childCount === 0 ? " :: " + JSON.stringify(n.text.slice(0, 60)) : ""))
  }
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, d + 1) }
}
walk(root, 0)
