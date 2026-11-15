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
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  await run("D1-union-nodetype", `pub union Pixel { value: u32 }\n`, (r, root) => {
    const un = findAll(root, (n) => n.type === "union_item")[0]
    const nm = un.namedChildren.map((c: any) => c.type + "=" + c.text.slice(0, 10))
    console.log("   union kids:", JSON.stringify(nm))
  })
  await run("E5-question-complexity", `fn f() -> i32 { let x = foo()?; let y = bar()?; x + y }\nfn g() -> i32 { 1 }\n`, (r, root) => {
    const f = (r.symbols ?? []).find((s: any) => s.name === "f")
    const trys = findAll(root, (n) => n.type === "try_expression").length
    console.log("   f.complexity=" + f?.complexity + " try_nodes=" + trys + " hasError=" + root.hasError)
    if ((f?.complexity ?? 1) < 3) throw new Error("? chains uncounted (claim TRUE)")
  })
  await run("E3-macroexport-kind", `#[macro_export]\nmacro_rules! mm { () => {} }\n`, (r) => {
    console.log("   exports=" + JSON.stringify(r.exports ?? []))
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
