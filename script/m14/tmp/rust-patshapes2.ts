import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm".replace("cpp", "rust")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `fn f(xs: Vec<i32>) {\n  for (a, b) in xs.iter() {}\n  if let Some(c) = Some(1) {}\n  while let Some(d) = Some(2) {}\n  let e = 1;\n}\n`
  const root = await parse(src)
  console.log("hasError=" + root.hasError)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const t of ["for_expression", "if_expression", "while_expression", "let_declaration"]) {
    const n = findAll(root, (x) => x.type === t)[0]
    if (!n) { console.log(t, "NONE"); continue }
    const fields: string[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      // discover field names by probing common ones
      fields.push(c.type + "=" + JSON.stringify(c.text.slice(0, 14)))
    }
    console.log("===" + t, "kids:", fields.join(" | "))
    for (const f of ["pattern", "condition", "value", "alternative", "consequence", "body"]) {
      try { const cf = n.childForFieldName(f); if (cf) console.log("   field", f, "->", cf.type, JSON.stringify(cf.text.slice(0, 20))) } catch {}
    }
  }
}
main()
