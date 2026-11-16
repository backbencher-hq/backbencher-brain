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
  const src = `pub const T3 = if (true) u32 else u64;\nfn f() u32 { const x: T3 = 1; return x; }\n`
  const root = await parseSrc(src)
  const r: any = await new RealZigAnalyzer().analyze(root, src, "T.zig")
  console.log("syms:", JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)))
  console.log("uses:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => x.source + "->" + x.target)))
}
main()
