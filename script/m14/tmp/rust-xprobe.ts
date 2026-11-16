import * as fs from "fs"
import * as path from "path"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const CASES: Record<string, string> = {
  RE1_bare_arm_pattern: `const V: u32 = 1;
fn f(x: u32) -> u32 {
    match x {
        v => v,
        _ => 0,
    }
}
fn g() -> u32 { V }
`,
  RE1b_bare_arm_collide: `const v: u32 = 1;
fn f(x: u32) -> u32 {
    match x {
        v => v,
        _ => 0,
    }
}
`,
  RE2_closure_param: `const G: u32 = 1;
fn f() {
    let h = |G| G + 1;
    let _ = h;
}
`,
  RE3_struct_shorthand: `const x: u32 = 5;
struct Point { x: u32 }
fn f() -> u32 {
    let p = Point { x };
    p.x
}
`,
  RE10_ref_pattern: `const r: u32 = 1;
fn f(o: Option<u32>) -> u32 {
    match o {
        ref r => 7,
        _ => r,
    }
}
`,
  RE11_scoped_use_leaf: `use std::io::Read;
const R2: u32 = 2;
fn f() -> u32 {
    Read;
    R2
}
`,
}
async function main() {
  const which = process.argv[2]
  for (const [name, src] of Object.entries(CASES)) {
    if (which && name !== which) continue
    const root = await parseSrc(src)
    const r: any = await new RealRustAnalyzer().analyze(root, src, "x.rs")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  uses: ${JSON.stringify(uses)}`)
  }
}
main()
