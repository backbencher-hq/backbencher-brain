// M49 W9 — F6 adjudication: what tree-sitter-zig ACTUALLY calls the shapes the
// analyzer names with rust/go literals (struct_item/package_clause/...).
// Loads the SAME vendored grammar production uses (src/util/bb-data-dir.ts):
// <repo>/wasm/tree-sitter-zig.wasm.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const CASES: Array<[string, string]> = [
  ["struct decl + container field + method", "const S = struct { a: u8, pub fn m() void {} };"],
  ["enum decl", "const E = enum { a, b };"],
  ["union decl", "const U = union { a: u8 };"],
  ["opaque decl", "const O = opaque {};"],
  ["type alias item", "const T = u32;"],
  ["error set", "const Err = error{ A, B };"],
  ["test decl", "test \"t\" { }"],
  ["usingnamespace", "pub const io = usingnamespace @import(\"std\");"],
  ["struct initializer (composite)", "const s = S{ .a = 1 };"],
  ["anonymous struct init", "const s = .{ .a = 1 };"],
  ["assignment (plain)", "fn f() void { g = 1; }"],
  ["compound assignment", "fn f() void { x += 1; }"],
  ["qualified type in type pos", "fn f() void { var y: std.mem.Allocator = undefined; }"],
  ["field access", "fn f() void { _ = p.x; }"],
  ["continue with label", "fn f() void { outer: while (true) { continue :outer; } }"],
  ["break with label", "fn f() void { outer: while (true) { break :outer; } }"],
  ["block label value", "const b = blk: { break :blk 1; };"],
  ["call callee", "fn f() void { foo(); }"],
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)

  const ALL = new Set<string>()
  for (const [label, src] of CASES) {
    const tree = parser.parse(src)
    const lines: string[] = []
    const walk = (n: any, d: number) => {
      if (d > 8) return
      ALL.add(n.type)
      lines.push("  ".repeat(d) + n.type + (n.named ? "" : " (anon)") + " :: " + JSON.stringify(String(n.text).slice(0, 28)))
      for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
    }
    walk(tree.rootNode, 0)
    console.log(`### ${label}\n    src: ${JSON.stringify(src)}\n${lines.join("\n")}`)
  }
  console.log("\n=== every type observed ===")
  console.log([...ALL].sort().join(", "))
}

main()
