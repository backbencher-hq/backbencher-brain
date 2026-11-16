import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `template <typename T, int N = M> struct B {};\nstruct P { int x; };\nP p = { .x = 1 };\nvoid f() { goto done; done: return; }\n[[maybe_unused]] int attr = 1;\nusing std::move;\nusing N2 = int;\n`
  const root = await parse(src)
  console.log("hasError=" + root.hasError)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  const show = (label: string, pred: (x: any) => boolean) => {
    for (const n of findAll(root, pred).slice(0, 3)) {
      const chain: string[] = []
      let p: any = n
      while (p) { chain.push(p.type); p = p.parent }
      console.log(label, JSON.stringify(n.text.slice(0, 20)), "<-", chain.slice(1, 6).join(" < "))
    }
  }
  show("TEMPL-T", (n) => n.text === "T" && n.type !== "primitive_type")
  show("TEMPL-N", (n) => n.text === "N" && (n.type === "identifier" || n.type === "type_identifier"))
  show("DESIG-X", (n) => n.text === "x" && n.type !== "primitive_type")
  show("GOTO", (n) => n.text === "done")
  show("ATTR", (n) => n.text === "maybe_unused")
  show("USING", (n) => n.text === "move" || n.text === "std")
  show("M-in-N", (n) => n.text === "M")
}
main()
