import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const SRC = [
  'const std = @import("std");',
  'const types = @import("lsp").types;',
  'pub const Error = error{ OutOfMemory };',
  'pub fn @"foldingRange"(',
  '    request: types.FoldingRange.Params,',
  ') Error!?[]types.FoldingRange {',
  '    _ = request;',
  '    return null;',
  '}',
].join("\n")
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const parser = new P(); parser.setLanguage(g)
  const tree = parser.parse(SRC)
  const walk = (n: any, path_: string[]) => {
    if (n.type === "identifier" && String(n.text) === "types") {
      console.log(`types @${n.startPosition.row+1}:${n.startPosition.column} parent=${n.parent?.type} path=${path_.join(" < ")}`)
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), [...path_, n.type])
  }
  walk(tree.rootNode, [])
  const mod: any = await import(path.resolve(ROOT, "src/ast/real-zig-analyzer.ts"))
  const az = new (mod.RealZigAnalyzer ?? mod.default)()
  const res = await az.analyze(tree.rootNode, SRC, "a.zig")
  console.log("USES:", (res.relationships??[]).filter((r:any)=>r.type==="uses").map((u:any)=>`${u.source}->${u.target}[${u.metadata?.relationshipType}]`).join(" ")||"-")
}
main()
