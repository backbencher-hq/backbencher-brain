import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealCAnalyzer().analyze(root, src, "T.c")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any) => (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
  await run("HC5-recheck", `int x = 1;\n`, async (r) => {
    void r
    const srcB = `{ {\n/*123456789012345*/\nint clean = 1;\n`
    const r2: any = await new RealCAnalyzer().analyze(await parse(srcB), srcB, "B.c")
    if (!(r2.symbols ?? []).some((s: any) => s.name === "clean")) throw new Error("clear() broke intra-file memo")
  })
  await run("HC6-proto-param-pollution", `int f(int count);\nint main(void) { return count; }\n`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r)) + " syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)))
    if (rels(r).some((s: string) => s.includes("->count"))) throw new Error("prototype param fabricates dangling use (claim TRUE)")
  })
  await run("HC7-flowinsensitive-shadow", `int g;\nvoid f(void) { g = 1; { int g; g = 2; } }\n`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r)))
    if (!rels(r).some((s: string) => s === "uses:f->g")) throw new Error("pre-shadow global read lost (claim TRUE)")
  })
  await run("HC8-bitfield-multi", `struct S { unsigned x : 3; unsigned y; int a, *b, c[4]; };\nint m1, m2;\n`, (r) => {
    const ss = (r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)
    console.log("   syms=" + JSON.stringify(ss))
    for (const n of ["x", "y", "a", "b", "c", "m1", "m2"]) if (!ss.some((s: string) => s.startsWith(n + ":"))) throw new Error("member lost: " + n)
  })
}
main()
