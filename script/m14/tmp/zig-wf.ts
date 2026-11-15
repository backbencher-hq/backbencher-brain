import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
async function parse(f: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(fs.readFileSync(f, "utf8")).rootNode
}
async function main() {
  const f = "/home/ishaq2321/bb_tests/repositories/zig/src/print_zoir.zig"
  const src = fs.readFileSync(f, "utf8")
  const root = await parse(f)
  const r: any = await new RealZigAnalyzer().analyze(root, src, "print_zoir.zig")
  console.log("uses WriteFailed:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses" && x.target === "WriteFailed")))
  console.log("syms WriteFailed:", JSON.stringify((r.symbols ?? []).filter((s: any) => s.name === "WriteFailed").map((s: any) => s.kind + (s.ownerName ? "(" + s.ownerName + ")" : ""))));
}
main()
