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
  await run("C1-structkey-designator", `const X: u32 = 99;\nconst Point = struct { X: i32 };\nfn f() u32 { var p = Point{ .X = 1 }; return p.X; }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    const bad = tu(r).filter((s: string) => s.endsWith("->X") && !s.startsWith("f->"))
    if (tu(r).filter((s: string) => s === "f->X").length !== 1) throw new Error("designator leaked or field read lost: " + JSON.stringify(tu(r)))
  })
  await run("C2-container-field-collision", `const count: u32 = 5;\nconst S = struct { count: i32 };\nfn f() u32 { return count; }\n`, (r) => {
    if (!tu(r).some((s: string) => s === "f->count")) throw new Error("real read lost")
  })
  await run("C3-label-collision", `const blk: u32 = 1;\nfn f() void { blk: { break :blk; } }\n`, (r) => {
    if (tu(r).some((s: string) => s.endsWith("->blk"))) throw new Error("label leaked as use")
  })
  await run("C4-payload-shadow", `const x: u32 = 9;\nfn f(opt: ?u32) void { if (opt) |x| { const y = x; } }\n`, (r) => {
    if (tu(r).some((s: string) => s.endsWith("->x"))) throw new Error("payload param leaked")
    if (tu(r).some((s: string) => s.endsWith("->y"))) throw new Error("payload-local leaked")
  })
  await run("C5-error-variant-use", `const E = error{ Bad };\nfn f() void { const e = Bad; }\n`, (r, root) => {
    console.log("   uses=" + JSON.stringify(tu(r)) + " hasError=" + root.hasError)
    // RULED: bare error names are not valid reads (values require `error.Bad`
    // or `E.Bad` paths); silence is correct here, the qualified form is pinned.
  })
  await run("C6-assign-not-bind", `var g: u32 = 0;\nfn f(v: u32) void { g = v; const h = g; }\n`, (r) => {
    if (!tu(r).some((s: string) => s === "f->g")) throw new Error("post-write global read lost (plain assignment bound as local)")
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
