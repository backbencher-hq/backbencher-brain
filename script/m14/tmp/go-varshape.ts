import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-go.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `package p\nvar G int\nvar x, y = f(), g()\nconst C = 1\nfunc h() { z, w := 1, 2 }\n`
  const root = await parse(src)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const t of ["var_spec", "const_spec", "short_var_declaration"]) {
    for (const n of findAll(root, (x) => x.type === t).slice(0, 3)) {
      const parts: string[] = []
      for (const f of ["name", "value", "left", "right", "type"]) {
        try { const cf = n.childForFieldName(f); if (cf) parts.push(f + "=" + cf.type + ":" + cf.text.slice(0, 12)) } catch {}
      }
      console.log(t, "fields:", parts.join(" | ") || "(none)", "kids:", n.namedChildren.map((c: any) => c.type).join(","))
    }
  }
}
main()
