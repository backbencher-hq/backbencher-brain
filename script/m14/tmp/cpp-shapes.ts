import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `int g;\n#define M 3\nvoid f() {\n  try { g = 1; } catch (const int& e) { g = e; }\n  auto l = [z = g]() { return z; };\n  int arr[M] = { [0] = g };\n}\nstruct S { int m; S() : m(g) {} };\nclass F { friend void helper(); };\n#ifdef FEAT\nint feat = 1;\n#endif\n`
  const root = await parse(src)
  const d = (n: any, dp: number): void => {
    if (dp > 5) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 28)))
    for (let i = 0; i < n.namedChildCount && i < 8; i++) d(n.namedChild(i), dp + 1)
  }
  // print only interesting subtrees
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const t of ["catch_clause", "lambda_expression", "friend_declaration", "preproc_ifdef", "field_initializer_list"]) {
    const ns = findAll(root, (n) => n.type === t)
    console.log("=== " + t + " x" + ns.length)
    if (ns[0]) d(ns[0], 0)
  }
  // how does [0] = g parse?
  const subs = findAll(root, (n) => n.type === "subscript_designator" || n.type === "field_designator" || n.type === "designator")
  console.log("=== designators: " + JSON.stringify(subs.map((n: any) => n.type)))
  // catch param shape
  const cc = findAll(root, (n) => n.type === "catch_clause")[0]
  if (cc) console.log("catch kids: " + JSON.stringify(cc.namedChildren.map((c: any) => c.type)))
}
main()
