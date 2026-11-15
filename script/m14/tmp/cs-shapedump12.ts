import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const dumpA = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + (n.isNamed ? n.type : `"${n.type}"`) + " :: " + JSON.stringify((n.text ?? "").slice(0, 24)))
    for (let i = 0; i < (n.childCount ?? 0); i++) dumpA(n.child(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  {
    const root = p.parse(`class A { void M() { (int a, int b) = (1, 2); (c, d) = (3, 4); } }`).rootNode
    for (const t of findAll(root, (x) => x.type === "tuple_expression")) { console.log("--- tuple:"); dumpA(t, 1, 2) }
  }
  {
    const root = p.parse(`using System.Linq; class A { void M() { var q = from x in xs select x into g; } }`).rootNode
    const ic = findAll(root, (x) => /into/.test(x.type))
    console.log("into nodes:", ic.map((x) => x.type).join(","))
    if (ic[0]) dumpA(ic[0], 1, 1)
  }
  {
    const root = p.parse(`class A { bool M(object o) { return o is Point; } }`).rootNode
    console.log("is nodes:", findAll(root, (x) => /^(is|as)_/.test(x.type)).map((x) => x.type).join(","))
  }
  {
    const root = p.parse(`class A { string M(object o) { return o as string; } }`).rootNode
    console.log("as nodes:", findAll(root, (x) => /^(is|as)_/.test(x.type)).map((x) => x.type).join(","))
  }
  {
    const root = p.parse(`class A { void M() { foreach (var x in ys) { } } }`).rootNode
    const fe = findAll(root, (x) => x.type === "foreach_statement")[0]
    console.log("--- foreach all children:"); dumpA(fe, 1, 1)
  }
}
main()
