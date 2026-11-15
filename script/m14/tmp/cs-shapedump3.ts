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
  const find = (n: any, pred: (x: any) => boolean): any => {
    if (!n) return null
    if (pred(n)) return n
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const r = find(n.namedChild(i), pred); if (r) return r }
    return null
  }
  const cases: Record<string, [string, (x: any) => boolean, number]> = {
    outvar: [`class A { void M() { if (int.TryParse("1", out int v)) { } } }`, (x) => x.type === "argument" && x.text.includes("out"), 3],
    deconstruct: [`class A { void M() { (int a, int b) = (1, 2); } }`, (x) => x.type === "assignment_expression" && x.text.startsWith("("), 3],
    ispattern: [`class A { bool M(object o) { return o is Point p; } }`, (x) => x.type === "is_pattern_expression", 3],
    query: [`using System.Linq; class A { void M() { var q = from x in src select x; } }`, (x) => x.type === "from_clause", 3],
    localfn: [`class A { void M() { int L(int q) { return q; } L(1); } }`, (x) => x.type === "local_function_statement", 3],
    withinit: [`class A { void M(P p) { var q = p with { X = 1 }; } }`, (x) => x.type === "with_expression", 3],
    anontype: [`class A { void M(int v) { var a = new { X = 1, Y = v }; } }`, (x) => x.type === "anonymous_object_creation_expression", 3],
    attr: [`class A { [MyAttr(Size = 3)] void M() { } }`, (x) => x.type === "attribute", 4],
    preproc: [`class A {\n#if DEBUG\n void M() { }\n#endif\n}`, (x) => x.type === "if_directive", 2],
    primaryctor: [`class C(int x) { int Get() { return x; } }`, (x) => x.type === "parameter_list" && (x.parent?.type === "class_declaration"), 3],
  }
  for (const [name, [src, pred, depth]] of Object.entries(cases)) {
    console.log(`--- ${name}:`)
    const root = p.parse(src).rootNode
    const n = find(root, pred)
    if (!n) { console.log("  NOT FOUND"); continue }
    dump(n, 1, depth)
  }
}
main()
