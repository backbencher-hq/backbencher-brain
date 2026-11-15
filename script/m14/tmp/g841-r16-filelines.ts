import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const CORPUS = "/home/ishaq2321/bb_tests/repositories/grails-core"
function resolveFile(suffix: string): string | null {
  const parts = suffix.split("/")
  const dir = "/home/ishaq2321/bb_tests/repositories/grails-core"
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let entries: any[] = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.isDirectory()) { if (!["node_modules", ".git", "build", "target"].includes(e.name)) stack.push(`${d}/${e.name}`) }
      else if (e.name === parts[parts.length - 1]) return `${d}/${e.name}`
    }
  }
  return null
}
const CASES: Array<[string, number]> = [
  ["grails-gsp/plugin/src/main/groovy/org/grails/plugins/web/taglib/FormTagLib.groovy", 503],
  ["grails-web-core/src/test/groovy/org/grails/web/servlet/mvc/GrailsParameterMapTests.groovy", 205],
  ["grails-views-gson/src/main/groovy/grails/plugin/json/view/api/internal/DefaultHalViewHelper.groovy", 267],
  ["grails-test-examples/views-functional-tests/grails-app/controllers/functional/tests/ProductController.groovy", 38],
  ["grails-test-examples/app1/grails-app/controllers/functionaltests/caching/CacheTestController.groovy", 33],
]
for (const [name, wasm] of [["OLD", "/tmp/g841-worktree-7f01e3ed.wasm"], ["NEW", "/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"]] as Array<[string, string]>) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P()
  parser.setLanguage(lang)
  console.log(`\n================= ${name}`)
  for (const [rel, line] of CASES) {
    const abs = fs.existsSync(`${CORPUS}/${rel}`) ? `${CORPUS}/${rel}` : resolveFile(rel)
    if (!abs) { console.log(`  MISSING ${rel}`); continue }
    const src = fs.readFileSync(abs, "utf8")
    const t = parser.parse(src)
    let errs = 0
    const walk = (n: any) => { if (n.type === "ERROR" || n.isMissing) errs++; for (let i = 0; i < n.childCount; i++) walk(n.child(i)) }
    walk(t.rootNode)
    const onLine: any[] = []
    const w2 = (n: any) => { if (n.startPosition.row + 1 === line) onLine.push(n); for (let i = 0; i < n.childCount; i++) w2(n.child(i)) }
    w2(t.rootNode)
    const types = onLine.map((n) => n.type)
    const mi = onLine.find((n) => n.type === "method_invocation")
    const key = ["method_invocation", "field_access", "juxt_function_call", "ERROR"].filter((x) => types.includes(x))
    console.log(`  ${rel.split("/").slice(-1)[0]}:${line}  errors=${errs}  onLine=[${key.join(",")}]  ${mi ? "MI text=" + JSON.stringify(mi.text.slice(0, 40)) : ""}`)
  }
}
