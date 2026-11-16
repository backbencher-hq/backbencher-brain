import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const dumpA = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + (n.isNamed ? n.type : `"${n.type}"`) + " :: " + JSON.stringify((n.text ?? "").slice(0, 26)))
    for (let i = 0; i < (n.childCount ?? 0); i++) dumpA(n.child(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  {
    const root = p.parse(`class A { void M() { var a = new { Y = 20, Z = 1 }; } }`).rootNode
    console.log("--- anontype full:"); dumpA(findAll(root, (x) => x.type === "anonymous_object_creation_expression")[0], 0, 3)
  }
  {
    const root = p.parse(`[MyAttr(Other)] class Annotated { const int Other = 20; }`).rootNode
    console.log("--- attr class children:"); dumpA(root, 0, 2)
  }
}
main()
