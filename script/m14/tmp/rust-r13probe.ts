import * as fs from "fs"
import * as path from "path"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `struct Point { x: u32, y: u32 }
struct Holder { p: Point, v: Vec<Point> }
enum Shape { Dot(Point), Rect { w: u32, h: Point }, Empty }
type Alias = Option<Point>;
const MAX: usize = 10;
const origin: Point = Point { x: 0, y: 0 };
fn mk(p: Point, q: Vec<Point>) -> Point { p }
fn bare(x: u32) -> u32 { x }
impl Point {
    fn dup(&self) -> Self { Point { x: self.x, y: self.y } }
}
trait T { fn f(&self) -> Self; }
`
  const root = await parseSrc(src)
  console.log("err:", root.hasError)
  const r: any = await new RealRustAnalyzer().analyze(root, src, "x.rs")
  const refs = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "references").map((x: any) => `${x.source}->${x.target}`)
  console.log(JSON.stringify(refs, null, 0))
}
main()
