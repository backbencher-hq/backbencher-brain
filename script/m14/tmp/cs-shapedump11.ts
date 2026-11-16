import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const dump = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 30)))
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1, max)
  }
  const dumpA = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + (n.isNamed ? n.type : `"${n.type}"`) + " :: " + JSON.stringify((n.text ?? "").slice(0, 22)))
    for (let i = 0; i < (n.childCount ?? 0); i++) dumpA(n.child(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  {
    const root = p.parse(`using System.Linq; class A { void M() { var q = from x in src select x; } }`).rootNode
    console.log("query node types:", [...new Set(findAll(root, (x) => /query|from_clause|select_clause/.test(x.type)).map((x) => x.type))].join(","))
    const from = findAll(root, (x) => x.type === "from_clause")[0]
    const q = from?.parent
    console.log("from parent:", q?.type)
  }
  {
    const root = p.parse(`class A { int M() { return sizeof(int) + typeof(string).Length; } }`).rootNode
    console.log("sizeof/typeof nodes:", findAll(root, (x) => /sizeof|typeof/.test(x.type)).map((x) => x.type).join(","))
  }
  {
    const root = p.parse(`class A { bool M(object o) { return o is Point; } }`).rootNode
    console.log("is-type nodes:", findAll(root, (x) => /^(is|as)_/.test(x.type)).map((x) => x.type).join(","))
  }
  {
    const root = p.parse(`class A { int _v; int P { get { return _v; } set { _v = value; } } }`).rootNode
    for (const a of findAll(root, (x) => x.type === "accessor_declaration")) { console.log("--- accessor:"); dumpA(a, 1, 1) }
  }
  {
    const root = p.parse(`class A { unsafe void M() { fixed (int* p = arr) { } } }`).rootNode
    const fx = findAll(root, (x) => x.type === "fixed_statement")[0]
    console.log("--- fixed:"); if (fx) dump(fx, 1, 3); else console.log("  NONE, err=" + root.hasError)
  }
  {
    const root = p.parse(`extern alias X; class A { }`).rootNode
    console.log("extern nodes:", findAll(root, (x) => /extern|alias/.test(x.type)).map((x) => x.type).join(","))
  }
}
main()
