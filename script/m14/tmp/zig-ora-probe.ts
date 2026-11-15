import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm".replace("cpp", "zig")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const cases: [string, string][] = [
    ["plain-const", `const T1: u32 = 1;\nfn f() u32 { return T1; }\n`],
    ["pub-const", `pub const T2: u32 = 1;\nfn f() u32 { return T2; }\n`],
    ["ifexpr-const", `pub const T3 = if (true) u32 else u64;\nfn f() u32 { const x: T3 = 1; return x; }\n`],
    ["extern-struct", `pub const T4 = extern struct { a: u32 };\nfn f() u32 { const x: T4 = undefined; return 1; }\n`],
  ]
  for (const [name, src] of cases) {
    const root = await parse(src)
    const r: any = await new RealZigAnalyzer().analyze(root, src, "T.zig")
    const au = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => x.target)
    const ou = mod.deriveZigBareUses(root).map((x: any) => x.target)
    console.log(name, "analyzer:", JSON.stringify(au), "oracle:", JSON.stringify(ou))
  }
}
main()
