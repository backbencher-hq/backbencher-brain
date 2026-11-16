import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const CASES: Array<[string, string]> = [
  ["remove in braceless if", "class C { def m() { if (attrs.id == null) attrs.remove('id') } }"],
  ["remove in braced if", "class C { def m() { if (attrs.id == null) { attrs.remove('id') } } }"],
  ["remove standalone", "class C { def m() { attrs.remove('id') } }"],
  ["int with args", "class C { def m() { max = max ?: httpParams.int(PAGINATION_MAX, 10) } }"],
  ["char as juxt arg", "class C { def m() { assertNull map.char('longNumber') } }"],
  ["char standalone", "class C { def m() { map.char('longNumber') } }"],
]
const dump = (x: any, d = 0): string => {
  const pad = "  ".repeat(d)
  const txt = x.childCount === 0 ? JSON.stringify(x.text.slice(0, 24)) : ""
  const own = x.type === "ERROR" || x.isMissing ? " <<<<" : ""
  let s = `${pad}${x.type}${own} ${txt}\n`
  for (let i = 0; i < x.childCount; i++) s += dump(x.child(i), d + 1)
  return s
}
for (const [name, wasm] of [["OLD 7f01e3ed", "/tmp/g841-worktree-7f01e3ed.wasm"], ["NEW 3edeebe8", "<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"]] as Array<[string, string]>) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P()
  parser.setLanguage(lang)
  console.log(`\n================= ${name}`)
  for (const [cname, src] of CASES) {
    const t = parser.parse(src)
    const errs = (() => { let n = 0; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return n })()
    // classify: is there a method_invocation named remove/char/int?
    let found: string[] = []
    const w2 = (x: any) => { if (x.type === "method_invocation" || x.type === "field_access" || x.type === "juxt_function_call") found.push(x.type); for (let i = 0; i < x.childCount; i++) w2(x.child(i)) }
    w2(t.rootNode)
    console.log(`  ${errs === 0 ? "ok " : "ERR"} ${cname.padEnd(22)} nodes: ${found.join(",")}`)
  }
}
