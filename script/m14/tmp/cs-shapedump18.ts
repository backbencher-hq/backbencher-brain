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
    const root = p.parse(`class A { void M() { var p = new Point { X = 1, Y = v }; } }`).rootNode
    const oc = findAll(root, (x) => x.type === "object_creation_expression")[0]
    console.log("--- object creation:"); dump(oc, 1, 4)
  }
  {
    const root = p.parse(`class A<T> { void M(T x) { } }`).rootNode
    console.log("--- generic class children:"); dump(findAll(root, (x) => x.type === "class_declaration")[0], 1, 2)
  }
  {
    const root = p.parse(`class A { void M<T>(T x) where T : class, new() { } }`).rootNode
    console.log("--- where clause:"); dump(findAll(root, (x) => /where/.test(x.type))[0], 1, 2)
  }
}
main()
