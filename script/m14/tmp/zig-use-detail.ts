import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const SRC = [
  "const std = @import(\"std\");",
  "const GLOBAL = 7;",
  "",
  "fn f(s: struct { GLOBAL: u8 }) void {",
  "    var y: std.mem.Allocator = undefined;",
  "    _ = s; _ = y; _ = GLOBAL;",
  "}",
].join("\n")
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const parser = new P(); parser.setLanguage(g)
  const tree = parser.parse(SRC)
  const mod: any = await import(path.resolve(ROOT, "src/ast/real-zig-analyzer.ts"))
  const az = new (mod.RealZigAnalyzer ?? mod.default)()
  const res = await az.analyze(tree.rootNode, SRC, "a.zig")
  for (const r of res.relationships ?? []) {
    console.log(r.type, "|", r.source, "->", r.target, "|", JSON.stringify(r.metadata))
  }
  console.log("--- symbols:", (res.symbols ?? []).map((s: any) => s.name).join(", "))
}
main()
