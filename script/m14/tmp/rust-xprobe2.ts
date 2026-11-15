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
const CASES: Record<string, string> = {
  V1_plain_read: `const v = 1;
fn f() -> u32 { v }
`,
  V2_pattern_only: `const v = 1;
fn f(x: u32) -> u32 {
    match x {
        v => 1,
        _ => 0,
    }
}
`,
  V3_body_only: `const v = 1;
fn f(x: u32) -> u32 {
    match x {
        1 => v,
        _ => 0,
    }
}
`,
  V4_closure_body: `const G = 1;
fn f() {
    let h = |q| G + 1;
    let _ = h;
}
`,
  V5_closure_param_use: `const q = 1;
fn f() {
    let h = |q| q + 1;
    let _ = h;
}
`,
}
async function main() {
  for (const [name, src] of Object.entries(CASES)) {
    const root = await parseSrc(src)
    const r: any = await new RealRustAnalyzer().analyze(root, src, "x.rs")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    console.log(`${name}: uses=${JSON.stringify(uses)} hasError=${root.hasError}`)
  }
}
main()
