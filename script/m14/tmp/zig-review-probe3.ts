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
  const tu = (r: any) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => x.source + "->" + x.target)
  await run("C3-label-fixed", `const blk: u32 = 1;\nfn f() void { blk: { break :blk; } }\n`, (r) => {
    if (tu(r).some((s: string) => s.endsWith("->blk"))) throw new Error("label still leaks")
  })
  await run("C6-assign-fixed", `var g: u32 = 0;\nfn f(v: u32) void { g = v; const h = g; }\n`, (r) => {
    const u = tu(r).filter((s: string) => s.endsWith("->g"))
    if (u.length !== 1 || u[0] !== "f->g") throw new Error("write/read confusion: " + JSON.stringify(tu(r)))
  })
  await run("C5-qualified-error", `const E = error{ Bad };\nfn f() u8 { const e = error.Bad; return e; }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).some((s: string) => s.endsWith("->Bad"))) throw new Error("qualified error-variant use lost")
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
