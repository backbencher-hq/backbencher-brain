import * as fs from "fs"
import * as path from "path"
import { RealCppAnalyzer } from "../../../src/ast/real-cpp-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
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
  await run("B1-shadow-local", `int g;\nvoid f() { int g = 1; g = 2; }\nvoid h() { g = 3; }\n`, (r) => {
    // write-only: no reads at all -> silence everywhere (write gate + shadow)
    if (tu(r).length) throw new Error("unexpected uses: " + JSON.stringify(tu(r)))
  })
  await run("B2-shadow-param", `int q;\nvoid f(int q) { q = 1; }\nvoid h() { q = 2; }\n`, (r) => {
    if (tu(r).length) throw new Error("unexpected uses: " + JSON.stringify(tu(r)))
  })
  await run("B3-member-implicit", `int count;\nstruct S { int count; void m() { count = count + 1; } };\n`, (r) => {
    // LHS writes silent; RHS reads member -> uses m->count... source is method scope name
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s.endsWith("->count"))) throw new Error("member read lost")
  })
  await run("B4-namespace", `namespace N { int x; int f() { return x; } }\nint y;\nint g() { return y; }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s.endsWith("->x"))) throw new Error("ns member read lost")
    if (!tu(r).some((s: string) => s.endsWith("->y"))) throw new Error("global read lost")
  })
  await run("B5-using-ns", `namespace N { int x; }\nusing namespace N;\nint f() { return x; }\n`, (r) => {
    if (!tu(r).some((s: string) => s.endsWith("->x"))) throw new Error("using-directed read lost")
  })
  await run("B6-preproc", `#ifdef FEAT\nint feat = 1;\n#endif\nint f() { return 0; }\n`, (r) => {
    if (tu(r).some((s: string) => s.includes("FEAT"))) throw new Error("directive text read")
  })
  await run("B7-qualified", `namespace N { int x; }\nint f() { return N::x; }\n`, (r) => {
    if (tu(r).some((s: string) => s.endsWith("->x") || s.endsWith("->N"))) throw new Error("qualified read emitted: " + JSON.stringify(tu(r)))
  })
  await run("B8-call-args", `int g;\nvoid take(int v);\nvoid f() { take(g); }\n`, (r) => {
    const c = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => x.target)
    if (!tu(r).some((s: string) => s.endsWith("->g"))) throw new Error("call arg read lost")
    if (tu(r).some((s: string) => s.endsWith("->take"))) throw new Error("callee double-emitted as use")
    if (!c.includes("take")) throw new Error("call lost")
  })
  await run("B9-catch-lambda", `int g;\nvoid f() {\n  try { g = 1; } catch (const int& e) { g = e; }\n  auto l = [z = g]() { return z; };\n}\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s.endsWith("->g"))) throw new Error("g read lost")
    if (!tu(r).some((s: string) => s.endsWith("->e"))) throw new Error("catch param read lost")
    if (tu(r).some((s: string) => s.endsWith("->z"))) throw new Error("lambda-local leaked")
  })
  await run("B10-enum-case", `enum Color { RED, GREEN };\nint f(Color c) { switch (c) { case RED: return 1; default: return 0; } }\n`, (r) => {
    if (!tu(r).some((s: string) => s.endsWith("->RED"))) throw new Error("enumerator read lost")
    if (!tu(r).some((s: string) => s.endsWith("->c"))) throw new Error("param... wait c is param, must be silent")
  })
  await run("B11-callback-value", `void apply(void (*cb)(int));\nvoid target(int v);\nvoid f() { apply(target); }\n`, (r) => {
    if (!tu(r).some((s: string) => s.endsWith("->target"))) throw new Error("callback value read lost")
  })
  await run("B12-designated-init", `struct P { int x; };\nint g;\nP p = { .x = g };\n`, (r) => {
    if (!tu(r).some((s: string) => s.endsWith("->g"))) throw new Error("init value read lost")
    if (tu(r).some((s: string) => s.endsWith("->x"))) throw new Error("designator leaked")
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
