import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  let failures = 0
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealZigAnalyzer().analyze(root, src, "T.zig")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { failures++; console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any) => (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
  await run("Z3-bare-reads", `const MAX: u32 = 100;\nfn f() u32 { return MAX; }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("uses"))))
    if (!rels(r).some((s: string) => s.includes("->MAX"))) throw new Error("bare const read emits nothing (claim TRUE)")
  })
  await run("Z3-call-args", `const D: u32 = 2;\nfn g(v: u32) void {}\nfn f() void { g(D); }\n`, (r) => {
    if (!rels(r).some((s: string) => s.includes("->D"))) throw new Error("call-arg const read lost (claim TRUE)")
  })
  await run("Z1-complexity", `const A: u32 = 1;\nconst B: u32 = 2;\nfn f() void {}\n`, (r) => {
    console.log("   complexity=" + (r.metadata ?? {}).complexity)
    if ((r.metadata ?? {}).complexity !== 1) throw new Error("synthetic complexity (claim TRUE): " + (r.metadata ?? {}).complexity)
  })
  await run("Z2-error-cols", `fn f() void { $bad$ }\n`, (r, root) => {
    const e = (r.errors ?? [])[0] as any
    console.log("   err=" + JSON.stringify(e?.range) + " hasError=" + root.hasError)
    if (e && e.range && e.range.startColumn < 1) throw new Error("0-based error columns (claim TRUE)")
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
