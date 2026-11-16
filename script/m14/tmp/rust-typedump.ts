import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const src = `struct Point { x: u32 }
fn mk(p: Point) -> Self { p }
impl Point {
    fn dup(&self) -> Self { Point { x: self.x } }
    fn conv(v: Vec<Point>) -> crate::Point { v[0] }
}
type Alias = Option<Point>;
enum E { V(Point), W { q: Point } }
`
  const root = p.parse(src).rootNode
  const dump = (n: any, dp: number): void => {
    if (dp > 4) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 26)))
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), dp + 1)
  }
  const find = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) find(c, pred, out) }
    return out
  }
  for (const fn of find(root, (x) => x.type === "function_item").slice(0, 3)) {
    console.log("=== fn", fn.childForFieldName("name")?.text)
    dump(fn, 1)
  }
}
main()
