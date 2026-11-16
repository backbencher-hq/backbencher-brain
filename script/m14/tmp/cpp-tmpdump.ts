import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`template <typename T>
void Box<T>::push(T x) {
    T old = v;
    v = x;
}
`).rootNode
  const dump = (n: any, dp: number): void => {
    if (dp > 5) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 26)))
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), dp + 1)
  }
  const find = (n: any, pred: (x: any) => boolean): any => {
    if (pred(n)) return n
    for (let i = 0; i < n.namedChildCount; i++) { const r = find(n.namedChild(i), pred); if (r) return r }
    return null
  }
  const fd = find(root, (x) => x.type === "function_definition")
  console.log("fn children:", Array.from({length: fd.namedChildCount}, (_, i) => fd.namedChild(i)?.type).join(","))
  dump(find(fd, (x) => x.type === "function_declarator"), 0)
}
main()
