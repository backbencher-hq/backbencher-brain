import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CASES = [
  ['deep namespace param', 'const types = @import("types.zig");\nfn f(request: types.document_formatting.Params) void { _ = request; }'],
  ['deep ns param + slice return', 'const types = @import("types.zig");\nfn f(request: types.document_formatting.Params) Error!?[]types.TextEdit { return undefined; }'],
  ['eql guard shape', 'const types = @import("types.zig");\nfn f(a: []const u8, b: []const u8) void { if (std.mem.eql(u8, a, b)) return; }'],
  ['union field ns', 'const types = @import("types.zig");\nconst U = union(enum) { initialize: types.InitializeParams, shutdown };'],
]
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const parser = new P(); parser.setLanguage(g)
  const mod: any = await import(path.resolve(ROOT, "src/ast/real-zig-analyzer.ts"))
  const az0 = new (mod.RealZigAnalyzer ?? mod.default)()
  for (const [label, src] of CASES) {
    const tree = parser.parse(src)
    const res = await az0.analyze(tree.rootNode, src, "a.zig")
    const uses = (res.relationships ?? []).filter((r: any) => r.type === "uses")
    console.log(`### ${label}\n   uses: ` + (uses.map((u: any) => `${u.source}->${u.target}[${u.metadata?.relationshipType}]`).join(" ") || "-"))
  }
}
main()
