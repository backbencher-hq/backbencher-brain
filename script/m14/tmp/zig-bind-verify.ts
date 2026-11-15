import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const SRC = [
  "const FLAG = 1;",
  "const SHARED = 2;",
  "const io = 3;",
  "",
  "fn typeField(s: struct { FLAG: u8 }, w: io.Writer) void {",
  "    _ = s; _ = w;",
  "    _ = FLAG;",   // MUST emit: type member must NOT shadow
  "    _ = io;",     // MUST emit: type namespace must NOT shadow
  "}",
  "",
  "fn realParam(SHARED: u32) void {",
  "    _ = SHARED;", // MUST NOT emit: a real parameter shadows
  "}",
  "",
  "fn payloadShadow(FLAG: u32) void {",
  "    if (FLAG > 0) |v| { _ = v; }",
  "    _ = FLAG;",   // shadowed by the param -> no edge
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
    if (r.type === "uses") console.log("uses", r.source, "->", r.target, "|", JSON.stringify(r.metadata?.relationshipType))
  }
}
main()
