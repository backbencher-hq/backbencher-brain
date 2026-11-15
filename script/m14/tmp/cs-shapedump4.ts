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
  const cases: Record<string, string> = {
    directives: `class A {\n#if DEBUG\n void M() { }\n#endif\n#pragma warning disable CS0168\n void N() { }\n}`,
    genericis: `class A { bool M(object o) { return o is System.Collections.Generic.List<int> x; } }`,
    varpattern: `class A { bool M(object o) { return o is var v; } }`,
    joinclause: `using System.Linq; class A { void M() { var q = from a in xs join b in ys on a.K equals b.K select a; } }`,
    switcharm: `class A { int M(object o) { return o switch { Point { X: 1 } => 1, [1, 2] => 2, > 5 => 3, _ => 0 }; } }`,
    withmulti: `class A { void M(P p) { var q = p with { X = 1, Y = 2 }; } }`,
    attrpos: `class A { [Foo(Bar)] void M() { } }`,
    plaindecon: `class A { void M() { (a, b) = GetPair(); } }`,
  }
  for (const [name, src] of Object.entries(cases)) {
    console.log(`=== ${name}:`)
    const root = p.parse(src).rootNode
    console.log("  hasError:", root.hasError)
    for (const t of ["if_directive", "preproc_if", "pragma_directive", "declaration_pattern", "var_pattern", "join_clause", "switch_arm", "with_initializer", "attribute_argument", "tuple_expression"]) {
      const ns = findAll(root, (x) => x.type === t)
      if (ns.length > 0) { console.log(`  -- ${t} x${ns.length}:`); dump(ns[0], 2, 3) }
    }
  }
}
main()
