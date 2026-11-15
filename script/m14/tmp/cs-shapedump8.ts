import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const dump = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 30)))
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  {
    const root = p.parse(`class A { bool M(object o) { return o is Point(1, int y); } }`).rootNode
    const al = findAll(root, (x) => x.type === "argument_list")[0]
    console.log("=== positional args:"); dump(al, 1, 3)
  }
  {
    const root = p.parse(`record R(int X, string Name);`).rootNode
    console.log("=== record positional:"); dump(findAll(root, (x) => x.type === "record_declaration")[0], 1, 3)
  }
  {
    const root = p.parse(`file class Hidden { void M() { } }`).rootNode
    const cd = findAll(root, (x) => x.type === "class_declaration")[0]
    console.log("=== file class children:", Array.from({length: cd.namedChildCount}, (_, i) => cd.namedChild(i)?.type).join(","))
    const dumpA = (n: any, dp: number): void => {
      if (!n || dp > 1) return
      console.log("  ".repeat(dp) + (n.isNamed ? n.type : `"${n.type}"`));
      for (let i = 0; i < (n.childCount ?? 0); i++) dumpA(n.child(i), dp + 1)
    }
    console.log("--- with anon:"); dumpA(cd, 0)
  }
}
main()
