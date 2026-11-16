import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const cases: [string, string][] = [
    ["filedecl-read", `const A: u32 = 1;\npub const B = A;\n`],
    ["fn-read", `const A: u32 = 1;\nfn f() u32 { return A; }\n`],
  ]
  for (const [name, src] of cases) {
    const root = await parseSrc(src)
    const r: any = await new RealZigAnalyzer().analyze(root, src, "T.zig")
    const au = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => x.target)
    const ou = mod.deriveZigBareUses(root).map((x: any) => x.target)
    const syms = (r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)
    console.log(name, "syms:", JSON.stringify(syms), "analyzer:", JSON.stringify(au), "oracle:", JSON.stringify(ou))
  }
}
main()
