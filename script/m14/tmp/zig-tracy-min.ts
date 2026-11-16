import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CASES: Array<[string,string]> = [
  ['tracy message', 'pub const enable = 1;\npub inline fn message(comptime msg: [:0]const u8) void {\n    if (!enable) return;\n    _ = msg;\n}'],
  ['enable in const expr', 'pub const enable = 1;\npub const enable_allocation = enable and 2;'],
  ['sentinel slice only', 'pub const enable = 1;\nfn f(x: [:0]const u8) void { _ = x; }'],
]
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const parser = new P(); parser.setLanguage(g)
  const mod: any = await import(path.resolve(ROOT, "src/ast/real-zig-analyzer.ts"))
  const az = new (mod.RealZigAnalyzer ?? mod.default)()
  for (const [label, src] of CASES) {
    const tree = parser.parse(src)
    if (label === 'sentinel slice only') {
      const lines: string[] = []
      const w = (n: any, d: number) => { if (d>6) return; lines.push("  ".repeat(d)+n.type+" :: "+JSON.stringify(String(n.text).slice(0,26))); for (let i=0;i<n.childCount;i++) w(n.child(i),d+1) }
      w(tree.rootNode, 0); console.log("SHAPE:\n"+lines.join("\n"))
    }
    const res = await az.analyze(tree.rootNode, src, "a.zig")
    const uses = (res.relationships??[]).filter((r:any)=>r.type==="uses")
    console.log(`### ${label}: ` + (uses.map((u:any)=>`${u.source}->${u.target}[${u.metadata?.relationshipType}]`).join(" ")||"-"))
  }
}
main()
