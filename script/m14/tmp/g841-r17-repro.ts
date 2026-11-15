import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const { ASTEngine } = await import("/home/ishaq2321/mcp/backbencher-brain/src/ast/engine.ts")
const { RealGroovyAnalyzer } = await import("/home/ishaq2321/mcp/backbencher-brain/src/ast/real-groovy-analyzer.ts")
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const F = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-views-gson/src/main/groovy/grails/plugin/json/view/api/internal/DefaultHalViewHelper.groovy"
const src = fs.readFileSync(F, "utf8")
const t = parser.parse(src)
// tree around 265-269
const show = (n: any, d = 0): string => {
  const head = `${" ".repeat(d)}${n.type} [${n.startPosition.row + 1}:${n.startPosition.column + 1}] ${JSON.stringify(n.text.length > 44 ? n.text.slice(0, 44) : n.text)}`
  const kids = n.namedChildCount ? Array.from({ length: n.namedChildCount }, (_, i) => show(n.namedChild(i), d + 2)) : []
  return [head, ...kids].join("\n")
}
const w = (n: any) => {
  if (n.startPosition.row + 1 >= 266 && n.startPosition.row + 1 <= 268 && n.startPosition.column <= 40) { console.log(show(n)); return }
  for (let i = 0; i < n.childCount; i++) w(n.child(i))
}
w(t.rootNode)
let errs = 0
const we = (n: any) => { if (n.type === "ERROR" || n.isMissing) errs++; for (let i = 0; i < n.childCount; i++) we(n.child(i)) }
we(t.rootNode)
console.log(`file errors=${errs}`)
// analyzer relationships near PAGINATION
const a = new RealGroovyAnalyzer()
const res: any = await (a as any).analyze(t.rootNode, src, F)
for (const r of res.relationships ?? []) if (String(r.target).includes("PAGINATION")) console.log("REL", JSON.stringify(r))
