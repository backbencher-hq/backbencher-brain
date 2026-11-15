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
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 34)))
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1, max)
  }
  const dumpAll = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + (n.isNamed ? n.type : `"${n.type}"`) + " :: " + JSON.stringify((n.text ?? "").slice(0, 24)))
    for (let i = 0; i < (n.childCount ?? 0); i++) dumpAll(n.child(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  {
    const root = p.parse(`class A { bool M(object o) { return o is Point(1, int y); } }`).rootNode
    console.log("=== positional (all patt* nodes):", findAll(root, (x) => x.type.includes("pattern")).map((x) => x.type).join(","))
    const pp = findAll(root, (x) => x.type.includes("positional"))[0]
    if (pp) dump(pp, 1, 3)
  }
  {
    const root = p.parse(`class A { bool M(Point p) { return p is { X: 1, Y: var y }; } }`).rootNode
    const sp = findAll(root, (x) => x.type === "subpattern")[0]
    console.log("=== subpattern (all children incl anon):"); dumpAll(sp, 1, 2)
  }
  {
    const root = p.parse(`class A { bool M(int v) { return v is > 0 and < 10; } }`).rootNode
    console.log("=== and (all patt* nodes):", findAll(root, (x) => x.type.includes("pattern")).map((x) => x.type).join(","))
  }
  {
    const root = p.parse(`class A { int M(object o) { return o switch { Point p => 1, _ => 0 }; } }`).rootNode
    const arms = findAll(root, (x) => x.type === "switch_expression_arm")
    console.log("=== switch_expression_arm:"); if (arms[0]) dump(arms[0], 1, 3)
  }
  {
    const root = p.parse(`class A { int c; string N() { return nameof(c); } }`).rootNode
    console.log("=== nameof (all *name* invas):", findAll(root, (x) => /name_of|nameof/i.test(x.type)).map((x) => x.type).join(","))
    const inv = findAll(root, (x) => x.type === "invocation_expression")[0]
    if (inv) { console.log("--- as invocation:"); dump(inv, 1, 2) }
  }
  {
    const root = p.parse(`class A { void M() { Helper(out x, ref y); } }`).rootNode
    const args = findAll(root, (x) => x.type === "argument")
    console.log("=== out/ref args (all children incl anon):")
    for (const a of args) dumpAll(a, 1, 1)
  }
}
main()
