import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"))
const parser = new P()
parser.setLanguage(lang)
const src = fs.readFileSync("<corpus-root>/bb_tests/repositories/grails-core/grails-datamapping-core/src/test/groovy/org/grails/datastore/gorm/support/BeforeValidateHelperTests.groovy", "utf8")
const root = parser.parse(src).rootNode
const hits: any[] = []
const walk = (n: any) => {
  if (n.type === "ERROR" || n.isMissing) hits.push({ type: n.isMissing ? `MISSING(${n.type})` : "ERROR", start: `${n.startPosition.row + 1}:${n.startPosition.column}`, end: `${n.endPosition.row + 1}:${n.endPosition.column}`, len: n.endIndex - n.startIndex, depth: 0, head: n.text.slice(0, 60).replace(/\n/g, "\\n") })
  for (let i = 0; i < n.childCount; i++) walk(n.child(i))
}
walk(root)
console.log(`total error nodes: ${hits.length}, file lines: ${src.split("\n").length}`)
for (const h of hits.slice(0, 10)) console.log(`${h.type} [${h.start} - ${h.end}] len=${h.len} :: ${JSON.stringify(h.head)}`)
// what does the class look like at root level?
const names: string[] = []
for (let i = 0; i < root.childCount; i++) { const c = root.child(i); names.push(`${c.type}[${c.startPosition.row + 1}-${c.endPosition.row + 1}]`) }
console.log("root children:", names.join(" "))
