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
  await run("R1-bare-reads", `const LIMIT: u32 = 100;\nstatic GLOBAL: u32 = 1;\nfn f(x: u32) -> u32 { LIMIT + GLOBAL + x }\n`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r).filter((s: string) => s.includes("uses"))))
    if (!rels(r).some((s: string) => s.includes("->LIMIT") || s.includes("->GLOBAL"))) throw new Error("bare const/static reads emit nothing (claim TRUE)")
  })
  await run("R1-call-args", `const D: u32 = 2;\nfn g(v: u32) {}\nfn f() { g(D); }\n`, (r) => {
    if (!rels(r).some((s: string) => s.includes("->D"))) throw new Error("call-arg const read lost (claim TRUE)")
  })
  await run("R8-where-bounds", `fn f<T: Clone>(x: T) -> T { x }\n`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r)))
    if (rels(r).some((s: string) => s.includes("->T"))) throw new Error("type param bound leaks as references (claim TRUE)")
  })
  await run("R2-destructuring", `struct P { a: i32, b: i32 }\nfn f(p: P) -> i32 { let (a, b) = (1, 2); a + b + p.a }\n`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    if ((r.symbols ?? []).some((s: any) => s.name.includes("(") || s.name.includes(","))) throw new Error("destructured pattern mints garbage symbol (claim TRUE)")
  })
  await run("R18-route-exports", `#[get("/users")]\nasync fn list_users() {}\n`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
