import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CASES = [
  "fn f(a: u8, b: []const u8) void {}",
  "fn g(s: struct { GLOBAL: u8 }) void {}",
  "fn h(comptime T: type, x: T) void {}",
  "fn i(p: *const Foo) void {}",
  "const P = struct { GLOBAL: u8 };",
  "fn j(x: P) void {}",
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
      if (d > 7) return
      lines.push("  ".repeat(d) + n.type + (n.named ? "" : " (anon)") + " :: " + JSON.stringify(String(n.text).slice(0, 30)))
      for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
    }
    walk(tree.rootNode, 0)
    console.log("### " + JSON.stringify(src) + "\n" + lines.join("\n"))
  }
}
main()
