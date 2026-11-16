import * as fs from "fs"
import * as path from "path"
import { RealCppAnalyzer } from "../../../src/ast/real-cpp-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  let failures = 0
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealCppAnalyzer().analyze(root, src, "T.cpp")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { failures++; console.log("FAIL " + name + " :: " + e.message) }
  }
  const tu = (r: any) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => x.source + "->" + x.target)
  await run("B1-writes-silent", `int g;\nvoid f() { int g = 1; g = 2; }\nvoid h() { g = 3; }\nvoid r() { g = g + 1; }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (tu(r).some((s: string) => s === "h->g" || s === "f->g")) throw new Error("write leaked: " + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s === "r->g")) throw new Error("RHS read lost")
  })
  await run("B2-param-shadow", `int q;\nvoid f(int q) { q = 1; }\nvoid h() { int t = q; }\n`, (r) => {
    if (tu(r).some((s: string) => s === "f->q")) throw new Error("param shadow leaked")
    if (!tu(r).some((s: string) => s === "h->q")) throw new Error("real read lost")
  })
  await run("B9-catch-lambda-fixed", `int g;\nvoid f() {\n  try { g = 1; } catch (const int& e) { g = e; }\n  auto l = [z = g]() { return z; };\n}\n`, (r) => {
    const u = tu(r)
    if (!u.some((s: string) => s === "f->g")) throw new Error("capture-init read lost")
    if (!u.some((s: string) => s === "f->e")) throw new Error("catch-param... e is local, must be silent - probe check")
  })
  await run("B10-enum-case-fixed", `enum Color { RED, GREEN };\nint f(Color c) { switch (c) { case RED: return 1; default: return 0; } }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s.endsWith("->RED"))) throw new Error("enumerator read lost")
    if (tu(r).some((s: string) => s.endsWith("->c"))) throw new Error("param leaked")
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
