import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/zig/lib/std/os/linux.zig", "utf8")
  const root = await parse(src)
  const r: any = await new RealZigAnalyzer().analyze(root, src, "linux.zig")
  const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses" && x.target === "timespec")
  console.log("uses(timespec):", JSON.stringify(uses.map((x: any) => x.source)))
  const syms = (r.symbols ?? []).filter((s: any) => s.name === "timespec")
  console.log("timespec syms:", JSON.stringify(syms.map((s: any) => s.name + ":" + s.kind + (s.ownerName ? "(" + s.ownerName + ")" : ""))))
}
main()
