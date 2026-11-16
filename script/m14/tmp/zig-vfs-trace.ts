import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
async function parse(f: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(fs.readFileSync(f, "utf8")).rootNode
}
async function main() {
  const f = "<corpus-root>/bb_tests/repositories/zig/lib/std/os/linux.zig"
  const src = fs.readFileSync(f, "utf8")
  const root = await parse(f)
  const r: any = await new RealZigAnalyzer().analyze(root, src, "linux.zig")
  for (const e of (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses" && /VFS_CAP|CPU_SETSIZE/.test(x.target))) {
    console.log(`${e.source}->${e.target}`);
  }
  const mod: any = await import("../../../script/m14/differential")
  const ou = mod.deriveZigBareUses(root).filter((x: any) => /VFS_CAP|CPU_SETSIZE/.test(x.target))
  console.log("oracle:", JSON.stringify(ou.map((x: any) => x.target)));
}
main()
