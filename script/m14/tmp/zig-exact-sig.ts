import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const SRC = [
  'const std = @import("std");',
  'const types = @import("lsp").types;',
  'pub const Error = error{ OutOfMemory, Canceled, InvalidParams };',
  'pub fn @"textDocument/foldingRange"(',
  '    server: *Server,',
  '    arena: std.mem.Allocator,',
  '    request: types.FoldingRange.Params,',
  ') Error!?[]types.FoldingRange {',
  '    _ = server; _ = arena; _ = request;',
  '    return null;',
  '}',
].join("\n")
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const parser = new P(); parser.setLanguage(g)
  const tree = parser.parse(SRC)
  const lines: string[] = []
  const walk = (n: any, d: number) => {
    if (d > 5) return
    if (["function_declaration","parameter","parameters"].includes(n.type) || d <= 2)
      lines.push("  ".repeat(d) + n.type + " :: " + JSON.stringify(String(n.text).slice(0, 40)))
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
  }
  walk(tree.rootNode, 0)
  console.log(lines.join("\n"))
  const mod: any = await import(path.resolve(ROOT, "src/ast/real-zig-analyzer.ts"))
  const az = new (mod.RealZigAnalyzer ?? mod.default)()
  const res = await az.analyze(tree.rootNode, SRC, "a.zig")
  const uses = (res.relationships ?? []).filter((r: any) => r.type === "uses")
  console.log("USES:", uses.map((u: any) => `${u.source}->${u.target}[${u.metadata?.relationshipType}]`).join(" ") || "-")
}
main()
