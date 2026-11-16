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
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 32)))
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1, max)
  }
  const dumpA = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + (n.isNamed ? n.type : `"${n.type}"`) + " :: " + JSON.stringify((n.text ?? "").slice(0, 20)))
    for (let i = 0; i < (n.childCount ?? 0); i++) dumpA(n.child(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  {
    const root = p.parse(`class A { void M() { Func<int,int> f = (x, y) => x + y; var g = (int a) => a; var h = q => q; } }`).rootNode
    for (const l of findAll(root, (x) => x.type === "lambda_expression")) { console.log("--- lambda:"); dump(l, 1, 3) }
  }
  {
    const root = p.parse(`using System.Linq; class A { void M() { var q = from a in xs let b = a select b; var r = from x in xs group x by x.K into g select g; } }`).rootNode
    for (const t of ["let_clause", "group_clause", "orderby_clause", "select_clause"]) {
      const ns = findAll(root, (x) => x.type === t)
      if (ns.length) { console.log(`--- ${t}:`); dump(ns[0], 1, 2) }
    }
  }
  {
    const root = p.parse(`class A { int _v; int P { get { return _v; } set { _v = value; } } void M() { this.N(); base.N(); } }`).rootNode
    console.log("=== this/base/value node types:", findAll(root, (x) => /^(this|base)$/.test(x.text ?? "") && (x.text ?? "").length <= 5).map((x) => x.type + ":" + x.text).join(","))
    const acc = findAll(root, (x) => x.type === "accessor_declaration")
    console.log("accessor count:", acc.length)
    if (acc[1]) { console.log("--- set accessor:"); dump(acc[1], 1, 2) }
  }
  {
    const root = p.parse(`class A {\n#pragma warning disable CS0168\n#region H\nvoid M() { }\n#endregion\n}`).rootNode
    console.log("=== directive nodes:", findAll(root, (x) => /preproc|pragma|region|directive/.test(x.type)).map((x) => x.type).join(","))
  }
}
main()
