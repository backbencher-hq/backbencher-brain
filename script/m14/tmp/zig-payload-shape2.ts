import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CASES = [
  "fn f(c: bool) void { if (c) |v| { _ = v; } }",
  "fn g(p: anytype) void { if (p) |*ptr| { _ = ptr; } }",
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
    const lines: string[] = []
    const walk = (n: any, d: number) => {
      lines.push("  ".repeat(d) + n.type + (n.named ? "" : " (anon)") + " :: " + JSON.stringify(String(n.text).slice(0, 24)))
      for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
    }
    walk(tree.rootNode, 0)
    console.log("### " + src + "\n" + lines.join("\n"))
  }
}
main()
