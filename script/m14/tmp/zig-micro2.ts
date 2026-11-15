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
  const cases: [string, string][] = [
    ["plain", `const A: u32 = 1;\npub const B = A;\n`],
    ["builtin-call-value", `const A: u32 = 1;\npub const B = ~@as(u32, A);\n`],
    ["hexval", `pub const VFS_CAP_REVISION_MASK = 0xFF000000;\npub const VFS_CAP_FLAGS_MASK = ~@as(u32, VFS_CAP_REVISION_MASK);\n`],
  ]
  for (const [name, src] of cases) {
    const root = await parseSrc(src)
    const ou = mod.deriveZigBareUses(root).map((x: any) => x.target)
    console.log(name, "oracle:", JSON.stringify(ou), "hasError:", root.hasError)
  }
}
main()
