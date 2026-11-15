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
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 32)))
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  {
    const root = p.parse(`class A { void M<T>(T x) where T : class, new() { } }`).rootNode
    console.log("where-ish nodes:", [...new Set(findAll(root, (x) => /where|constraint/.test(x.type)).map((x) => x.type))].join(","))
    const w = findAll(root, (x) => /where|constraint/.test(x.type))[0]
    if (w) dump(w, 1, 2)
  }
  {
    const root = p.parse(`class D : Base, IFoo { }`).rootNode
    const b = findAll(root, (x) => x.type === "base_list")[0]
    console.log("--- base_list:"); if (b) dump(b, 1, 2)
  }
  {
    const root = p.parse(`class B { public virtual void M() { } } class D : B { public new void M() { } }`).rootNode
    const { RealCSharpAnalyzer } = await import("../../../src/ast/real-csharp-analyzer")
    const r: any = await new RealCSharpAnalyzer().analyze(root, `class B { public virtual void M() { } } class D : B { public new void M() { } }`, "x.cs")
    console.log("new-hiding rels:", JSON.stringify((r.relationships ?? []).filter((x: any) => /override|Override/.test(String(x.type))).map((x: any) => `${x.type}[${x.source}->${x.target}]`)))
  }
  {
    const root = p.parse(`class A { bool M((int, int) t) { return t is (int a, int b); } }`).rootNode
    console.log("tuple-pattern nodes:", [...new Set(findAll(root, (x) => /tuple/.test(x.type)).map((x) => x.type))].join(","))
    const tp = findAll(root, (x) => x.type === "tuple_pattern")
    if (tp[0]) { console.log("--- tuple_pattern:"); dump(tp[0], 1, 2) }
  }
}
main()
