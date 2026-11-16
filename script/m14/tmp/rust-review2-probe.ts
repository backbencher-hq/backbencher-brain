import * as fs from "fs"
import * as path from "path"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
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
  const rels = (r: any) => (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
  const syms = (r: any) => (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`)
  await run("D1-union-selfedge", `pub union Pixel { value: u32 }\nfn f() -> u32 { 1 }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("uses"))))
    if (rels(r).some((s: string) => s === "uses:global->Pixel" || s === "uses:Pixel->Pixel")) throw new Error("union name self-edge (claim TRUE)")
  })
  await run("D2-self-construction", `pub struct Point { x: i32 }\nimpl Point {\n  pub fn new() -> Self { Self { x: 1 } }\n}\n`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r).filter((s: string) => s.includes("Point") || s.includes("Self"))))
    if (!rels(r).some((s: string) => s.includes("Point") && s.startsWith("instantiates"))) throw new Error("Self-construction instantiates nothing (claim TRUE)")
  })
  await run("D3-pubcrate-exports", `pub(crate) fn internal() {}\npub(super) fn up() {}\npub fn open() {}\n`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
    if ((r.exports ?? []).some((e: any) => e.name === "internal" || e.name === "up")) throw new Error("restricted-visibility exported as public API (claim TRUE)")
  })
  await run("D4-use-self", `use self::foo;\nuse crate::bar;\n`, (r, root) => {
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => i.module + ":" + JSON.stringify(i.items))) + " hasError=" + root.hasError)
  })
  await run("D5-dyn-impl-trait", `trait Foo {}\nfn f(x: &dyn Foo, y: impl Foo) {}\n`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("uses"))))
    if (rels(r).some((s: string) => s.startsWith("uses") && s.endsWith("->Foo"))) throw new Error("dyn/impl-trait type position reads as value (claim TRUE)")
  })
  await run("D6-pubuse-export-name", `pub use std::io::Read;\n`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
