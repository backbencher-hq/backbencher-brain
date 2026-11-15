import * as fs from "fs"
import * as path from "path"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const root = await parseSrc(`const T1: u32 = 1;\nfn f() u32 { return T1; }\n`)
  console.log("oracle:", JSON.stringify(mod.deriveZigBareUses(root).map((x: any) => x.target)));
  // instrument: count identifier visits by reimplementing minimal walk? No - check prepass via behavior:
  const root2 = await parseSrc(`const T1: u32 = 1;\n`)
  console.log("decl-only oracle:", JSON.stringify(mod.deriveZigBareUses(root2).map((x: any) => x.target)));
}
main()
