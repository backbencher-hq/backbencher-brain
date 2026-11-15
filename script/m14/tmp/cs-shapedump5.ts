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
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  const cases: Record<string, [string, string[]]> = {
    outexisting: [`class A { void M() { int x; Helper(out x); } }`, ["argument"]],
    refarg: [`class A { void M() { Helper(ref x); } }`, ["argument"]],
    positional: [`class A { bool M(object o) { return o is Point(1, int y); } }`, ["positional_pattern"]],
    listpat: [`class A { bool M(int[] a) { return a is [1, var x]; } }`, ["list_pattern"]],
    proppat: [`class A { bool M(Point p) { return p is { X: 1, Y: var y }; } }`, ["property_pattern", "property_pattern_clause"]],
    andor: [`class A { bool M(int v) { return v is > 0 and < 10; } }`, ["binary_pattern"]],
    foreachdecl: [`class A { void M() { foreach (var x in ys) { } foreach (Point p in ps) { } } }`, ["foreach_statement"]],
    switchfull: [`class A { int M(object o) { switch (o) { case Point p when p.X > 0: return 1; default: return 0; } } }`, ["switch_section", "case_pattern_switch_label"]],
    nameofrel: [`class A { int count; string N() { return nameof(count); } }`, ["name_of_expression"]],
    interpolated: [`class A { string M(string n) { return $"hi {n}"; } }`, ["interpolation"]],
  }
  for (const [name, [src, types]] of Object.entries(cases)) {
    console.log(`=== ${name}:`)
    const root = p.parse(src).rootNode
    let found = false
    for (const t of types) {
      for (const n of findAll(root, (x) => x.type === t).slice(0, 1)) { console.log(`  -- ${t}:`); dump(n, 2, 3); found = true }
    }
    if (!found) console.log("  NONE FOUND, err=" + root.hasError)
  }
}
main()
