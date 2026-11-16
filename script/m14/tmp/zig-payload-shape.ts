import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CASES = [
  "fn f(c: bool) void { if (c) |v| { _ = v; } }",
  "fn g(p: anytype) void { if (p) |*ptr| { _ = ptr; } }",
  "fn h(x: anytype) void { const o = x catch |err| { _ = err; return; }; _ = o; }",
  "fn i(m: anytype) void { while (m.next()) |a, b| { _ = a; _ = b; } }",
  "fn j(s: struct { FLAG: u8 }, io: u8) void { _ = s; _ = io; }",
]
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const parser = new P(); parser.setLanguage(g)
  for (const src of CASES) {
    const tree = parser.parse(src)
    console.log("### " + src)
    const walk = (n: any, d: number) => {
      if (d > 6) return
      if (["payload","parameter","parameters"].includes(n.type) || d <= 1) {
        console.log("  ".repeat(d) + n.type + " :: " + JSON.stringify(String(n.text).slice(0, 30)))
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c.type === "payload") { walk(c, d + 1); continue }
        if (c.named) walk(c, d + 1)
      }
    }
    walk(tree.rootNode, 0)
  }
}
main()
