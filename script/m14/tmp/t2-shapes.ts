// Shape dump for the T2 mirror: what are the TS interface body + member nodes?
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const src = [
  "export interface DOMAttributes {",
  "  ontoggle?: (e: Event) => void;",
  "  run(x: number): void;",
  "}",
  "export interface HTMLAttributes extends DOMAttributes {",
  "  ontoggle?: (e: Event) => void;",
  "  run(x: number): void;",
  "}",
].join("\n")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const p = new P()
  p.setLanguage(lang)
  const root = p.parse(src).rootNode
  const decls: any[] = []
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (/^(interface|class)_declaration$/.test(n.type)) decls.push(n)
    for (let i = 0; i < n.namedChildCount; i++) st.push(n.namedChild(i))
  }
  for (const d of decls) {
    console.log(`decl ${d.type} "${d.childForFieldName("name")?.text ?? "?"}"`)
    for (let j = 0; j < d.namedChildCount; j++) {
      const b = d.namedChild(j)
      console.log(`   child ${b.type}`)
      if (b.type === "object_type" || /body/.test(b.type)) {
        for (let k = 0; k < b.namedChildCount; k++) {
          const m = b.namedChild(k)
          console.log(`      member ${m.type} name=${m.childForFieldName("name")?.text ?? m.namedChildren.find((c: any) => /identifier/.test(c.type))?.text ?? "?"}`)
        }
      }
    }
  }
}
main()
