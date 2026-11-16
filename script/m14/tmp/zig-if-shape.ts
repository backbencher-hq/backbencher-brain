import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const SRC = 'pub const enable = 1;\npub inline fn message(comptime msg: [:0]const u8) void {\n    if (!enable) return;\n    _ = msg;\n}'
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const parser = new P(); parser.setLanguage(g)
  const tree = parser.parse(SRC)
  const walk = (n: any, path_: string[], d: number) => {
    if (String(n.text) === "enable" && n.type === "identifier") console.log("enable path:", path_.join(" < "))
    if (d > 9) return
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), [...path_, n.type], d + 1)
  }
  walk(tree.rootNode, [], 0)
}
main()
