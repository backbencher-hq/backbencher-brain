import * as fs from "fs"
import * as path from "path"
import { RealCppAnalyzer } from "../../../src/ast/real-cpp-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function parse(src: string, lang = "tree-sitter-cpp.wasm") {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", lang)))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealCppAnalyzer().analyze(root, src, "T.cpp")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any) => (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
  const syms = (r: any) => (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}:vis=${s.visibility}`)
  await run("P8-bare-reads", `int g;\nint f() { return g; }\n`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r)))
    if (!rels(r).some((s: string) => s.includes("->g"))) throw new Error("bare global read emits nothing (claim TRUE)")
  })
  await run("P10-static-member-def", `struct Foo { static int count; int x; };\nint Foo::count = 0;\n`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)))
    if (!(r.symbols ?? []).some((s: any) => s.name === "count")) throw new Error("static member def lost (claim TRUE)")
  })
  await run("P11-friend", `class Bar;\nclass Foo { friend class Bar; friend void helper(); };\n`, (r, root) => {
    console.log("   syms=" + JSON.stringify(syms(r)) + " hasError=" + root.hasError)
  })
  await run("P13-static-fn-vis", `static void helper() { }\nvoid shown() { helper(); }\n`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)) + " exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
    const h = (r.symbols ?? []).find((s: any) => s.name === "helper")
    if (h && h.visibility !== "private") throw new Error("static fn not private (claim TRUE)")
  })
  await run("P14-anon-ns", `namespace { int hidden_var; void hidden_fn() {} }\nint shown_var;\n`, (r) => {
    console.log("   syms=" + JSON.stringify(syms(r)) + " exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
    if ((r.exports ?? []).some((e: any) => e.name === "hidden_var" || e.name === "hidden_fn")) throw new Error("anon-ns member exported (claim TRUE)")
  })
  await run("P16-decl-template", `#include <vector>\nstd::vector<int> v;\nBox<int> b;\n`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("instantiates"))))
  })
}
main()
