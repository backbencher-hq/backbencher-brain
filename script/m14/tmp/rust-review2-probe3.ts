import * as fs from "fs"
import * as path from "path"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm".replace("cpp", "rust"))))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  let failures = 0
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealRustAnalyzer().analyze(root, src, "T.rs")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { failures++; console.log("FAIL " + name + " :: " + e.message) }
  }
  await run("D3b-private-parent", `mod m {\n  pub struct S { pub x: i32 }\n  pub trait T {}\n  pub enum E { V }\n  pub use std::io::Read;\n}\npub mod n {\n  pub fn f() {}\n}\n`, (r) => {
    const ex = (r.exports ?? []).map((e: any) => e.name)
    console.log("   exports=" + JSON.stringify(ex))
    for (const bad of ["S", "T", "E", "std::io::Read"]) if (ex.includes(bad)) throw new Error("private-parent member exported: " + bad + " (claim TRUE)")
    if (!ex.includes("n")) throw new Error("legit top export lost: " + JSON.stringify(ex))
    if (ex.includes("f")) throw new Error("module member should ride Contains, not export")
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
