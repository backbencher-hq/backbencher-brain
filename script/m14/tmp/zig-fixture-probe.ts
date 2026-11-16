import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const f = "validation/m14/fixtures/zig/bare-value-reads.zig"
  const src = fs.readFileSync(f, "utf8")
  const root = p.parse(src).rootNode
  const r: any = await new RealZigAnalyzer().analyze(root, src, "bare-value-reads.zig")
  console.log("syms fast/Mode/Widget:", JSON.stringify((r.symbols ?? []).filter((s: any) => ["fast", "Mode", "Widget"].includes(s.name)).map((s: any) => s.name + ":" + s.kind + " owner=" + String(s.ownerName))))
  console.log("uses:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => x.source + "->" + x.target)))
  console.log("errors:", JSON.stringify((r.errors ?? []).map((e: any) => ({ l: e.range?.startLine, c: e.range?.startColumn, ix: e.range?.startIndex })).slice(-6)))
}
main()
