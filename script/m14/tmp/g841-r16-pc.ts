import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const F = "<corpus-root>/bb_tests/repositories/grails-core/grails-test-examples/hibernate7/views-functional-tests/grails-app/controllers/functional/tests/ProductController.groovy"
const dump = (x: any, d = 0): string => {
  const pad = "  ".repeat(d)
  const txt = x.childCount === 0 ? JSON.stringify(x.text.slice(0, 26)) : ""
  const own = x.type === "ERROR" || x.isMissing ? " <<<<" : ""
  let s = `${pad}${x.type}${own} ${txt}\n`
  for (let i = 0; i < x.childCount; i++) s += dump(x.child(i), d + 1)
  return s
}
for (const [name, wasm] of [["OLD", "/tmp/g841-worktree-7f01e3ed.wasm"], ["NEW", "<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"]] as Array<[string, string]>) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P()
  parser.setLanguage(lang)
  const src = fs.readFileSync(F, "utf8")
  const t = parser.parse(src)
  console.log(`\n============= ${name}`)
  // method_declaration at line 38
  let md: any = null
  const w = (n: any) => { if ((n.type === "method_declaration" || n.type === "function_definition") && n.startPosition.row === 37) md = n; for (let i = 0; i < n.childCount; i++) w(n.child(i)) }
  w(t.rootNode)
  if (md) console.log(dump(md).split("\n").slice(0, 12).join("\n"))
  else console.log("  (no method_declaration at row 38)")
  // what wraps line 37/38?
  const at37: any[] = []
  const w2 = (n: any) => { if (n.startPosition.row === 36 || n.startPosition.row === 37) at37.push(`${n.type}[${n.startPosition.row + 1}]`); for (let i = 0; i < n.childCount; i++) w2(n.child(i)) }
  w2(t.rootNode)
  console.log("  nodes starting at rows 37-38:", at37.slice(0, 10).join(" "))
}
