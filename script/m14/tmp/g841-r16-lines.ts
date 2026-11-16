import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"))
const parser = new P()
parser.setLanguage(lang)
const CORPUS = "<corpus-root>/bb_tests/repositories"
const CASES: Array<[string, number]> = [
  ["grails-gsp/plugin/src/main/groovy/org/grails/plugins/web/taglib/FormTagLib.groovy", 503],
  ["grails-web-core/src/test/groovy/org/grails/web/servlet/mvc/GrailsParameterMapTests.groovy", 205],
  ["grails-views-gson/src/main/groovy/grails/plugin/json/view/api/internal/DefaultHalViewHelper.groovy", 267],
]
const dump = (x: any, src: string, d = 0): string => {
  const pad = "  ".repeat(d)
  const one = (n: any) => `${n.startPosition.row + 1}:${n.startPosition.column}-${n.endPosition.column}`
  const txt = x.childCount === 0 ? JSON.stringify(x.text.slice(0, 28)) : `[${one(x)}]`
  let s = `${pad}${x.type} ${txt}\n`
  for (let i = 0; i < x.childCount; i++) s += dump(x.child(i), src, d + 1)
  return s
}
for (const [rel, line] of CASES) {
  const src = fs.readFileSync(`${CORPUS}/grails-core/${rel}`, "utf8")
  const t = parser.parse(src)
  console.log(`\n########## ${rel.split("/").slice(-1)[0]}:${line}`)
  console.log(`  source: ${src.split("\n")[line - 1].trim()}`)
  // all nodes starting on the line; dump the statement-shaped one
  const starts: any[] = []
  const walk = (n: any) => {
    if (n.startPosition.row + 1 === line) starts.push(n)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t.rootNode)
  console.log("  nodes starting here: " + starts.map((n) => `${n.type}[${n.startPosition.column}-${n.endPosition.column}]`).slice(0, 12).join(" "))
  const pick = starts.find((n) => ["method_invocation", "juxt_function_call", "ERROR", "expression_statement", "if_statement", "field_access"].includes(n.type))
  if (pick) console.log(dump(pick, src).split("\n").slice(0, 20).join("\n"))
}
