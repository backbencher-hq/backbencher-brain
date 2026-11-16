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
  const tu = (r: any) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => x.source + "->" + x.target)
  await run("B1-shadow-param-local", `const G: u32 = 1;\nfn f(G: u32) -> u32 { G }\nfn h() -> u32 { let G = 2; G }\nfn r() -> u32 { G }\n`, (r) => {
    if (tu(r).some((s: string) => s === "f->G" || s === "h->G")) throw new Error("shadowed read leaked: " + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s === "r->G")) throw new Error("real read lost")
  })
  await run("B2-destructure-bind", `const A: u8 = 1;\nstruct P { x: i32 }\nfn f() -> i32 { let (a, b) = (1, 2); let P { x: y } = P { x: 3 }; a + b + y }\n`, (r) => {
    if (tu(r).some((s: string) => s.endsWith("->a") || s.endsWith("->b") || s.endsWith("->y"))) throw new Error("local leaked: " + JSON.stringify(tu(r)))
  })
  await run("B3-match-arm", `enum E { V(i32), W }\nfn f(o: E) -> i32 { match o { E::V(v) => v, E::W => 0 } }\n`, (r) => {
    if (tu(r).some((s: string) => s.endsWith("->v"))) throw new Error("arm binding leaked")
  })
  await run("B4-unit-variant-use", `enum E { V(i32), W }\nuse E::W;\nfn f(o: E) -> i32 { match o { W => 1, _ => 0 } }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s.endsWith("->W"))) throw new Error("imported variant use lost")
  })
  await run("B5-qualified-leaf", `enum E { V }\nfn f() -> i32 { match 1 { _ => 0 } }\nfn g() -> E { E::V }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s.endsWith("->V"))) throw new Error("qualified variant leaf lost")
  })
  await run("B6-macro-def-silent", `macro_rules! mm { ($x:expr) => { $x }; }\nconst foo: u32 = 1;\nfn f() -> u32 { foo }\n`, (r) => {
    if (!tu(r).some((s: string) => s.endsWith("->foo"))) throw new Error("real read lost")
  })
  await run("B7-for-iflet-closure", `const G: u32 = 1;\nfn f(xs: Vec<u32>) -> u32 {\n  let mut t = 0;\n  for e in xs.iter() { t += e; }\n  if let Some(c) = Some(G) { t += c; }\n  let cl = |q: u32| q + G;\n  t + cl(1)\n}\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s.endsWith("->G"))) throw new Error("global read lost")
    for (const bad of ["->e", "->c", "->q", "->t"]) if (tu(r).some((s: string) => s.endsWith(bad))) throw new Error("local leaked: " + bad)
  })
  await run("B8-struct-shorthand", `struct P { x: i32 }\nconst X: i32 = 5;\nfn f() -> P { let x = X; P { x } }\n`, (r) => {
    if (!tu(r).some((s: string) => s.endsWith("->X"))) throw new Error("const read lost")
  })
  await run("B9-mod-scoping", `mod m { pub const C: u8 = 1; pub fn f() -> u8 { C } }\nfn g() -> u8 { C }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s === "f->C")) throw new Error("same-mod read lost")
    if (tu(r).some((s: string) => s === "g->C")) throw new Error("out-of-mod read leaked")
  })
  await run("B10-assign-lhs", `static mut S: u32 = 0;\nfn f(v: u32) -> u32 { S = v; S += 1; S }\n`, (r) => {
    const u = tu(r).filter((s: string) => s.endsWith("->S"))
    if (u.length !== 1 || u[0] !== "f->S") throw new Error("write/read confusion: " + JSON.stringify(tu(r)))
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
