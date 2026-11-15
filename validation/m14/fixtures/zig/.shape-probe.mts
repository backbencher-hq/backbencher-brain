import { readFileSync } from "node:fs"
import { Parser, Language } from "web-tree-sitter"
const ROOT = "/home/ishaq2321/mcp/bb-lanes/zig"
await Parser.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const lang: any = await Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-zig.wasm`))
const p = new Parser(); p.setLanguage(lang)
const src = `const std = @import("std");

pub fn build(b: *std.Build) ?*std.Build.Step.Compile {
    const t = b.standardTargetOptions(.{});
    var o: ?std.Build.LazyPath = null;
    return null;
}
`
const tree = p.parse(src)!
const sexp = (n: any, d = 0): string => {
  if (d > 14) return "  ".repeat(d) + n.type + "\n"
  let s = "  ".repeat(d) + n.type
  if (n.namedChildCount === 0) s += `  "${String(n.text).slice(0, 30)}"`
  s += "\n"
  for (let i = 0; i < n.namedChildCount; i++) s += sexp(n.namedChild(i), d + 1)
  return s
}
console.log(sexp(tree.rootNode))
