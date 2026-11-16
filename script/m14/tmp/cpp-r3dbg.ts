import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`struct Outer {
    struct Inner {
        int n;
        void m();
    };
};
void Outer::Inner::m() {
    n = n + 1;
}
`).rootNode
  const find = (n: any, pred: (x: any) => boolean): any => {
    if (pred(n)) return n
    for (let i = 0; i < n.namedChildCount; i++) { const r = find(n.namedChild(i), pred); if (r) return r }
    return null
  }
  const fd = find(root, (x) => x.type === "function_definition" && x.text.includes("Outer::Inner"))
  const walkDecl = (n: any): void => {
    const d = (function findD(m: any): any {
      for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c.type === "function_declarator") return c }
      for (let i = 0; i < m.namedChildCount; i++) { const r = findD(m.namedChild(i)); if (r) return r }
      return null
    })(n)
    console.log("declarator children:", Array.from({length: d.namedChildCount}, (_, i) => d.namedChild(i)?.type).join(","))
    const q = d.namedChild(0)
    console.log("qid children:", Array.from({length: q.namedChildCount}, (_, i) => q.namedChild(i)?.type + ":" + q.namedChild(i)?.text?.slice(0,12)).join(" | "))
  }
  walkDecl(fd)
  // pre-pass check: what does the Inner class_specifier contain
  const inner = find(root, (x) => x.type === "struct_specifier" && x.text.startsWith("struct Inner"))
  console.log("inner struct children:", Array.from({length: inner.namedChildCount}, (_, i) => inner.namedChild(i)?.type).join(","))
}
main()
