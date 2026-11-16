import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CASES = [
  ['namespace type', 'const types = @import("types.zig");\nfn f(request: types.Params) void { _ = request; }'],
  ['bare type name', 'const f80 = struct { v: u8 };\nfn pack(x: f80) void { _ = x; }'],
  ['bare type + body read', 'const FLAG = 1;\nconst f80 = struct { v: u8 };\nfn pack(x: f80) void { _ = x; _ = FLAG; _ = f80; }'],
  ['slice of type', 'const types = @import("types.zig");\nfn g() Error!?[]types.TextEdit { return undefined; }'],
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
    const refs = (res.relationships ?? []).filter((r: any) => r.type === "references")
    console.log(`### ${label}`)
    console.log("   src:", JSON.stringify(src))
    console.log("   uses:", uses.map((u: any) => `${u.source}->${u.target}[${u.metadata?.relationshipType}]`).join(" ") || "-")
    console.log("   refs:", refs.map((u: any) => `${u.source}->${u.target}[${u.metadata?.relationshipType}]`).join(" ") || "-")
  }
}
main()
