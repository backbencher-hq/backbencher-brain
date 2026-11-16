import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"))
const parser = new P()
parser.setLanguage(lang)
const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
for (const rel of [
  "grails-test-examples/app1/grails-app/controllers/functionaltests/async/AsyncTestController.groovy",
  "grails-gsp/plugin/src/main/groovy/org/grails/plugins/web/taglib/UrlMappingTagLib.groovy",
]) {
  const abs = `${REPO}/${rel}`
  if (!fs.existsSync(abs)) { console.log(`missing ${rel}`); continue }
  const src = fs.readFileSync(abs, "utf8")
  const root = parser.parse(src).rootNode
  const hits: any[] = []
  const walk = (n: any) => {
    if (n.type === "ERROR" || n.isMissing) hits.push({ t: n.isMissing ? `M(${n.type})` : "ERR", a: `${n.startPosition.row + 1}:${n.startPosition.column}`, b: `${n.endPosition.row + 1}:${n.endPosition.column}`, len: n.endIndex - n.startIndex, head: n.text.slice(0, 50).replace(/\n/g, "\\n") })
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  console.log(`\n=== ${rel.split("/").slice(-1)[0]} (${hits.length} nodes)`)
  const lines = src.split("\n")
  console.log("head where the first error starts:")
  const first = hits[0]
  const row = parseInt(first.a.split(":")[0], 10)
  for (let r = Math.max(0, row - 4); r < Math.min(lines.length, row + 2); r++) console.log(`${r + 1 === row ? ">>" : "  "}${String(r + 1).padStart(4)} ${lines[r]}`)
  console.log("smallest nodes:", hits.sort((x, y) => x.len - y.len).slice(0, 4).map((h) => `${h.t}[${h.a}-${h.b}] ${JSON.stringify(h.head)}`).join(" | "))
}
